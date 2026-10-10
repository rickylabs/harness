// Snapshots under test-fixtures/provider-limits-produced are the bytes Orchid's producer wrote
// (rickylabs/orchid#97 at 063f277a7845b805356d582a3b0d40240332dcf4: recordLimitOutcome and
// publishProviderLimits driven by its own tests, plus one fixture driver named in rickylabs/harness#650).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readProviderLimitSnapshot, type ProviderLimitMeterV1, type ProviderLimitSnapshotV1, type ProviderOutcomeV1 } from "./provider-limits.js";
import { admitProviderRoute, assessProviderLimits, PROVIDER_LIMIT_VALIDITY_MS } from "./provider-limit-admission.js";

const fixtures = new URL("../test-fixtures/provider-limits-produced/", import.meta.url);
function decode(raw: unknown, label: string): ProviderLimitSnapshotV1 {
  const read = readProviderLimitSnapshot(raw);
  assert.equal(read.ok, true, `${label} decodes`);
  if (!read.ok) throw new Error(label);
  return read.snapshot;
}
const produced = (name: string) => decode(JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), "utf8")), name);
const after = (snapshot: ProviderLimitSnapshotV1, ms = 1000) => Date.parse(snapshot.generatedAt) + ms;
const meter = (a: ReturnType<typeof assessProviderLimits>, provider: string, window: string, keyName: string | null = null) =>
  a.meters.find(m => m.meter.provider === provider && m.meter.window === window && m.meter.keyName === keyName && m.meter.state !== "unknown")!;

// Synthetic cases start from rows Orchid's producer wrote and change only the field under test, then decode
// again: each is valid evidence that breaks exactly one rule. Times are offsets from one synthetic instant.
const base = produced("native-keys-global-refusal");
const nativeRow = base.meters.find(m => m.scope === "subscription" && m.state === "known")!;
const keyRow = base.meters.find(m => m.scope === "key" && m.state === "known")!;
const refusalRow = base.outcomes.find(o => o.outcome === "refused" && o.keyName === null && o.accountRef === null && o.model === null)!;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const native = (o: Partial<ProviderLimitMeterV1> = {}): ProviderLimitMeterV1 => ({ ...nativeRow, observedAt: at(0), resetsAt: null, ...o });
const key = (o: Partial<ProviderLimitMeterV1> = {}): ProviderLimitMeterV1 => ({ ...keyRow, observedAt: at(0), resetsAt: null, ...o });
const refused = (o: Partial<ProviderOutcomeV1> = {}): ProviderOutcomeV1 => ({ ...refusalRow, observedAt: at(0), resetsAt: null, ...o });
const succeeded = (o: Partial<ProviderOutcomeV1> = {}) => refused({ outcome: "succeeded", reason: null, ...o });
const synthetic = (meters: ProviderLimitMeterV1[], outcomes: ProviderOutcomeV1[]) =>
  decode({ schemaVersion: 1, generatedAt: at(600), meters, outcomes }, "synthetic");
const assess = (meters: ProviderLimitMeterV1[], outcomes: ProviderOutcomeV1[], now = T0 + 1000) => assessProviderLimits(synthetic(meters, outcomes), now);

test("produced thresholds: 89.9% is quiet, 90% warns on native windows and key caps, and a warning never refuses", () => {
  const s = produced("thresholds-hard-then-rate"), a = assessProviderLimits(s, after(s));
  assert.deepEqual([meter(a, "codex", "5h").usedPercent, meter(a, "codex", "5h").warning], [89.9, false]);
  assert.deepEqual([meter(a, "codex", "weekly").usedPercent, meter(a, "codex", "weekly").warning], [90, true]);
  assert.equal(meter(a, "openrouter", "total", "near-cap").warning, true);
  assert.equal(meter(a, "openrouter", "total", "below-cap").warning, false);
  const codex = admitProviderRoute(a, "codex/fixture");
  assert.equal(codex.admitted, true);
  assert.deepEqual(codex.warnings.map(w => w.meter.window), ["weekly"]);
  const routed = admitProviderRoute(a, "openrouter/vendor/model");
  assert.deepEqual([routed.admitted, routed.warnings.map(w => w.meter.keyName)], [true, ["near-cap"]]);
  assert.deepEqual(admitProviderRoute(a, "openrouter/vendor/other").warnings, []);
});

test("produced 100% meters and an exhausted key cap warn; only the provider-wide quota refusal blocks", () => {
  const s = produced("native-keys-global-refusal"), a = assessProviderLimits(s, after(s));
  assert.equal(meter(a, "codex", "weekly").usedPercent, 100);
  assert.equal(meter(a, "openrouter", "total", "small-cap").usedPercent, 100);
  const exhaustedKey = admitProviderRoute(a, "openrouter/vendor/model");
  assert.deepEqual([exhaustedKey.admitted, exhaustedKey.warnings.length], [true, 1]);
  const codex = admitProviderRoute(a, "codex/fixture");
  assert.equal(codex.admitted, false);
  assert.deepEqual([codex.refusal?.reason, codex.refusal?.accountRef, codex.refusal?.model], ["quota_exhausted", null, null]);
  assert.equal(codex.warnings.length, 2, "warnings stay visible beside the refusal");
  assert.equal(admitProviderRoute(a, "claude/fixture").admitted, true);
});

test("produced unknown meters stay unknown: no percentage, no warning, no refusal", () => {
  const names = readdirSync(fixtures).filter(name => name.endsWith(".json")).map(name => name.slice(0, -".json".length));
  assert.notEqual(names.length, 0);
  for (const name of names) {
    const s = produced(name), a = assessProviderLimits(s, after(s));
    for (const m of a.meters.filter(m => m.meter.state === "unknown")) {
      assert.deepEqual([m.usedPercent, m.stale, m.warning], [null, null, false], `${name} ${m.meter.provider} ${m.meter.window}`);
    }
    assert.equal(admitProviderRoute(a, "agy/fixture").admitted, true, `${name}: an unreadable source is not a refusal`);
  }
});

test("produced 429 after a quota refusal: the route stays refused; a rate limit alone is advisory", () => {
  const s = produced("thresholds-hard-then-rate"), a = assessProviderLimits(s, after(s));
  const go = admitProviderRoute(a, "opencode-go/fixture");
  assert.deepEqual([go.admitted, go.refusal?.reason, go.rateLimits.map(o => o.reason)], [false, "quota_exhausted", ["rate_limited"]]);
  assert.ok(go.refusal?.resetsAt !== null, "the provider's reported reset is carried");
  const rateOnly = admitProviderRoute(a, "opencode-go/rate-only");
  assert.deepEqual([rateOnly.admitted, rateOnly.rateLimits.length], [true, 1]);
});

test("produced recovery: a strictly later matching success clears a provider-wide refusal", () => {
  const s = produced("refusal-cleared"), a = assessProviderLimits(s, after(s));
  assert.equal(s.outcomes.some(o => o.provider === "opencode-go" && o.outcome === "refused"), true);
  assert.deepEqual(a.refusals, []);
  assert.equal(admitProviderRoute(a, "opencode-go/fixture").admitted, true);
});

test("produced binding retirement: an account refusal blocks only routes its account still binds", () => {
  const bound = produced("binding-before"), retired = produced("binding-after");
  const before = admitProviderRoute(assessProviderLimits(bound, after(bound)), "codex/fixture");
  assert.deepEqual([before.admitted, before.refusal?.accountRef !== null], [false, true]);
  const now = assessProviderLimits(retired, after(retired));
  assert.equal(now.refusals.length, 1, "the refusal stays visible");
  assert.equal(admitProviderRoute(now, "codex/fixture").admitted, true);
});

test("freshness: an aged or future reading neither warns nor refuses", () => {
  const s = produced("native-keys-global-refusal"), weekly = (now: number) => meter(assessProviderLimits(s, now), "codex", "weekly");
  const observed = Date.parse(weekly(after(s)).meter.observedAt!);
  assert.deepEqual([weekly(observed + PROVIDER_LIMIT_VALIDITY_MS - 1).stale, weekly(observed + PROVIDER_LIMIT_VALIDITY_MS - 1).warning], [false, true]);
  assert.deepEqual([weekly(observed + PROVIDER_LIMIT_VALIDITY_MS).stale, weekly(observed + PROVIDER_LIMIT_VALIDITY_MS).warning], [true, false]);
  assert.deepEqual([weekly(observed - 1).stale, weekly(observed - 1).warning], [null, false]);
});

test("reset expiry: a reading past its resetsAt is stale while still younger than the validity window", () => {
  const reset = 60_000, s = synthetic([native({ usedPercent: 95, resetsAt: at(reset / 1000) })], []);
  assert.ok(reset < PROVIDER_LIMIT_VALIDITY_MS, "only the reset can make this reading stale");
  const reading = (now: number) => { const m = assessProviderLimits(s, now).meters[0]!; return [m.stale, m.warning]; };
  assert.deepEqual(reading(T0 + reset - 1), [false, true]);
  assert.deepEqual(reading(T0 + reset), [true, false]);
});

test("completeness and caps: a partial reading never warns, an unmeasured cap is unknown, a zero or overspent cap is fully used", () => {
  const advice = (m: ProviderLimitMeterV1) => { const a = assess([m], []).meters[0]!; return [a.usedPercent, a.stale, a.warning]; };
  assert.deepEqual(advice(native({ usedPercent: 95 })), [95, false, true]);
  assert.deepEqual(advice(native({ usedPercent: 95, state: "partial", reason: "source_partial" })), [95, false, false]);
  assert.deepEqual(advice(key({ used: 10, limit: null, remaining: null })), [null, false, false]);
  const zero = assess([key({ used: 0, limit: 0, remaining: 0 })], []);
  assert.deepEqual([zero.meters[0]!.usedPercent, zero.meters[0]!.warning], [100, true]);
  const route = admitProviderRoute(zero, keyRow.launchModels[0]!);
  assert.deepEqual([route.admitted, route.warnings.length], [true, 1]);
  const overspent = assess([key({ used: 11, limit: 10, remaining: -1 })], []);
  assert.deepEqual(advice(overspent.meters[0]!.meter), [100, false, true]);
  const spent = admitProviderRoute(overspent, keyRow.launchModels[0]!);
  assert.deepEqual([spent.admitted, spent.refusal, spent.warnings.length], [true, null, 1]);
});

test("clearance is scoped and strict: equal instants, another model, account, key or provider keep the refusal", () => {
  const ref = "aref:v1:codex:" + "b".repeat(43);
  const active = (...outcomes: ProviderOutcomeV1[]) => assess([], outcomes).refusals.length;
  const modelRefusal = refused({ model: "m", reason: "payment_required" }), later = at(1);
  assert.equal(active(modelRefusal, succeeded({ model: "m" })), 1);
  assert.equal(active(modelRefusal, succeeded({ model: "other", observedAt: later })), 1);
  assert.equal(active(modelRefusal, succeeded({ model: null, observedAt: later })), 1);
  assert.equal(active(modelRefusal, succeeded({ model: "m", accountRef: ref, observedAt: later })), 1);
  assert.equal(active(refused({ provider: "openrouter", keyName: "a" }), succeeded({ provider: "openrouter", keyName: "b", observedAt: later })), 1);
  assert.equal(active(refused(), succeeded({ provider: "claude", observedAt: later })), 1);
  assert.equal(active(modelRefusal, succeeded({ model: "m", observedAt: later })), 0);
  assert.equal(active(refused(), succeeded({ model: "any", observedAt: later })), 0);
});

test("clearance is order-independent: successes straddling a refusal clear it in either order", () => {
  const refusal = refused({ observedAt: at(10) }), early = succeeded({ observedAt: at(5) }), late = succeeded({ observedAt: at(20) });
  for (const outcomes of [[refusal, early, late], [refusal, late, early], [late, refusal, early]]) {
    assert.deepEqual(assess([], outcomes).refusals, []);
  }
  assert.equal(assess([], [refusal, early]).refusals.length, 1, "an earlier success alone keeps it");
});

test("admission reports the latest covering refusal whatever the order, the first listed on an equal instant", () => {
  const quota = refused({ reason: "quota_exhausted", observedAt: at(10), resetsAt: at(3600) });
  const payment = refused({ reason: "payment_required", observedAt: at(20), resetsAt: null });
  const reported = (...outcomes: ProviderOutcomeV1[]) => {
    const verdict = admitProviderRoute(assess([], outcomes), "codex/fixture");
    return [verdict.admitted, verdict.refusal?.reason, verdict.refusal?.observedAt, verdict.refusal?.resetsAt];
  };
  assert.deepEqual(reported(quota, payment), [false, "payment_required", at(20), null]);
  assert.deepEqual(reported(payment, quota), [false, "payment_required", at(20), null]);
  const tied = refused({ reason: "quota_exhausted", observedAt: at(20), resetsAt: at(3600) });
  assert.deepEqual(reported(payment, tied), [false, "payment_required", at(20), null]);
  assert.deepEqual(reported(tied, payment), [false, "quota_exhausted", at(20), at(3600)]);
});

test("bound credentials: a refusal blocks only routes whose meter matches every credential it names", () => {
  const keyRoute = keyRow.launchModels[0]!, nativeRoute = nativeRow.launchModels[0]!;
  const account = "paccount_" + "0".repeat(64), otherAccount = "paccount_" + "1".repeat(64);
  const admitted = (m: ProviderLimitMeterV1, o: ProviderOutcomeV1, route: string) => admitProviderRoute(assess([m], [o]), route).admitted;
  const keyRefusal = (o: Partial<ProviderOutcomeV1> = {}) => refused({ provider: "openrouter", keyName: keyRow.keyName, ...o });
  const accountRefusal = (accountRef: string) => refused({ provider: "openrouter", accountRef, reason: "payment_required" });
  // Key only: that key, on any account.
  assert.equal(admitted(key(), keyRefusal(), keyRoute), false);
  assert.equal(admitted(key(), keyRefusal({ keyName: "other-key" }), keyRoute), true);
  assert.equal(admitted(key({ accountRef: account }), keyRefusal(), keyRoute), false);
  // Account only: every bound meter of that account, a named key included.
  assert.equal(admitted(native(), refused({ accountRef: nativeRow.accountRef }), nativeRoute), false);
  assert.equal(admitted(native(), refused({ accountRef: "aref:v1:codex:" + "b".repeat(43) }), nativeRoute), true);
  assert.equal(admitted(key({ accountRef: account }), accountRefusal(account), keyRoute), false);
  assert.equal(admitted(key({ accountRef: account }), accountRefusal(otherAccount), keyRoute), true);
  // Key and account: both must match.
  assert.equal(admitted(key({ accountRef: account }), keyRefusal({ accountRef: account }), keyRoute), false);
  assert.equal(admitted(key({ accountRef: account }), keyRefusal({ accountRef: otherAccount }), keyRoute), true);
  assert.equal(admitted(key({ accountRef: account }), keyRefusal({ keyName: "other-key", accountRef: account }), keyRoute), true);
});

test("scope: an unbound key or account refusal never blocks another credential's route", () => {
  const a = assess([], [refused({ provider: "openrouter", keyName: "a" }), refused({ accountRef: "aref:v1:codex:" + "a".repeat(43) }),
    refused({ provider: "opencode-go", model: "m" }),
    // A provider whose name prefixes another's covers only its own `provider/` routes.
    refused({ provider: "opencode", reason: "payment_required" })]);
  assert.equal(a.refusals.length, 4);
  assert.equal(admitProviderRoute(a, "opencode/any").admitted, false);
  for (const route of ["openrouter/vendor/model", "codex/fixture", "opencode-go/other", "opencode-go-m/x"]) assert.equal(admitProviderRoute(a, route).admitted, true, route);
  assert.equal(admitProviderRoute(a, "opencode-go/m").admitted, false);
});
