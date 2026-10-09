/**
 * The provider's other three verbs and its lifetime rules, driven against a fake `query()`: observe,
 * steer, stop, the child it must not leave behind, the request's deadline, and the fields it cannot
 * carry to the SDK.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { timeoutMs, TIMER_CEILING_MS } from "@rickylabs/subagents";

import { untranslated } from "../../src/application/provider.js";
import {
  fakeSdk,
  first,
  makeProvider,
  running,
  settle,
  BARE,
  EVIDENCE,
  INIT,
  NOW,
  REQUEST,
  RESULT,
} from "../fixtures/provider.js";

describe("observing", () => {
  it("reports a running run without going to look", async () => {
    const { provider, run } = await running();
    const observation = await provider.observe(run);
    assert.equal(observation.liveness, "running");
    assert.equal(observation.observedAt, NOW);
    assert.equal(observation.detail, "session started");
  });

  it("points at the directory a run's transcripts land in", async () => {
    // The isolated config dir is not the one `harness-telemetry` scans by default, so a run launched
    // here would otherwise leave evidence nothing goes looking for. The directory, not the file:
    // the CLI owns its project-slug scheme, and the backfill walks for `*.jsonl` anyway.
    const { provider, run } = await running();
    assert.deepEqual((await provider.observe(run)).artifacts, [EVIDENCE]);
  });

  it("reports the run as finished once the result arrives", async () => {
    const { provider, fake, run } = await running();
    fake.emit(RESULT);
    await settle();
    const observation = await provider.observe(run);
    assert.equal(observation.liveness, "finished");
    assert.match(observation.detail, /run completed \(success\) after 3 turns/);
    assert.equal(first(provider.records()).costUsd, 0.12);
  });

  it("carries the model note on every observation, not only on the dispatch", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit({ ...INIT, model: "claude-opus-4-1" });
    const dispatched = await provider.dispatch(REQUEST, "run-1");
    const run = dispatched.run;
    if (run === null) throw new Error("expected a run");
    assert.match((await provider.observe(run)).detail, /asked opus-5, running claude-opus-4-1/);
  });
});

// --- steering -----------------------------------------------------------------------------------

describe("steering a run in flight", () => {
  it("delivers the message down the same stream the brief went down", async () => {
    const { provider, fake, run } = await running();
    const result = await provider.steer(run, "also update the README");
    assert.equal(result.verdict, "delivered");
    await settle();
    assert.equal(fake.received.length, 2);
    assert.equal(fake.received[1]?.message.content, "also update the README");
  });

  it("stamps the steer with the session the run is actually in", async () => {
    const { provider, fake, run } = await running();
    await provider.steer(run, "also update the README");
    await settle();
    assert.equal(fake.received[1]?.session_id, "ses_test_0001");
  });

  it("refuses an empty message rather than sending a blank turn", async () => {
    const { provider, run } = await running();
    assert.equal((await provider.steer(run, "   ")).verdict, "refused");
  });

  it("refuses to steer a run that is over", async () => {
    const { provider, fake, run } = await running();
    fake.emit(RESULT);
    await settle();
    const result = await provider.steer(run, "one more thing");
    assert.equal(result.verdict, "refused");
    assert.match(result.detail, /finished/);
  });
});

// --- stopping -----------------------------------------------------------------------------------

describe("stopping a run", () => {
  it("interrupts first, so the agent can put down what it is holding", async () => {
    const { provider, fake, run } = await running();
    const result = await provider.stop(run, "superseded");
    assert.equal(result.verdict, "stopped");
    assert.equal(result.detail, "interrupted: superseded");
    assert.equal(fake.interrupts, 1);
    await settle();
    assert.equal(first(provider.records()).liveness, "finished");
  });

  it("aborts when the query offers no interrupt", async () => {
    const { provider, fake, run } = await running(fakeSdk({ interrupt: false }));
    const result = await provider.stop(run, "budget exhausted");
    assert.equal(result.verdict, "stopped");
    assert.equal(result.detail, "aborted: budget exhausted");
    assert.equal(fake.aborted, true);
    await settle();
    assert.equal(first(provider.records()).liveness, "finished");
  });

  it("reads a stopped run as finished, not failed — the stream dying is the stop working", async () => {
    const { provider, run } = await running();
    await provider.stop(run, "superseded");
    await settle();
    assert.match((await provider.observe(run)).detail, /stopped: superseded/);
  });

  it("treats a run that is already over as a success, because nothing is left to stop", async () => {
    const { provider, fake, run } = await running();
    fake.emit(RESULT);
    await settle();
    assert.equal((await provider.stop(run, "cleanup")).verdict, "already-over");
  });

  it("ends every live run on shutdown", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit(INIT);
    await provider.dispatch(REQUEST, "run-1");
    await provider.dispatch({ ...REQUEST, prompt: "second job" }, "run-2");
    await provider.shutdown("daemon restarting");
    await settle();
    assert.equal(provider.records().length, 2);
    for (const record of provider.records()) {
      assert.equal(record.liveness, "finished", `${record.runId} was left ${record.liveness}`);
    }
  });
});

// --- the child not outliving the stream ---------------------------------------------------------

describe("not leaving a child behind", () => {
  it("aborts the controller when the run finishes cleanly", async () => {
    // #52's second acceptance criterion, structurally: the abort is in a `finally`, so a run that
    // ends by *any* path — result, throw, stop, shutdown — reaps its child. Proving the process
    // table is clean afterwards is a claim about a real box, and belongs to #49.
    const { provider, fake, run } = await running();
    assert.equal(fake.aborted, false);
    fake.emit(RESULT);
    await settle();
    assert.equal(fake.aborted, true);
    assert.equal((await provider.observe(run)).liveness, "finished");
  });

  it("gives every run its own controller", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit(INIT);
    await provider.dispatch(REQUEST, "run-1");
    await provider.dispatch({ ...REQUEST, prompt: "second job" }, "run-2");
    const one = fake.calls[0]?.abortController;
    const two = fake.calls[1]?.abortController;
    assert.equal(one instanceof AbortController, true);
    assert.equal(two instanceof AbortController, true);
    assert.notEqual(one, two);
    await provider.shutdown();
    await settle();
  });
});

// --- the deadline -------------------------------------------------------------------------------

describe("honouring the request's deadline", () => {
  it("converts a Go duration from nanoseconds to milliseconds", () => {
    // `parseGoDuration` reproduces Go's `time.ParseDuration`, which is in **nanoseconds**. Feeding
    // its result to `setTimeout` reads as correct and fails in the most expensive direction there
    // is: `30m` becomes 1.8e12, overflows the 32-bit timer, fires on the next tick, and every
    // bounded run is stopped the instant it starts.
    assert.equal(timeoutMs({ ...REQUEST, timeout: "30m" }), 1_800_000);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "1s" }), 1_000);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "500ms" }), 500);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "1h30m" }), 5_400_000);
  });

  it("arms nothing for a deadline the executor would have discarded anyway", () => {
    assert.equal(timeoutMs(REQUEST), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "" }), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "0" }), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "soon" }), null);
    assert.equal(timeoutMs({ ...REQUEST, timeout: "-5m" }), null);
  });

  it("clamps a deadline past the timer ceiling, and says that it did", () => {
    assert.equal(timeoutMs({ ...REQUEST, timeout: "1000h" }), TIMER_CEILING_MS);
    assert.match(
      untranslated({ ...REQUEST, timeout: "1000h" }).join("; "),
      /clamped to 2147483647ms/,
    );
  });

  it("stops a run that outlives its deadline", async () => {
    const fake = fakeSdk();
    const provider = makeProvider(fake.query);
    fake.emit(INIT);
    const result = await provider.dispatch({ ...REQUEST, timeout: "40ms" }, "run-1");
    assert.equal(result.verdict, "accepted");
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await settle();
    const record = first(provider.records());
    assert.equal(record.liveness, "finished");
    assert.equal(record.detail, "stopped: timeout after 40ms");
  });
});

// --- what does not reach the SDK ----------------------------------------------------------------

describe("naming what cannot be carried", () => {
  it("names effort, which is half of what the matrix pinned", () => {
    assert.deepEqual(untranslated(REQUEST), ["effort=medium (the SDK exposes no effort option)"]);
  });

  it("names every other field the SDK has no option for", () => {
    const lost = untranslated({
      ...REQUEST,
      maxTokens: "500k",
      profile: "reviewer",
      router: "openrouter",
    });
    assert.equal(lost.length, 4);
    assert.match(lost.join("; "), /max-tokens=500k/);
    assert.match(lost.join("; "), /profile=reviewer/);
    assert.match(lost.join("; "), /router=openrouter/);
  });

  it("says nothing about fields that were not set", () => {
    assert.deepEqual(untranslated(BARE), []);
  });
});
