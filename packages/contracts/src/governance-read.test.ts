import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { readGovernanceSnapshot } from "./governance-read.js";
const root = new URL("../test-fixtures/governance-read/", import.meta.url);
// Mutable JSON is deliberate: each negative changes independent transport input.
const fixture = (name = "mixed-timeout"): any => JSON.parse(readFileSync(new URL(`${name}.json`, root), "utf8"));
const refuse = (value: unknown, reason = "invalid") => {
  const read = readGovernanceSnapshot(value);
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.reason, reason);
  assert.doesNotMatch(JSON.stringify(read), /PRIVATE_CANARY|private-value/);
};
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
