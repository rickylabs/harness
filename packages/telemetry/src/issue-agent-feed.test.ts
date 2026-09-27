import assert from "node:assert/strict";
import { it } from "node:test";
import { projectRouteIdentity, readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import { buildIssueAgentTreeSnapshot } from "./issue-agent-feed.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { RunRecord } from "./model.js";

const at = "2026-01-01T00:00:00.000Z", later = "2026-01-01T00:00:01.000Z";
const route = projectRouteIdentity({ requested: {
  provider: { value: "fixture-provider", source: "request.modelProvider" },
  model: { value: "fixture-model", source: "request.model" },
  effort: { value: "high", source: "request.effort" },
} });
const dispatch: DispatchEvidence = { runId: "PRIVATE-DISPATCH-CANARY", external: "PRIVATE-NATIVE-ROOT", source: "codex", harness: "codex",
  linkageBasis: "dispatcher-confirmed", issue: { repo: "example/project", number: 42 }, parentRunId: null,
  location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" }, dispatchState: "dispatched",
  budget: { tokenLimit: 1000, source: "issue-override", reason: null },
  router: { value: "direct", source: "dispatch", reason: null },
  routePolicy: { value: "netscript-matrix", digest: "b".repeat(64), source: "dispatch", reason: null },
  observedAt: at, revision: "a".repeat(64), route };
const run = (id: string, parentId: string | null, outcome: RunRecord["outcome"] = "unknown"): RunRecord => ({
  id, parentId, source: "codex", startedAt: at, updatedAt: later, branch: null,
  identity: { provider: "native-provider", model: "native-model", effort: null, profile: null },
  usage: {}, outcome, linkedIssues: [], origin: "PRIVATE-PATH-CANARY", quota: [] });
const runs = [run("PRIVATE-NATIVE-ROOT", null, "complete"), run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT")];
const build = (d: DispatchEvidence = dispatch, native: readonly RunRecord[] = runs) => {
  const observations = buildAgentObservations({ dispatches: [d], runs: native, observedAt: later,
    sourceBound: true, dispatchComplete: true, nativeComplete: true });
  return buildIssueAgentTreeSnapshot({ observations, dispatches: [d], runs: native });
};

it("groups issue, dispatch, root and child without leaking native identity or paths", () => {
  const snapshot = build();
  assert.equal(snapshot.complete, true);
  assert.ok(readIssueAgentTreeSnapshot(snapshot).ok);
  assert.equal(snapshot.issues.length, 1);
  const agents = snapshot.issues[0]?.dispatches[0]?.agents ?? [];
  assert.equal(agents.length, 2);
  const root = agents.find(a => a.observation.parentAgentId.state === "confirmed-root")!;
  const child = agents.find(a => a.observation.parentAgentId.state === "known-parent")!;
  assert.equal(child.observation.parentAgentId.value, root.observation.agentId);
  assert.deepEqual(root.budget, { tokenLimit: 1000, source: "issue-override", reason: null });
  assert.deepEqual(child.budget, { tokenLimit: null, source: "unavailable", reason: "source_not_bound" });
  assert.deepEqual(child.provider, { value: "native-provider", source: "native", reason: null });
  assert.deepEqual(root.router, { value: "direct", source: "dispatch", reason: null });
  assert.deepEqual(child.router, { value: "direct", source: "dispatch", reason: null });
  assert.deepEqual(root.routePolicy, { value: "netscript-matrix", digest: "b".repeat(64), source: "dispatch", reason: null });
  assert.deepEqual(child.routePolicy, { value: null, digest: null, source: "unavailable", reason: "source_not_bound" });
  assert.equal(root.terminalOutcome.value, "succeeded");
  assert.equal(root.dispatchId, root.observation.assignment.id);
  assert.ok(root.history.every(event => event.dispatchId === root.dispatchId));
  assert.equal(root.liveness.state, "ended");
  assert.equal(root.endedAt, null); // updatedAt is last activity, even after a terminal outcome.
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
});
it("keeps router unavailable when the dispatch has no validated gateway", () => {
  const snapshot = build({ ...dispatch,
    router: { value: null, source: "unavailable", reason: "source_not_bound" },
    routePolicy: { value: null, digest: null, source: "unavailable", reason: "source_not_bound" },
    budget: { tokenLimit: 0, source: "route-default", reason: null } });
  const agents = snapshot.issues[0]?.dispatches[0]?.agents ?? [];
  assert.equal(agents.length, 2);
  assert.equal(agents[0]?.router.value, null);
  assert.equal(agents[1]?.router.value, null);
  assert.ok(agents.some(agent => agent.budget.tokenLimit === 0));
});
it("keeps unsafe child identity unknown and does not copy free-form source detail", () => {
  const bad = [runs[0]!, { ...runs[1]!, identity: { ...runs[1]!.identity,
    provider: "PRIVATE-SECRET-SPACE value", model: "/PRIVATE/PATH" } }];
  const snapshot = build(dispatch, bad);
  const child = snapshot.issues[0]?.dispatches[0]?.agents.find(a => a.observation.parentAgentId.state === "known-parent");
  assert.deepEqual(child?.provider, { value: null, source: "unavailable", reason: "source_not_bound" });
  assert.deepEqual(child?.model, { value: null, source: "unavailable", reason: "source_not_bound" });
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
});
it("keeps path-shaped identity unavailable and distinguishes cancelled, failed and ambiguous endings", () => {
  const path = build(dispatch, [runs[0]!, { ...runs[1]!, identity: { ...runs[1]!.identity,
    provider: "home/agent/private", model: "home/agent/private" } }]);
  const child = path.issues[0]?.dispatches[0]?.agents.find(a => a.observation.parentAgentId.state === "known-parent");
  assert.equal(child?.provider.value, null);
  assert.equal(child?.model.value, null);
  const privateRoute = projectRouteIdentity({ requested: {
    provider: { value: "fixture-provider", source: "request.modelProvider" },
    model: { value: "home/agent/private", source: "request.model" },
    effort: { value: "high", source: "request.effort" },
  } });
  const rootPath = build({ ...dispatch, route: privateRoute });
  assert.equal(rootPath.issues[0]?.dispatches[0]?.agents[0]?.observation.route.requested.model.value, null);
  assert.ok(!JSON.stringify(rootPath).includes("home/agent/private"));
  const terminal = (cause: RunRecord["terminalCause"]) => build(dispatch, [{ ...runs[0]!, outcome: "failed", terminalCause: cause }, runs[1]!])
    .issues[0]?.dispatches[0]?.agents.find(a => a.observation.parentAgentId.state === "confirmed-root")?.terminalOutcome.value;
  assert.equal(terminal("cancelled"), "cancelled");
  assert.equal(terminal("error"), "failed");
  assert.equal(terminal(undefined), null);
});
it("withholds a partial native tree instead of publishing a misleading prefix", () => {
  const observations = buildAgentObservations({ dispatches: [dispatch], runs, observedAt: later,
    sourceBound: true, dispatchComplete: true, nativeComplete: false });
  const snapshot = buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs });
  assert.equal(snapshot.complete, false);
  assert.deepEqual(snapshot.issues, []);
});
