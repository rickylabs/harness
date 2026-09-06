/**
 * The vendor boundary, tested as what it is: a guess about someone else's shapes.
 *
 * Two different jobs here. The readers are tested against malformed input because that is the
 * failure mode a structural boundary actually has — a renamed field arrives as a message that no
 * longer matches, and the question is whether that produces a `null` the fold can handle or a
 * `TypeError` in a background loop. `userMessage` is tested for its *key set*, because it travels
 * the other way and a wrong key there is invisible: the CLI drops the message, `steer` reports
 * `delivered`, and nobody learns until a run ignores an instruction.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTurn, readInit, readResult, userMessage } from "./sdk.js";

const INIT = {
  type: "system",
  subtype: "init",
  session_id: "ses-9",
  model: "claude-opus-4-1",
  cwd: "/work/harness",
  tools: ["Bash"],
};

describe("the message we construct", () => {
  it("has exactly the fields the SDK's user message declares", () => {
    // The pin. If #49 comes back with a correction, it changes this list and one constructor.
    assert.deepEqual(Object.keys(userMessage("hi")).sort(), [
      "message",
      "parent_tool_use_id",
      "session_id",
      "type",
    ]);
  });

  it("carries the content verbatim and nests it the way the SDK does", () => {
    assert.deepEqual(userMessage("do the thing"), {
      type: "user",
      message: { role: "user", content: "do the thing" },
      parent_tool_use_id: null,
      session_id: "",
    });
  });

  it("takes a session id when the run has one, and defaults to empty rather than undefined", () => {
    assert.equal(userMessage("x", "ses-9").session_id, "ses-9");
    assert.equal(userMessage("x").session_id, "");
  });
});

describe("reading the init message", () => {
  it("reads the session id, the resolved model and the working directory", () => {
    assert.deepEqual(readInit(INIT), {
      sessionId: "ses-9",
      model: "claude-opus-4-1",
      cwd: "/work/harness",
    });
  });

  it("is not an init message without a session id", () => {
    // The only reason dispatch waits for this message. A system/init that cannot name the session
    // has told us nothing, and resolving the wait on it would report a run we cannot address.
    assert.equal(readInit({ type: "system", subtype: "init" }), null);
    assert.equal(readInit({ ...INIT, session_id: "" }), null);
    assert.equal(readInit({ ...INIT, session_id: 7 }), null);
  });

  it("ignores every other message, and anything that is not a message", () => {
    assert.equal(readInit({ type: "system", subtype: "compact_boundary" }), null);
    assert.equal(readInit({ type: "assistant" }), null);
    assert.equal(readInit(null), null);
    assert.equal(readInit("system"), null);
    assert.equal(readInit(undefined), null);
  });

  it("survives a release that drops the fields it does not need", () => {
    assert.deepEqual(readInit({ type: "system", subtype: "init", session_id: "s" }), {
      sessionId: "s",
      model: null,
      cwd: null,
    });
  });
});

describe("reading the result message", () => {
  it("reads the outcome and what the run cost", () => {
    assert.deepEqual(
      readResult({
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 12,
        duration_ms: 4321,
        total_cost_usd: 0.42,
      }),
      { subtype: "success", isError: false, numTurns: 12, durationMs: 4321, costUsd: 0.42 },
    );
  });

  it("treats only an explicit `true` as an error", () => {
    // A missing field is not an error, and neither is a truthy string. The difference decides
    // whether a completed run lands on the board as done or as failed.
    assert.equal(readResult({ type: "result" })?.isError, false);
    assert.equal(readResult({ type: "result", is_error: "yes" })?.isError, false);
    assert.equal(readResult({ type: "result", is_error: true })?.isError, true);
  });

  it("reports absent or unusable numbers as null rather than zero", () => {
    const line = readResult({ type: "result", num_turns: "many", total_cost_usd: Number.NaN });
    assert.equal(line?.numTurns, null);
    assert.equal(line?.costUsd, null);
    assert.equal(line?.durationMs, null);
  });

  it("ignores every other message", () => {
    assert.equal(readResult(INIT), null);
    assert.equal(readResult(null), null);
  });
});

describe("recognising a turn", () => {
  it("counts assistant and user messages, and nothing else", () => {
    assert.equal(isTurn({ type: "assistant" }), true);
    assert.equal(isTurn({ type: "user" }), true);
    assert.equal(isTurn(INIT), false);
    assert.equal(isTurn({ type: "result" }), false);
    assert.equal(isTurn({ type: "stream_event" }), false);
    assert.equal(isTurn(null), false);
  });
});
