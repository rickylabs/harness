/**
 * Fixtures follow `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` as it is actually written: an
 * envelope of `{timestamp, type, payload}`, with the interesting kind nested at `payload.type`
 * inside an `event_msg`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoFromUnixSeconds, parseCodexRollout, quotaFromRateLimits } from "./codex.js";

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
    const run = parseCodexRollout(lines(meta, turn), "/store/r.jsonl");
    assert.ok(run);
    assert.deepEqual(run.identity, { model: "gpt-5.6-sol", effort: "xhigh", provider: "openai" });
    assert.equal(run.id, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d");
    assert.deepEqual(run.linkedIssues, [98]);
  });

  it("takes the last token_count as the total, not the sum of them", () => {
    // Codex reports a running total. Summing would multiply the last turn by the number of turns —
    // a number that looks plausible and is wrong by an order of magnitude on a long run.
    const run = parseCodexRollout(
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
    const run = parseCodexRollout(
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
    assert.equal(parseCodexRollout(started, "o")?.outcome, "running");

    const finished = `${started}\n${JSON.stringify({ timestamp: "2026-09-04T21:20:00.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "t1", duration_ms: 1080000 } })}`;
    assert.equal(parseCodexRollout(finished, "o")?.outcome, "complete");

    const errored = `${started}\n${JSON.stringify({ timestamp: "2026-09-04T21:03:00.000Z", type: "event_msg", payload: { type: "stream_error", message: "upstream reset" } })}`;
    assert.equal(parseCodexRollout(errored, "o")?.outcome, "failed");
  });

  it("says unknown when nothing in the file speaks to the outcome", () => {
    assert.equal(parseCodexRollout(lines(meta, turn), "o")?.outcome, "unknown");
  });

  it("takes the first user message as the title", () => {
    const run = parseCodexRollout(
      lines(meta, turn, { timestamp: "2026-09-04T21:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: "review PR #98" } }),
      "o",
    );
    assert.equal(run?.title, "review PR #98");
  });

  it("returns null when the rollout never identified its session", () => {
    assert.equal(parseCodexRollout(lines(turn), "o"), null);
  });

  it("survives a half-written last line", () => {
    const run = parseCodexRollout(`${lines(meta, turn)}\n{"timestamp":"2026`, "o");
    assert.equal(run?.id, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d");
  });
});
