import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { readGovernanceSnapshot, readTransportCapacity, type TransportCapacityRow } from "./index.js";

const fixture = (): any => JSON.parse(readFileSync(new URL("../test-fixtures/transport-capacity/orchid-104.json", import.meta.url), "utf8"));
const envelope = (snapshot: any): any => {
  const value = JSON.parse(readFileSync(new URL("../test-fixtures/governance-read/transport-availability.json", import.meta.url), "utf8"));
  const { schemaVersion: _, ...body } = snapshot;
  value.transportAvailability = body;
  return value;
};
it("capacity: recorded Orchid #104 publication survives both shared and envelope decoding with explicit nulls", () => {
  const source = fixture(), read = readGovernanceSnapshot(envelope(source));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const rows: readonly TransportCapacityRow[] = read.snapshot.transportAvailability!.transportCapacity!;
  assert.deepEqual(rows, source.transportCapacity);
  assert.notEqual(rows, source.transportCapacity);
  assert.notEqual(rows[0], source.transportCapacity[0]);
  assert.equal(rows[0]!.admissionCap, null);
  assert.equal(rows[2]!.admissionCap, 0);
  assert.equal(rows[3]!.active, null);
});
it("capacity: reader-first absence remains absent, never synthesizes free seats", () => {
  const source = fixture(); delete source.transportCapacity;
  const read = readGovernanceSnapshot(envelope(source));
  assert.ok(read.ok);
  assert.equal(Object.hasOwn(read.snapshot.transportAvailability!, "transportCapacity"), false);
});
it("capacity: accepts free seats despite unavailable pacing, every pacing reason and disabled missing budget", () => {
  for (const [pacing, reasons] of [
    ["clear", [null]], ["limited", ["governor-pacing", "5h-ceiling", "weekly-ceiling"]],
    ["unknown", ["meter-unread", "meter-stale", "window-expired", "ceiling-misconfigured"]],
  ] as const) for (const pacingReason of reasons) {
    const source = fixture();
    Object.assign(source.transportCapacity[1], { capacity: "free", active: 0, pacing, pacingReason });
    assert.notEqual(readTransportCapacity(source.transportCapacity, source.transports), null);
  }
  const source = fixture(); source.transportCapacity[2].admissionCap = null;
  assert.notEqual(readTransportCapacity(source.transportCapacity, source.transports), null);
  Object.assign(source.transportCapacity[3], { capacity: "unknown", capacityReason: "seats-config-invalid" });
  assert.notEqual(readTransportCapacity(source.transportCapacity, source.transports), null);
});

const controls: readonly [string, (source: any) => void][] = [
  ["null array", s => { s.transportCapacity = null; }],
  ["empty array", s => { s.transportCapacity = []; }],
  ["missing row", s => { s.transportCapacity.pop(); }],
  ["capacity on legacy prefix", s => { s.transports.pop(); s.transportCapacity.pop(); }],
  ["extra availability row", s => { s.transports.push(s.transports[3]); }],
  ["extra row", s => { s.transportCapacity.push(s.transportCapacity[3]); }],
  ["row order", s => { s.transportCapacity.reverse(); }],
  ["unknown transport", s => { s.transportCapacity[1].transport = "PRIVATE_CANARY"; }],
  ["misaligned availability transport", s => { s.transports[1].transport = "agy"; }],
  ["unknown capacity", s => { s.transportCapacity[1].capacity = "PRIVATE_CANARY"; }],
  ["unknown capacity with spare seats", s => { Object.assign(s.transportCapacity[1], { capacity: "PRIVATE_CANARY", active: 0 }); }],
  ["non-free available", s => { Object.assign(s.transports[1], { available: true, reason: null }); }],
  ["disabled available", s => { Object.assign(s.transports[2], { available: true, reason: null }); }],
  ["unknown available", s => { Object.assign(s.transports[0], { available: true, reason: null }); }],
  ["full reason", s => { s.transportCapacity[1].capacityReason = "seats-not-configured"; }],
  ["disabled reason null", s => { s.transportCapacity[2].capacityReason = null; }],
  ["unknown reason null", s => { s.transportCapacity[0].capacityReason = null; }],
  ["unknown reason value", s => { s.transportCapacity[0].capacityReason = "PRIVATE_CANARY"; }],
  ["negative count", s => { s.transportCapacity[1].admissionCap = -1; }],
  ["fractional count", s => { s.transportCapacity[1].active = 0.5; }],
  ["unsafe count", s => { s.transportCapacity[1].active = Number.MAX_SAFE_INTEGER + 1; }],
  ["string count", s => { s.transportCapacity[1].maxActive = "1"; }],
  ["OpenCode max count", s => { s.transportCapacity[3].maxActive = 0; }],
  ["OpenCode active count", s => { s.transportCapacity[3].active = 0; }],
  ["OpenCode admission count", s => { s.transportCapacity[3].admissionCap = 0; }],
  ["occupied count null", s => { s.transportCapacity[0].active = null; }],
  ["unknown max count", s => { s.transportCapacity[0].maxActive = 0; }],
  ["unknown admission count", s => { s.transportCapacity[0].admissionCap = 0; }],
  ["disabled max count", s => { s.transportCapacity[2].maxActive = 1; }],
  ["disabled max null", s => { s.transportCapacity[2].maxActive = null; }],
  ["known max null", s => { s.transportCapacity[1].maxActive = null; }],
  ["known max zero", s => { s.transportCapacity[1].maxActive = 0; }],
  ["known admission null", s => { s.transportCapacity[1].admissionCap = null; }],
  ["full count mismatch", s => { s.transportCapacity[1].active = 0; }],
  ["free count mismatch", s => { s.transportCapacity[1].capacity = "free"; }],
  ["unknown pacing", s => { s.transportCapacity[1].pacing = "PRIVATE_CANARY"; }],
  ["metered pacing unmetered", s => { s.transportCapacity[1].pacing = "unmetered"; }],
  ["unmetered pacing clear", s => { s.transportCapacity[2].pacing = "clear"; }],
  ["clear pacing reason", s => { s.transportCapacity[1].pacingReason = "governor-pacing"; }],
  ["unmetered pacing reason", s => { s.transportCapacity[2].pacingReason = "meter-unread"; }],
  ["limited pacing null", s => { s.transportCapacity[1].pacing = "limited"; }],
  ["limited pacing unknown reason", s => { Object.assign(s.transportCapacity[1], { pacing: "limited", pacingReason: "meter-unread" }); }],
  ["unknown pacing null", s => { s.transportCapacity[0].pacingReason = null; }],
  ["unknown pacing limited reason", s => { s.transportCapacity[0].pacingReason = "5h-ceiling"; }],
  ["extra row field", s => { s.transportCapacity[1].PRIVATE_CANARY = "private-value"; }],
  ...["capacityReason", "maxActive", "active", "admissionCap", "pacingReason"].map(field =>
    [`omitted ${field}`, (s: any) => { delete s.transportCapacity[1][field]; }] as [string, (s: any) => void]),
];
for (const [name, modify] of controls) it(`capacity refuses ${name}`, () => {
  const source = fixture(); modify(source);
  assert.equal(readTransportCapacity(source.transportCapacity, source.transports), null);
  const read = readGovernanceSnapshot(envelope(source));
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.reason, "invalid");
  assert.doesNotMatch(JSON.stringify(read), /PRIVATE_CANARY|private-value/);
});
it("capacity: hostile reflection never escapes the public boundary", () => {
  const source = fixture();
  assert.equal(readTransportCapacity(new Proxy([], { getPrototypeOf() { throw new Error("PRIVATE_CANARY"); } }), source.transports), null);
  Object.defineProperty(source.transportCapacity[0], "capacity", { get() { throw new Error("PRIVATE_CANARY"); } });
  assert.equal(readTransportCapacity(source.transportCapacity, source.transports), null);
});
