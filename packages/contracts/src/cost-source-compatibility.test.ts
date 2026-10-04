/** Public wire provenance is preserved through a reader-first naming migration. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { projectRouteIdentity } from "./route.js";
import { AGENT_COST_SOURCE_NAMES, readAgentObservations, unavailableAgentCost } from "./agent-observations.js";

const at = "2026-01-01T00:00:00.000Z", validUntil = "2026-01-01T01:00:00.000Z", revision = "a".repeat(64);
const keys = ["subscriptionHeadroom", "meteredSpend", "runTokens", "localCapacity"] as const;
const sources = {
  subscriptionHeadroom: ["dsh-telemetry.governance.usage", "harness-telemetry.governance.usage"],
  meteredSpend: ["dsh-telemetry.runs", "harness-telemetry.runs"],
  runTokens: ["dsh-telemetry.runs", "harness-telemetry.runs"],
  localCapacity: ["dsh-telemetry.host-capacity", "harness-telemetry.host-capacity"],
} as const;
const measurements = {
  subscriptionHeadroom: { remainingPercent: 75, windowMinutes: 60, resetsAt: null },
  meteredSpend: { amount: 0.25, currency: "USD", accounting: "reported" },
  runTokens: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 80 },
  localCapacity: { host: "fixture-node", ramUsedBytes: 100, ramTotalBytes: 200, vramUsedBytes: null, vramTotalBytes: null },
};
function cost(mask: number, available: boolean): Record<string, Record<string, unknown>> {
  const defaults = unavailableAgentCost();
  return Object.fromEntries(keys.map((key, i) => [key, { ...defaults[key], source: sources[key][(mask >> i) & 1],
    ...(available ? { availability: "available", measurement: measurements[key], reason: null, observedAt: at, validUntil, revision } : {}) }]));
}
function envelope(rows: unknown) {
  const absent = { value: null, reason: "source_not_bound", observedAt: null, validUntil: null, revision: null };
  return { schema: 1, protocol: 1, observedAt: at, revision, complete: true, reason: null,
    agents: [{ agentId: "agent_" + revision, repo: { owner: "example", name: "project" }, issueNumber: 42,
      assignment: { id: "assignment_" + revision, dispatcher: "divybot", basis: "dispatcher-confirmed" },
      parentAgentId: { state: "confirmed-root", value: null, reason: null },
      workspace: absent, pane: absent, tab: absent, terminal: absent, running: absent,
      route: projectRouteIdentity(null), cost: rows, observedAt: at, revision }] };
}
it("preserves every canonical/legacy source combination for available and unavailable rows", () => {
  for (const available of [false, true]) for (let mask = 0; mask < 16; mask++) {
    const rows = cost(mask, available), input = envelope(rows), before = JSON.stringify(input);
    const read = readAgentObservations(input);
    assert.ok(read.ok, `family mask ${mask}, available=${available}`);
    assert.deepEqual(read.observation.agents[0]?.cost, rows);
    assert.notEqual(read.observation.agents[0]?.cost, rows);
    assert.equal(JSON.stringify(input), before, "decoding does not normalize caller provenance or measurements");
  }
});
it("retains the legacy producer default and old three-row unavailable capacity placeholder", () => {
  const rows = cost(0, false);
  assert.deepEqual(unavailableAgentCost(), rows);
  delete rows.localCapacity;
  const read = readAgentObservations(envelope(rows));
  assert.ok(read.ok);
  assert.deepEqual(read.observation.agents[0]?.cost.localCapacity, unavailableAgentCost().localCapacity);
});
it("exports deeply frozen per-row source vocabulary without a mutable decoder guard", () => {
  assert.equal(Object.isFrozen(AGENT_COST_SOURCE_NAMES), true);
  for (const key of keys) {
    assert.equal(Object.isFrozen(AGENT_COST_SOURCE_NAMES[key]), true);
    assert.deepEqual(new Set(AGENT_COST_SOURCE_NAMES[key]), new Set(sources[key]));
    assert.equal(Reflect.set(AGENT_COST_SOURCE_NAMES[key], "0", "PRIVATE-SOURCE-CANARY"), false);
  }
  assert.equal(Reflect.set(AGENT_COST_SOURCE_NAMES, "runTokens", ["PRIVATE-SOURCE-CANARY"]), false);
  assert.ok(readAgentObservations(envelope(cost(15, true))).ok);
});
it("rejects arbitrary, malformed and cross-class sources as a whole after accepting the canonical control", () => {
  assert.ok(readAgentObservations(envelope(cost(15, true))).ok);
  const all = [...new Set(Object.values(sources).flat())];
  for (const key of keys) {
    const wrong = all.filter(source => !(sources[key] as readonly string[]).includes(source));
    for (const source of [...wrong, "harness-telemetry", "harness-telemetry.runs.extra", "HARNESS-TELEMETRY.RUNS",
      " harness-telemetry.runs", "harness-telemetry.runs ", "harness-telemetry.governance.spend", "PRIVATE-SOURCE-CANARY", null, 1]) {
      const rows = cost(15, true); rows[key]!.source = source;
      assert.deepEqual(readAgentObservations(envelope(rows)), { ok: false, reason: "invalid" }, `${key}: ${String(source)}`);
    }
  }
});
it("canonical provenance retains strict kind, unit, scope, metadata and measurement guards", () => {
  assert.ok(readAgentObservations(envelope(cost(15, true))).ok);
  for (const key of keys) for (const change of [
    { kind: "wrong" }, { unit: "wrong" }, { scope: "wrong" }, { availability: "unknown" },
    { reason: "measurement_missing" }, { measurement: null }, { observedAt: null },
    { observedAt: null, validUntil: null },
    { observedAt: "2026-01-01T00:01:00.000Z" }, { validUntil: "2025-12-31T23:59:59.000Z" },
    { revision: null }, { revision: "invalid" }, { PRIVATE_FIELD_CANARY: "private-value" },
  ]) {
    const rows = cost(15, true); Object.assign(rows[key]!, change);
    assert.deepEqual(readAgentObservations(envelope(rows)), { ok: false, reason: "invalid" });
  }
  for (const key of ["subscriptionHeadroom", "localCapacity"] as const) {
    const rows = cost(15, true); rows[key]!.validUntil = null;
    assert.equal(readAgentObservations(envelope(rows)).ok, false);
  }
  for (const key of keys) {
    const rows = cost(15, true); rows[key]!.validUntil = "2026-01-01T00:00:30.000Z";
    const frame = envelope(rows); frame.observedAt = "2026-01-01T00:01:00.000Z";
    assert.deepEqual(readAgentObservations(frame), { ok: false, reason: "invalid" }, "expires before capture even after source time");
  }
});
it("canonical unavailable rows retain strict absence, reason and whole-document refusal", () => {
  assert.ok(readAgentObservations(envelope(cost(15, false))).ok);
  for (const key of keys) for (const change of [
    { availability: "unknown" }, { measurement: measurements[key] }, { reason: null },
    { reason: "PRIVATE-REASON-CANARY" }, { observedAt: "2026-01-01T00:01:00.000Z" },
    { validUntil }, { revision: "invalid" }, { PRIVATE_FIELD_CANARY: "private-value" },
  ]) {
    const rows = cost(15, false); Object.assign(rows[key]!, change);
    assert.deepEqual(readAgentObservations(envelope(rows)), { ok: false, reason: "invalid" });
  }
  const frame = envelope(cost(15, true));
  const second = structuredClone(frame.agents[0]!);
  second.agentId = "agent_" + "b".repeat(64);
  second.issueNumber = 43;
  second.assignment.id = "assignment_" + "b".repeat(64);
  const secondRows = cost(0, false);
  second.cost = secondRows;
  frame.agents.push(second);
  assert.ok(readAgentObservations(frame).ok, "valid mixed agents before the bad suffix control");
  secondRows.runTokens!.source = "harness-telemetry.host-capacity";
  assert.deepEqual(readAgentObservations(frame), { ok: false, reason: "invalid" }, "no accepted prefix of a refused collection");
});
it("source fields retain accessor/proxy refusal without invoking caller getters", () => {
  assert.ok(readAgentObservations(envelope(cost(15, true))).ok);
  let invoked = false;
  const rows = cost(15, true);
  Object.defineProperty(rows.runTokens, "source", { enumerable: true, get() { invoked = true; throw Error("PRIVATE-CANARY"); } });
  assert.deepEqual(readAgentObservations(envelope(rows)), { ok: false, reason: "invalid" });
  assert.equal(invoked, false);
  const other = cost(15, false); other.localCapacity = new Proxy({}, { ownKeys() { throw Error("PRIVATE-CANARY"); } });
  assert.deepEqual(readAgentObservations(envelope(other)), { ok: false, reason: "invalid" });
});
