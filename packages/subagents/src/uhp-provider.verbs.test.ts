/**
 * `provider-uhp`: `observe`, `steer` and `stop` over the loopback mock. How these suites are built is
 * described in `uhp-provider.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type RunRef } from "./provider.js";
import { type UhpResponse } from "./uhp-mock.js";
import {
  harnessed,
  request,
  response,
  MODEL,
  SESSION,
  SUBSTITUTE,
} from "./fixtures/uhp-provider.js";

describe("observe — the #287 mapping, read from the stored response", () => {
  const mapping = [
    { status: "in_progress", liveness: "running" },
    { status: "completed", liveness: "finished" },
    { status: "failed", liveness: "failed" },
    { status: "cancelled", liveness: "finished" },
    { status: "incomplete", liveness: "failed" },
  ] as const;

  for (const { status, liveness } of mapping) {
    it(`maps ${status} to ${liveness}`, async () => {
      const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status }) }) });
      const dispatched = await provider.dispatch(request, `run-observe-${status}`);
      const observed = await provider.observe(dispatched.run as RunRef);
      assert.equal(observed.liveness, liveness);
      assert.equal(observed.run.runId, `run-observe-${status}`);
      // `artifacts` stays empty: a UHP response's output is the agent's prose, and recovering a branch or
      // a pull request url from it is a parsing job with its own failure modes (#294 owns it). A fabricated
      // url on a run record is worse than an empty list.
      assert.deepEqual(observed.artifacts, []);
    });
  }

  it("keeps cancelled apart from failed, which is the row most likely to be collapsed", async () => {
    const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status: "cancelled" }) }) });
    const cancelled = await provider.observe((await provider.dispatch(request, "run-cancelled")).run as RunRef);
    const { provider: failing } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status: "failed" }) }) });
    const failed = await provider.observe((await failing.dispatch(request, "run-failed")).run as RunRef);
    assert.equal(cancelled.liveness, "finished");
    assert.notEqual(cancelled.liveness, failed.liveness);
    assert.ok(cancelled.detail.includes("cancelled"));
  });

  it("reports a 404 as unknown rather than synthesizing a terminal state", async () => {
    const { provider } = await harnessed({
      read: () => ({ httpStatus: 404, body: { error: { code: "session_expired" } } }),
    });
    const observed = await provider.observe((await provider.dispatch(request, "run-404")).run as RunRef);
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("session_expired"));
  });

  it("reports an unreadable body as unknown", async () => {
    const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: { nothing: true } }) });
    const observed = await provider.observe((await provider.dispatch(request, "run-unreadable")).run as RunRef);
    assert.equal(observed.liveness, "unknown");
  });

  it("refuses to attribute a read-back that reports a different session", async () => {
    const { provider } = await harnessed({
      read: () => ({ httpStatus: 200, body: response({ status: "completed", metadata: { session_id: "sess_elsewhere" } }) }),
    });
    const observed = await provider.observe((await provider.dispatch(request, "run-moved")).run as RunRef);
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("cannot change session"));
  });

  it("is unknown for a run this provider has never dispatched", async () => {
    const { provider } = await harnessed();
    const observed = await provider.observe({ runId: "never-dispatched", provider: "uhp", external: null });
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("no recorded turn"));
  });

  it("is unknown for a run owned by another provider", async () => {
    const { provider } = await harnessed();
    const observed = await provider.observe({ runId: "someone-elses", provider: "codex", external: "thread_1" });
    assert.equal(observed.liveness, "unknown");
    assert.ok(observed.detail.includes("owned by provider codex"));
  });

  it("names a substitution that only appears on the read-back", async () => {
    const substituted = response({
      status: "completed",
      model: SUBSTITUTE,
      metadata: { session_id: SESSION, requested_model: MODEL, model_fallback: true },
    });
    const { provider } = await harnessed({ read: () => ({ httpStatus: 200, body: substituted }) });
    const late = await provider.observe((await provider.dispatch(request, "run-late-sub")).run as RunRef);
    assert.equal(late.liveness, "finished");
    assert.ok(late.detail.includes("contradiction of the requested route"));

    // Paired control on the same shape: a clean read-back says nothing of the kind, so the assertion above
    // is about the substitution rather than about the sentence always being there.
    const { provider: clean } = await harnessed({ read: () => ({ httpStatus: 200, body: response({ status: "completed" }) }) });
    const fine = await clean.observe((await clean.dispatch(request, "run-clean-read")).run as RunRef);
    assert.equal(fine.detail.includes("contradiction of the requested route"), false);
  });
});

/* -------------------------------------------------------------------------------------------------
 * steer
 * ---------------------------------------------------------------------------------------------- */

describe("steer — continuation at a turn boundary, not injection into a live turn", () => {
  it("refuses a second turn while the first is still running, without sending anything", async () => {
    const { provider, tasks } = await harnessed();
    const dispatched = await provider.dispatch(request, "run-busy");
    assert.equal(tasks.length, 1);
    const steered = await provider.steer(dispatched.run as RunRef, "and also fix the tests");
    assert.equal(steered.verdict, "refused");
    assert.ok(steered.detail.includes("prior-turn-open"));
    // Nothing was sent: Lifecycle §5 would have answered `409 session_busy`, and a local refusal costs no
    // round trip and no ambiguity about whether the message landed.
    assert.equal(tasks.length, 1);
  });

  it("delivers the next turn once the previous one is terminal, chaining on the response id", async () => {
    const turns: readonly UhpResponse[] = [
      response({ id: "resp_turn_a", status: "completed" }),
      response({ id: "resp_turn_b", status: "in_progress" }),
    ];
    const { provider, tasks } = await harnessed({
      task: (_body, index) => ({ httpStatus: 200, response: turns[Math.min(index, turns.length - 1)] as UhpResponse }),
    });
    const dispatched = await provider.dispatch(request, "run-steer");
    const steered = await provider.steer(dispatched.run as RunRef, "now add tests");
    assert.equal(steered.verdict, "delivered");
    assert.equal(tasks.length, 2);
    assert.equal((tasks[1] as Record<string, unknown>)["previous_response_id"], "resp_turn_a");
    assert.equal((tasks[1] as Record<string, unknown>)["input"], "now add tests");
    assert.equal(provider.sessions()["run-steer"]?.turns.length, 2);
  });

  it("refuses an empty message and a run it does not hold", async () => {
    const { provider, tasks } = await harnessed();
    const dispatched = await provider.dispatch(request, "run-empty-steer");
    assert.equal((await provider.steer(dispatched.run as RunRef, "   ")).verdict, "refused");
    assert.equal(tasks.length, 1);
    const orphan = await provider.steer({ runId: "unknown-run", provider: "uhp", external: null }, "hello");
    assert.equal(orphan.verdict, "unknown");
  });

  it("reports an expired session as unknown and a rejected turn as refused", async () => {
    const first = response({ id: "resp_turn_a", status: "completed" });
    const { provider: expired } = await harnessed({
      task: (_body, index) => index === 0
        ? { httpStatus: 200, response: first }
        : { httpStatus: 404, error: { code: "session_expired" } },
    });
    const expiredRun = (await expired.dispatch(request, "run-expired")).run as RunRef;
    const expiredSteer = await expired.steer(expiredRun, "continue");
    assert.equal(expiredSteer.verdict, "unknown");
    assert.ok(expiredSteer.detail.includes("session_expired"));

    const { provider: busy } = await harnessed({
      task: (_body, index) => index === 0
        ? { httpStatus: 200, response: first }
        : { httpStatus: 409, error: { code: "session_busy" } },
    });
    const busyRun = (await busy.dispatch(request, "run-remote-busy")).run as RunRef;
    const busySteer = await busy.steer(busyRun, "continue");
    assert.equal(busySteer.verdict, "refused");
    // The distinction: one says the message did not land, the other says nobody knows.
    assert.notEqual(busySteer.verdict, expiredSteer.verdict);
  });

  it("names a substitution on a continuation while still reporting the turn as delivered", async () => {
    const first = response({ id: "resp_turn_a", status: "completed" });
    const substituted = response({
      id: "resp_turn_b",
      status: "in_progress",
      model: SUBSTITUTE,
      metadata: { session_id: SESSION, requested_model: MODEL, model_fallback: true },
    });
    const { provider } = await harnessed({
      task: (_body, index) => ({ httpStatus: 200, response: (index === 0 ? first : substituted) }),
    });
    const run = (await provider.dispatch(request, "run-steer-sub")).run as RunRef;
    const steered = await provider.steer(run, "continue");
    // `delivered` is a claim about the message, and the message landed. The contradiction is a different
    // fact, and `SteerResult` has nowhere structured to carry it — recorded as a proposal in the run notes.
    assert.equal(steered.verdict, "delivered");
    assert.ok(steered.detail.includes("contradiction of the requested route"));
  });
});

/* -------------------------------------------------------------------------------------------------
 * stop — the three outcomes the downstream consumer asked to be able to tell apart
 * ---------------------------------------------------------------------------------------------- */

describe("stop — cancelled, already-over and unknown stay three answers", () => {
  it("reports a cancelled task as stopped", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "cancelled" }) }) });
    const run = (await provider.dispatch(request, "run-stop")).run as RunRef;
    const stopped = await provider.stop(run, "reclaiming capacity");
    assert.equal(stopped.verdict, "stopped");
  });

  it("reports an already-terminal task as already-over, which is a success", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "completed" }) }) });
    const run = (await provider.dispatch(request, "run-stop-late")).run as RunRef;
    const stopped = await provider.stop(run, "reclaiming capacity");
    assert.equal(stopped.verdict, "already-over");
  });

  it("reports a 404 or an expired session as unknown rather than a synthesized terminal state", async () => {
    for (const code of ["response_not_found", "session_expired"]) {
      const { provider } = await harnessed({ cancel: () => ({ httpStatus: 404, body: { error: { code } } }) });
      const run = (await provider.dispatch(request, `run-stop-${code}`)).run as RunRef;
      const stopped = await provider.stop(run, "reclaiming capacity");
      // The downstream fixture asserts exactly this path: a provider that collapsed it into `stopped` or
      // `already-over` would produce a false green two repositories away.
      assert.equal(stopped.verdict, "unknown");
      assert.notEqual(stopped.verdict, "stopped");
      assert.notEqual(stopped.verdict, "already-over");
      assert.ok(stopped.detail.includes(code));
    }
  });

  it("reports a task that has not stopped yet as unknown, because cancellation is a request", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "in_progress" }) }) });
    const run = (await provider.dispatch(request, "run-stop-slow")).run as RunRef;
    const stopped = await provider.stop(run, "reclaiming capacity");
    assert.equal(stopped.verdict, "unknown");
    assert.ok(stopped.detail.includes("has not reached a terminal state"));
  });

  it("is unknown for a run it cannot name, and does not call the endpoint", async () => {
    let cancels = 0;
    const { provider } = await harnessed({
      cancel: () => {
        cancels += 1;
        return { httpStatus: 200, body: response({ status: "cancelled" }) };
      },
    });
    const stopped = await provider.stop({ runId: "never-here", provider: "uhp", external: null }, "why not");
    assert.equal(stopped.verdict, "unknown");
    assert.equal(cancels, 0);
  });

  it("advances the ledger on a cancelled task so a later steer is not refused as busy", async () => {
    const { provider } = await harnessed({ cancel: () => ({ httpStatus: 200, body: response({ status: "cancelled" }) }) });
    const run = (await provider.dispatch(request, "run-stop-advance")).run as RunRef;
    assert.equal(provider.sessions()["run-stop-advance"]?.turns[0]?.status, "in_progress");
    await provider.stop(run, "reclaiming capacity");
    assert.equal(provider.sessions()["run-stop-advance"]?.turns[0]?.status, "cancelled");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The readers S10 found empty, kept anyway
 * ---------------------------------------------------------------------------------------------- */
