import assert from "node:assert/strict";
import { it } from "node:test";
import { ORCHID_OBSERVER_REASON, projectRouteIdentity, readIssueAgentTreeSnapshot, unavailableAgentCost } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import { buildIssueAgentTreeSnapshot, combineIssueAgentTreeSnapshots } from "./issue-agent-feed.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { HostCapacityReading } from "./host-capacity.js";
import type { RunRecord } from "./model.js";
import type { PublicActionReceipt } from "./action-receipt-cli.js";

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
const runs = [run("PRIVATE-NATIVE-ROOT", null, "complete"),
  { ...run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT"), nativeDepth: 1 }];
const build = (d: DispatchEvidence = dispatch, native: readonly RunRecord[] = runs, capturedAt = later,
  localCapacity?: HostCapacityReading) => {
  const observations = buildAgentObservations({ dispatches: [d], runs: native, observedAt: capturedAt,
    sourceBound: true, dispatchComplete: true, nativeComplete: true });
  return buildIssueAgentTreeSnapshot({ observations, dispatches: [d], runs: native,
    ...(localCapacity === undefined ? {} : { localCapacity }) });
};

it("measures running for a bound native task through the full frame validity", () => {
  const capture = "2026-01-01T00:01:31.000Z";
  const active = [run("PRIVATE-NATIVE-ROOT", null, "running"),
    run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "running")];
  const snapshot = build(dispatch, active, capture);
  assert.equal(snapshot.complete, true);
  const agents = snapshot.issues[0]?.dispatches[0]?.agents ?? [];
  assert.equal(agents.length, 2);
  for (const agent of agents) {
    assert.equal(agent.liveness.state, "running");
    assert.equal(agent.liveness.evidence, "runtime-observation");
    assert.equal(agent.liveness.observedAt, later);
    assert.equal(agent.observation.running.value, true);
    assert.equal(agent.observation.running.validUntil, "2026-01-01T00:02:01.000Z");
  }
  assert.ok(readIssueAgentTreeSnapshot(snapshot).ok);
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
});

it("expires running before frame validity can outlive the native activity window", () => {
  const active = [run("PRIVATE-NATIVE-ROOT", null, "running"),
    run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "running")];
  const edge = build(dispatch, active, "2026-01-01T00:01:46.000Z"); // event age 105 seconds
  assert.equal(edge.issues[0]?.dispatches[0]?.agents.every(agent => agent.liveness.state === "running"), true);
  const expired = build(dispatch, active, "2026-01-01T00:01:46.001Z");
  assert.equal(expired.issues[0]?.dispatches[0]?.agents.every(agent =>
    agent.liveness.state === "unknown" && agent.observation.running.reason === "source_stale"), true);
  const future = build(dispatch, [{ ...run("PRIVATE-NATIVE-ROOT", null, "running"),
    updatedAt: "2026-01-01T00:00:02.000Z" }], later);
  assert.equal(future.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "unknown");
});

it("terminal outcome wins, then a fresh native task restores running without an unknown flip", () => {
  const capture = "2026-01-01T00:00:03.000Z";
  const ended = build(dispatch, [run("PRIVATE-NATIVE-ROOT", null, "complete"), runs[1]!], capture);
  const rootOf = (snapshot: ReturnType<typeof build>) => snapshot.issues[0]?.dispatches[0]?.agents
    .find(agent => agent.observation.parentAgentId.state === "confirmed-root");
  assert.equal(rootOf(ended)?.liveness.state, "ended");
  assert.equal(rootOf(ended)?.timeline?.events.find(event => event.kind === "ended")?.reason, "native-complete");
  assert.equal(rootOf(ended)?.observation.running.value, null);
  const resumed = build(dispatch, [{ ...run("PRIVATE-NATIVE-ROOT", null, "running"),
    updatedAt: "2026-01-01T00:00:02.000Z" }, runs[1]!], capture);
  assert.equal(rootOf(resumed)?.liveness.state, "running");
  assert.equal(rootOf(resumed)?.observation.running.value, true);
  const failed = build(dispatch, [{ ...run("PRIVATE-NATIVE-ROOT", null, "failed"),
    updatedAt: "2026-01-01T00:00:02.000Z", terminalCause: "error" }, runs[1]!], capture);
  assert.equal(rootOf(failed)?.liveness.state, "ended");
  assert.equal(rootOf(failed)?.observation.running.value, null);
  assert.equal(rootOf(failed)?.terminalOutcome.value, "failed");
  assert.equal(rootOf(failed)?.timeline?.events.find(event => event.kind === "ended")?.reason, "native-error");
});

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
  assert.deepEqual(root.nativeDepth, { value: null, source: "unavailable", reason: "source_not_bound" });
  assert.deepEqual(child.nativeDepth, { value: 1, source: "native", reason: null });
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
it("binds measured activity, token numerator, child spawn, and immutable action to the exact agent", () => {
  const rootRun = { ...run("PRIVATE-NATIVE-ROOT", null, "running"), usage: { inputTokens: 8, outputTokens: 3,
    reasoningTokens: 2, cacheReadTokens: 5 }, activitySteps: [{ id: "step_" + "a".repeat(64), at,
      kind: "command", toolName: "exec_command", commandHead: "git status", filePath: null,
      summary: "Ran git status", source: "codex-rollout" }] } as RunRecord;
  const childRun = { ...run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "running"), nativeDepth: 1,
    usage: { inputTokens: 2, outputTokens: 1 } } as RunRecord;
  const observations = buildAgentObservations({ dispatches: [dispatch], runs: [rootRun, childRun],
    observedAt: later, sourceBound: true, dispatchComplete: true, nativeComplete: true });
  const rootId = observations.agents.find(agent => agent.parentAgentId.state === "confirmed-root")!.agentId;
  const accepted: PublicActionReceipt = { schemaVersion: 1, operationId: "00000000-0000-4000-8000-000000000001",
    requestDigest: "a".repeat(64), repository: "example/project", issueNumber: 42, action: "steer",
    agentId: rootId, dispatchId: observations.agents[0]!.assignment.id, outcome: "accepted",
    reason: "prompt_delivered", observedAt: later, replacementAgentId: null, messageId: null };
  const snapshot = buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs: [rootRun, childRun],
    actions: [accepted, { ...accepted, operationId: "00000000-0000-4000-8000-000000000002", issueNumber: 43 }],
    actionsComplete: true });
  assert.equal(snapshot.complete, true);
  const agents = snapshot.issues[0]!.dispatches[0]!.agents;
  const root = agents.find(agent => agent.observation.agentId === rootId)!;
  const child = agents.find(agent => agent.observation.agentId !== rootId)!;
  assert.equal(root.tokenUsage?.usedTokens, 11);
  assert.equal(root.tokenUsage?.budgetTokens, 1000);
  assert.equal(child.tokenUsage?.usedTokens, 3);
  assert.equal(child.tokenUsage?.budgetTokens, null);
  assert.equal(root.activity?.steps[0]?.summary, "Ran git status");
  assert.deepEqual(root.timeline?.events.map(event => event.kind), ["dispatched", "started", "subagent-spawned", "action-accepted"]);
  assert.equal(root.timeline?.events.find(event => event.kind === "subagent-spawned")?.relatedAgentId, child.observation.agentId);
  assert.equal(root.timeline?.events.filter(event => event.kind === "action-accepted").length, 1);
  assert.equal(root.timeline?.events.find(event => event.kind === "action-accepted")?.reason, "prompt_delivered");
  assert.equal(child.timeline?.events.some(event => event.kind === "action-accepted"), false);
  const rejected = buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs: [rootRun, childRun],
    actions: [{ ...accepted, outcome: "rejected", reason: "identity_mismatch" }], actionsComplete: true });
  assert.equal(rejected.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId)
    ?.timeline?.events.find(event => event.kind === "action-rejected")?.reason, "identity_mismatch");
  const stopped = buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs: [rootRun, childRun],
    actions: [{ ...accepted, action: "stop", reason: "workspace_close_delivered" }], actionsComplete: true });
  assert.equal(stopped.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId)
    ?.timeline?.events.find(event => event.kind === "action-accepted")?.reason, "workspace_close_delivered");
  assert.equal(stopped.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId)
    ?.timeline?.events.some(event => event.kind === "ended"), false);
  const malformed = buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs: [rootRun, childRun],
    actions: [{ ...accepted, reason: "PRIVATE-RAW-REASON" }], actionsComplete: true });
  const protectedTimeline = malformed.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId)?.timeline;
  assert.equal(protectedTimeline?.events.some(event => event.kind === "action-accepted"), false);
  assert.equal(protectedTimeline?.truncated, true);
  assert.ok(!JSON.stringify(malformed).includes("PRIVATE-RAW-REASON"));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
});
it("preserves incomplete action and event-overflow truncation when child spawn decorates the root", () => {
  const observations = buildAgentObservations({ dispatches: [dispatch], runs, observedAt: later,
    sourceBound: true, dispatchComplete: true, nativeComplete: true });
  const rootId = observations.agents.find(agent => agent.parentAgentId.state === "confirmed-root")!.agentId;
  const project = (actions: PublicActionReceipt[], actionsComplete: boolean) =>
    buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs, actions, actionsComplete });
  const rootOf = (actions: PublicActionReceipt[], actionsComplete: boolean) =>
    project(actions, actionsComplete).issues[0]!.dispatches[0]!.agents.find(agent =>
      agent.observation.agentId === rootId)!;
  assert.equal(rootOf([], false).timeline?.truncated, true);
  assert.equal(rootOf([], true).timeline?.truncated, false);
  const actions: PublicActionReceipt[] = Array.from({ length: 36 }, (_, i) => ({
    schemaVersion: 1, operationId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    requestDigest: "a".repeat(64), repository: "example/project", issueNumber: 42, action: "steer",
    agentId: rootId, dispatchId: observations.agents[0]!.assignment.id, outcome: "accepted",
    reason: "prompt_delivered", observedAt: later, replacementAgentId: null, messageId: null,
  }));
  assert.equal(rootOf(actions, true).timeline?.events.length, 32);
  assert.equal(rootOf(actions, true).timeline?.truncated, true);
});
it("never infers native child depth from the projected parent edge", () => {
  const missing = build(dispatch, [runs[0]!, run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT")]);
  const child = missing.issues[0]?.dispatches[0]?.agents.find(a => a.observation.parentAgentId.state === "known-parent");
  assert.deepEqual(child?.nativeDepth, { value: null, source: "unavailable", reason: "measurement_missing" });
  const invalid = build(dispatch, [runs[0]!, { ...runs[1]!, nativeDepth: 0 }]);
  const invalidChild = invalid.issues[0]?.dispatches[0]?.agents.find(a => a.observation.parentAgentId.state === "known-parent");
  assert.equal(invalidChild?.nativeDepth.value, null);
  assert.ok(readIssueAgentTreeSnapshot(missing).ok);
});
it("projects a certified dispatch host through root and child while withholding unverified capacity", () => {
  const placed = build({ ...dispatch, host: "fixture-node" });
  assert.equal(placed.complete, true);
  for (const agent of placed.issues[0]?.dispatches[0]?.agents ?? []) {
    assert.deepEqual(agent.location.host, { value: "fixture-node", basis: "placement", observedAt: at, reason: null });
    assert.equal(agent.observation.cost.localCapacity.scope, "host");
    assert.equal(agent.observation.cost.localCapacity.availability, "unavailable");
    assert.equal(agent.observation.cost.localCapacity.reason, "observer-unavailable");
  }
  const unbound = build({ ...dispatch, host: "fixture.invalid" });
  assert.equal(unbound.issues[0]?.dispatches[0]?.agents[0]?.location.host.reason, "source_not_bound");
  assert.equal(unbound.issues[0]?.dispatches[0]?.agents[0]?.observation.cost.localCapacity.reason, "source_not_bound");
  assert.ok(readIssueAgentTreeSnapshot(placed).ok);
});
it("binds a measured capacity row only to the exact local placement host", () => {
  const measurement = { host: "fixture-node", ramUsedBytes: 1024, ramTotalBytes: 4096,
    vramUsedBytes: 256, vramTotalBytes: 2048,
    cards: [{ card: "card0", vramUsedBytes: 256, vramTotalBytes: 2048 }] };
  const available: HostCapacityReading = { host: "fixture-node", cost: {
    kind: "local_capacity", unit: "bytes", source: "dsh-telemetry.host-capacity", scope: "host",
    availability: "available", measurement, reason: null, observedAt: later,
    validUntil: "2026-01-01T00:00:16.000Z", revision: "c".repeat(64),
  } };
  const placed = { ...dispatch, host: "fixture-node" };
  const matching = build(placed, runs, later, available);
  assert.equal(matching.complete, true);
  for (const agent of matching.issues[0]?.dispatches[0]?.agents ?? []) {
    assert.equal(agent.observation.cost.localCapacity.availability, "available");
    assert.deepEqual(agent.observation.cost.localCapacity.measurement, measurement);
  }
  assert.ok(readIssueAgentTreeSnapshot(matching).ok);
  const other: HostCapacityReading = { ...available, host: "other-fixture",
    cost: { ...available.cost, availability: "available", reason: null,
      measurement: { ...measurement, host: "other-fixture" } } };
  const mismatch = build(placed, runs, later, other);
  for (const agent of mismatch.issues[0]?.dispatches[0]?.agents ?? []) {
    assert.equal(agent.observation.cost.localCapacity.availability, "unavailable");
    assert.equal(agent.observation.cost.localCapacity.reason, "binding_invalid");
    assert.equal(agent.observation.cost.localCapacity.measurement, null);
  }
  assert.ok(readIssueAgentTreeSnapshot(mismatch).ok);
  const lyingObserver = build(placed, runs, later, { ...available, host: "other-fixture" });
  for (const agent of lyingObserver.issues[0]?.dispatches[0]?.agents ?? []) {
    assert.equal(agent.observation.cost.localCapacity.reason, "binding_invalid");
  }
  const unset = build(placed, runs, later, { host: null, cost: unavailableAgentCost("host_identity_unset").localCapacity });
  for (const agent of unset.issues[0]?.dispatches[0]?.agents ?? []) {
    assert.equal(agent.observation.cost.localCapacity.reason, "host_identity_unset");
  }
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
it("keeps a bound issue when another receipt has no native root", () => {
  const good = build();
  const stale = { ...good, complete: false, reason: "ancestry_unavailable" as const, issues: [] };
  const combined = combineIssueAgentTreeSnapshots({ observedAt: later, entries: [
    { repo: { owner: "example", name: "project" }, issueNumber: 43, snapshot: stale },
    { repo: { owner: "example", name: "project" }, issueNumber: 42, snapshot: good },
  ] });
  assert.equal(combined.complete, false);
  assert.equal(combined.reason, "ancestry_unavailable");
  assert.equal(combined.issues[0]?.issueNumber, 42);
  assert.equal(combined.issues[0]?.complete, true);
  assert.equal(combined.issues[0]?.dispatches[0]?.agents.length, 2);
  assert.deepEqual(combined.issues[1], { repo: { owner: "example", name: "project" }, issueNumber: 43,
    complete: false, reason: "ancestry_unavailable", dispatches: [] });
  assert.equal(readIssueAgentTreeSnapshot(combined).ok, true);
});
it("retains the first bound issue when aggregate issue count exceeds the contract cap", () => {
  const good = build();
  const stale = { ...good, complete: false, reason: "ancestry_unavailable" as const, issues: [] };
  const entries = [{ repo: { owner: "example", name: "project" }, issueNumber: 42, snapshot: good },
    ...Array.from({ length: 260 }, (_, i) => ({ repo: { owner: "example", name: "project" },
      issueNumber: 1000 + i, snapshot: stale }))];
  const combined = combineIssueAgentTreeSnapshots({ observedAt: later, entries });
  assert.equal(combined.complete, false);
  assert.equal(combined.reason, "scan_limit");
  assert.equal(combined.issues.length, 256);
  assert.equal(combined.issues[0]?.issueNumber, 42);
  assert.equal(combined.issues[0]?.dispatches[0]?.agents.length, 2);
  assert.equal(readIssueAgentTreeSnapshot(combined).ok, true);
});
it("retains earlier bound issues when aggregate bytes exceed the contract cap", () => {
  const good = build();
  const entries = Array.from({ length: 256 }, (_, i) => {
    const copy = structuredClone(good) as unknown as {
      issues: { issueNumber: number; dispatches: { dispatchId: string; agents: {
        dispatchId: string; observation: { agentId: string; issueNumber: number;
          assignment: { id: string }; parentAgentId: { state: string; value: string | null } };
        provider: unknown; model: unknown; location: { host: unknown; container: unknown; seat: unknown };
        history: { dispatchId: string; kind: string; at: string }[]; historyTruncated: boolean }[] }[] }[] };
    const issueNumber = 1000 + i;
    const assignment = `assignment_${(i + 1).toString(16).padStart(64, "0")}`;
    const rootId = `agent_${(i * 2 + 1).toString(16).padStart(64, "0")}`;
    const childId = `agent_${(i * 2 + 2).toString(16).padStart(64, "0")}`;
    const issue = copy.issues[0]!;
    issue.issueNumber = issueNumber;
    const dispatch = issue.dispatches[0]!;
    dispatch.dispatchId = assignment;
    for (const agent of dispatch.agents) {
      agent.dispatchId = assignment;
      agent.observation.issueNumber = issueNumber;
      agent.observation.assignment.id = assignment;
      const child = agent.observation.parentAgentId.state === "known-parent";
      agent.observation.agentId = child ? childId : rootId;
      if (child) agent.observation.parentAgentId.value = rootId;
      (agent.observation as unknown as { routeObservedReasons: unknown }).routeObservedReasons =
        Object.fromEntries(["transport", "model", "effort", "tier", "role"].map(field => [field,
          { status: "unknown", reasonCode: "observer-unavailable", reason: ORCHID_OBSERVER_REASON }]));
      for (const field of ["host", "container", "seat"] as const) agent.location[field] =
        { value: "f".repeat(128), basis: "placement", observedAt: at, reason: null };
      agent.provider = { value: "f".repeat(128), source: "native", reason: null };
      agent.model = { value: "f".repeat(128), source: "native", reason: null };
      agent.history = [{ dispatchId: assignment, kind: "dispatch-observed", at },
        ...Array.from({ length: 15 }, (_, n) => ({ dispatchId: assignment,
          kind: "run-activity-observed", at: new Date(Date.parse(at) + n + 1).toISOString() }))];
      agent.historyTruncated = true;
    }
    return { repo: { owner: "example", name: "project" }, issueNumber,
      snapshot: copy as unknown as typeof good };
  });
  const first = readIssueAgentTreeSnapshot(entries[0]!.snapshot);
  assert.equal(first.ok, true);
  const combined = combineIssueAgentTreeSnapshots({ observedAt: later, entries,
    globalReason: "source_unavailable" });
  assert.equal(combined.complete, false);
  assert.equal(combined.reason, "source_unavailable");
  assert.ok(combined.issues.length > 0 && combined.issues.length < 256,
    `issues=${combined.issues.length} bytes=${Buffer.byteLength(JSON.stringify(combined))}`);
  assert.equal(combined.issues[0]?.issueNumber, 1000);
  assert.equal(combined.issues[0]?.complete, true);
  assert.equal(readIssueAgentTreeSnapshot(combined).ok, true);
});

it("requires verified seat AND native process absence to end a stopped root", () => {
  const active = [run("PRIVATE-NATIVE-ROOT", null, "running")];
  const captured = "2026-01-01T00:00:04.000Z";
  const seatAt = "2026-01-01T00:00:02.000Z", processAt = "2026-01-01T00:00:03.000Z";
  const root = (stop: NonNullable<DispatchEvidence["stop"]>) => build({ ...dispatch, stop }, active, captured)
    .issues[0]?.dispatches[0]?.agents[0];
  const receiptOnly = root({ seatObservedAt: null, processObservedAt: null });
  assert.equal(receiptOnly?.liveness.state, "running");
  assert.equal(receiptOnly?.actionState.state, "unknown");
  assert.equal(receiptOnly?.timeline?.events.some(event => event.kind === "ended"), false);
  const seatOnly = root({ seatObservedAt: seatAt, processObservedAt: null });
  assert.equal(seatOnly?.actionState.state, "stopping");
  assert.equal(seatOnly?.liveness.state, "unknown");
  assert.equal(seatOnly?.endedBy, null);
  assert.equal(seatOnly?.terminalOutcome.value, null);
  assert.equal(seatOnly?.timeline?.events.some(event => event.kind === "ended"), false);
  assert.ok(seatOnly?.history.some(event => event.kind === "stop-seat-observed"));
  const processOnly = root({ seatObservedAt: null, processObservedAt: processAt });
  assert.equal(processOnly?.actionState.state, "unknown");
  assert.equal(processOnly?.liveness.state, "running");
  const both = root({ seatObservedAt: seatAt, processObservedAt: processAt });
  assert.equal(both?.actionState.state, "stopped");
  assert.deepEqual(both?.liveness, { state: "ended", evidence: "stop-observation", observedAt: processAt, reason: null });
  assert.equal(both?.endedBy, "stop");
  assert.deepEqual(both?.terminalOutcome, { value: "cancelled", source: "stop-observation", observedAt: processAt, reason: null });
  assert.equal(both?.endedAt, processAt);
  assert.equal(both?.timeline?.events.find(event => event.kind === "ended")?.reason, "stop");
  assert.ok(both?.history.some(event => event.kind === "stop-process-observed"));
  for (const state of [{ seatObservedAt: seatAt, processObservedAt: null },
    { seatObservedAt: seatAt, processObservedAt: processAt }]) {
    assert.ok(readIssueAgentTreeSnapshot(build({ ...dispatch, stop: state }, active, captured)).ok);
  }
});

it("masks stale running at teardown seat absence and ends only after process absence", () => {
  const active = [run("PRIVATE-NATIVE-ROOT", null, "running")];
  const captured = "2026-01-01T00:00:04.000Z";
  const seatAt = "2026-01-01T00:00:02.000Z", processAt = "2026-01-01T00:00:03.000Z";
  const root = (teardown: NonNullable<DispatchEvidence["teardown"]>) => build({ ...dispatch, teardown }, active, captured)
    .issues[0]?.dispatches[0]?.agents[0];
  const intentOnly = root({ cause: "timeout", seatObservedAt: null, processObservedAt: null });
  assert.equal(intentOnly?.liveness.state, "running");
  const seatOnly = root({ cause: "timeout", seatObservedAt: seatAt, processObservedAt: null });
  assert.equal(seatOnly?.liveness.state, "unknown");
  assert.equal(seatOnly?.observation.running.value, null);
  assert.equal(seatOnly?.endedBy, null);
  assert.equal(seatOnly?.terminalOutcome.value, null);
  assert.equal(seatOnly?.timeline?.events.some(event => event.kind === "ended"), false);
  assert.ok(seatOnly?.history.some(event => event.kind === "teardown-seat-observed"));
  const processOnly = root({ cause: "timeout", seatObservedAt: null, processObservedAt: processAt });
  assert.equal(processOnly?.liveness.state, "running");
  const both = root({ cause: "timeout", seatObservedAt: seatAt, processObservedAt: processAt });
  assert.deepEqual(both?.liveness, { state: "ended", evidence: "teardown-observation", observedAt: processAt, reason: null });
  assert.equal(both?.endedBy, "timeout");
  assert.deepEqual(both?.terminalOutcome, { value: "cancelled", source: "teardown-observation", observedAt: processAt, reason: null });
  assert.equal(both?.endedAt, processAt);
  assert.equal(both?.timeline?.events.find(event => event.kind === "ended")?.reason, "timeout");
  assert.ok(both?.history.some(event => event.kind === "teardown-process-observed"));
  assert.equal(root({ cause: "teardown", seatObservedAt: seatAt, processObservedAt: processAt })?.endedBy, "teardown");
  assert.equal(root({ cause: "teardown", seatObservedAt: seatAt, processObservedAt: processAt })
    ?.timeline?.events.find(event => event.kind === "ended")?.reason, "teardown");
  for (const state of [{ cause: "timeout", seatObservedAt: seatAt, processObservedAt: null },
    { cause: "timeout", seatObservedAt: seatAt, processObservedAt: processAt }] as const) {
    assert.ok(readIssueAgentTreeSnapshot(build({ ...dispatch, teardown: state }, active, captured)).ok);
  }
});
