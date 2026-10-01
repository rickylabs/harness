import assert from "node:assert/strict";
import { test } from "node:test";
import { paidQuantityFromNano, paidQuantityNano, readProviderUsageSnapshot, type ProviderMeterRow, type ProviderUsageSnapshot } from "./provider-usage.js";
import { readAccountUsageDocument, readProviderBudgetDecisions } from "./paid-account-usage.js";
const at = "2026-01-02T12:00:00.000Z", end = "2026-02-01T00:00:00.000Z", from = "2026-01-01T00:00:00.000Z";
const accountRef = `paccount_${"a".repeat(64)}`;
const meter = (): ProviderMeterRow => ({ provider: "github-copilot", model: "fixture-model", accountRef, unit: "premium_requests",
  period: "month", from, through: end, observedAt: at, reportedThrough: null, source: "github-billing", state: "known", reason: null,
  grossQuantity: "12", includedQuantity: "10", netQuantity: "2", grossUsd: "6", includedUsd: "5", netUsd: "1", pricePerUnitUsd: "0.5" });
const fixture = (): ProviderUsageSnapshot => ({ schemaVersion: 1, generatedAt: at, meters: [meter()],
  prices: [{ provider: "openrouter", model: "fixture/model", observedAt: at, source: "models-endpoint", state: "known", reason: null,
    rates: { input: "1", output: "2", cacheRead: "0.1", cacheWrite: "0" }, overrides: [], additionalCharges: [] }],
  history: [{ provider: "fixture-provider", model: "fixture-model", accountRef, from, through: at, observedAt: at, messages: 2,
    costUsd: "1", costSource: "local-reported", tokens: { input: 20, output: 5, reasoning: 2, cacheRead: 40, cacheWrite: 20 },
    cacheHitRate: 0.5, coverage: "complete", reason: null }], coverage: { githubBilling: "known", openRouter: "known", openCode: "complete" } });
const reject = (value: unknown): void => assert.deepEqual(readProviderUsageSnapshot(value), { ok: false, reason: "invalid" });
test("paid decimals retain fractional precision, reject noncanonical/negative/overflow and never round", () => {
  for (const value of ["0", "1", "0.000000001", "999999999.999999999"]) assert.equal(paidQuantityFromNano(paidQuantityNano(value)!), value);
  for (const value of [null, 0, "01", "-1", "1.0", "1e3", "0.0000000001", "1000000000", "NaN", " 1"]) assert.equal(paidQuantityNano(value), null);
  assert.equal(paidQuantityFromNano(-1n), null); assert.equal(paidQuantityFromNano(1_000_000_000_000_000_000n), null);
});
test("closed provider snapshot keeps premium/credits/USD/unmetered separate and copies data", () => {
  const f = { ...fixture() }; f.meters = [...f.meters,
    { ...meter(), unit: "ai_credits" }, { ...meter(), model: null, pricePerUnitUsd: null },
    { ...meter(), provider: "fixture-provider", unit: "usd", period: "history", through: at, source: "opencode-history", state: "partial", reason: "partial-history",
      grossQuantity: null, includedQuantity: null, netQuantity: null, includedUsd: null, netUsd: null, pricePerUnitUsd: null },
    { ...meter(), provider: "fixture-provider", model: null, unit: "unknown", period: "history", through: at, source: "unmetered", state: "unknown",
      reason: "account-source-unavailable", observedAt: null, grossQuantity: null, includedQuantity: null, netQuantity: null, grossUsd: null, includedUsd: null, netUsd: null, pricePerUnitUsd: null }];
  const read = readProviderUsageSnapshot(f); assert.equal(read.ok, true);
  if (read.ok) { assert.deepEqual(read.snapshot, f); assert.notEqual(read.snapshot, f); assert.notEqual(read.snapshot.history[0]!.tokens, f.history[0]!.tokens); }
});
test("billing scope, split, source/unit/state/time and duplicate/private rows are rejected", () => {
  const variants: Record<string, unknown>[] = [
    { provider: "private/path" }, { model: " private-model" }, { accountRef: "private-account" }, { unit: "tokens" }, { period: "weekly" },
    { from: end }, { through: "2026-02-30T00:00:00.000Z" }, { observedAt: end }, { reportedThrough: end },
    { source: "unmetered" }, { provider: "openrouter" }, { unit: "usd" }, { period: "history" },
    { state: "known", reason: "request-failed" }, { state: "unknown", observedAt: null, reason: "request-failed" },
    { grossQuantity: null }, { grossQuantity: "11" }, { grossUsd: "7" }, { netQuantity: "-1" }, { netUsd: Infinity }, { PRIVATE_CANARY: "private-value" },
  ];
  for (const change of variants) reject({ ...fixture(), meters: [{ ...meter(), ...change }] });
  reject({ ...fixture(), meters: [meter(), meter()] });
  const unknown = { ...meter(), state: "unknown", reason: "no-plan-read-credential", observedAt: null,
    grossQuantity: null, includedQuantity: null, netQuantity: null, grossUsd: null, includedUsd: null, netUsd: null, pricePerUnitUsd: null };
  const unknownSnapshot = { ...fixture(), meters: [unknown], coverage: { ...fixture().coverage, githubBilling: "unknown" } };
  assert.equal(readProviderUsageSnapshot(unknownSnapshot).ok, true);
  reject({ ...unknownSnapshot, coverage: { ...fixture().coverage, githubBilling: "known" } });
  reject({ ...fixture(), schemaVersion: 2 }); reject({ ...fixture(), generatedAt: from });
  reject({ ...fixture(), coverage: { ...fixture().coverage, githubBilling: "not-configured" } });
  reject({ ...fixture(), coverage: { ...fixture().coverage, githubBilling: "unknown" } });
});
test("model prices preserve overrides, unknown cache values and charge coverage instead of claiming free", () => {
  const f = fixture(), row = f.prices[0]!;
  const overrides = [{ minPromptTokens: 100, utcStart: null, utcEnd: null, utcDays: null, rates: row.rates },
    { minPromptTokens: null, utcStart: "22:00", utcEnd: "06:00", utcDays: [0, 6], rates: row.rates }];
  assert.equal(readProviderUsageSnapshot({ ...f, prices: [{ ...row, overrides }] }).ok, true);
  for (const change of [{ rates: { ...row.rates, cacheRead: null } }, { additionalCharges: ["request"] },
    { overrides: [{ ...overrides[0], minPromptTokens: null }] },
    { overrides: [{ ...overrides[0], rates: { ...row.rates, input: null } }] }, { overrides: [{ ...overrides[1], utcEnd: null }] },
    { overrides: [{ ...overrides[1], utcStart: "25:00" }] }, { overrides: [{ ...overrides[1], utcDays: [0, 0] }] },
    { overrides: [{ ...overrides[1], utcDays: [7] }] }, { overrides: [{ ...overrides[1], utcDays: [] }] },
    { rates: { ...row.rates, input: "-1" } }, { additionalCharges: ["PRIVATE_CANARY"] }, { privatePath: "private-value" }]) reject({ ...f, prices: [{ ...row, ...change }] });
  reject({ ...f, prices: [row, row] }); reject({ ...f, coverage: { ...f.coverage, openRouter: "not-configured" } });
  const partial = { ...row, state: "partial", reason: "unsupported-pricing", rates: { ...row.rates, cacheRead: null }, additionalCharges: ["request"] };
  assert.equal(readProviderUsageSnapshot({ ...f, prices: [partial], coverage: { ...f.coverage, openRouter: "partial" } }).ok, true);
});
test("normalized cache counts sum before division and unknown/empty denominator stays null", () => {
  const f = fixture(), row = f.history[0]!;
  for (const change of [{ cacheHitRate: 0.4 }, { tokens: { ...row.tokens, cacheRead: null } }, { tokens: { ...row.tokens, reasoning: -1 } },
    { messages: -1 }, { costUsd: null }, { through: end }, { observedAt: end }, { coverage: "partial", reason: null }, { tokens: { ...row.tokens, input: Number.MAX_SAFE_INTEGER } },
    { costSource: "provider-billing" }, { PRIVATE_CANARY: "private-value" }]) reject({ ...f, history: [{ ...row, ...change }] });
  reject({ ...f, history: [row, row] }); reject({ ...f, coverage: { ...f.coverage, openCode: "not-configured" } });
  assert.equal(readProviderUsageSnapshot({ ...f, history: [{ ...row, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cacheHitRate: null }] }).ok, true);
  assert.equal(readProviderUsageSnapshot({ ...f, history: [{ ...row, tokens: { ...row.tokens, input: null }, cacheHitRate: null,
    costUsd: null, coverage: "partial", reason: "partial-history" }], coverage: { ...f.coverage, openCode: "partial" } }).ok, true);
});
test("hostile reflection, sparse collections and bounds cannot expose private diagnostics", () => {
  let calls = 0;
  const f = fixture(); reject({ ...f, get meters(): unknown { calls++; throw new Error("PRIVATE_CANARY"); } }); assert.equal(calls, 0);
  for (const meters of [Array(2), Array.from({ length: 1025 }, meter)]) reject({ ...f, meters });
  reject({ ...f, meters: Object.assign([meter()], { PRIVATE_CANARY: "private-value" }) });
  reject({ ...f, meters: Array.from({ length: 1025 }, (_, i) => ({ ...meter(), model: `fixture-${i}` })) });
  reject(new Proxy({}, { getPrototypeOf() { throw new Error("PRIVATE_CANARY"); } }));
  reject({ ...f, coverage: { ...f.coverage, privatePath: "PRIVATE_CANARY" } });
});
test("reader-first account documents keep legacy native rows unchanged and reject private/future wrappers", () => {
  const account = { schemaVersion: 1, generatedAt: at, quota: [], sessions: [], unattributed: [],
    coverage: ["codex", "claude"].map(vendor => ({ vendor, from: at, through: at, state: "unavailable", reason: "not-configured" })) };
  assert.equal(readAccountUsageDocument(account).ok, true);
  const document = { schemaVersion: 2, generatedAt: at, account, providers: fixture() };
  const read = readAccountUsageDocument(document); assert.equal(read.ok, true);
  if (read.ok && read.document.schemaVersion === 2) assert.deepEqual(read.document.account, account);
  for (const change of [{ schemaVersion: 3 }, { generatedAt: from }, { account: { ...account, generatedAt: end } },
    { providers: { ...fixture(), generatedAt: end } }, { PRIVATE_CANARY: "private-value" }]) assert.equal(readAccountUsageDocument({ ...document, ...change }).ok, false);
  let calls = 0; assert.equal(readAccountUsageDocument({ ...document, get schemaVersion() { calls++; return 2; } }).ok, false); assert.equal(calls, 0);
});
test("per-model budget decisions carry only the reader's fixed known/unavailable vocabulary", () => {
  const row = { provider: "fixture-provider", model: "fixture-model", observedAt: at, validUntil: end, available: false, reason: "budget-reached" };
  assert.deepEqual(readProviderBudgetDecisions([row]), [row]); assert.deepEqual(readProviderBudgetDecisions([{ ...row, reason: "budget-unavailable" }]), [{ ...row, reason: "budget-unavailable" }]);
  assert.deepEqual(readProviderBudgetDecisions([{ ...row, available: true, reason: null }]), [{ ...row, available: true, reason: null }]);
  for (const change of [{ provider: "private/path" }, { model: " private-model" }, { reason: "PRIVATE_CANARY" }, { available: true }, { reason: null },
    { observedAt: end }, { validUntil: at }, { PRIVATE_CANARY: "private-value" }]) assert.equal(readProviderBudgetDecisions([{ ...row, ...change }]), null);
  assert.equal(readProviderBudgetDecisions([row, row]), null); assert.equal(readProviderBudgetDecisions(Array(2)), null);
});
