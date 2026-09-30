import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountUsageEnvelope, AccountQuotaSnapshot, SessionUsage } from "@rickylabs/harness-contracts";
import { collectAccountUsage, inferUnattributedUsage, readAccountUsageSource, sessionUsage, storedQuota, usageScopeHash, type AccountUsageSource } from "./account-usage.js";
import { parseCodexRollout, quotasFromRateLimits } from "./backfill/codex.js";
import { backfillFromDisk } from "./backfill/index.js";
import { parseClaudeTranscript } from "./backfill/claude.js";
const key = Buffer.alloc(32, 7), from = "2026-01-02T12:00:00.000Z", to = "2026-01-02T12:03:00.000Z", reset = "2026-01-03T12:00:00.000Z";
const reading = (at: string, usedPercent: number): AccountQuotaSnapshot => ({ vendor: "codex", accountRef: `aref:v1:codex:${"b".repeat(43)}`,
  limitId: "meter-a", window: "weekly", usedPercent, resetsAt: reset, observedAt: at, observedBy: null, source: "account-poll", availability: "available", reason: null });
const frame = (at: string, usedPercent: number): AccountUsageEnvelope => ({ schemaVersion: 1, generatedAt: at, quota: [reading(at, usedPercent)], sessions: [], unattributed: [],
  coverage: ["codex", "claude"].map(vendor => ({ vendor: vendor as "codex" | "claude", from, through: at, state: "complete", reason: null })) });
const session = (endedAt: string | null): SessionUsage => ({ vendor: "codex", sessionRef: `sref:v1:codex:${"a".repeat(43)}`,
  seat: "seat-a", cwdLabel: "project-a", model: null, effort: null, startedAt: "2026-01-02T11:00:00.000Z", endedAt, observedAt: to,
  tokens: { input: null, cached: null, cacheWrite: null, output: null, reasoning: null }, inputIncludesCached: true, availability: "unavailable", reason: "no-reading" });
test("positive same-epoch quiet increase emits only an inferred percent delta", () => {
  const rows = inferUnattributedUsage(frame(from, 12), frame(to, 17));
  assert.deepEqual(rows, [{ kind: "unattributed", vendor: "codex", accountRef: reading(to, 17).accountRef,
    limitId: "meter-a", window: "weekly", from, to, usedPercentDelta: 5, inferred: true, reason: "no_observed_session_activity" }]);
});
test("reset, different scope, unknowns, expired window, decreasing or equal snapshots refuse inference", () => {
  const previous = frame(from, 12), current = frame(to, 17);
  for (const change of [{ resetsAt: "2026-01-04T12:00:00.000Z" }, { resetsAt: from }, { accountRef: null },
    { accountRef: `aref:v1:codex:${"c".repeat(43)}` }, { limitId: "meter-b" }, { limitId: null }, { window: "5h" },
    { usedPercent: null }, { usedPercent: 12 }, { usedPercent: 11 }, { observedAt: from }, { availability: "partial" }]) {
    assert.deepEqual(inferUnattributedUsage(previous, { ...current, quota: [{ ...current.quota[0]!, ...change } as AccountQuotaSnapshot] }), []);
  }
  assert.deepEqual(inferUnattributedUsage({ ...previous, quota: [previous.quota[0]!, previous.quota[0]!] }, current), []);
});
test("owned activity, an unclosed older run and partial or uncovered source spans block external attribution", () => {
  const previous = frame(from, 12), current = frame(to, 17);
  for (const endedAt of [null, to]) assert.deepEqual(inferUnattributedUsage(previous, { ...current, sessions: [session(endedAt)] }), []);
  assert.equal(inferUnattributedUsage(previous, { ...current, sessions: [session(from)] }).length, 1);
  for (const change of [{ state: "partial", reason: "partial-scan" }, { state: "unavailable", reason: "not-configured" }, { from: to }, { through: from }]) {
    assert.deepEqual(inferUnattributedUsage(previous, { ...current, coverage: [{ ...current.coverage[0]!, ...change } as AccountUsageEnvelope["coverage"][number], current.coverage[1]!] }), []);
  }
  assert.deepEqual(inferUnattributedUsage({ ...previous, coverage: [] }, current), []);
  assert.deepEqual(inferUnattributedUsage({ ...previous, sessions: [session(null)] }, current), []);
});
const line = (type: string, payload: unknown, at = from): string => JSON.stringify({ type, payload, timestamp: at });
test("Codex cumulative carriers are not added; cache writes and separate per-turn totals survive", () => {
  const counts = { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 5, output_tokens: 20, reasoning_output_tokens: 10 };
  const parsed = parseCodexRollout([
    line("session_meta", { id: "fake-thread" }), line("turn_context", { model: "fake-model", collaboration_mode: { settings: { reasoning_effort: "high" } } }),
    line("event_msg", { type: "token_count", info: { total_token_usage: counts }, rate_limits: { limit_id: "meter-a",
      primary: { used_percent: 12, window_minutes: 300, resets_at: 1767441600 }, secondary: { used_percent: 17, window_minutes: 10080, resets_at: 1767441600 } } }),
    line("token_usage_record", { thread_token_usage: counts, turn_id: "fake-turn", turn_token_usage: { ...counts, input_tokens: 70 }, usage: { input_tokens: 999 } }, to),
    line("token_usage_record", { thread_token_usage: { ...counts, input_tokens: 1 }, turn_id: "fake-turn", turn_token_usage: { input_tokens: 1 } }, from),
  ].join("\n"), "PRIVATE_CANARY");
  assert.deepEqual(parsed.notes, []);
  assert.equal(parsed.run?.usage.inputTokens, 100);
  assert.equal(parsed.run?.usage.cacheWriteTokens, 5);
  assert.equal(parsed.run?.updatedAt, to);
  assert.equal(parsed.run?.turnUsage?.[0]?.usage.inputTokens, 70);
  assert.deepEqual(parsed.run?.quota.map(q => q.windowMinutes), [300, 10080]);
  const store = { vendor: "codex" as const, seat: "seat-a", cwdLabel: "project-a", root: "unused", accountIdentity: null };
  const publicSession = sessionUsage(parsed.run!, store, key)!;
  assert.equal(publicSession.tokens.input, 100);
  assert.equal(publicSession.model, "fake-model"); assert.equal(publicSession.effort, "high");
  assert.ok(!JSON.stringify(publicSession).includes("fake-thread") && !JSON.stringify(publicSession).includes("PRIVATE_CANARY"));
  assert.deepEqual(storedQuota(parsed.run!, store, key).map(q => [q.window, q.usedPercent]), [["5h", 12], ["weekly", 17]]);
  assert.equal(quotasFromRateLimits({ secondary: { used_percent: 4, window_minutes: 10080 } }, from).length, 1);
  assert.equal(quotasFromRateLimits({ credits: { balance: "fake-balance" } }, from)[0]?.creditBalance, "fake-balance");
  const incomplete = parseCodexRollout([line("session_meta", { id: "fake-thread" }),
    line("token_usage_record", { thread_token_usage: counts }),
    line("token_usage_record", { thread_token_usage: { input_tokens: 200 } }, to)].join("\n"), "unused");
  assert.equal(incomplete.run?.usage.outputTokens, undefined);
  assert.equal(sessionUsage(incomplete.run!, store, key)?.availability, "partial");
  const wrongThread = parseCodexRollout([line("session_meta", { id: "fake-thread" }),
    line("token_usage_record", { thread_id: "other-fake-thread", thread_token_usage: counts })].join("\n"), "unused");
  assert.equal(wrongThread.run?.usage.inputTokens, undefined);
  assert.equal(wrongThread.notes[0]?.reason, "token record thread identity mismatch");
});
test("Claude response deduplication preserves separate cached and created input", () => {
  const record = { type: "assistant", sessionId: "fake-session", uuid: "fake-message", timestamp: from,
    message: { id: "fake-response", model: "fake-model", usage: { input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 5, output_tokens: 20 } } };
  const run = parseClaudeTranscript([JSON.stringify(record), JSON.stringify(record)].join("\n"), "PRIVATE_CANARY").run!;
  const row = sessionUsage(run, { vendor: "claude", seat: "seat-a", cwdLabel: "project-a", root: "unused", accountIdentity: null }, key)!;
  assert.deepEqual(row.tokens, { input: 100, cached: 40, cacheWrite: 5, output: 20, reasoning: null });
  assert.equal(row.inputIncludesCached, false);
  assert.equal(run.quota.length, 0);
});
test("collector reads synthetic roots, detects an empty quiet span and keeps unknown Claude quota null", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-fixture-"));
  try {
    const codexRoot = join(root, "codex"), claudeRoot = join(root, "claude");
    await mkdir(codexRoot); await mkdir(claudeRoot);
    const source: AccountUsageSource = { schemaVersion: 1, keyFile: join(root, "fake-key"), stateFile: join(root, "state"),
      stores: [{ vendor: "codex", seat: "seat-a", cwdLabel: "project-a", root: codexRoot, accountIdentity: null },
        { vendor: "claude", seat: "seat-a", cwdLabel: "project-a", root: claudeRoot, accountIdentity: null }], codex: { bin: process.execPath, home: null } };
    const poll = (n: number) => async () => ({ ok: true as const, result: { accountId: "fake-account", rateLimits: { limitId: "meter-a",
      primary: { usedPercent: n, windowDurationMins: 300, resetsAt: 1767441600 }, secondary: { usedPercent: n, windowDurationMins: 10080, resetsAt: 1767441600 } } } });
    const first = await collectAccountUsage(source, key, { now: () => from, poll: poll(12) });
    assert.ok(first.coverage.every(c => c.state === "complete"));
    const second = await collectAccountUsage(source, key, { now: () => to, poll: poll(17), previous: first });
    assert.equal(second.unattributed.length, 2);
    const failedPoll = await collectAccountUsage(source, key, { now: () => to,
      poll: async () => ({ ok: false, reason: "timeout" }), previous: first });
    assert.ok(failedPoll.quota.filter(q => q.vendor === "codex").every(q => q.observedAt === from && q.usedPercent === 12));
    assert.equal(failedPoll.unattributed.length, 0);
    assert.ok(second.quota.filter(q => q.vendor === "claude").every(q => q.usedPercent === null && q.reason === "direct-read-unsupported"));
    await writeFile(join(codexRoot, "fake.jsonl"), [line("session_meta", { id: "fake-thread" }), line("event_msg", { type: "task_started" }, to)].join("\n"));
    const busy = await collectAccountUsage(source, key, { now: () => to, poll: poll(17), previous: first });
    assert.equal(busy.unattributed.length, 0);
    await writeFile(join(codexRoot, "fake.jsonl"), "INVALID_PRIVATE_CANARY");
    const bounded = await backfillFromDisk({ codexSessions: root }, { maxDirectoryEntries: 1 });
    assert.equal(bounded.degraded, true);
    const partial = await collectAccountUsage(source, key, { now: () => to, poll: poll(17), previous: first });
    assert.equal(partial.coverage[0]?.state, "partial"); assert.equal(partial.unattributed.length, 0);
    const unconfigured = await collectAccountUsage({ ...source, stores: [], codex: null }, key, { now: () => to });
    assert.ok(unconfigured.coverage.every(c => c.state === "unavailable"));
    assert.ok(unconfigured.quota.every(q => q.usedPercent === null));
    assert.deepEqual(readAccountUsageSource(source), source);
    assert.notEqual(usageScopeHash(source, key), usageScopeHash({ ...source, stores: [] }, key));
    assert.notEqual(usageScopeHash(source, key), usageScopeHash(source, Buffer.alloc(32, 8)));
    assert.throws(() => readAccountUsageSource({ ...source, stores: [source.stores[0], source.stores[0]] }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
