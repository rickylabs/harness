import assert from "node:assert/strict";
import { it } from "node:test";
import { ORCHID_OBSERVER_REASON, projectRouteIdentity, readIssueAgentTreeSnapshot, unavailableAgentCost } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import { parseCodexRollout } from "./backfill/codex.js";
import { buildIssueAgentTreeSnapshot, combineIssueAgentTreeSnapshots } from "./issue-agent-feed.js";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import type { HostCapacityReading } from "./host-capacity.js";
import type { RunRecord } from "./model.js";
import type { PublicActionReceipt } from "./action-receipt-cli.js";
import { at, later, dispatch, run, runs, build } from "./fixtures/issue-agent-feed.js";

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
