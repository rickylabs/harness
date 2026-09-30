import assert from "node:assert/strict";
import { test } from "node:test";
import { readAccountUsageEnvelope, sessionProcessedTokens, type AccountUsageEnvelope, type SessionUsage } from "./account-usage.js";
const at = "2026-01-02T12:00:00.000Z";
const session = (vendor: "codex" | "claude"): SessionUsage => ({ vendor, sessionRef: `sref:v1:${vendor}:${"a".repeat(43)}`,
  seat: "seat-a", cwdLabel: "project-a", model: "fake-model", effort: "high", startedAt: at, endedAt: null, observedAt: at,
  tokens: { input: 100, cached: 40, cacheWrite: 5, output: 20, reasoning: 10 }, inputIncludesCached: vendor === "codex", availability: "available", reason: null });
const fixture = (): AccountUsageEnvelope => ({ schemaVersion: 1, generatedAt: at, quota: [{ vendor: "codex", accountRef: `aref:v1:codex:${"b".repeat(43)}`,
  limitId: "meter-a", window: "weekly", usedPercent: 12, resetsAt: "2026-01-03T12:00:00.000Z", observedAt: at, observedBy: null,
  source: "account-poll", availability: "available", reason: null }], sessions: [session("codex"), session("claude")], unattributed: [],
  coverage: ["codex", "claude"].map(vendor => ({ vendor: vendor as "codex" | "claude", from: at, through: at, state: "complete", reason: null })) });
test("vendor token totals count cache once and never manufacture missing Claude components", () => {
  assert.equal(sessionProcessedTokens(session("codex")), 120);
  assert.equal(sessionProcessedTokens(session("claude")), 165);
  assert.equal(sessionProcessedTokens({ ...session("claude"), tokens: { ...session("claude").tokens, cacheWrite: null } }), null);
  assert.equal(sessionProcessedTokens({ ...session("codex"), tokens: { ...session("codex").tokens, input: Number.MAX_SAFE_INTEGER } }), null);
});
test("closed copying decoder accepts synthetic readings and unavailable nulls", () => {
  const input = fixture();
  const read = readAccountUsageEnvelope(input);
  assert.equal(read.ok, true);
  if (read.ok) { assert.notEqual(read.envelope, input); assert.notEqual(read.envelope.sessions[0]?.tokens, input.sessions[0]?.tokens); }
  assert.equal(readAccountUsageEnvelope({ ...input, quota: [{ ...input.quota[0], accountRef: null, limitId: null, source: "unavailable", availability: "unavailable",
    reason: "direct-read-unsupported", usedPercent: null, resetsAt: null, observedAt: null }] }).ok, true);
});
test("rejects extra private fields, raw refs, invalid cache semantics, counts and timestamps", () => {
  const f = fixture();
  for (const s of [ { ...f.sessions[0], rawId: "PRIVATE_CANARY" }, { ...f.sessions[0], sessionRef: "fake-native-id" },
    { ...f.sessions[0], cwdLabel: "directory/private" }, { ...f.sessions[0], inputIncludesCached: false },
    { ...f.sessions[0], tokens: { ...f.sessions[0]!.tokens, cached: 101 } },
    { ...f.sessions[0], tokens: { ...f.sessions[0]!.tokens, reasoning: 21 } },
    { ...f.sessions[0], tokens: { ...f.sessions[0]!.tokens, output: -1 } },
    { ...f.sessions[0], tokens: { ...f.sessions[0]!.tokens, input: null } },
    { ...f.sessions[0], observedAt: "2026-02-30T12:00:00.000Z" },
    { ...f.sessions[0], observedAt: "2026-01-02T12:01:00.000Z" } ]) assert.equal(readAccountUsageEnvelope({ ...f, sessions: [s] }).ok, false);
  assert.equal(readAccountUsageEnvelope({ ...f, quota: [{ ...f.quota[0], usedPercent: NaN }] }).ok, false);
  assert.equal(readAccountUsageEnvelope({ ...f, sessions: [f.sessions[0], f.sessions[0]] }).ok, false);
  assert.equal(readAccountUsageEnvelope({ ...f, quota: [f.quota[0], f.quota[0]] }).ok, false);
});
test("refuses accessors, sparse/oversized arrays and foreign errors without evaluating them", () => {
  let calls = 0;
  const input = { ...fixture(), get sessions(): unknown { calls++; throw new Error("PRIVATE_CANARY"); } };
  assert.deepEqual(readAccountUsageEnvelope(input), { ok: false, reason: "invalid" });
  assert.equal(calls, 0);
  const array = new Proxy([], { get() { calls++; throw new Error("PRIVATE_CANARY"); } });
  assert.equal(readAccountUsageEnvelope({ ...fixture(), sessions: array }).ok, true);
  assert.equal(calls, 0);
  for (const sessions of [Array(2), Array.from({ length: 2001 }, () => session("codex"))])
    assert.equal(readAccountUsageEnvelope({ ...fixture(), sessions }).ok, false);
  assert.equal(readAccountUsageEnvelope(new Proxy({}, { getPrototypeOf() { throw { toString() { calls++; return "PRIVATE_CANARY"; } }; } })).ok, false);
  assert.equal(calls, 0);
});
