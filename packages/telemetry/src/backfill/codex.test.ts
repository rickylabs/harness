/**
 * Fixtures follow `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` as it is actually written: an
 * envelope of `{timestamp, type, payload}`, with the interesting kind nested at `payload.type`
 * inside an `event_msg`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isoFromUnixSeconds,
  KNOWN_TYPES,
  OBSERVED_UNREAD_ENVELOPES,
  parseCodexRollout,
  quotaFromRateLimits,
  unknownTypeNote,
} from "./codex.js";
import { NOT_AN_OBJECT } from "./jsonl.js";

/** The record alone. Notes are asserted on directly in the degradation suite below. */
const parseRun = (text: string, origin = "o") => parseCodexRollout(text, origin).run;

const lines = (...records: readonly unknown[]): string =>
  records.map((r) => JSON.stringify(r)).join("\n");

const meta = {
  timestamp: "2026-09-04T21:00:00.000Z",
  type: "session_meta",
  payload: {
    session_id: "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d",
    timestamp: "2026-09-04T21:00:00.000Z",
    cwd: "/home/agent/projects/harness/worktrees/orch/divybot-98",
    originator: "codex_cli_rs",
    cli_version: "0.58.0",
    model_provider: "openai",
  },
};

const turn = {
  timestamp: "2026-09-04T21:00:01.000Z",
  type: "turn_context",
  payload: {
    turn_id: "t1",
    cwd: "/home/agent/projects/harness/worktrees/orch/divybot-98",
    model: "gpt-5.6-sol",
    collaboration_mode: { mode: "full-access", settings: { model: "gpt-5.6-sol", reasoning_effort: "xhigh" } },
  },
};

const tokenCount = (total: Record<string, number>, at: string, rateLimits?: unknown) => ({
  timestamp: at,
  type: "event_msg",
  payload: {
    type: "token_count",
    info: { total_token_usage: total, model_context_window: 400_000 },
    ...(rateLimits === undefined ? {} : { rate_limits: rateLimits }),
  },
});

describe("isoFromUnixSeconds", () => {
  it("converts a Unix second", () => {
    assert.equal(isoFromUnixSeconds(1_772_000_000), new Date(1_772_000_000_000).toISOString());
  });

  it("refuses to present a missing value as 1970", () => {
    // A quota that "resets at 1970-01-01" reads as a bug in the account, not a gap in the record.
    for (const bad of [undefined, null, 0, -1, "soon", Number.NaN]) {
      assert.equal(isoFromUnixSeconds(bad), null, `${String(bad)} produced a date`);
    }
  });
});

describe("quotaFromRateLimits", () => {
  it("reads the window position and the plan out of the block", () => {
    const reading = quotaFromRateLimits(
      {
        limit_id: "primary-5h",
        plan_type: "pro",
        primary: { used_percent: 63, window_minutes: 300, resets_at: 1_772_000_000 },
        credits: { has_credits: true, unlimited: false, balance: "12.40" },
      },
      "2026-09-04T21:10:00.000Z",
    );
    assert.ok(reading);
    assert.equal(reading.source, "codex");
    assert.equal(reading.limitId, "primary-5h");
    assert.equal(reading.usedPercent, 63);
    assert.equal(reading.windowMinutes, 300);
    assert.equal(reading.planType, "pro");
    assert.equal(reading.creditBalance, "12.40");
    assert.equal(reading.resetsAt, new Date(1_772_000_000_000).toISOString());
  });

  it("returns nothing when the block carries neither a window nor credits", () => {
    assert.equal(quotaFromRateLimits({ limit_id: "x" }, "2026-09-04T21:10:00.000Z"), null);
  });

  it("keeps a credits-only block, which is the relay account's whole story", () => {
    const reading = quotaFromRateLimits({ credits: { balance: "0.00" } }, "2026-09-04T21:10:00.000Z");
    assert.equal(reading?.creditBalance, "0.00");
    assert.equal(reading?.usedPercent, null);
  });
});

describe("parseCodexRollout", () => {
  it("recovers the launch identity from turn_context, not from prose", () => {
    // The harness invariant is that launch identity is data. This is where a run that claims one
    // model in its brief and ran another becomes visible.
    const run = parseRun(lines(meta, turn), "/store/r.jsonl");
    assert.ok(run);
    assert.deepEqual(run.identity, {
      model: "gpt-5.6-sol",
      effort: "xhigh",
      provider: "openai",
      profile: null,
    });
    assert.equal(run.id, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d");
    assert.deepEqual(run.linkedIssues, [{ number: 98, from: "path" }]);
  });

  it("takes the last token_count as the total, not the sum of them", () => {
    // Codex reports a running total. Summing would multiply the last turn by the number of turns —
    // a number that looks plausible and is wrong by an order of magnitude on a long run.
    const run = parseRun(
      lines(
        meta,
        turn,
        tokenCount({ input_tokens: 100, output_tokens: 10, reasoning_output_tokens: 5, cached_input_tokens: 50 }, "2026-09-04T21:05:00.000Z"),
        tokenCount({ input_tokens: 300, output_tokens: 30, reasoning_output_tokens: 12, cached_input_tokens: 250 }, "2026-09-04T21:09:00.000Z"),
      ),
      "o",
    );
    assert.deepEqual(run?.usage, {
      inputTokens: 300,
      outputTokens: 30,
      reasoningTokens: 12,
      cacheReadTokens: 250,
    });
  });

  it("collects a quota reading per token_count, stamped with when it was observed", () => {
    const run = parseRun(
      lines(
        meta,
        turn,
        tokenCount({ input_tokens: 1 }, "2026-09-04T21:05:00.000Z", { limit_id: "primary-5h", primary: { used_percent: 10, window_minutes: 300 } }),
        tokenCount({ input_tokens: 2 }, "2026-09-04T21:09:00.000Z", { limit_id: "primary-5h", primary: { used_percent: 44, window_minutes: 300 } }),
      ),
      "o",
    );
    assert.equal(run?.quota.length, 2);
    assert.equal(run?.quota[0]?.observedAt, "2026-09-04T21:05:00.000Z");
    assert.equal(run?.quota[1]?.usedPercent, 44);
  });

  it("tracks the last state-bearing event as the outcome", () => {
    const started = lines(meta, turn, { timestamp: "2026-09-04T21:02:00.000Z", type: "event_msg", payload: { type: "task_started" } });
    assert.equal(parseRun(started, "o")?.outcome, "running");

    const finished = `${started}\n${JSON.stringify({ timestamp: "2026-09-04T21:20:00.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "t1", duration_ms: 1080000 } })}`;
    assert.equal(parseRun(finished, "o")?.outcome, "complete");

    const errored = `${started}\n${JSON.stringify({ timestamp: "2026-09-04T21:03:00.000Z", type: "event_msg", payload: { type: "stream_error", message: "upstream reset" } })}`;
    assert.equal(parseRun(errored, "o")?.outcome, "failed");
  });

  it("says unknown when nothing in the file speaks to the outcome", () => {
    assert.equal(parseRun(lines(meta, turn), "o")?.outcome, "unknown");
  });

  it("reads the first user message for the issues in it", () => {
    const run = parseRun(
      lines(meta, turn, { timestamp: "2026-09-04T21:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: "review PR #77" } }),
      "o",
    );
    // 98 is the worktree the rollout was launched in; 77 can only have come from the message.
    assert.deepEqual(run?.linkedIssues, [{ number: 77, from: "prose" }, { number: 98, from: "path" }]);
  });

  it("puts none of the operator's words on the record it returns", () => {
    // See the matching test on the Claude seam: prose is read for issue numbers and dropped there,
    // because a run record is published (finding F-5 on #105).
    const run = parseRun(
      lines(meta, turn, { timestamp: "2026-09-04T21:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: "the passphrase is hunter2" } }),
      "o",
    );
    assert.ok(run);
    const published = JSON.stringify(run);
    assert.equal(published.includes("hunter2"), false, "the prompt reached the record");
    assert.equal(published.includes("/home/agent"), false, "the working directory reached the record");
  });

  it("returns null when the rollout never identified its session", () => {
    assert.equal(parseRun(lines(turn), "o"), null);
  });

  it("survives a half-written last line", () => {
    const run = parseRun(`${lines(meta, turn)}\n{"timestamp":"2026`, "o");
    assert.equal(run?.id, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d");
  });
});

describe("parseCodexRollout, on a rollout it cannot fully read", () => {
  it("survives a line that is JSON but not a record", () => {
    const text = `${lines(meta, turn)}\nnull`;
    const { run, notes } = parseCodexRollout(text, "o");
    assert.equal(run?.id, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d");
    assert.deepEqual(notes, [{ reason: NOT_AN_OBJECT, lines: 1 }]);
  });

  it("reports an envelope type it does not understand, and refuses it the clock", () => {
    const text = lines(meta, turn, {
      type: "warp-drive",
      timestamp: "2026-09-05T09:00:00.000Z",
      payload: {},
    });
    const { run, notes } = parseCodexRollout(text, "o");
    assert.equal(run?.updatedAt, "2026-09-04T21:00:01.000Z");
    assert.deepEqual(notes, [{ reason: unknownTypeNote("warp-drive"), lines: 1 }]);
  });

  it("says nothing about an unfamiliar payload kind, which is expected traffic", () => {
    // `payload.type` is an open union — one member per item kind, and a new tool adds one. Noting
    // those would bury the envelope note that actually means something is going unread.
    const text = lines(meta, turn, {
      type: "response_item",
      timestamp: "2026-09-04T21:00:02.000Z",
      payload: { type: "some_new_tool_call" },
    });
    const { run, notes } = parseCodexRollout(text, "o");
    assert.deepEqual(notes, []);
    assert.equal(run?.updatedAt, "2026-09-04T21:00:02.000Z");
  });

  it("returns null rather than throwing on a reset time too large to be a date", () => {
    // Finding F-4. `new Date(1e20 * 1000).toISOString()` throws, and the throw escaped the seam.
    const text = lines(
      meta,
      turn,
      tokenCount({ input_tokens: 1 }, "2026-09-04T21:05:00.000Z", {
        limit_id: "primary-5h",
        primary: { used_percent: 20, window_minutes: 300, resets_at: 1e20 },
      }),
    );
    const { run, notes } = parseCodexRollout(text, "o");
    assert.equal(run?.quota[0]?.resetsAt, null);
    assert.equal(run?.quota[0]?.usedPercent, 20);
    assert.deepEqual(notes, []);
  });

  it("reports every envelope type the local store was observed to contain as known", () => {
    for (const type of ["compacted", "event_msg", "response_item", "session_meta", "turn_context"]) {
      assert.equal(KNOWN_TYPES.has(type), true, `${type} is not in KNOWN_TYPES`);
    }
  });
});


/**
 * `world_state` and `inter_agent_communication_metadata` were reported as unrecognised on every
 * rollout that held them — 1521 and 1308 occurrences on one host — and for `world_state` that note
 * was a false statement: `repository-run-observation.ts` in this same package reads it on purpose,
 * for scope assertion. A note means this package could not read something.
 */
describe("declared-unread envelopes", () => {
  const at = "2026-09-05T09:00:00.000Z";
  const rollout = (...records: readonly unknown[]): string =>
    records.map((r) => JSON.stringify(r)).join("\n");
  const meta = { type: "session_meta", timestamp: at, payload: { session_id: "s-1", cwd: "/w" } };

  it("says nothing about an envelope it was told not to read", () => {
    const { notes } = parseCodexRollout(rollout(meta,
      { type: "world_state", timestamp: "2026-09-05T10:00:00.000Z", payload: { full: true } }), "o");
    assert.deepEqual(notes, []);
  });

  it("says nothing about the inter-agent metadata envelope either", () => {
    const { notes } = parseCodexRollout(rollout(meta,
      { type: "inter_agent_communication_metadata", timestamp: at, payload: { trigger_turn: true } }), "o");
    assert.deepEqual(notes, []);
  });

  it("still refuses to let a declared-unread envelope move the clock", () => {
    // Quieter must not mean more trusting. The record is unread either way.
    const { run } = parseCodexRollout(rollout(meta,
      { type: "world_state", timestamp: "2026-09-05T23:00:00.000Z", payload: { full: true } }), "o");
    assert.equal(run?.updatedAt, at);
  });

  it("says nothing about token_usage_record, whose counts are read from another envelope", () => {
    // Left noting on a false claim that its counts were unread. They are read from
    // event_msg/token_count, 82862 records against this envelope's 17304 on one store. Issue 328.
    const { notes } = parseCodexRollout(rollout(meta,
      { type: "token_usage_record", timestamp: at, payload: { thread_id: "t" } }), "o");
    assert.deepEqual(notes, []);
    assert.equal(OBSERVED_UNREAD_ENVELOPES.has("token_usage_record"), true);
  });

  it("still reads the counts from the envelope that does carry them", () => {
    // The reason the record above can be skipped. If this ever stops holding, skipping the other
    // becomes a real loss rather than a de-duplication, so the two belong in one another's company.
    const { run } = parseCodexRollout(rollout(meta, {
      type: "event_msg", timestamp: at,
      payload: { type: "token_count", info: { total_token_usage: {
        input_tokens: 11, output_tokens: 22, reasoning_output_tokens: 33, cached_input_tokens: 44 } } },
    }), "o");
    assert.equal(run?.usage.inputTokens, 11);
    assert.equal(run?.usage.outputTokens, 22);
    assert.equal(run?.usage.reasoningTokens, 33);
    assert.equal(run?.usage.cacheReadTokens, 44);
  });

  it("still reports an envelope in neither list, so a real discovery is not silenced", () => {
    const { notes } = parseCodexRollout(rollout(meta, { type: "warp_drive", timestamp: at, payload: {} }), "o");
    assert.deepEqual(notes, [{ reason: unknownTypeNote("warp_drive"), lines: 1 }]);
  });

  it("holds the two lists disjoint", () => {
    for (const type of KNOWN_TYPES) {
      assert.equal(OBSERVED_UNREAD_ENVELOPES.has(type), false, `${type} is both read and declared unread`);
    }
  });

  it("gives every declared-unread envelope a non-empty reason", () => {
    for (const [type, reason] of OBSERVED_UNREAD_ENVELOPES) {
      assert.ok(reason.trim().length > 0, `${type} has an empty reason`);
    }
  });
});
