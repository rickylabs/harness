import assert from "node:assert/strict";
import { it } from "node:test";
import { projectRouteIdentity } from "./route.js";
import { readIssueAgentTreeSnapshot, type IssueAgentTreeSnapshot } from "./issue-agent-tree.js";
import { unavailableAgentCost, type AgentObservation } from "./agent-observations.js";

const at = "2026-01-01T00:00:00.000Z", rev = "a".repeat(64), dispatchId = "assignment_" + "b".repeat(64);
const absent = () => ({ value: null, reason: "source_not_bound", observedAt: null, validUntil: null, revision: null } as const);
const observation: AgentObservation = { agentId: "agent_" + "c".repeat(64), repo: { owner: "example", name: "project" }, issueNumber: 42,
  assignment: { id: dispatchId, dispatcher: "divybot", basis: "dispatcher-confirmed" },
  parentAgentId: { state: "confirmed-root", value: null, reason: null }, workspace: absent(), pane: absent(), tab: absent(), terminal: absent(),
  running: absent(), route: projectRouteIdentity(null), cost: unavailableAgentCost(), observedAt: at, revision: rev };
const unknown = { value: null, source: "unavailable", reason: "source_not_bound" } as const;
const unplaced = { value: null, basis: "unavailable", observedAt: null, reason: "source_not_bound" } as const;
const node = { dispatchId, observation, harness: { value: "codex", source: "dispatch", reason: null }, provider: unknown,
  router: unknown, routePolicy: { value: null, digest: null, source: "unavailable", reason: "source_not_bound" },
  model: unknown, location: { host: unplaced, container: unplaced, seat: unplaced },
  budget: { tokenLimit: null, source: "unavailable", reason: "source_not_bound" }, quotaRegime: { value: "subscription", reason: null },
  liveness: { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" },
  terminalOutcome: { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" },
  startedAt: null, startedAtReason: "run_not_found", endedAt: null, endedAtReason: "measurement_missing",
  transcript: { value: null, reason: "source_not_bound" },
  history: [{ dispatchId, kind: "dispatch-observed", at }], historyTruncated: false } as const;
const snapshot = (): IssueAgentTreeSnapshot => ({ schema: 1, protocol: 1, observedAt: at,
  validUntil: "2026-01-01T00:00:15.000Z", revision: rev, complete: true, reason: null,
  issues: [{ repo: observation.repo, issueNumber: 42, dispatches: [{ dispatchId, agents: [node] }] }] });
const read = (value: unknown) => readIssueAgentTreeSnapshot(value);

it("decodes a grouped opaque dispatch tree with explicit unknowns", () => {
  const result = read(snapshot());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.snapshot.issues[0]?.dispatches[0]?.agents[0]?.budget.tokenLimit, null);
});
it("retains sourced zero, rejects invalid budgets and unsupported router claims", () => {
  const s = snapshot();
  const mutate = (patch: Record<string, unknown>) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node, ...patch }] }] }] });
  assert.equal(read(mutate({ nativeSessionId: "PRIVATE-CANARY" })).ok, false);
  assert.equal(read(mutate({ budget: { tokenLimit: 0, source: "route-default", reason: null } })).ok, true);
  assert.equal(read(mutate({ budget: { tokenLimit: -1, source: "route-default", reason: null } })).ok, false);
  assert.equal(read(mutate({ budget: { tokenLimit: null, source: "route-default", reason: null } })).ok, false);
  assert.equal(read(mutate({ router: { value: "PRIVATE-PATH-CANARY", source: "native", reason: null } })).ok, false);
  assert.equal(read(mutate({ router: { value: "router", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(mutate({ router: { value: "direct", source: "dispatch", reason: null } })).ok, true);
  assert.equal(read(mutate({ harness: { value: "opencode", source: "dispatch", reason: null },
    router: { value: "openai", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(mutate({ routePolicy: { value: "netscript-matrix", digest: rev, source: "dispatch", reason: null } })).ok, true);
  assert.equal(read(mutate({ routePolicy: { value: "netscript-matrix", digest: "PRIVATE-CANARY", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(mutate({ model: { value: "home/agent/private", source: "native", reason: null } })).ok, false);
  assert.equal(read(mutate({ location: { ...node.location, host: { value: "home/agent/private", basis: "placement", observedAt: at, reason: null } } })).ok, false);
});
it("rejects child claims that cannot be attributed to child evidence", () => {
  const child = { ...node, observation: { ...observation, agentId: "agent_" + "d".repeat(64),
    parentAgentId: { state: "known-parent", value: observation.agentId, reason: null } },
    harness: { value: "codex", source: "native", reason: null } };
  const withChild = (patch: Record<string, unknown>) => {
    const s = snapshot();
    return { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [node, { ...child, ...patch }] }] }] };
  };
  assert.equal(read(withChild({})).ok, true);
  assert.equal(read(withChild({ budget: { tokenLimit: 1000, source: "route-default", reason: null } })).ok, false);
  assert.equal(read(withChild({ provider: { value: "openai", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ model: { value: "model", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ harness: { value: "codex", source: "dispatch", reason: null } })).ok, false);
  assert.equal(read(withChild({ router: { value: "direct", source: "dispatch", reason: null } })).ok, false);
  const routed = { ...node, router: { value: "direct", source: "dispatch", reason: null } };
  const s = snapshot();
  const inherited = { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId,
    agents: [routed, { ...child, router: { value: "direct", source: "dispatch", reason: null } }] }] }] };
  assert.equal(read(inherited).ok, true);
  assert.equal(read(withChild({ routePolicy: { value: "netscript-matrix", digest: rev, source: "dispatch", reason: null } })).ok, false);
});
it("reads a 0.5.0 frame without routePolicy as typed unavailable", () => {
  const { routePolicy: _legacy, ...legacyNode } = node;
  const s = snapshot();
  const old = { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [legacyNode] }] }] };
  const result = read(old);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.snapshot.issues[0]?.dispatches[0]?.agents[0]?.routePolicy,
    { value: null, digest: null, source: "unavailable", reason: "source_not_bound" });
});
it("bounds and orders history, and never treats a last-activity event as endedAt", () => {
  const s = snapshot();
  const mutate = (patch: Record<string, unknown>) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node, ...patch }] }] }] });
  const tooLong = Array.from({ length: 17 }, (_, i) => ({ dispatchId, kind: "run-activity-observed",
    at: new Date(Date.parse(at) - (17 - i) * 1000).toISOString() }));
  assert.equal(read(mutate({ history: tooLong })).ok, false);
  assert.equal(read(mutate({ history: [{ dispatchId, kind: "run-activity-observed", at }, { dispatchId, kind: "dispatch-observed", at }] })).ok, false);
  assert.equal(read(mutate({ endedAt: at })).ok, false);
  assert.equal(read(mutate({ history: [{ dispatchId, kind: "raw-log-detail", at, detail: "PRIVATE-CANARY" }] })).ok, false);
});
it("rejects a getter before reading its value", () => {
  const s = snapshot(); let called = false;
  Object.defineProperty(s, "issues", { enumerable: true, get() { called = true; throw Error("PRIVATE-CANARY"); } });
  assert.equal(read(s).ok, false);
  assert.equal(called, false);
});
it("pins dispatch identity and freshness, and separates placement from runtime and terminal evidence", () => {
  const s = snapshot();
  const mutate = (patch: Record<string, unknown>) => ({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node, ...patch }] }] }] });
  assert.equal(read({ ...s, validUntil: "2026-01-01T00:00:16.000Z" }).ok, false);
  assert.equal(read(mutate({ dispatchId: "assignment_" + "d".repeat(64) })).ok, false);
  assert.equal(read(mutate({ history: [{ ...node.history[0], dispatchId: "assignment_" + "d".repeat(64) }] })).ok, false);
  assert.equal(read(mutate({ location: { ...node.location, host: { value: "/PRIVATE-PATH-CANARY", basis: "placement", observedAt: at, reason: null } } })).ok, false);
  assert.equal(read(mutate({ terminalOutcome: { value: "succeeded", source: "native-outcome", observedAt: at, reason: null } })).ok, false);
  assert.equal(read(mutate({ quotaRegime: { value: null, reason: null } })).ok, false);
});
