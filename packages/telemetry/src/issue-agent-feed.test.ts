import assert from "node:assert/strict";
import { it } from "node:test";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import { childEventKey } from "./claude-child-events.js";
import { ISSUE_TOKEN_SOURCES, buildIssueAgentTreeSnapshot } from "./issue-agent-feed.js";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import type { ClaudeChildCompletion, RunRecord } from "./model.js";
import type { PublicActionReceipt } from "./action-receipt-cli.js";
import { at, later, dispatch, run, runs, build } from "./fixtures/issue-agent-feed.js";

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
it("labels used tokens per vendor: OpenCode reads opencode-usage, AGY stays unavailable, never claude-usage", () => {
  assert.deepEqual({ ...ISSUE_TOKEN_SOURCES }, { codex: "codex-token-count", claude: "claude-usage", opencode: "opencode-usage" });
  assert.ok(Object.isFrozen(ISSUE_TOKEN_SOURCES));
  // OpenCode's input excludes both cache kinds and its output excludes reasoning, so all five are added.
  const usage = { inputTokens: 100, outputTokens: 20, reasoningTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 5 };
  const rootFor = (source: RunRecord["source"], u: RunRecord["usage"]) =>
    [{ ...run("PRIVATE-NATIVE-ROOT", null, "running"), source, usage: u } as RunRecord];
  const agentFor = (source: RunRecord["source"], u: RunRecord["usage"]) => {
    const snapshot = build({ ...dispatch, source, harness: source }, rootFor(source, u));
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true, source);
    return snapshot.issues[0]!.dispatches[0]!.agents[0]!;
  };
  const opencode = agentFor("opencode", usage);
  assert.deepEqual(opencode.tokenUsage, { usedTokens: 555, budgetTokens: 1000, observedAt: later, source: "opencode-usage", reason: null });
  assert.deepEqual(opencode.resourceHistory?.tokens, { points: [], truncated: false, source: "unavailable", reason: "measurement_missing" });
  for (const [source, u] of [["opencode", {}], ["opencode", { ...usage, reasoningTokens: -1 }],
    ["agy", usage], ["agy", {}]] as const) {
    const a = agentFor(source, u);
    assert.deepEqual(a.tokenUsage, { usedTokens: null, budgetTokens: 1000, observedAt: null, source: "unavailable",
      reason: "measurement_missing" }, source + " " + JSON.stringify(u));
  }
  // The same numbers on a Claude run keep Claude's own counting: reasoning is inside its output.
  assert.deepEqual([agentFor("claude", usage).tokenUsage?.usedTokens, agentFor("claude", usage).tokenUsage?.source], [525, "claude-usage"]);
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
