import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { readGovernanceSnapshot, readOpenCodeProviderPools, readRecordedAdmission } from "./governance-read.js";
import { parseState, timestamp } from "./governance-read-fields.js";
import { readDispatchRefusal } from "./dispatch-refusal.js";
const root = new URL("../test-fixtures/governance-read/", import.meta.url);
// Mutable JSON is deliberate: each negative changes independent transport input.
const fixture = (name = "mixed-timeout"): any => JSON.parse(readFileSync(new URL(`${name}.json`, root), "utf8"));
const refuse = (value: unknown, reason = "invalid") => {
  const read = readGovernanceSnapshot(value);
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.reason, reason);
  assert.doesNotMatch(JSON.stringify(read), /PRIVATE_CANARY|private-value/);
};
it("retains generic governance producer compatibility for Harness and legacy identifiers", () => {
  for (const producer of ["harness-telemetry", "dsh-telemetry"]) {
    const input = { ...fixture(), producer };
    const read = readGovernanceSnapshot(input);
    assert.ok(read.ok);
    assert.deepEqual(read.snapshot, input);
  }
});
for (const name of readdirSync(root)) it(`P: installed-format synthetic fixture ${name}`, () => {
  const input = fixture(name.slice(0, -5));
  const reading = readGovernanceSnapshot(input);
  assert.equal(reading.ok, true);
  if (reading.ok) assert.deepEqual(reading.snapshot, input);
});
for (const value of [null, "x", [], 1, true]) it(`N1 unreadable ${JSON.stringify(value)}`, () => refuse(value, "unreadable"));
for (const [name, modify] of [
  ["N5 unknown top-level key is never reflected", (v: any) => { v.PRIVATE_CANARY = "private-value"; }],
  ["N6 unavailable with state", (v: any) => { v.availability = "unavailable"; }],
  ["N7 fresh null state", (v: any) => { v.state = null; }],
  ["N8 missing approvals", (v: any) => { delete v.sources.approvals; }],
  ["N8 approvals cannot be observed", (v: any) => { v.sources.approvals.status = "read"; }],
  ["N9 missing validity", (v: any) => { delete v.sources.capacity.validUntil; }],
  ["N10 read requires leaves", (v: any) => { v.state.regimes[2].hosts = []; }],
  ["N11 unknown failure", (v: any) => { v.sources.usage.reason = "PRIVATE_CANARY"; }],
  ["N12 note cap", (v: any) => { v.notes = ["x".repeat(4097)]; }],
  ["N12 note controls", (v: any) => { v.notes = ["x\u0000"]; }],
  ["N13 accepted admission", (v: any) => { v.admissions[0].accepted = true; }],
  ["N14 allow admission", (v: any) => { v.admissions[0].state = "allow"; }],
  ["N15 unsafe reason", (v: any) => { v.admissions[0].reason = "PRIVATE_CANARY / private-value"; }],
  ["N16 future leaf", (v: any) => { v.state.regimes[2].hosts[0].observedAt = "2026-09-07T12:00:01Z"; }],
  ["N17 reversed interval", (v: any) => { v.validUntil = "2026-09-07T11:00:00Z"; }],
  ["N18 future envelope", (v: any) => { v.evaluatedAt = "2026-09-07T11:00:00Z"; }],
  ["N19 duplicate regime", (v: any) => { v.state.regimes[0] = v.state.regimes[1]; }],
  ["N19 missing regime", (v: any) => { v.state.regimes.pop(); }],
  ["N20 admissions cap", (v: any) => { v.admissions = Array(1001).fill(v.admissions[0]); }],
  ["N21 failed configured complete", (v: any) => { v.complete = true; }],
  ["N22 dropped complete", (v: any) => { v.complete = true; v.sources.usage = { status: "not-configured" }; v.sources.admissions.dropped = ["admission-conflict"]; }],
  ["N23 used exceeds total", (v: any) => { v.state.regimes[2].hosts[0].ramTotalBytes = 1; }],
  ["N26 records mismatch", (v: any) => { v.sources.admissions.records = 2; }],
  ["BI1 meter provenance required", (v: any) => { delete v.sources.capacity.provenance; }],
  ["BI1 admission provenance required", (v: any) => { delete v.sources.admissions.provenance; }],
  ["BI1 collected time required", (v: any) => { delete v.sources.admissions.collectedAt; }],
  ["BI3 false availability", (v: any) => { v.availability = "stale"; }],
  ["BI3 false meter freshness", (v: any) => { v.sources.capacity.freshness = "stale"; }],
  ["BI3 false admission freshness", (v: any) => { v.admissions[0].freshness = "stale"; }],
  ["BI3 February 30", (v: any) => { v.evaluatedAt = "2026-02-30T12:00:00Z"; }],
  ["BI3 hour 24", (v: any) => { v.evaluatedAt = "2026-09-07T24:00:00Z"; }],
  ["BI3 NaN", (v: any) => { v.state.regimes[2].hosts[0].ramUsedBytes = NaN; }],
  ["BI3 infinity", (v: any) => { v.sources.admissions.records = Infinity; }],
  ["BI4 unread populated", (v: any) => { v.sources.capacity = { status: "not-configured" }; }],
  ["BI4 unread unnoted", (v: any) => { v.state.regimes[0].note = null; }],
  ["BI6 cyclic schema object", (v: any) => { v.state = v; }],
  ["BI6 sparse array", (v: any) => { delete v.admissions[0]; }],
  ["BI6 wrong prototype", (v: any) => { v.state = Object.assign(Object.create(null), v.state); }],
  ["BI6 leaf cap", (v: any) => { v.state.regimes[2].hosts = Array(257).fill(v.state.regimes[2].hosts[0]); }],
  ["BI6 notes cap", (v: any) => { v.notes = Array(65).fill("note"); }],
  ["BI6 unknown nested key", (v: any) => { v.state.regimes[2].hosts[0].PRIVATE_CANARY = "private-value"; }],
  ["BI6 overlong safe identifier", (v: any) => { v.producer = "x".repeat(129); }],
  ["BI6 accessor array element", (v: any) => { Object.defineProperty(v.admissions, "0", { get() { throw new Error("PRIVATE_CANARY"); } }); }],
  ["no approval census", (v: any) => { v.state.pending = [{}]; }],
] as const) it(name, () => { const value = fixture(); modify(value); refuse(value); });
it("N2–N4 unsupported schema/protocol is explicit and finite", () => {
  for (const [schema, protocol] of [[undefined, 1], [2, 1], [1, 2], [NaN, Infinity], ["PRIVATE_CANARY", {}], [0, 1]]) {
    const result = readGovernanceSnapshot({ schema, protocol });
    assert.deepEqual(result, { ok: false, reason: "unsupported-schema", schema: typeof schema === "number" && Number.isSafeInteger(schema) ? schema : null,
      protocol: typeof protocol === "number" && Number.isSafeInteger(protocol) ? protocol : null });
  }
});
it("N23 unbounded memory, N24 all-unconfigured, BI2 complete without admissions", () => {
  const input = fixture(); input.state.regimes[2].hosts[0].ramTotalBytes = null;
  assert.equal(readGovernanceSnapshot(input).ok, true);
  assert.equal(readGovernanceSnapshot(fixture("unavailable-not-configured")).ok, true);
  assert.equal(readGovernanceSnapshot(fixture("complete-without-admissions")).ok, true);
});
it("N25 unavailable reason is a closed code", () => {
  const input = fixture("unavailable-not-configured"); input.unavailableReason = "no live sources"; refuse(input);
});
it("BI6 accessors are refused without invocation, including top-level metadata", () => {
  let calls = 0;
  for (const top of [false, true]) {
    const input = fixture();
    Object.defineProperty(top ? input : input.sources.capacity, top ? "schema" : "observedAt", { enumerable: true, get() { calls++; throw new Error("PRIVATE_CANARY"); } });
    refuse(input, top ? "unreadable" : "invalid");
  }
  assert.equal(calls, 0);
});
it("BI6 thrown and revoked proxy inspection is contained, even hostile thrown values", () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  refuse(revoked.proxy, "unreadable");
  const hostile = new Proxy({}, { getPrototypeOf() { throw revoked.proxy; } });
  refuse(hostile, "unreadable");
  const input = fixture(); input.state = hostile; refuse(input);
  refuse(Object.create(null), "unreadable");
});
it("BI6 output is independently owned in both directions", () => {
  const input = fixture(); const read = readGovernanceSnapshot(input);
  assert.equal(read.ok, true); if (!read.ok) return;
  const snapshot = JSON.stringify(read.snapshot);
  input.sources.capacity.provenance = "mutated"; input.state.regimes[2].hosts[0].ramUsedBytes = 3;
  input.admissions[0].reason = "mutated"; input.notes.push("mutated");
  assert.equal(JSON.stringify(read.snapshot), snapshot);
  (read.snapshot.notes as string[]).push("output-mutation");
  assert.ok(!input.notes.includes("output-mutation"));
});
it("strict nested state shapes and numeric bounds", () => {
  for (const change of [
    (v: any) => { v.state.regimes[0].accounts[0].windows[0].usedPercent = 101; },
    (v: any) => { v.state.regimes[0].accounts[0].windows[0].PRIVATE_CANARY = 1; },
    (v: any) => { v.state.regimes[1].providers[0].spentUsd = -1; },
    (v: any) => { v.state.regimes[0].accounts[0].windows[0].resetsAt = "2026-02-30T00:00:00Z"; },
    (v: any) => { v.state.regimes[0].accounts[0].windows = Array(257).fill({}); },
    (v: any) => { v.state.regimes[1].providers[0].provider = "x".repeat(257); },
  ]) { const input = fixture("complete-without-admissions"); change(input); refuse(input); }
});

// 0.28.0: the dispatcher's transport availability, a sibling source with its own validity.
const withAvailability = (): any => fixture("transport-availability");
it("provider budget decisions are independently copied, clock-bound and reader-first optional", () => {
  const value = withAvailability(), body = value.transportAvailability;
  const row = { provider: "fixture-provider", model: "fixture-model", observedAt: body.observedAt, validUntil: body.validUntil,
    available: false, reason: "budget-reached" };
  body.providerBudgets = [row];
  const read = readGovernanceSnapshot(value); assert.equal(read.ok, true);
  if (read.ok) { assert.deepEqual(read.snapshot.transportAvailability?.providerBudgets, [row]); assert.notEqual(read.snapshot.transportAvailability?.providerBudgets, body.providerBudgets); }
  for (const providerBudgets of [null, [row, row], [{ ...row, observedAt: "2026-01-01T00:00:00.000Z" }],
    [{ ...row, validUntil: "2027-01-01T00:00:00.000Z" }], [{ ...row, reason: "PRIVATE_CANARY" }], [{ ...row, available: true }]]) {
    const next = withAvailability(); next.transportAvailability.providerBudgets = providerBudgets; refuse(next);
  }
});
for (const [name, modify] of [
  ["TA one key without the other", (v: any) => { delete v.transportAvailability; }],
  ["TA coverage without the body key", (v: any) => { delete v.sources.transportAvailability; }],
  ["TA read coverage with a null body", (v: any) => { v.transportAvailability = null; }],
  ["TA body without read coverage", (v: any) => { v.sources.transportAvailability = { status: "failed", reason: "file-unreadable" }; }],
  ["TA body times differ from its coverage", (v: any) => { v.transportAvailability.observedAt = "2026-09-07T11:59:51.000Z"; }],
  ["TA body from after the evaluation", (v: any) => {
    for (const t of [v.transportAvailability, v.sources.transportAvailability]) { t.observedAt = "2026-09-07T12:00:01.000Z"; t.validUntil = "2026-09-07T12:01:01.000Z"; } }],
  ["TA a transport missing", (v: any) => { v.transportAvailability.transports.pop(); }],
  ["TA an extra transport", (v: any) => { v.transportAvailability.transports.push({ transport: "unknown", available: true, reason: null }); }],
  ["TA transports out of order", (v: any) => { v.transportAvailability.transports.reverse(); }],
  ["TA available with a reason", (v: any) => { v.transportAvailability.transports[1].reason = "no-capacity"; }],
  ["TA unavailable without a reason", (v: any) => { v.transportAvailability.transports[0].reason = null; }],
  ["TA an unknown reason is never reflected", (v: any) => { v.transportAvailability.transports[0].reason = "PRIVATE_CANARY"; }],
  ["TA an extra row field", (v: any) => { v.transportAvailability.transports[0].PRIVATE_CANARY = "private-value"; }],
  ["TA complete with failed coverage", (v: any) => { v.complete = true; v.sources.usage = { status: "not-configured" };
    v.notes = ["pending approvals unobserved", "spend: not-configured"]; v.state.regimes[0].note = "usage: not-configured";
    v.sources.transportAvailability = { status: "failed", reason: "file-unreadable" }; v.transportAvailability = null; }],
] as const) it(name, () => { const value = withAvailability(); modify(value); refuse(value); });
it("TA decodes failed, discarded and unavailable-document forms, and a stale read", () => {
  const failed = withAvailability(); failed.sources.transportAvailability = { status: "failed", reason: "file-unreadable" }; failed.transportAvailability = null;
  const discarded = withAvailability(); discarded.sources.transportAvailability = { status: "discarded", reason: "stale-source" }; discarded.transportAvailability = null;
  const stale = withAvailability();
  for (const t of [stale.transportAvailability, stale.sources.transportAvailability]) { t.observedAt = "2026-09-07T11:58:00.000Z"; t.validUntil = "2026-09-07T11:59:00.000Z"; }
  stale.sources.transportAvailability.freshness = "stale";
  const unavailable = fixture("unavailable-not-configured");
  unavailable.sources.transportAvailability = withAvailability().sources.transportAvailability;
  unavailable.transportAvailability = withAvailability().transportAvailability;
  for (const value of [failed, discarded, stale, unavailable]) {
    const read = readGovernanceSnapshot(value);
    assert.equal(read.ok, true, JSON.stringify(read));
    if (read.ok) assert.deepEqual(read.snapshot, value);
  }
  // A read coverage claiming fresh after its validUntil is refused, as for the meters.
  stale.sources.transportAvailability.freshness = "fresh";
  refuse(stale);
});

// 0.31.0: staged reader-first rollout accepts the strict legacy prefix unchanged.
it("TA OpenCode is capacity-only while legacy snapshots remain unchanged", () => {
  for (const available of [true, false]) {
    const value = withAvailability();
    value.transportAvailability.transports.push({ transport: "opencode", available, reason: available ? null : "no-capacity" });
    const read = readGovernanceSnapshot(value);
    assert.equal(read.ok, true, JSON.stringify(read));
    if (read.ok) assert.deepEqual(read.snapshot, value);
  }
  const legacy = withAvailability();
  const old = readGovernanceSnapshot(legacy);
  assert.equal(old.ok, true);
  if (old.ok) assert.deepEqual(old.snapshot, legacy); // No invented fourth row or inferred headroom.
  for (const change of [
    (v: any) => { v.transportAvailability.transports.splice(0, 2); },
    (v: any) => { v.transportAvailability.transports.push({ transport: "opencode", available: true, reason: null }); },
    (v: any) => { v.transportAvailability.transports[3].transport = "agy"; },
    (v: any) => { v.transportAvailability.transports[3].transport = "PRIVATE_CANARY"; },
    (v: any) => { v.transportAvailability.transports[3].available = "true"; },
    (v: any) => { v.transportAvailability.transports[3].PRIVATE_CANARY = "private-value"; },
    (v: any) => { v.transportAvailability.transports[3].available = true; },
    (v: any) => { v.transportAvailability.transports[3].reason = null; },
    ...["meter-unread", "meter-stale", "window-expired", "5h-ceiling", "weekly-ceiling", "ceiling-misconfigured", "PRIVATE_CANARY"].map(reason =>
      (v: any) => { v.transportAvailability.transports[3].reason = reason; }),
  ]) {
    const value = withAvailability();
    value.transportAvailability.transports.push({ transport: "opencode", available: false, reason: "no-capacity" });
    change(value);
    refuse(value);
  }
});

const withPools = (): any => {
  const value = withAvailability();
  value.transportAvailability.transports.push({ transport: "opencode", available: true, reason: null });
  value.transportAvailability.openCodeProviderPools = [{ provider: "fixture-provider", maxActive: 1, active: 0 }];
  return value;
};
it("TA provider pools preserve exact source counts and optional absence", () => {
  for (const [maxActive, active] of ([[1, 0], [1, 1], [1, 2], [0, 0], [256, 255]] as const)) {
    const value = withPools();
    value.transportAvailability.openCodeProviderPools[0] = { provider: "fixture-provider", maxActive, active };
    value.transportAvailability.transports[3] = { transport: "opencode", available: maxActive > active, reason: maxActive > active ? null : "no-capacity" };
    const read = readGovernanceSnapshot(value);
    assert.equal(read.ok, true, JSON.stringify(read));
    if (read.ok) assert.deepEqual(read.snapshot, value);
  }
  const value = withPools(); value.transportAvailability.openCodeProviderPools = [];
  value.transportAvailability.transports[3] = { transport: "opencode", available: false, reason: "no-capacity" };
  const read = readGovernanceSnapshot(value); assert.equal(read.ok, true);
  if (read.ok) assert.deepEqual(read.snapshot, value);
  const legacy = withAvailability(); const old = readGovernanceSnapshot(legacy);
  assert.equal(old.ok, true);
  if (old.ok) assert.equal(Object.hasOwn(old.snapshot.transportAvailability!, "openCodeProviderPools"), false);
});
for (const [name, modify] of [
  ["null", (v: any) => {v.transportAvailability.openCodeProviderPools = null;}],
  ["duplicate", (v: any) => {v.transportAvailability.openCodeProviderPools.push({...v.transportAvailability.openCodeProviderPools[0]});}],
  ["over cap", (v: any) => {v.transportAvailability.openCodeProviderPools = Array.from({length:129}, (_,i) => ({provider:`fixture-${i}`,maxActive:1,active:0}));}],
  ["unsafe provider", (v: any) => {v.transportAvailability.openCodeProviderPools[0].provider = "PRIVATE_CANARY / private-value";}],
  ["unknown field", (v: any) => {v.transportAvailability.openCodeProviderPools[0].PRIVATE_CANARY = "private-value";}],
  ["negative max", (v: any) => {v.transportAvailability.openCodeProviderPools[0].maxActive = -1;}],
  ["large max", (v: any) => {v.transportAvailability.openCodeProviderPools[0].maxActive = 257;}],
  ["fraction max", (v: any) => {v.transportAvailability.openCodeProviderPools[0].maxActive = 1.5;}],
  ["negative active", (v: any) => {v.transportAvailability.openCodeProviderPools[0].active = -1;}],
  ["unsafe active", (v: any) => {v.transportAvailability.openCodeProviderPools[0].active = Number.MAX_SAFE_INTEGER + 1;}],
  ["string active", (v: any) => {v.transportAvailability.openCodeProviderPools[0].active = "0";}],
  ["contradictory aggregate", (v: any) => {v.transportAvailability.openCodeProviderPools[0].active = 1;}],
  ["missing OpenCode row", (v: any) => {v.transportAvailability.transports.pop();}],
  ["sparse", (v: any) => {delete v.transportAvailability.openCodeProviderPools[0];}],
  ["accessor", (v: any) => {Object.defineProperty(v.transportAvailability.openCodeProviderPools[0], "active", {enumerable:true,get(){throw new Error("PRIVATE_CANARY");}});}],
] as const) it(`TA provider pools refuse ${name}`, () => {const value=withPools(); modify(value); refuse(value);});

it("TA provider pools contain hostile inspection and own their output", () => {
 const revoked=Proxy.revocable({},{});revoked.revoke();
 assert.equal(readOpenCodeProviderPools(revoked.proxy),null);
 const hostile=new Proxy({}, {getPrototypeOf(){throw new Error("PRIVATE_CANARY");}});
 assert.equal(readOpenCodeProviderPools([hostile]),null);
 const input=[{provider:"fixture-provider",maxActive:1,active:0}];
 const output=readOpenCodeProviderPools(input);assert.deepEqual(output,input);
 input[0]!.active=1;assert.equal(output![0]!.active,0);
});

it("governance budgets preserve native nested models and refuse a provider-prefixed model fixture", () => {
  const load = (name: string): Record<string, unknown> => JSON.parse(readFileSync(
    new URL(`../test-fixtures/provider-budget-native-model/${name}.json`, import.meta.url), "utf8"));
  for (const name of ["native-flat", "native-nested", "native-tilde", "native-provider-like", "native-provider-name", "provider-prefixed", "provider-double-prefixed"]) {
    const value = withAvailability(), row = { ...load(name), observedAt: value.transportAvailability.observedAt,
      validUntil: value.transportAvailability.validUntil, available: false, reason: "budget-unavailable" };
    value.transportAvailability.providerBudgets = [row];
    if (name.startsWith("provider-")) refuse(value);
    else {
      const read = readGovernanceSnapshot(value); assert.equal(read.ok, true);
      if (read.ok) assert.deepEqual(read.snapshot.transportAvailability?.providerBudgets, [row]);
    }
  }
});

// Cases migrated from the deleted telemetry observation parser (#654). Field behaviour the canonical
// model still supports is tested on the shared helpers; the document's stricter rules are stated.
const OBSERVED = "2026-09-07T11:55:00.000Z";
const OBSERVED_MS = Date.parse(OBSERVED);
const approval = (id = "approval-1") => ({ id, kind: "dispatch-admission", summary: "Approve paid fallback for item 205",
  item: 205, runId: null, regime: "metered", requestedAt: "2026-09-07T11:54:00.000Z", expiresAt: null });
const host = (over: Record<string, unknown> = {}) => ({ host: "fixture-host", vramUsedBytes: 8, vramTotalBytes: 24,
  ramUsedBytes: 32, ramTotalBytes: 128, observedAt: OBSERVED, ...over });
const state = (over: Record<string, unknown> = {}): any => ({ generatedAt: OBSERVED, regimes: [
  { regime: "capacity", state: "allow", hosts: [host()], note: null },
  { regime: "subscription", state: "allow", note: null, accounts: [
    { seam: "codex", account: "primary", state: "allow", observedAt: OBSERVED, windows: [
      { label: "weekly", windowMinutes: 10080, usedPercent: 52, resetsAt: null, binding: false },
      { label: "5h", windowMinutes: 300, usedPercent: 63, resetsAt: "2026-09-07T13:00:00.000Z", binding: true }] },
    { seam: "claude", account: "backup", state: "allow", windows: [], observedAt: OBSERVED }] },
  { regime: "metered", state: "allow", note: null,
    providers: [{ provider: "openrouter", spentUsd: 12.5, ceilingUsd: 50, windowLabel: "monthly", observedAt: OBSERVED }] },
], pending: [], notes: ["synthetic note b", "synthetic note a"], ...over });
const refusal = (over: Record<string, unknown> = {}) => ({ item: 205, regime: "subscription", state: "throttle",
  observedAt: "2026-09-07T11:54:00.000Z", validUntil: "2026-09-07T12:01:00.000Z", freshness: "fresh",
  provenance: "synthetic:dispatcher", reason: "quota-paced", accepted: false, ...over });
it("M1 state decoding normalizes regimes, pending, notes, accounts and binding-first windows", () => {
  const parsed = parseState(state({ pending: [approval("z"), approval("a")] }), OBSERVED_MS);
  assert.deepEqual(parsed.regimes.map(r => r.regime), ["subscription", "metered", "capacity"]);
  assert.deepEqual(parsed.pending.map(p => p.id), ["a", "z"]);
  assert.deepEqual(parsed.notes, ["synthetic note a", "synthetic note b"]);
  const subscription = parsed.regimes[0];
  assert.ok(subscription?.regime === "subscription");
  assert.deepEqual(subscription.accounts.map(a => `${a.seam}/${a.account}`), ["claude/backup", "codex/primary"]);
  assert.equal(subscription.accounts[1]?.windows[0]?.binding, true);
});
it("M1 the document orders admissions by item", () => {
  const input = fixture("admissions-only");
  input.admissions = [{ ...input.admissions[0], item: 9 }, input.admissions[0]];
  input.sources.admissions.records = 2;
  const read = readGovernanceSnapshot(input);
  assert.ok(read.ok);
  assert.deepEqual(read.snapshot.admissions.map(a => a.item), [7, 9]);
});
it("M2 one refusal classifies its own freshness; the document refuses a fresh envelope over a stale refusal", () => {
  assert.equal(readRecordedAdmission(refusal({ freshness: "stale", validUntil: "2026-09-07T11:59:00.000Z" }), "2026-09-07T12:00:00.000Z")?.freshness, "stale");
  assert.equal(readRecordedAdmission(refusal({ validUntil: "2026-09-07T11:59:00.000Z" }), "2026-09-07T12:00:00.000Z"), null);
  const input = fixture("admissions-only");
  input.admissions[0].validUntil = "2026-09-07T12:01:00.000Z";
  refuse(input);
});
it("M3 instants compare as epoch milliseconds, keeping the producer's spelling", () => {
  const read = readRecordedAdmission(refusal({ observedAt: "2026-09-07T13:54:00+02:00", validUntil: "2026-09-07T14:01:00+02:00" }), "2026-09-07T12:00:00.000Z");
  assert.equal(read?.observedAt, "2026-09-07T13:54:00+02:00");
  assert.equal(timestamp("2026-09-07T13:55:00+02:00", "t").ms, OBSERVED_MS);
  assert.equal(parseState(state({ generatedAt: "2026-09-07T13:55:00+02:00" }), OBSERVED_MS).generatedAt, "2026-09-07T13:55:00+02:00");
});
it("M4 a refusal observed after the evaluation instant is refused", () => {
  assert.equal(readRecordedAdmission(refusal({ observedAt: "2026-09-07T12:00:01.000Z", validUntil: "2026-09-07T12:05:00.000Z" }), "2026-09-07T12:00:00.000Z"), null);
});
it("M5 null readings stay never-read evidence in state; the document refuses them on a retained read source", () => {
  const parsed = parseState(state({ regimes: [{ regime: "capacity", state: "allow", note: null,
    hosts: [host({ vramUsedBytes: null, vramTotalBytes: null, observedAt: null })] }, ...state().regimes.slice(1)] }), OBSERVED_MS);
  const capacity = parsed.regimes[2];
  assert.ok(capacity?.regime === "capacity");
  assert.deepEqual([capacity.hosts[0]?.observedAt, capacity.hosts[0]?.vramUsedBytes], [null, null]);
  const input = fixture();
  input.state.regimes[2].hosts[0].observedAt = null;
  refuse(input);
});
it("M6 generatedAt, pending and notes are required, never defaulted", () => {
  for (const key of ["generatedAt", "pending", "notes"]) {
    const input = state(); delete input[key];
    assert.throws(() => parseState(input, OBSERVED_MS));
  }
});
it("M7 approvals keep every field where they are carried; the document refuses any pending approval", () => {
  assert.deepEqual(parseState(state({ pending: [approval()] }), OBSERVED_MS).pending, [approval()]);
  const outcome = { accepted: false, reason: "needs-approval", detail: "waiting for an operator", approval: approval() };
  assert.deepEqual(readDispatchRefusal(outcome, OBSERVED), outcome);
  assert.equal(readDispatchRefusal({ ...outcome, approval: { ...approval(), requestedAt: "2026-09-07T11:56:00.000Z" } }, OBSERVED), null);
  for (const detail of ["", "x".repeat(4097)]) assert.equal(readDispatchRefusal({ ...outcome, detail }, OBSERVED), null);
  const input = fixture();
  input.state.pending = [approval()];
  refuse(input);
});
it("M8 an unsafe provenance is refused without echoing it", () => {
  const input = fixture();
  input.provenance = "/home/private/PRIVATE_CANARY";
  refuse(input);
  assert.equal(readRecordedAdmission(refusal({ provenance: "/home/private/PRIVATE_CANARY" }), "2026-09-07T12:00:00.000Z"), null);
});
it("M9 missing regimes, unknown states, negative headroom and accepted refusals are refused", () => {
  assert.throws(() => parseState(state({ regimes: state().regimes.slice(0, 2) }), OBSERVED_MS));
  assert.throws(() => parseState(state({ regimes: [{ ...state().regimes[0], state: "green" }, ...state().regimes.slice(1)] }), OBSERVED_MS));
  assert.throws(() => parseState(state({ regimes: [{ regime: "capacity", state: "allow", note: null, hosts: [host({ vramUsedBytes: 25 })] },
    ...state().regimes.slice(1)] }), OBSERVED_MS));
  assert.equal(readRecordedAdmission(refusal({ accepted: true }), "2026-09-07T12:00:00.000Z"), null);
  assert.equal(readDispatchRefusal({ accepted: true, reason: "quota-paced", detail: "x" }, OBSERVED), null);
});
