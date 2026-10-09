import assert from "node:assert/strict";
import { it } from "node:test";
import { ORCHID_OBSERVER_REASON, projectRouteIdentity, readIssueAgentTreeSnapshot, unavailableAgentCost } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import { parseCodexRollout } from "./backfill/codex.js";
import { childEventKey } from "./claude-child-events.js";
import { buildIssueAgentTreeSnapshot, combineIssueAgentTreeSnapshots } from "./issue-agent-feed.js";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import type { HostCapacityReading } from "./host-capacity.js";
import type { ClaudeChildCompletion, RunRecord } from "./model.js";
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

it("serves the same public opaque identities as the Orchid final-comment marker", () => {
  const root = build({ ...dispatch, runId: "orchid-" + "d".repeat(64) }).issues[0]!.dispatches[0]!.agents[0]!;
  assert.equal(root.dispatchId, "assignment_a1f5fcca4becf7d50bd0e31ad73fa92c02529e014327dc23b0aed46f3f5ef794");
  assert.equal(root.observation.agentId, "agent_01b2bf7785f015813e783817d39ed708678d7641631859805a0d30ddea71ce86");
});

it("withholds a stale native end that precedes served assistant activity", () => {
  const activityAt = "2026-01-01T00:00:00.700Z";
  const native: RunRecord = { ...runs[0]!, terminalAt: "2026-01-01T00:00:00.500Z", activitySteps: [{
    id: "step_" + "a".repeat(64), at: activityAt, source: "codex-rollout", kind: "message",
    toolName: null, commandHead: null, filePath: null, target: null, summary: "The assigned work is complete.",
  }] };
  const rootOf = (r: RunRecord) => build(dispatch, [r]).issues[0]!.dispatches[0]!.agents[0]!;
  const stale = rootOf(native);
  assert.equal(stale.endedAt, null);
  assert.equal(stale.endedAtReason, "measurement_missing");
  assert.equal(stale.activity?.steps[0]?.at, activityAt);
  const current = rootOf({ ...native, terminalAt: "2026-01-01T00:00:00.800Z" });
  assert.equal(current.endedAt, "2026-01-01T00:00:00.800Z");
});

it("measures running for a bound native task through the full frame validity", () => {
  const capture = "2026-01-01T00:01:31.000Z";
  const active = [run("PRIVATE-NATIVE-ROOT", null, "running"),
    run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "running")];
  const snapshot = build(dispatch, active, capture);
  assert.equal(snapshot.complete, true);
  // Three watch intervals (5 s cadence, reads up to 7 s) fit inside one frame's validity.
  assert.equal(Date.parse(snapshot.validUntil) - Date.parse(snapshot.observedAt), 30_000);
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

it("shows a matched Claude child Start as running, while Stop leaves it unknown", () => {
  const rootId = "fixture-claude-root", childId = "agent-fixture-child";
  const claudeDispatch = { ...dispatch, source: "claude" as const, harness: "claude" as const, external: rootId };
  const native = [{ ...run(rootId, null), source: "claude" as const },
    { ...run(childId, rootId), source: "claude" as const, nativeDepth: 1 }];
  const capturedAt = "2026-01-01T00:00:30.000Z";
  const tree = (starts: ReadonlyMap<string, string>) => {
    const observations = buildAgentObservations({ dispatches: [claudeDispatch], runs: native,
      observedAt: capturedAt, sourceBound: true, dispatchComplete: true, nativeComplete: true,
      claudeChildStarts: starts });
    return buildIssueAgentTreeSnapshot({ observations, dispatches: [claudeDispatch], runs: native });
  };
  const first = tree(new Map([[childEventKey(rootId, childId), later]]));
  const firstChild = first.issues[0]?.dispatches[0]?.agents.find(a => a.parentAgentId !== null);
  assert.equal(firstChild?.liveness.state, "running");
  assert.equal(firstChild?.liveness.evidence, "runtime-observation");
  assert.ok(readIssueAgentTreeSnapshot(first).ok);
  const afterStop = tree(new Map());
  const stoppedChild = afterStop.issues[0]?.dispatches[0]?.agents.find(a => a.parentAgentId !== null);
  assert.equal(stoppedChild?.liveness.state, "unknown");
  assert.equal(stoppedChild?.terminalOutcome.value, null);
  assert.ok(!JSON.stringify(first).includes(rootId) && !JSON.stringify(first).includes(childId));
});

it("RUN-6: a Claude root stopped at its prompt is idle (observed not running), not unknown", () => {
  // RUN-6 (2026-09-30), synthetic ids: the root worked until 11:22:26 and then sat at its prompt, which
  // herdr reports as done. Orchid ticks every 30 s; before this, the done tick removed the working row and
  // the app went from Running to Unknown.
  const rootId = "fixture-claude-root";
  const native = [{ ...run(rootId, null), source: "claude" as const, startedAt: "2026-09-30T11:20:43.000Z", updatedAt: "2026-09-30T11:22:26.000Z" }];
  const tree = (claudeStatus: DispatchEvidence["claudeStatus"], capturedAt: string) => {
    const d = { ...dispatch, source: "claude" as const, harness: "claude" as const, external: rootId,
      ...(claudeStatus === undefined ? {} : { claudeStatus }) };
    const observations = buildAgentObservations({ dispatches: [d], runs: native, observedAt: capturedAt,
      sourceBound: true, dispatchComplete: true, nativeComplete: true });
    const snapshot = buildIssueAgentTreeSnapshot({ observations, dispatches: [d], runs: native });
    assert.ok(readIssueAgentTreeSnapshot(JSON.parse(JSON.stringify(snapshot))).ok, capturedAt);
    return { snapshot, root: snapshot.issues[0]!.dispatches[0]!.agents[0]! };
  };
  const working = tree({ state: "working", at: "2026-09-30T11:22:26.000Z" }, "2026-09-30T11:22:30.000Z").root;
  assert.equal(working.liveness.state, "running");
  // The tick after the turn ended: herdr said done, so the row is idle.
  const { snapshot, root: idle } = tree({ state: "idle", at: "2026-09-30T11:22:56.000Z" }, "2026-09-30T11:23:05.000Z");
  assert.deepEqual(idle.liveness, { state: "idle", evidence: "runtime-observation", observedAt: "2026-09-30T11:22:56.000Z", reason: null });
  assert.equal(idle.observation.running.value, false);
  assert.equal(idle.terminalOutcome.value, null); // Not ended: it can be prompted again.
  // No row (blocked, or no verified observation) and a stale idle row both stay unknown.
  assert.equal(tree(undefined, "2026-09-30T11:23:05.000Z").root.liveness.state, "unknown");
  assert.equal(tree({ state: "idle", at: "2026-09-30T11:22:56.000Z" }, "2026-09-30T11:24:00.000Z").root.liveness.state, "unknown");
  // The poke at 11:31:04 made it work again: the next working tick is running again.
  assert.equal(tree({ state: "working", at: "2026-09-30T11:31:26.000Z" }, "2026-09-30T11:31:30.000Z").root.liveness.state, "running");
  // The strict reader refuses idle liveness that disagrees with its observation, and a false bit outside idle.
  const tamper = (edit: (agent: Record<string, any>) => void) => {
    const copy = JSON.parse(JSON.stringify(snapshot));
    edit(copy.issues[0].dispatches[0].agents[0]);
    return readIssueAgentTreeSnapshot(copy).ok;
  };
  assert.equal(tamper(agent => { agent.observation.running.value = true; }), false);
  assert.equal(tamper(agent => { agent.liveness = { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" }; }), false);
  assert.ok(!JSON.stringify(snapshot).includes(rootId));
});

it("ends a verified Claude sidechain only after its own dispatch has seat and process absence", () => {
  const rootId = "fixture-claude-root", childId = "agent-fixture-child";
  const claudeDispatch = { ...dispatch, source: "claude" as const, harness: "claude" as const, external: rootId };
  const native = [{ ...run(rootId, null), source: "claude" as const },
    { ...run(childId, rootId), source: "claude" as const, nativeDepth: 1 }];
  const capturedAt = "2026-01-01T00:00:30.000Z";
  const seatAt = "2026-01-01T00:00:12.000Z", processAt = "2026-01-01T00:00:14.000Z";
  const tree = (d: DispatchEvidence, projected = native, starts = new Map<string, string>()) => {
    const observations = buildAgentObservations({ dispatches: [claudeDispatch], runs: native,
      observedAt: capturedAt, sourceBound: true, dispatchComplete: true, nativeComplete: true,
      claudeChildStarts: starts });
    return buildIssueAgentTreeSnapshot({ observations, dispatches: [d], runs: projected });
  };
  const child = (snapshot: ReturnType<typeof tree>) => snapshot.issues[0]?.dispatches[0]?.agents
    .find(agent => agent.observation.parentAgentId.state === "known-parent");
  const before = tree(claudeDispatch);
  assert.equal(child(before)?.liveness.state, "unknown"); // matched Stop, no fresh Start
  assert.equal(child(before)?.endedAt, null);
  const transcriptTurnEnd = tree(claudeDispatch, [native[0]!, { ...native[1]!, outcome: "complete" }]);
  assert.equal(child(transcriptTurnEnd)?.liveness.state, "unknown"); // no Claude session completion marker
  assert.equal(child(tree(claudeDispatch, native, new Map([[childEventKey(rootId, childId), later]])))
    ?.liveness.state, "running"); // resume after Stop is a new running observation
  const seatOnly = tree({ ...claudeDispatch, teardown: { cause: "teardown", seatObservedAt: seatAt,
    processObservedAt: null } });
  assert.equal(child(seatOnly)?.liveness.state, "unknown");
  assert.equal(child(seatOnly)?.terminalOutcome.value, null);
  const processOnly = tree({ ...claudeDispatch, teardown: { cause: "teardown", seatObservedAt: null,
    processObservedAt: processAt } });
  assert.equal(child(processOnly)?.liveness.state, "unknown");
  const teardown = { ...claudeDispatch, teardown: { cause: "teardown" as const,
    seatObservedAt: seatAt, processObservedAt: processAt } };
  const ended = tree(teardown);
  assert.equal(child(ended)?.liveness.state, "ended");
  assert.equal(child(ended)?.liveness.evidence, "teardown-observation");
  assert.equal(child(ended)?.endedAt, processAt);
  assert.equal(child(ended)?.endedBy, "teardown");
  assert.deepEqual(child(ended)?.terminalOutcome, { value: "cancelled", source: "teardown-observation",
    observedAt: processAt, reason: null });
  assert.equal(child(ended)?.timeline?.events.find(event => event.kind === "ended")?.reason, "teardown");
  assert.ok(readIssueAgentTreeSnapshot(ended).ok);
  const resumedAfterOldObservation = tree(teardown, native,
    new Map([[childEventKey(rootId, childId), "2026-01-01T00:00:20.000Z"]]));
  assert.equal(child(resumedAfterOldObservation)?.liveness.state, "running");
  const stopped = tree({ ...claudeDispatch, stop: { seatObservedAt: seatAt, processObservedAt: processAt } });
  assert.equal(child(stopped)?.endedBy, "stop");
  assert.equal(child(stopped)?.terminalOutcome.value, "cancelled");
  const stopping = tree({ ...claudeDispatch, stop: { seatObservedAt: seatAt, processObservedAt: null } });
  assert.equal(child(stopping)?.liveness.state, "unknown");
  assert.equal(child(stopping)?.terminalOutcome.value, null);
  const timedOut = tree({ ...claudeDispatch, teardown: { cause: "timeout",
    seatObservedAt: seatAt, processObservedAt: processAt } });
  assert.equal(child(timedOut)?.endedBy, "timeout");
  assert.equal(child(timedOut)?.terminalOutcome.value, "cancelled");
  const wrongRoot = tree({ ...teardown, external: "other-root" });
  assert.notEqual(child(wrongRoot)?.liveness.state, "ended");
  const wrongChild = tree(teardown, [native[0]!, { ...native[1]!, parentId: "other-root" }]);
  assert.notEqual(child(wrongChild)?.liveness.state, "ended");
  const preChildSeat = tree({ ...claudeDispatch, teardown: { cause: "teardown",
    seatObservedAt: "2025-12-31T23:59:59.000Z", processObservedAt: processAt } });
  assert.notEqual(child(preChildSeat)?.liveness.state, "ended");
});

it("ends a verified Claude child on its parent's own completion notification, fail-closed otherwise", () => {
  const rootId = "fixture-claude-root", childId = "agent-fixture-child";
  const claudeDispatch = { ...dispatch, source: "claude" as const, harness: "claude" as const, external: rootId };
  const native = [{ ...run(rootId, null), source: "claude" as const },
    { ...run(childId, rootId), source: "claude" as const, nativeDepth: 1 }];
  const capturedAt = "2026-01-01T00:00:30.000Z", doneAt = "2026-01-01T00:00:05.000Z";
  const completion = (over: Partial<ClaudeChildCompletion> = {}): ClaudeChildCompletion =>
    ({ childId, status: "completed", at: doneAt, ...over });
  const tree = (completions: readonly ClaudeChildCompletion[], d: DispatchEvidence = claudeDispatch,
    starts = new Map<string, string>(), extra: readonly RunRecord[] = []) => {
    const runs = [{ ...native[0]!, childCompletions: completions }, native[1]!, ...extra];
    const observations = buildAgentObservations({ dispatches: [claudeDispatch], runs,
      observedAt: capturedAt, sourceBound: true, dispatchComplete: true, nativeComplete: true, claudeChildStarts: starts });
    return buildIssueAgentTreeSnapshot({ observations, dispatches: [d], runs });
  };
  const child = (snapshot: ReturnType<typeof tree>) => snapshot.issues[0]?.dispatches[0]?.agents
    .find(agent => agent.observation.parentAgentId.state === "known-parent");
  const completed = tree([completion()]);
  assert.deepEqual(child(completed)?.liveness, { state: "ended", evidence: "native-outcome", observedAt: doneAt, reason: null });
  assert.deepEqual(child(completed)?.terminalOutcome, { value: "succeeded", source: "native-outcome", observedAt: doneAt, reason: null });
  assert.deepEqual([child(completed)?.endedAt, child(completed)?.endedAtReason, child(completed)?.endedBy], [doneAt, null, null]);
  assert.equal(child(completed)?.timeline?.events.find(event => event.kind === "ended")?.at, doneAt);
  assert.ok(readIssueAgentTreeSnapshot(completed).ok);
  assert.equal(child(tree([completion({ status: "failed" })]))?.terminalOutcome.value, "failed");
  // Fail-closed: every doubt leaves the child unknown rather than ended.
  for (const doubt of [
    tree([completion({ status: "other" })]),                                   // unmapped status
    tree([completion({ childId: "agent-other-child" })]),                      // another child's notification
    tree([completion({ at: "2026-01-01T00:00:00.500Z" })]),                    // before the child's last record
    tree([completion({ at: "2025-12-31T23:59:59.000Z" })]),                    // before the child started
    tree([], claudeDispatch, new Map(), [{ ...run("fixture-other-session", null), source: "claude" as const,
      childCompletions: [completion()] }]),                                     // another session's notification
  ]) assert.deepEqual([child(doubt)?.liveness.state, child(doubt)?.terminalOutcome.value], ["unknown", null]);
  // A later matched Start is a resume: running again, not ended.
  assert.equal(child(tree([completion()], claudeDispatch,
    new Map([[childEventKey(rootId, childId), "2026-01-01T00:00:20.000Z"]])))?.liveness.state, "running");
  // The child's own completion stays the truthful end when its root is torn down later.
  const tornDown = tree([completion()], { ...claudeDispatch, teardown: { cause: "teardown",
    seatObservedAt: "2026-01-01T00:00:12.000Z", processObservedAt: "2026-01-01T00:00:14.000Z" } });
  assert.deepEqual([child(tornDown)?.liveness.evidence, child(tornDown)?.terminalOutcome.value, child(tornDown)?.endedAt],
    ["native-outcome", "succeeded", doneAt]);
  assert.ok(readIssueAgentTreeSnapshot(tornDown).ok);
});

it("expires running before frame validity can outlive the native activity window", () => {
  const active = [run("PRIVATE-NATIVE-ROOT", null, "running"),
    run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "running")];
  const edge = build(dispatch, active, "2026-01-01T00:01:31.000Z"); // event age 90 seconds
  assert.equal(edge.issues[0]?.dispatches[0]?.agents.every(agent => agent.liveness.state === "running"), true);
  const expired = build(dispatch, active, "2026-01-01T00:01:31.001Z");
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
  assert.equal(root.parentAgentId, null);
  assert.equal(child.parentAgentId, root.observation.agentId);
  assert.deepEqual(root.effort, { value: "high", source: "dispatch", reason: null });
  assert.deepEqual(child.effort, { value: null, source: "unavailable", reason: "source_not_bound" });
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
it("ends a Codex child that finished natively at its exact terminal record time, never at its last activity (RUN-453)", () => {
  const ended = "2026-01-01T00:00:00.500Z";
  const child = (extra: Partial<RunRecord>) => ({ ...run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "complete"), nativeDepth: 1, ...extra });
  const childOf = (native: RunRecord[]) => {
    const snapshot = build(dispatch, native);
    assert.ok(readIssueAgentTreeSnapshot(snapshot).ok);
    return (snapshot.issues[0]?.dispatches[0]?.agents ?? []).find(a => a.observation.parentAgentId.state === "known-parent");
  };
  const measured = childOf([runs[0]!, child({ terminalAt: ended })]);
  assert.equal(measured?.liveness.state, "ended");
  assert.equal(measured?.endedAt, ended);
  assert.equal(measured?.endedAtReason, null);
  assert.deepEqual(measured?.timeline?.events.filter(e => e.kind === "ended").map(e => e.at), [ended]);
  // No exact terminal time, or one before the start: still unknown, as before.
  for (const extra of [{}, { terminalAt: "2025-12-31T23:59:59.000Z" }]) {
    const unmeasured = childOf([runs[0]!, child(extra)]);
    assert.equal(unmeasured?.liveness.state, "ended");
    assert.equal(unmeasured?.endedAt, null);
    assert.equal(unmeasured?.endedAtReason, "measurement_missing");
  }
});
it("projects bound root-dispatch revisions on root and child, and marks an old writer unavailable", () => {
  const pinned: DispatchEvidence = { ...dispatch,
    profileRevision: { value: "c".repeat(40), scope: "root-dispatch", source: "dispatch", reason: null },
    matrixRevision: { value: "d".repeat(40), scope: "root-dispatch", source: "dispatch", reason: null } };
  const agents = build(pinned).issues[0]?.dispatches[0]?.agents ?? [];
  assert.equal(agents.length, 2);
  assert.deepEqual(agents.map(agent => agent.profileRevision), [pinned.profileRevision, pinned.profileRevision]);
  assert.deepEqual(agents.map(agent => agent.matrixRevision), [pinned.matrixRevision, pinned.matrixRevision]);
  assert.ok(readIssueAgentTreeSnapshot(build(pinned)).ok);
  const old = build().issues[0]?.dispatches[0]?.agents ?? [];
  for (const agent of old) {
    assert.deepEqual(agent.profileRevision, { value: null, scope: "root-dispatch", source: "unavailable", reason: "source_not_bound" });
    assert.deepEqual(agent.matrixRevision, { value: null, scope: "root-dispatch", source: "unavailable", reason: "source_not_bound" });
  }
});
it("counts Claude cache reads and writes as used tokens, as Codex already does for cached input", () => {
  // Claude's input_tokens excludes both cache kinds; Codex's includes cached input, so a Codex run keeps
  // input + output (the next test's root, with a cache read, still reads 11) and a Claude run adds both back.
  const claude: DispatchEvidence = { ...dispatch, source: "claude", harness: "claude" };
  const rootRun = { ...run("PRIVATE-NATIVE-ROOT", null, "running"), source: "claude",
    usage: { inputTokens: 8, outputTokens: 3, cacheReadTokens: 5 },
    tokenSamples: { points: [{ at: later, usedTokens: 16 }], truncated: false, invalid: false } } as RunRecord;
  const childRun = { ...run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "running"), source: "claude", nativeDepth: 1,
    usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 900, cacheWriteTokens: 7 },
    tokenSamples: { points: [{ at: later, usedTokens: 921 }], truncated: false, invalid: false } } as RunRecord;
  const agents = build(claude, [rootRun, childRun]).issues[0]!.dispatches[0]!.agents;
  assert.equal(agents.length, 2);
  const root = agents.find(agent => agent.observation.parentAgentId.state === "confirmed-root")!;
  const child = agents.find(agent => agent.observation.parentAgentId.state !== "confirmed-root")!;
  assert.deepEqual([root.tokenUsage?.usedTokens, root.tokenUsage?.source], [16, "claude-usage"]);
  assert.deepEqual([child.tokenUsage?.usedTokens, child.tokenUsage?.source], [921, "claude-usage"]);
  assert.deepEqual(child.resourceHistory?.tokens.points, [{ at: later, usedTokens: 921 }]);
  // Each kind stays its own true row on the run's cost.
  assert.deepEqual(child.observation.cost.runTokens.measurement,
    { inputTokens: 10, outputTokens: 4, cacheReadTokens: 900, cacheWriteTokens: 7 });
  // A malformed part never hides inside a plausible sum: 10 + (-5) + 4 would read as 9.
  const malformed = { ...childRun, usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: -5 } } as RunRecord;
  const bad = build(claude, [rootRun, malformed]).issues[0]!.dispatches[0]!.agents
    .find(agent => agent.observation.parentAgentId.state !== "confirmed-root")!;
  assert.deepEqual([bad.tokenUsage?.usedTokens, bad.tokenUsage?.reason], [null, "measurement_missing"]);
});
it("binds measured activity, token numerator, child spawn, and immutable action to the exact agent", () => {
  const rootRun = { ...run("PRIVATE-NATIVE-ROOT", null, "running"), usage: { inputTokens: 8, outputTokens: 3,
    reasoningTokens: 2, cacheReadTokens: 5 }, tokenSamples: { points: [
      { at, usedTokens: 5 }, { at: later, usedTokens: 11 }], truncated: false, invalid: false },
    activitySteps: [{ id: "step_" + "a".repeat(64), at,
      kind: "command", toolName: "exec_command", commandHead: "git status", filePath: null,
      summary: "Ran git status", source: "codex-rollout" }] } as RunRecord;
  const childRun = { ...run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT", "running"), nativeDepth: 1,
    usage: { inputTokens: 2, outputTokens: 1 }, tokenSamples: { points: [{ at: later, usedTokens: 3 }],
      truncated: false, invalid: false } } as RunRecord;
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
  assert.deepEqual(root.resourceHistory?.tokens, { points: [
    { at, usedTokens: 5 }, { at: later, usedTokens: 11 }], truncated: false,
    source: "codex-token-count", reason: null });
  assert.deepEqual(root.resourceHistory?.budgets, { points: [
    { at, tokenLimit: 1_000, source: "issue-override" }], truncated: false, reason: null });
  assert.deepEqual(child.resourceHistory?.budgets, { points: [], truncated: false, reason: "source_not_bound" });
  assert.equal(child.resourceHistory?.tokens.points.at(-1)?.usedTokens, 3);
  const raised: PublicActionReceipt = { ...accepted, action: "raise_budget", reason: "goal_budget_updated", tokenBudget: 1_500 };
  const projectRaised = (row: PublicActionReceipt, actionsComplete = true) => buildIssueAgentTreeSnapshot({
    observations, dispatches: [dispatch], runs: [rootRun, childRun], actions: [row], actionsComplete });
  const raisedSnapshot = projectRaised(raised);
  const raisedRoot = raisedSnapshot.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId);
  const raisedChild = raisedSnapshot.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId !== rootId);
  assert.deepEqual(raisedRoot?.budget, { tokenLimit: 1_500, source: "action-receipt", reason: null });
  assert.equal(raisedRoot?.tokenUsage?.budgetTokens, 1_500);
  assert.equal(raisedChild?.budget.tokenLimit, null);
  assert.deepEqual(raisedRoot?.resourceHistory?.budgets, { points: [
    { at, tokenLimit: 1_000, source: "issue-override" },
    { at: later, tokenLimit: 1_500, source: "action-receipt" }], truncated: false, reason: null });
  assert.equal(raisedChild?.resourceHistory?.budgets.reason, "source_not_bound");
  assert.equal(readIssueAgentTreeSnapshot(raisedSnapshot).ok, true);
  for (const unsafe of [
    { ...raised, agentId: `agent_${"e".repeat(64)}` },
    { ...raised, dispatchId: `assignment_${"f".repeat(64)}` },
    { ...raised, outcome: "rejected" as const, reason: "budget_ceiling_exceeded" },
    { ...raised, tokenBudget: null },
    { ...raised, tokenBudget: 1_000 },
  ]) {
    const unraised = projectRaised(unsafe);
    const unraisedRoot = unraised.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId);
    assert.equal(unraisedRoot?.budget.tokenLimit, 1_000);
    assert.equal(unraisedRoot?.resourceHistory?.budgets.points.length, 1);
  }
  assert.equal(projectRaised(raised, false).issues[0]?.dispatches[0]?.agents
    .find(agent => agent.observation.agentId === rootId)?.budget.tokenLimit, 1_000);
  assert.equal(projectRaised(raised, false).issues[0]?.dispatches[0]?.agents
    .find(agent => agent.observation.agentId === rootId)?.resourceHistory?.budgets.reason, "source_incomplete");
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
  for (const [action, reason] of [["raise_budget", "goal_budget_updated"], ["retry", "retry_dispatched"]] as const) {
    const projected = buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs: [rootRun, childRun],
      actions: [{ ...accepted, action, reason }], actionsComplete: true });
    const row = projected.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId);
    assert.equal(row?.timeline?.events.find(event => event.kind === "action-accepted")?.reason, reason);
    assert.equal(readIssueAgentTreeSnapshot(projected).ok, true);
  }
  const malformed = buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs: [rootRun, childRun],
    actions: [{ ...accepted, reason: "PRIVATE-RAW-REASON" }], actionsComplete: true });
  const protectedTimeline = malformed.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.agentId === rootId)?.timeline;
  assert.equal(protectedTimeline?.events.some(event => event.kind === "action-accepted"), false);
  assert.equal(protectedTimeline?.truncated, true);
  assert.ok(!JSON.stringify(malformed).includes("PRIVATE-RAW-REASON"));
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
});
it("canonicalizes a nanosecond action receipt time without admitting malformed or future receipts", () => {
  const active = [run("PRIVATE-NATIVE-ROOT", null, "running")];
  const observations = buildAgentObservations({ dispatches: [dispatch], runs: active, observedAt: later,
    sourceBound: true, dispatchComplete: true, nativeComplete: true });
  const rootId = observations.agents[0]!.agentId;
  const receipt: PublicActionReceipt = { schemaVersion: 1, operationId: "00000000-0000-4000-8000-000000000001",
    requestDigest: "a".repeat(64), repository: "example/project", issueNumber: 42, action: "steer",
    agentId: rootId, dispatchId: observations.agents[0]!.assignment.id, outcome: "accepted",
    reason: "prompt_delivered", observedAt: "2026-01-01T00:00:01.000000123Z", replacementAgentId: null, messageId: null };
  const project = (observedAt: string) => buildIssueAgentTreeSnapshot({ observations, dispatches: [dispatch], runs: active,
    actions: [{ ...receipt, observedAt }], actionsComplete: true });
  const good = project(receipt.observedAt!);
  const events = good.issues[0]?.dispatches[0]?.agents[0]?.timeline?.events ?? [];
  assert.equal(events.find(event => event.kind === "action-accepted")?.at, later);
  assert.equal(events.find(event => event.kind === "action-accepted")?.reason, "prompt_delivered");
  assert.equal(readIssueAgentTreeSnapshot(good).ok, true);
  for (const invalid of ["2026-01-01T00:00:01.0000001234Z", "2025-02-30T00:00:01.000000123Z",
    "2026-01-01T00:00:02.000000123Z"]) {
    assert.equal(project(invalid).issues[0]?.dispatches[0]?.agents[0]?.timeline?.events
      .some(event => event.kind === "action-accepted"), false);
  }
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
    validUntil: "2026-01-01T00:00:31.000Z", revision: "c".repeat(64),
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
        parentAgentId: string | null;
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
      agent.parentAgentId = child ? rootId : null;
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
      snapshot: copy as unknown as typeof good, launchBlock: {
        state: "blocked", reason: "goal-prompt-unconfirmed", at, dispatchId: assignment, source: "orchid" } as const };
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
  assert.ok(combined.issues.every(issue => issue.launchBlock?.reason === "goal-prompt-unconfirmed"));
  assert.ok(combined.issues.some(issue => !issue.complete && issue.reason === "scan_limit"));
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

it("#516: a Claude root that finished its turn before an operator-timeout teardown ends succeeded, not cancelled", () => {
  // #516 (2026-09-30), synthetic ids: the root's last turn ended at 11:31:12.824 and it sat at its
  // prompt; divybot's 15-minute timeout tore it down at 11:36:06. It read Failed/Timed out.
  const rootId = "fixture-claude-root";
  const claudeDispatch = { ...dispatch, source: "claude" as const, harness: "claude" as const, external: rootId,
    teardown: { cause: "timeout" as const, seatObservedAt: "2026-09-30T11:36:06.000Z", processObservedAt: "2026-09-30T11:36:06.500Z" } };
  const captured = "2026-09-30T11:36:10.000Z";
  const tree = (turnEndedAt: string | undefined, d: DispatchEvidence = claudeDispatch) => {
    const native = [{ ...run(rootId, null), source: "claude" as const, startedAt: "2026-09-30T11:20:43.000Z",
      updatedAt: "2026-09-30T11:31:12.824Z", ...(turnEndedAt === undefined ? {} : { turnEndedAt }) }];
    const observations = buildAgentObservations({ dispatches: [d], runs: native, observedAt: captured,
      sourceBound: true, dispatchComplete: true, nativeComplete: true });
    const snapshot = buildIssueAgentTreeSnapshot({ observations, dispatches: [d], runs: native });
    assert.ok(readIssueAgentTreeSnapshot(JSON.parse(JSON.stringify(snapshot))).ok);
    return { snapshot, root: snapshot.issues[0]!.dispatches[0]!.agents[0]! };
  };
  const { snapshot, root: done } = tree("2026-09-30T11:31:12.824Z");
  assert.deepEqual(done.liveness, { state: "ended", evidence: "teardown-observation", observedAt: "2026-09-30T11:36:06.500Z", reason: null });
  assert.equal(done.endedBy, "timeout"); // The teardown is recorded, as the way it ended...
  assert.equal(done.endedAt, "2026-09-30T11:36:06.500Z");
  assert.deepEqual(done.terminalOutcome, { value: "succeeded", source: "native-outcome", observedAt: "2026-09-30T11:31:12.824Z", reason: null });
  const ended = done.timeline?.events.find(event => event.kind === "ended");
  assert.deepEqual([ended?.outcome, ended?.reason], ["succeeded", "timeout"]); // ...not as the outcome.
  // Mid-turn at the teardown (no completed turn), or a turn that "ended" after it: cancelled, as before.
  for (const turnEndedAt of [undefined, "2026-09-30T11:36:07.000Z"]) {
    assert.deepEqual(tree(turnEndedAt).root.terminalOutcome,
      { value: "cancelled", source: "teardown-observation", observedAt: "2026-09-30T11:36:06.500Z", reason: null });
  }
  // Any teardown of a finished root is done, not only a timeout.
  assert.equal(tree("2026-09-30T11:31:12.824Z", { ...claudeDispatch, teardown: { ...claudeDispatch.teardown, cause: "teardown" } })
    .root.terminalOutcome.value, "succeeded");
  // The strict reader refuses a success dated after the teardown, and a success sourced from the teardown.
  const tamper = (edit: (agent: Record<string, any>) => void) => {
    const copy = JSON.parse(JSON.stringify(snapshot));
    edit(copy.issues[0].dispatches[0].agents[0]);
    return readIssueAgentTreeSnapshot(copy).ok;
  };
  assert.equal(tamper(agent => { agent.terminalOutcome.observedAt = "2026-09-30T11:36:07.000Z"; }), false);
  assert.equal(tamper(agent => { agent.terminalOutcome.source = "teardown-observation"; }), false);
  assert.ok(!JSON.stringify(snapshot).includes(rootId));
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

it("retains launch blocks independently of every native coverage failure", () => {
  const good = build();
  const block = { state: "blocked", reason: "goal-prompt-unconfirmed", at,
    dispatchId: good.issues[0]!.dispatches[0]!.dispatchId, source: "orchid" } as const;
  const combine = (snapshot: typeof good) => combineIssueAgentTreeSnapshots({ observedAt: later,
    entries: [{ repo: { owner: "example", name: "project" }, issueNumber: 42, snapshot, launchBlock: block }] });
  const full = combine(good);
  assert.equal(full.complete, true);
  assert.deepEqual(full.issues[0]?.launchBlock, block);
  assert.equal(full.issues[0]?.dispatches[0]?.agents.length, 2);
  for (const reason of ["binding_unavailable", "ancestry_unavailable", "source_unavailable", "scan_limit"] as const) {
    const combined = combine({ ...good, complete: false, reason, issues: [] });
    assert.equal(combined.complete, false);
    assert.deepEqual(combined.issues[0], { repo: { owner: "example", name: "project" }, issueNumber: 42,
      complete: false, reason, dispatches: [], launchBlock: block });
    assert.equal(readIssueAgentTreeSnapshot(combined).ok, true);
  }
  const corrupt = combine({ ...good, unexpected: "PRIVATE-PROMPT-CANARY" } as typeof good);
  assert.deepEqual(corrupt.issues[0]?.launchBlock, block);
  assert.equal(corrupt.issues[0]?.reason, "binding_unavailable");
  assert.ok(!JSON.stringify(corrupt).includes("PRIVATE-"));
});


it("projects code-mode wrapper commands and patch files through the real rollout reader and strict issue decoder", () => {
  const wrapper = { timestamp: later, type: "response_item", payload: { type: "custom_tool_call", name: "exec", input:
    'await tools.exec_command({cmd:"git status --short PRIVATE-ARG-CANARY"}); await tools.apply_patch("*** Begin Patch\\n*** Update File: src/main.ts\\n@@\\n+PRIVATE-PATCH-CANARY\\n*** End Patch");' } };
  const parsed = parseCodexRollout([JSON.stringify({ timestamp: at, type: "session_meta",
    payload: { session_id: "PRIVATE-NATIVE-ROOT", timestamp: at, cwd: "/PRIVATE-PATH-CANARY" } }),
    JSON.stringify(wrapper)].join("\n"), "PRIVATE-ORIGIN-CANARY");
  assert.ok(parsed.run);
  const snapshot = build(dispatch, [parsed.run]);
  assert.equal(snapshot.complete, true);
  assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
  const steps = snapshot.issues[0]?.dispatches[0]?.agents[0]?.activity?.steps ?? [];
  assert.equal(steps.length, 2);
  assert.equal(steps.find(step => step.toolName === "exec_command")?.commandHead, "git status");
  assert.equal(steps.find(step => step.toolName === "apply_patch")?.filePath, "src/main.ts");
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
});
