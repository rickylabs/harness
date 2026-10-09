// Snapshots under test-fixtures/provider-limits-produced are the bytes Orchid's producer wrote
// (rickylabs/orchid#97 at 063f277a7845b805356d582a3b0d40240332dcf4: recordLimitOutcome and
// publishProviderLimits driven by its own tests, plus one fixture driver named in rickylabs/harness#650).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readProviderLimitSnapshot, type ProviderLimitSnapshotV1, type ProviderOutcomeV1 } from "./provider-limits.js";
import { admitProviderRoute, assessProviderLimits, PROVIDER_LIMIT_VALIDITY_MS } from "./provider-limit-admission.js";

function produced(name: string): ProviderLimitSnapshotV1 {
  const read = readProviderLimitSnapshot(JSON.parse(readFileSync(new URL(`../test-fixtures/provider-limits-produced/${name}.json`, import.meta.url), "utf8")));
  assert.equal(read.ok, true, `${name} decodes`);
  if (!read.ok) throw new Error(name);
  return read.snapshot;
}
const after = (snapshot: ProviderLimitSnapshotV1, ms = 1000) => Date.parse(snapshot.generatedAt) + ms;
const meter = (a: ReturnType<typeof assessProviderLimits>, provider: string, window: string, keyName: string | null = null) =>
  a.meters.find(m => m.meter.provider === provider && m.meter.window === window && m.meter.keyName === keyName && m.meter.state !== "unknown")!;

test("produced thresholds: 89.9% is quiet, 90% warns on native windows and key caps, and a warning never refuses", () => {
  const s = produced("thresholds-hard-then-rate"), a = assessProviderLimits(s, after(s));
  assert.deepEqual([meter(a, "codex", "5h").usedPercent, meter(a, "codex", "5h").warning], [89.9, false]);
  assert.deepEqual([meter(a, "codex", "weekly").usedPercent, meter(a, "codex", "weekly").warning], [90, true]);
  assert.equal(meter(a, "openrouter", "total", "near-cap").warning, true);
  assert.equal(meter(a, "openrouter", "total", "below-cap").warning, false);
  const codex = admitProviderRoute(a, "codex/fixture");
  assert.equal(codex.admitted, true);
  assert.deepEqual(codex.warnings.map(w => w.meter.window), ["weekly"]);
  const key = admitProviderRoute(a, "openrouter/vendor/model");
  assert.deepEqual([key.admitted, key.warnings.map(w => w.meter.keyName)], [true, ["near-cap"]]);
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
  for (const name of ["native-keys-global-refusal", "refusal-cleared", "binding-before", "binding-after", "thresholds-hard-then-rate"]) {
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

test("freshness: an aged, reset or future reading neither warns nor refuses", () => {
  const s = produced("native-keys-global-refusal"), weekly = (now: number) => meter(assessProviderLimits(s, now), "codex", "weekly");
  const observed = Date.parse(weekly(after(s)).meter.observedAt!);
  assert.deepEqual([weekly(observed + PROVIDER_LIMIT_VALIDITY_MS - 1).stale, weekly(observed + PROVIDER_LIMIT_VALIDITY_MS - 1).warning], [false, true]);
  assert.deepEqual([weekly(observed + PROVIDER_LIMIT_VALIDITY_MS).stale, weekly(observed + PROVIDER_LIMIT_VALIDITY_MS).warning], [true, false]);
  assert.deepEqual([weekly(observed - 1).stale, weekly(observed - 1).warning], [null, false]);
  const five = meter(assessProviderLimits(s, Date.parse(meter(assessProviderLimits(s, after(s)), "codex", "5h").meter.resetsAt!)), "codex", "5h");
  assert.deepEqual([five.stale, five.warning], [true, false]);
});

test("clearance is scoped and strict: equal instants, another model, account or key keep the refusal", () => {
  const at = "2026-01-01T00:00:00.000Z", later = "2026-01-01T00:00:01.000Z", ref = "aref:v1:codex:" + "a".repeat(43);
  const outcome = (o: Partial<ProviderOutcomeV1>): ProviderOutcomeV1 => ({ provider: "codex", keyName: null, accountRef: null, model: "m", outcome: "refused",
    reason: "payment_required", source: "provider-run", observedAt: at, resetsAt: null, ...o });
  const success = (o: Partial<ProviderOutcomeV1>) => outcome({ outcome: "succeeded", reason: null, observedAt: later, ...o });
  const active = (...outcomes: ProviderOutcomeV1[]) => assessProviderLimits({ schemaVersion: 1, generatedAt: later, meters: [], outcomes }, Date.parse(later)).refusals.length;
  assert.equal(active(outcome({}), success({ observedAt: at })), 1);
  assert.equal(active(outcome({}), success({ model: "other" })), 1);
  assert.equal(active(outcome({}), success({ model: null })), 1);
  assert.equal(active(outcome({}), success({ accountRef: ref })), 1);
  assert.equal(active(outcome({ provider: "openrouter", keyName: "a" }), success({ provider: "openrouter", keyName: "b" })), 1);
  assert.equal(active(outcome({}), success({})), 0);
  assert.equal(active(outcome({ model: null }), success({ model: "any" })), 0);
});

test("scope: an unbound key or account refusal never blocks another credential's route", () => {
  const at = "2026-01-01T00:00:00.000Z", ref = "aref:v1:codex:" + "a".repeat(43);
  const snapshot: ProviderLimitSnapshotV1 = { schemaVersion: 1, generatedAt: at, meters: [], outcomes: [
    { provider: "openrouter", keyName: "a", accountRef: null, model: null, outcome: "refused", reason: "quota_exhausted", source: "provider-run", observedAt: at, resetsAt: null },
    { provider: "codex", keyName: null, accountRef: ref, model: null, outcome: "refused", reason: "quota_exhausted", source: "provider-run", observedAt: at, resetsAt: null },
    { provider: "opencode-go", keyName: null, accountRef: null, model: "m", outcome: "refused", reason: "quota_exhausted", source: "provider-run", observedAt: at, resetsAt: null },
    // A provider whose name prefixes another's covers only its own `provider/` routes.
    { provider: "opencode", keyName: null, accountRef: null, model: null, outcome: "refused", reason: "payment_required", source: "provider-run", observedAt: at, resetsAt: null } ] };
  const a = assessProviderLimits(snapshot, Date.parse(at));
  assert.equal(a.refusals.length, 4);
  assert.equal(admitProviderRoute(a, "opencode/any").admitted, false);
  for (const route of ["openrouter/vendor/model", "codex/fixture", "opencode-go/other", "opencode-go-m/x"]) assert.equal(admitProviderRoute(a, route).admitted, true, route);
  assert.equal(admitProviderRoute(a, "opencode-go/m").admitted, false);
});
