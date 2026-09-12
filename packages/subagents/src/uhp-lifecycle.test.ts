/**
 * UHP lifecycle to `RunLiveness`, checked row by row against the table in issue #287.
 *
 * Spike S11, issue #289. Run artifacts: `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * These tests prove that this repository maps a given status to a given word. They prove nothing about
 * which statuses a real HarnessRouter emits, or when. The fixtures are written from the specification;
 * the live check is issue #294.
 *
 * The distinctions under test are the three that cost something when collapsed:
 *
 *   cancelled vs failed      — blaming an operator for a stop they asked for, and letting a
 *                              failure-keyed retry policy relaunch it
 *   incomplete vs failed     — a budget ceiling read as a defect, so the fix is attempted in the code
 *                              instead of in the limit
 *   unknown vs failed        — a dropped connection read as a dead agent, which is the one with a
 *                              destructive action attached: a lease reclaimed under a live run
 *
 * `assert.notEqual(verdict.liveness, "finished")` would pass for two of the three while they were
 * broken, so each test asserts the pair that must differ.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RunLiveness, RunRef } from "./provider.js";
import { mapUhpOutcome, uhpObservation, type UhpLifecycleVerdict, type UhpOutcome } from "./uhp-lifecycle.js";
import { UHP_LIFECYCLE_FIXTURES, UHP_TURNS, startUhpTurnMock } from "./uhp-mock.js";
import { consumeUhpStream } from "./uhp-stream.js";
import { UHP_LIFECYCLE_STATUSES, type UhpLifecycleStatus } from "./uhp-wire.js";

const RUN: RunRef = { runId: "run_s11", provider: "uhp", external: "sess_s11" };

function lifecycle(status: UhpLifecycleStatus): UhpLifecycleVerdict {
  return mapUhpOutcome({ kind: "lifecycle", status });
}

describe("lifecycle mapping — the #287 table, row by row", () => {
  /** The table, transcribed from the issue rather than from the implementation. */
  const table: readonly (readonly [UhpLifecycleStatus, RunLiveness, string | null, "budget" | null])[] = [
    ["in_progress", "running", null, null],
    ["completed", "finished", null, null],
    ["failed", "failed", null, null],
    ["cancelled", "finished", "stopped", null],
    ["incomplete", "failed", null, "budget"],
  ];

  it("covers every status the protocol defines", () => {
    assert.deepEqual(table.map(([status]) => status).sort(), [...UHP_LIFECYCLE_STATUSES].sort());
  });

  for (const [status, liveness, stop, limit] of table) {
    it(`maps ${status} to ${liveness}${stop === null ? "" : ` with a ${stop} stop verdict`}${limit === null ? "" : ` and a ${limit} detail`}`, () => {
      const verdict = lifecycle(status);
      assert.equal(verdict.liveness, liveness);
      assert.equal(verdict.stop, stop);
      assert.equal(verdict.limit, limit);
      assert.ok(verdict.detail.length > 0);
    });
  }

  it("never reports queued, because UHP does not split accepted from running", () => {
    for (const status of UHP_LIFECYCLE_STATUSES) {
      assert.notEqual(lifecycle(status).liveness, "queued");
    }
  });

  it("never reports unknown for a status the server actually sent", () => {
    // `unknown` is reserved for "nobody knows". A status that fell through a switch and landed there
    // would look like caution and would in fact be a lost report.
    for (const status of UHP_LIFECYCLE_STATUSES) {
      assert.notEqual(lifecycle(status).liveness, "unknown");
    }
  });
});

describe("lifecycle mapping — the three distinctions that cost something when collapsed", () => {
  it("separates cancelled from failed, in liveness and in the stop verdict", () => {
    const cancelled = lifecycle("cancelled");
    const failed = lifecycle("failed");

    assert.equal(cancelled.liveness, "finished");
    assert.equal(failed.liveness, "failed");
    assert.notEqual(cancelled.liveness, failed.liveness);
    // The stop verdict is the other half: `finished` alone does not record that someone stopped it.
    assert.equal(cancelled.stop, "stopped");
    assert.equal(failed.stop, null);
    assert.notDeepEqual(cancelled, failed);
  });

  it("separates incomplete from failed, which share a liveness word and nothing else", () => {
    const incomplete = lifecycle("incomplete");
    const failed = lifecycle("failed");

    // Both are `failed`: the work did not finish. Asserting only the liveness would make this test pass
    // for a mapping that dropped the budget signal entirely.
    assert.equal(incomplete.liveness, "failed");
    assert.equal(failed.liveness, "failed");
    assert.equal(incomplete.limit, "budget");
    assert.equal(failed.limit, null);
    assert.notEqual(incomplete.limit, failed.limit);
    assert.notDeepEqual(incomplete, failed);
    // The word #287 names is in the detail too, for a reader who never looks at the field.
    assert.match(incomplete.detail, /^budget/);
    assert.doesNotMatch(failed.detail, /budget/);
  });

  it("separates a transport failure from a failed run, in both directions", () => {
    const transportFailures: readonly UhpOutcome[] = [
      { kind: "unreachable" },
      { kind: "unreachable", cause: "ECONNREFUSED" },
      { kind: "not-found" },
      { kind: "not-found", code: "response_not_found" },
      { kind: "not-found", code: "session_expired" },
      { kind: "transport", httpStatus: 500 },
      { kind: "transport", httpStatus: 502 },
      { kind: "unreadable", refusal: "truncated" },
      { kind: "unreadable", refusal: "sequence-broken" },
    ];
    const failed = lifecycle("failed");

    for (const outcome of transportFailures) {
      const verdict = mapUhpOutcome(outcome);
      assert.equal(verdict.liveness, "unknown");
      // Not `failed`: the network said nothing about the agent. Not `finished` either, which would be
      // the other convenient lie.
      assert.notEqual(verdict.liveness, failed.liveness);
      assert.notEqual(verdict.liveness, "finished");
      assert.equal(verdict.stop, null);
      assert.equal(verdict.limit, null);
      assert.ok(verdict.detail.length > 0);
    }
  });

  it("does not treat an unreadable stream as a failed run", () => {
    // The seam between the two modules. `readUhpStream` refusing a stream is a statement about our
    // reading; the run is probably still going, because "A dropped connection MUST NOT abort the task."
    const state = consumeUhpStream("data: not json\n\n");
    assert.equal(state.ok, false);
    assert.ok(!state.ok);
    const verdict = mapUhpOutcome({ kind: "unreadable", refusal: state.refusal });
    assert.equal(verdict.liveness, "unknown");
    assert.notEqual(verdict.liveness, "failed");
    assert.match(verdict.detail, /not a failed run/);
  });

  it("distinguishes all four outcomes a status screen must not merge", () => {
    const words = [
      lifecycle("in_progress").liveness,
      lifecycle("completed").liveness,
      lifecycle("failed").liveness,
      mapUhpOutcome({ kind: "unreachable" }).liveness,
    ];
    assert.equal(new Set(words).size, 4);
  });
});

describe("lifecycle mapping into the seam's Observation", () => {
  it("carries the run, the clock and the mapped liveness without inventing artifacts", () => {
    const observedAt = "2026-09-12T10:00:00.000Z";
    const observation = uhpObservation(RUN, { kind: "lifecycle", status: "completed" }, observedAt);
    assert.deepEqual(observation.run, RUN);
    assert.equal(observation.liveness, "finished");
    assert.equal(observation.observedAt, observedAt);
    // Nothing is parsed out of the agent's prose. A fabricated pull request url on a run record is
    // worse than an empty list, and #294 owns the question with a real router to check against.
    assert.deepEqual(observation.artifacts, []);
    assert.equal(observation.detail, mapUhpOutcome({ kind: "lifecycle", status: "completed" }).detail);
  });

  it("keeps the run reachable on an unknown outcome, because that is when it is needed", () => {
    const observation = uhpObservation(RUN, { kind: "unreachable" }, "2026-09-12T10:00:00.000Z");
    assert.equal(observation.liveness, "unknown");
    assert.equal(observation.run.runId, RUN.runId);
    assert.equal(observation.run.external, RUN.external);
  });

  it("passes artifacts through when a caller has some, without deriving them", () => {
    const observation = uhpObservation(
      RUN,
      { kind: "lifecycle", status: "completed" },
      "2026-09-12T10:00:00.000Z",
      ["feat/uhp-stream-adapter--s11"],
    );
    assert.deepEqual(observation.artifacts, ["feat/uhp-stream-adapter--s11"]);
  });
});

describe("lifecycle mapping over a real socket", () => {
  it("maps a 404 from an unknown previous_response_id to unknown, not to failed", async () => {
    // Sessions §1: an unknown `previous_response_id` is `404` with `code: "response_not_found"`. The
    // mock enforces it, and #287 maps a 404 to `unknown`.
    const mock = await startUhpTurnMock();
    try {
      const exchange = await mock.send({ input: "continue", previous_response_id: "resp_never_existed" });
      assert.equal(exchange.httpStatus, 404);
      assert.match(exchange.body, /response_not_found/);

      const verdict = mapUhpOutcome({ kind: "not-found", code: "response_not_found" });
      assert.equal(verdict.liveness, "unknown");
      assert.notEqual(verdict.liveness, "failed");
      assert.notEqual(verdict.liveness, "finished");
    } finally {
      await mock.close();
    }
  });

  it("maps the streamed terminal status of a real exchange, reading the response and not the event", async () => {
    const mock = await startUhpTurnMock([UHP_LIFECYCLE_FIXTURES.cancelled], { deltas: ["par", "tial"] });
    try {
      const exchange = await mock.send({ input: "long task", stream: true });
      const state = consumeUhpStream(exchange.body);
      assert.ok(state.ok && state.done);
      const verdict = mapUhpOutcome({ kind: "lifecycle", status: state.status });
      assert.equal(verdict.liveness, "finished");
      assert.equal(verdict.stop, "stopped");
      assert.notEqual(verdict.liveness, "failed");
    } finally {
      await mock.close();
    }
  });

  it("reaches every scripted turn id, so the chain fixtures are what the mapping saw", async () => {
    // A guard on the fixture rather than on the mapping: three distinct response ids, so a chain test
    // cannot accidentally pass by serving one turn three times.
    assert.equal(new Set(UHP_TURNS.map((turn) => turn.id)).size, 3);
  });
});
