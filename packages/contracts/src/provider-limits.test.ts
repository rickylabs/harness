import { test } from "node:test";
import assert from "node:assert/strict";
import { readProviderLimitSnapshot } from "./provider-limits.js";
const at = "2026-01-01T00:00:00.000Z";
const meter = { provider: "codex", scope: "subscription", keyName: null, accountRef: null, limitId: "native", model: null, launchModels: [], window: "weekly", unit: "percent", used: null, limit: null, remaining: null, usedPercent: 100, state: "known", source: "orchid-governor", reason: null, observedAt: at, resetsAt: null };
const doc = () => ({ schemaVersion: 1, generatedAt: at, meters: [{ ...meter }], outcomes: [] });
test("100 percent is valid meter evidence; copied decoder never invents refusal", () => {
  const raw = doc(), result = readProviderLimitSnapshot(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  raw.meters[0]!.usedPercent = 0;
  assert.equal(result.snapshot.meters[0]?.usedPercent, 100);
  assert.deepEqual(result.snapshot.outcomes, []);
});
test("closed snapshot rejects partial scope, secrets, malformed quantities and duplicate identities", () => {
  for (const bad of [ { ...doc(), generatedAt: "2026-02-30T00:00:00.000Z" }, { ...doc(), rawError: "private" }, { ...doc(), meters: [meter, meter] }, { ...doc(), meters: [{ ...meter, usedPercent: null }] },
    { ...doc(), meters: [{ ...meter, limitId: "sk-" + "abcdefghijklmnop" }] }, { ...doc(), outcomes: [{ provider: "codex", keyName: null, accountRef: null, model: null, outcome: "succeeded", reason: "quota_exhausted", source: "provider-run", observedAt: at, resetsAt: null }] } ]) assert.equal(readProviderLimitSnapshot(bad).ok, false);
});
test("unknown identity cannot bind; two keys cannot claim a route; native windows may share a binding", () => {
  assert.equal(readProviderLimitSnapshot({ ...doc(), meters: [{ ...meter, launchModels: ["codex/fixture"] }] }).ok, false);
  const a = { ...meter, accountRef: "aref:v1:codex:" + "a".repeat(43), launchModels: ["codex/fixture"] };
  assert.equal(readProviderLimitSnapshot({ ...doc(), meters: [a, { ...a, window: "5h" }] }).ok, true);
  assert.equal(readProviderLimitSnapshot({ ...doc(), meters: [a, { ...a, accountRef: "aref:v1:codex:" + "b".repeat(43) }] }).ok, false);
});
test("decoder refuses accessors without invoking them", () => {
  const raw = doc(); let calls = 0;
  Object.defineProperty(raw, "meters", { get: () => { calls++; return []; }, enumerable: true });
  assert.equal(readProviderLimitSnapshot(raw).ok, false); assert.equal(calls, 0);
});
