/**
 * The fold, tested as a value.
 *
 * Every transition in this provider is a pure function, which means the interesting cases can be
 * written down directly instead of being provoked through a live stream. Three of them are load-
 * bearing: a run ends at its first `result` (so nothing after it can reopen it), a stream that ends
 * without a result is a *failure* rather than a quiet success, and a stream that dies after `stop`
 * was asked for is a *success* rather than a failure. Those three lines are what a coordinator reads
 * when it decides whether a worktree is free.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyMessage,
  describe as describeRun,
  endStream,
  isOver,
  markStopping,
  modelNote,
  newRun,
  type MessageReaders,
  type RunRecord,
} from "./run.js";
import { isTurn, readInit, readResult } from "./sdk.js";

const READERS: MessageReaders = { readInit, readResult, isTurn };

const T0 = "2026-09-06T10:00:00.000Z";
const T1 = "2026-09-06T10:00:01.000Z";
const T2 = "2026-09-06T10:00:02.000Z";

function fresh(askedModel = "opus-5"): RunRecord {
  return newRun({
    runId: "run-1",
    askedModel,
    at: T0,
    artifacts: ["/srv/agents/run-1/.claude/projects"],
  });
}

const INIT = { type: "system", subtype: "init", session_id: "ses-1", model: "opus-5" };
const TURN = { type: "assistant" };

function started(record = fresh()): RunRecord {
  return applyMessage(record, INIT, T1, READERS);
}

describe("a run that has not said anything", () => {
  it("is queued, not running, and names no session", () => {
    const record = fresh();
    assert.equal(record.liveness, "queued");
    assert.equal(record.external, null);
    assert.equal(record.reportedModel, null);
    assert.equal(record.turns, 0);
    assert.equal(record.costUsd, null);
    assert.equal(isOver(record), false);
    assert.deepEqual(record.artifacts, ["/srv/agents/run-1/.claude/projects"]);
  });

  it("has not been asked to stop", () => {
    assert.equal(fresh().stopping, false);
    assert.equal(fresh().stopReason, null);
  });
});

describe("the session announcing itself", () => {
  it("records the session id and starts running", () => {
    const record = started();
    assert.equal(record.external, "ses-1");
    assert.equal(record.liveness, "running");
    assert.equal(record.reportedModel, "opus-5");
    assert.equal(record.detail, "session started");
  });

  it("moves updatedAt and leaves startedAt alone", () => {
    const record = started();
    assert.equal(record.startedAt, T0);
    assert.equal(record.updatedAt, T1);
  });

  it("says so when the CLI resolved a different model than the matrix asked for", () => {
    // Recorded, not refused — see `modelNote`. The value of this line is that it reaches telemetry
    // at the moment of substitution rather than being reconstructed from a transcript later.
    const record = applyMessage(fresh("opus-5"), { ...INIT, model: "claude-opus-4-1" }, T1, READERS);
    assert.equal(modelNote(record), "asked opus-5, running claude-opus-4-1");
    assert.equal(describeRun(record), "session started; asked opus-5, running claude-opus-4-1");
  });

  it("does not bake the note into the detail, which would print it twice", () => {
    const record = applyMessage(fresh("opus-5"), { ...INIT, model: "sonnet-5" }, T1, READERS);
    assert.equal(record.detail, "session started");
  });

  it("has no note when the model came back as asked, or has not come back yet", () => {
    assert.equal(modelNote(started()), null);
    assert.equal(modelNote(fresh()), null);
    assert.equal(modelNote(applyMessage(fresh(), { ...INIT, model: null }, T1, READERS)), null);
  });
});

describe("working", () => {
  it("counts turns and keeps the run running", () => {
    let record = started();
    record = applyMessage(record, TURN, T2, READERS);
    record = applyMessage(record, { type: "user" }, T2, READERS);
    assert.equal(record.turns, 2);
    assert.equal(record.liveness, "running");
    assert.equal(record.detail, "working (2 turns)");
  });

  it("ignores messages that are neither init, result nor turn", () => {
    const record = started();
    const after = applyMessage(record, { type: "stream_event" }, T2, READERS);
    assert.equal(after, record);
  });
});

describe("the run ending", () => {
  it("finishes on a successful result, and keeps what it cost", () => {
    const record = applyMessage(
      started(),
      { type: "result", subtype: "success", num_turns: 7, total_cost_usd: 0.31 },
      T2,
      READERS,
    );
    assert.equal(record.liveness, "finished");
    assert.equal(record.costUsd, 0.31);
    assert.equal(record.detail, "run completed (success) after 7 turns");
    assert.equal(isOver(record), true);
  });

  it("fails on an error result", () => {
    const record = applyMessage(
      started(),
      { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 40 },
      T2,
      READERS,
    );
    assert.equal(record.liveness, "failed");
    assert.equal(record.detail, "run ended in error (error_max_turns) after 40 turns");
  });

  it("falls back to its own turn count when the result does not carry one", () => {
    let record = started();
    record = applyMessage(record, TURN, T2, READERS);
    record = applyMessage(record, { type: "result" }, T2, READERS);
    assert.equal(record.detail, "run completed (success) after 1 turns");
  });

  it("leaves the cost alone when the result does not name one", () => {
    const record = applyMessage(started(), { type: "result" }, T2, READERS);
    assert.equal(record.costUsd, null);
  });

  it("cannot be reopened by anything still in flight behind the result", () => {
    // The inbox is closed by the same event, so messages after this describe a run whose state has
    // already been reported. Reopening it would un-finish a run a coordinator may have acted on.
    const over = applyMessage(started(), { type: "result" }, T2, READERS);
    assert.equal(applyMessage(over, TURN, T2, READERS), over);
    assert.equal(applyMessage(over, INIT, T2, READERS), over);
  });
});

describe("the stream ending", () => {
  it("is a failure when no result arrived, because the outcome is not known", () => {
    const record = endStream(started(), T2, null);
    assert.equal(record.liveness, "failed");
    assert.match(record.detail, /ended without a result/);
  });

  it("is a failure carrying the error when the generator threw", () => {
    const record = endStream(started(), T2, "socket hang up");
    assert.equal(record.liveness, "failed");
    assert.equal(record.detail, "the run ended: socket hang up");
  });

  it("is a success when a stop was asked for — the stream dying is the stop working", () => {
    const record = endStream(markStopping(started(), "superseded by #91", T2), T2, "aborted");
    assert.equal(record.liveness, "finished");
    assert.equal(record.detail, "stopped: superseded by #91");
  });

  it("says something even when the stop carried no reason", () => {
    const stopping = { ...started(), stopping: true, stopReason: null };
    assert.equal(endStream(stopping, T2, null).detail, "stopped: no reason given");
  });

  it("changes nothing for a run that already ended", () => {
    const over = applyMessage(started(), { type: "result" }, T2, READERS);
    assert.equal(endStream(over, T2, "socket hang up"), over);
  });
});

describe("marking a stop", () => {
  it("records that it was deliberate, without ending the run itself", () => {
    const record = markStopping(started(), "budget exhausted", T2);
    assert.equal(record.stopping, true);
    assert.equal(record.stopReason, "budget exhausted");
    assert.equal(record.liveness, "running");
    assert.equal(record.updatedAt, T2);
  });
});

describe("the line an observer reads", () => {
  it("appends the model note to whatever the run is currently doing", () => {
    let record = applyMessage(fresh("opus-5"), { ...INIT, model: "sonnet-5" }, T1, READERS);
    record = applyMessage(record, TURN, T2, READERS);
    assert.equal(describeRun(record), "working (1 turns); asked opus-5, running sonnet-5");
  });

  it("is just the detail when nothing was substituted", () => {
    assert.equal(describeRun(started()), "session started");
  });
});

describe("the readers being injected", () => {
  it("lets the fold work on messages that are not the SDK's", () => {
    // The point of the injection: a correction to the vendor's wire shape stays inside `sdk.ts`,
    // and this module keeps meaning the same thing.
    const readers: MessageReaders = {
      readInit: (message) => (message === "hello" ? { sessionId: "x", model: null } : null),
      readResult: () => null,
      isTurn: (message) => message === "tick",
    };
    let record = applyMessage(fresh(), "hello", T1, readers);
    assert.equal(record.external, "x");
    assert.equal(record.liveness, "running");
    record = applyMessage(record, "tick", T2, readers);
    assert.equal(record.turns, 1);
  });
});
