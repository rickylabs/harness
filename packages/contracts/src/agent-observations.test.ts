/** Synthetic public identities and measurements only. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { readAgentObservations, unavailableAgentCost, MAX_AGENT_OBSERVATIONS, type AgentObservation, type AgentObservations } from "./agent-observations.js";
import { compareRouteIdentity, projectRouteIdentity } from "./route.js";
const at = "2026-01-01T00:00:00.000Z";
const rev = "a".repeat(64);
const id = (n: number) => "agent_" + n.toString(16).padStart(64, "0");
const absent = () => ({ value: null, reason: "source_not_bound", observedAt: null, validUntil: null, revision: null } as const);
function fixture(n = 1): AgentObservation {
  return { agentId: id(n), repo: { owner: "example", name: "project" }, issueNumber: 42,
    assignment: { id: "assignment_" + rev, dispatcher: "divybot", basis: "dispatcher-confirmed" },
    parentAgentId: { state: "confirmed-root", value: null, reason: null },
    workspace: absent(), tab: absent(), pane: absent(), terminal: absent(), running: absent(),
    route: projectRouteIdentity(compareRouteIdentity(
      { provider: "fixture-router", model: "fixture-model", effort: "high", cwd: null },
      { provider: "different-fixture-router", model: "fixture-model", effort: "high", cwd: null },
    )), cost: unavailableAgentCost(), observedAt: at, revision: rev };
}
const envelope = (agents: readonly AgentObservation[] = [fixture()]): AgentObservations =>
  ({ schema: 1, protocol: 1, observedAt: at, revision: rev, complete: true, reason: null, agents });
const refusal = (v: unknown, reason: string) => assert.deepEqual(readAgentObservations(v), { ok: false, reason });
it("reads a whole tree with opaque identity, canonical mismatch evidence and three unavailable cost rows", () => {
  const child: AgentObservation = { ...fixture(2), parentAgentId: { state: "known-parent", value: id(1), reason: null } };
  const input = envelope([child, fixture()]);
  const read = readAgentObservations(input);
  assert.ok(read.ok);
  assert.deepEqual(read.observation, input);
  assert.notEqual(read.observation.agents, input.agents);
  assert.deepEqual(read.observation.agents[0]?.route.mismatches, ["provider"]);
  assert.equal(read.observation.agents[0]?.cost.subscriptionHeadroom.unit, "percent_remaining");
  assert.equal(read.observation.agents[0]?.cost.meteredSpend.unit, "currency");
  assert.equal(read.observation.agents[0]?.cost.runTokens.unit, "tokens");
});
it("rejects unknown versions, incomplete reads and oversized arrays without returning any prefix", () => {
  refusal({ ...envelope(), schema: 2 }, "unsupported-schema");
  refusal({ ...envelope(), complete: false, reason: "scan_limit" }, "incomplete");
  refusal(envelope(Array(MAX_AGENT_OBSERVATIONS + 1).fill(fixture())), "oversized");
});
it("refuses duplicates, cycles, missing parents, unknown parentage and cross-issue ancestry as a whole", () => {
  refusal(envelope([fixture(), fixture()]), "ambiguous-ancestry");
  refusal(envelope([{ ...fixture(), parentAgentId: { state: "known-parent", value: id(1), reason: null } }]), "ambiguous-ancestry");
  refusal(envelope([{ ...fixture(), parentAgentId: { state: "known-parent", value: id(2), reason: null } }]), "ambiguous-ancestry");
  refusal(envelope([{ ...fixture(), parentAgentId: { state: "unavailable", value: null, reason: "identity_unavailable" } }]), "ambiguous-ancestry");
  const child: AgentObservation = { ...fixture(2), issueNumber: 43, parentAgentId: { state: "known-parent", value: id(1), reason: null } };
  refusal(envelope([fixture(), child]), "ambiguous-ancestry");
  refusal(envelope([fixture(), fixture(2)]), "ambiguous-ancestry");
});
it("does not accept raw native ids, path references, spoofed route evidence or null values without reasons", () => {
  refusal(envelope([{ ...fixture(), agentId: "fixture-native-session" }]), "invalid");
  refusal(envelope([{ ...fixture(), terminal: { value: "/synthetic/private", reason: null, observedAt: at, validUntil: null, revision: rev } }]), "invalid");
  refusal(envelope([{ ...fixture(), route: { ...fixture().route, status: "known" } }]), "invalid");
  refusal({ ...envelope(), agents: [{ ...fixture(), running: { ...absent(), reason: null } }] }, "invalid");
  refusal({ ...envelope(), agents: [{ ...fixture(), nativeId: "PRIVATE-CANARY" }] }, "invalid");
});
it("bounds total encoded bytes, independently of agent count", () => {
  const long = "x".repeat(128);
  const rows = Array.from({ length: MAX_AGENT_OBSERVATIONS }, (_, n) => {
    const f = fixture(n + 1);
    const known = { value: long, reason: null, observedAt: at, validUntil: null, revision: rev } as const;
    return { ...f, assignment: { ...f.assignment, id: "assignment_" + (n + 1).toString(16).padStart(64, "0") },
      workspace: known, pane: known, terminal: known, tab: known,
      route: projectRouteIdentity(compareRouteIdentity(
        { provider: long, model: long, effort: long, cwd: null },
        { provider: "y".repeat(128), model: "y".repeat(128), effort: "y".repeat(128), cwd: null },
      )) };
  });
  refusal(envelope(rows), "oversized");
});
it("validates measured rows separately with source revisions and validity, preserving overlapping token components", () => {
  const f = fixture();
  const base = { availability: "available", reason: null, observedAt: at, validUntil: "2026-01-01T01:00:00.000Z", revision: rev } as const;
  const cost = { ...f.cost,
    subscriptionHeadroom: { ...f.cost.subscriptionHeadroom, ...base, measurement: { remainingPercent: 75, windowMinutes: 60, resetsAt: null } },
    meteredSpend: { ...f.cost.meteredSpend, ...base, measurement: { amount: 0.25, currency: "USD", accounting: "reported" } as const },
    runTokens: { ...f.cost.runTokens, ...base, measurement: { inputTokens: 100, cacheReadTokens: 80 } },
  };
  assert.ok(readAgentObservations(envelope([{ ...f, cost }])).ok);
  refusal(envelope([{ ...f, cost: { ...cost, subscriptionHeadroom: { ...cost.subscriptionHeadroom, measurement: { remainingPercent: 101, windowMinutes: 60, resetsAt: null } } } }]), "invalid");
  refusal(envelope([{ ...f, cost: { ...cost, runTokens: { ...cost.runTokens, validUntil: "2025-12-31T23:00:00.000Z" } } }]), "invalid");
});
it("contains hostile accessors and proxies without invoking getters or retaining caller objects", () => {
  let invoked = false;
  const input = envelope();
  Object.defineProperty(input, "agents", { enumerable: true, get() { invoked = true; throw Error(); } });
  refusal(input, "invalid");
  assert.equal(invoked, false);
  refusal(new Proxy({}, { ownKeys() { throw Error(); } }), "invalid");
  const rows = [fixture()];
  Object.defineProperty(rows, "0", { enumerable: true, get() { invoked = true; throw Error(); } });
  refusal(envelope(rows), "invalid");
  assert.equal(invoked, false);
});
