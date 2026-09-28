/** Pure per-issue projection of the existing dispatcher/native ancestry join. */
import { createHash } from "node:crypto";
import { readAgentObservations, readIssueAgentTreeSnapshot, AGENT_ACTION_REJECTED_REASONS, MAX_AGENT_HISTORY, MAX_AGENT_OBSERVATIONS,
  MAX_ISSUE_AGENT_TREE_BYTES, ISSUE_AGENT_TREE_FRESH_MS, AGENT_EFFORTS, unavailableAgentCost,
  projectRouteIdentity,
  type AgentHistoryEvent, type AgentObservation, type AgentObservations, type AgentTreeValue, type AgentRoutePolicy,
  type AgentTimelineEvent, type AgentTimelineReason, type IssueAgentTree, type IssueAgentTreeAgent, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { resolveOrchidNativeRoot } from "./orchid-native-binding.js";
import type { HostCapacityReading } from "./host-capacity.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { RunRecord } from "./model.js";
import type { PublicActionReceipt } from "./action-receipt-cli.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (kind: "agent" | "assignment", value: string) => `${kind}_${digest(kind + "\0" + value)}`;
const unavailable: AgentTreeValue = { value: null, source: "unavailable", reason: "source_not_bound" };
const unavailablePolicy: AgentRoutePolicy = { value: null, digest: null, source: "unavailable", reason: "source_not_bound" };
const publicLabel = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");
const safe = (value: string | null | undefined, source: "dispatch" | "native"): AgentTreeValue =>
  publicLabel(value)
    ? { value, source, reason: null } : unavailable;
function publicObservation(observation: AgentObservation): AgentObservation {
  const clean = (leaf: { readonly value: string | null; readonly source: string }) =>
    ({ ...leaf, value: publicLabel(leaf.value) ? leaf.value : null });
  const side = (name: "requested" | "observed") => ({
    provider: clean(observation.route[name].provider), model: clean(observation.route[name].model),
    effort: clean(observation.route[name].effort), cwd: clean(observation.route[name].cwd),
  });
  const route = projectRouteIdentity({ requested: side("requested"), observed: side("observed") });
  return { ...observation, route, revision: digest(JSON.stringify({ prior: observation.revision, route })) };
}
const time = (value: string | undefined, latest: string): string | null =>
  value && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && value <= latest ? value : null;
/** Orchid receipts may have nanoseconds; the public timeline wire time has milliseconds. */
const receiptTime = (value: string | undefined, latest: string): string | null => {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  const at = new Date(millis).toISOString();
  return at.slice(0, 19) === value.slice(0, 19) && at <= latest ? at : null;
};
const event = (agentId: string, kind: AgentTimelineEvent["kind"], at: string,
  source: AgentTimelineEvent["source"], relatedAgentId: string | null = null,
  outcome: AgentTimelineEvent["outcome"] = null, reason: AgentTimelineReason | null = null): AgentTimelineEvent => ({
    id: `event_${digest([agentId, kind, at, relatedAgentId ?? "", outcome ?? ""].join("\0"))}`,
    at, kind, action: null, relatedAgentId, source, outcome, reason });
const orderedEvents = (events: readonly AgentTimelineEvent[]) => [...events]
  .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

function history(observation: AgentObservation, dispatch: DispatchEvidence, run: RunRecord | undefined, now: string,
  root: boolean): readonly AgentHistoryEvent[] {
  const rows: AgentHistoryEvent[] = [];
  const dispatchId = observation.assignment.id;
  if (observation.parentAgentId.state !== "known-parent" && time(dispatch.observedAt, now) !== null) {
    rows.push({ dispatchId, kind: "dispatch-observed", at: dispatch.observedAt! });
  }
  const started = time(run?.startedAt, now);
  const activity = time(run?.updatedAt, now);
  if (started !== null) rows.push({ dispatchId, kind: "run-started-observed", at: started });
  if (activity !== null && (started === null || activity > started)) rows.push({ dispatchId, kind: "run-activity-observed", at: activity });
  if (root) {
    const seat = time(dispatch.stop?.seatObservedAt ?? undefined, now);
    const process = time(dispatch.stop?.processObservedAt ?? undefined, now);
    if (seat !== null) rows.push({ dispatchId, kind: "stop-seat-observed", at: seat });
    if (process !== null) rows.push({ dispatchId, kind: "stop-process-observed", at: process });
    const teardownSeat = time(dispatch.teardown?.seatObservedAt ?? undefined, now);
    const teardownProcess = time(dispatch.teardown?.processObservedAt ?? undefined, now);
    if (teardownSeat !== null) rows.push({ dispatchId, kind: "teardown-seat-observed", at: teardownSeat });
    if (teardownProcess !== null) rows.push({ dispatchId, kind: "teardown-process-observed", at: teardownProcess });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind)).slice(0, MAX_AGENT_HISTORY);
}

function node(observation: AgentObservation, dispatch: DispatchEvidence, run: RunRecord | undefined, now: string,
  localCapacity: HostCapacityReading | undefined, actions: readonly PublicActionReceipt[], actionsComplete: boolean): IssueAgentTreeAgent {
  const root = observation.parentAgentId.state !== "known-parent";
  const provenAncestry = observation.parentAgentId.state === "confirmed-root" || observation.parentAgentId.state === "known-parent";
  const harness = root ? safe(dispatch.harness ?? dispatch.source, "dispatch") : safe(run?.source, "native");
  const provider = root ? safe(observation.route.requested.provider.value, "dispatch") : safe(run?.identity.provider, "native");
  const model = root ? safe(observation.route.requested.model.value, "dispatch") : safe(run?.identity.model, "native");
  const requestedEffort = observation.parentAgentId.state === "confirmed-root"
    ? observation.route.requested.effort.value : null;
  const effort: AgentTreeValue = typeof requestedEffort === "string" &&
    AGENT_EFFORTS.includes(requestedEffort as typeof AGENT_EFFORTS[number])
    ? { value: requestedEffort, source: "dispatch", reason: null }
    : requestedEffort !== null ? { value: null, source: "unavailable", reason: "binding_invalid" } : unavailable;
  const parentAgentId = observation.parentAgentId.state === "known-parent" ? observation.parentAgentId.value : null;
  const router = provenAncestry && dispatch.router?.value === "direct" && dispatch.router.source === "dispatch" &&
    (dispatch.source === "codex" || dispatch.source === "claude") ? dispatch.router : unavailable;
  const start = time(run?.startedAt, now);
  const outcomeAt = time(run?.updatedAt, now);
  const seatAt = root ? time(dispatch.stop?.seatObservedAt ?? undefined, now) : null;
  const processAt = root ? time(dispatch.stop?.processObservedAt ?? undefined, now) : null;
  const stopAt = seatAt !== null && processAt !== null ? (seatAt > processAt ? seatAt : processAt) : null;
  const teardownSeatAt = root ? time(dispatch.teardown?.seatObservedAt ?? undefined, now) : null;
  const teardownProcessAt = root ? time(dispatch.teardown?.processObservedAt ?? undefined, now) : null;
  const teardownAt = teardownSeatAt !== null && teardownProcessAt !== null
    ? (teardownSeatAt > teardownProcessAt ? teardownSeatAt : teardownProcessAt) : null;
  const actionState: IssueAgentTreeAgent["actionState"] = stopAt !== null
    ? { state: "stopped", observedAt: stopAt, reason: null }
    : seatAt !== null ? { state: "stopping", observedAt: seatAt, reason: null }
      : { state: "unknown", observedAt: null, reason: "source_not_bound" };
  const liveness: IssueAgentTreeAgent["liveness"] = (run?.outcome === "complete" || run?.outcome === "failed") && outcomeAt !== null
    ? { state: "ended", evidence: "native-outcome", observedAt: now, reason: null }
    : stopAt !== null ? { state: "ended", evidence: "stop-observation", observedAt: stopAt, reason: null }
    : teardownAt !== null ? { state: "ended", evidence: "teardown-observation", observedAt: teardownAt, reason: null }
    : seatAt !== null ? { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" }
    : teardownSeatAt !== null ? { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" }
    : observation.running.value === true && observation.running.observedAt !== null
      ? { state: "running", evidence: "runtime-observation", observedAt: observation.running.observedAt, reason: null }
      : { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" };
  const endedBy: IssueAgentTreeAgent["endedBy"] = liveness.state === "ended" && liveness.evidence === "stop-observation" ? "stop"
    : liveness.state === "ended" && liveness.evidence === "teardown-observation" ? dispatch.teardown!.cause : null;
  const terminalOutcome: IssueAgentTreeAgent["terminalOutcome"] = liveness.state === "ended"
    ? liveness.evidence === "stop-observation"
      ? { value: "cancelled", source: "stop-observation", observedAt: stopAt!, reason: null }
    : liveness.evidence === "teardown-observation"
      ? { value: "cancelled", source: "teardown-observation", observedAt: teardownAt!, reason: null }
    : run!.outcome === "complete"
      ? { value: "succeeded", source: "native-outcome", observedAt: now, reason: null }
      : run!.terminalCause === "error" || run!.terminalCause === "cancelled"
        ? { value: run!.terminalCause === "error" ? "failed" : "cancelled", source: "native-outcome", observedAt: now, reason: null }
        : { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" }
    : { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" };
  const unplaced = { value: null, basis: "unavailable", observedAt: null, reason: "source_not_bound" } as const;
  const host = provenAncestry && dispatch.host && /^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(dispatch.host) &&
    time(dispatch.observedAt, now) !== null
    ? { value: dispatch.host, basis: "placement", observedAt: dispatch.observedAt!, reason: null } as const : unplaced;
  const missingCapacity = (reason: "source_not_bound" | "observer-unavailable" | "binding_invalid" | "source_stale") =>
    unavailableAgentCost(reason).localCapacity;
  const capacity = host.value === null ? missingCapacity("source_not_bound")
    : localCapacity === undefined ? missingCapacity("observer-unavailable")
    : localCapacity.host === null && localCapacity.cost.reason === "host_identity_unset" ? localCapacity.cost
    : localCapacity.host !== host.value ? missingCapacity("binding_invalid")
    : localCapacity.cost.availability === "available" &&
      (localCapacity.cost.measurement.host !== host.value || localCapacity.cost.observedAt! > now)
      ? missingCapacity("binding_invalid")
    : localCapacity.cost.availability === "available" &&
      (localCapacity.cost.validUntil === null || Date.parse(localCapacity.cost.validUntil) < Date.parse(now) + ISSUE_AGENT_TREE_FRESH_MS)
      ? missingCapacity("source_stale")
    : localCapacity.cost;
  // A verified seat absence supersedes a still-fresh native activity claim.
  // Clear the observation itself so the strict decoder and action consumers
  // cannot retain a contradictory running bit beside unknown/ended liveness.
  const running = liveness.state !== "running" && observation.running.value === true
    ? { value: null, reason: "measurement_missing", observedAt: null, validUntil: null, revision: null } as const
    : observation.running;
  const placedObservation = { ...observation, running, cost: { ...observation.cost, localCapacity: capacity },
    revision: digest(JSON.stringify({ prior: observation.revision, running, host: host.value, capacity })) };
  const seam = run?.source ?? dispatch.source;
  const nativeDepth: IssueAgentTreeAgent["nativeDepth"] = !root && run?.source === "codex" &&
    run.parentId !== null && typeof run.nativeDepth === "number" &&
    Number.isSafeInteger(run.nativeDepth) && run.nativeDepth >= 1
    ? { value: run.nativeDepth, source: "native", reason: null }
    : { value: null, source: "unavailable", reason: !root && run !== undefined ? "measurement_missing" : "source_not_bound" };
  const budget = root ? dispatch.budget ?? { tokenLimit: null, source: "unavailable", reason: "source_not_bound" } as const
    : { tokenLimit: null, source: "unavailable", reason: "source_not_bound" } as const;
  const steps = (run?.activitySteps ?? []).filter(step => time(step.at, now) !== null).slice(0, 20);
  const activity: NonNullable<IssueAgentTreeAgent["activity"]> = run !== undefined && time(run.updatedAt, now) !== null
    ? { availability: "available", reason: null, observedAt: run.updatedAt, steps }
    : { availability: "unavailable", reason: "source_not_bound", observedAt: null, steps: [] };
  const input = run?.usage.inputTokens, output = run?.usage.outputTokens;
  const measured = (run?.source === "codex" || run?.source === "claude") && input !== undefined && output !== undefined && Number.isSafeInteger(input) && Number.isSafeInteger(output) &&
    input >= 0 && output >= 0 && Number.isSafeInteger(input + output) && time(run?.updatedAt, now) !== null;
  const tokenUsage: NonNullable<IssueAgentTreeAgent["tokenUsage"]> = measured
    ? { usedTokens: input! + output!, budgetTokens: budget.tokenLimit, observedAt: run!.updatedAt,
        source: run!.source === "codex" ? "codex-token-count" : "claude-usage", reason: null }
    : { usedTokens: null, budgetTokens: budget.tokenLimit, observedAt: null, source: "unavailable",
        reason: run === undefined ? "source_not_bound" : "measurement_missing" };
  const events: AgentTimelineEvent[] = [];
  if (root && time(dispatch.observedAt, now) !== null) events.push(event(observation.agentId, "dispatched", dispatch.observedAt!, "dispatch"));
  if (start !== null) events.push(event(observation.agentId, "started", start, "native"));
  if (liveness.state === "ended" && terminalOutcome.value !== null) {
    const end = liveness.evidence === "native-outcome" ? outcomeAt : liveness.observedAt;
    const endReason: AgentTimelineReason = endedBy ?? (terminalOutcome.value === "succeeded" ? "native-complete"
      : terminalOutcome.value === "failed" ? "native-error" : "native-cancelled");
    if (end !== null) events.push(event(observation.agentId, "ended", end, "terminal", null, terminalOutcome.value, endReason));
  }
  let invalidActionReason = false;
  for (const receipt of actions) {
    const at = receiptTime(receipt.observedAt ?? undefined, now);
    if (at === null || receipt.agentId !== observation.agentId || receipt.dispatchId !== observation.assignment.id ||
        receipt.repository?.toLowerCase() !== `${observation.repo.owner}/${observation.repo.name}`.toLowerCase() ||
        receipt.issueNumber !== observation.issueNumber || receipt.action === null ||
        (receipt.outcome !== "accepted" && receipt.outcome !== "rejected")) continue;
    const validReason = receipt.outcome === "accepted"
      ? receipt.reason === (receipt.action === "stop" ? "workspace_close_delivered" : "prompt_delivered")
      : AGENT_ACTION_REJECTED_REASONS.includes(receipt.reason as typeof AGENT_ACTION_REJECTED_REASONS[number]);
    if (!validReason) { invalidActionReason = true; continue; }
    events.push({ id: `event_${digest([observation.agentId, receipt.operationId, receipt.outcome].join("\0"))}`,
      at, kind: receipt.outcome === "accepted" ? "action-accepted" : "action-rejected",
      action: receipt.action, relatedAgentId: null, source: "action-receipt", outcome: null,
      reason: receipt.reason as AgentTimelineReason });
  }
  const timeline: NonNullable<IssueAgentTreeAgent["timeline"]> = {
    events: orderedEvents(events).slice(-32), truncated: !actionsComplete || invalidActionReason || events.length > 32 };
  return { dispatchId: observation.assignment.id, observation: placedObservation, harness, provider, router,
    routePolicy: observation.parentAgentId.state === "confirmed-root" ? dispatch.routePolicy ?? unavailablePolicy : unavailablePolicy, model,
    effort, parentAgentId,
    location: { host, container: unplaced, seat: unplaced }, nativeDepth,
    budget,
    quotaRegime: seam === "codex" || seam === "claude" ? { value: "subscription", reason: null }
      : { value: null, reason: "source_not_bound" },
    liveness, actionState, endedBy, terminalOutcome, startedAt: start, startedAtReason: start === null ? "run_not_found" : null,
    endedAt: endedBy === "stop" ? stopAt : endedBy === "timeout" || endedBy === "teardown" ? teardownAt : null,
    endedAtReason: endedBy === null ? "measurement_missing" : null,
    transcript: { value: null, reason: "source_not_bound" },
    history: history(observation, dispatch, run, now, root), historyTruncated: false,
    activity, tokenUsage, timeline };
}

/** Invalid or partial ancestry is never repackaged as a complete tree. */
export function buildIssueAgentTreeSnapshot(input: {
  readonly observations: AgentObservations;
  readonly dispatches: readonly DispatchEvidence[];
  readonly runs: readonly RunRecord[];
  readonly localCapacity?: HostCapacityReading;
  readonly actions?: readonly PublicActionReceipt[];
  readonly actionsComplete?: boolean;
}): IssueAgentTreeSnapshot {
  const { dispatches, runs } = input;
  const dispatchById = new Map(dispatches.map(d => [opaque("assignment", d.runId), d]));
  const observations: AgentObservations = { ...input.observations,
    agents: input.observations.agents.map(raw => {
      const publicRow = publicObservation(raw);
      const dispatch = dispatchById.get(raw.assignment.id);
      const seat = raw.parentAgentId.state === "confirmed-root"
        ? time(dispatch?.stop?.seatObservedAt ?? undefined, input.observations.observedAt) : null;
      return seat === null ? publicRow : { ...publicRow,
        running: { value: null, reason: "source_stale", observedAt: null, validUntil: null, revision: null } as const,
        revision: digest(JSON.stringify({ prior: publicRow.revision, stopSeat: seat })) };
    }),
    revision: digest(JSON.stringify({ prior: input.observations.revision, publicRoute: true })) };
  const empty = (reason: IssueAgentTreeSnapshot["reason"]): IssueAgentTreeSnapshot => ({
    schema: 1, protocol: 1, observedAt: observations.observedAt,
    validUntil: new Date(Date.parse(observations.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ reason, observation: observations.revision })), complete: false, reason, issues: [],
  });
  const checked = readAgentObservations(observations);
  if (!checked.ok && observations.agents.length > 0) return empty("ancestry_unavailable");
  if (!observations.complete && observations.reason !== "ancestry_unavailable") return empty(observations.reason);
  const nativeById = new Map<string, RunRecord>();
  for (const run of runs) nativeById.set(opaque("agent", run.source + "\0" + run.id), run);
  const issues = new Map<string, { repo: IssueAgentTree["repo"]; issueNumber: number; dispatches: Map<string, IssueAgentTreeAgent[]> }>();
  for (const observation of observations.agents) {
    const dispatch = dispatchById.get(observation.assignment.id);
    if (!dispatch) return empty("binding_unavailable");
    const key = `${observation.repo.owner.toLowerCase()}/${observation.repo.name.toLowerCase()}#${observation.issueNumber}`;
    let issue = issues.get(key);
    if (!issue) { issue = { repo: observation.repo, issueNumber: observation.issueNumber, dispatches: new Map() }; issues.set(key, issue); }
    let agents = issue.dispatches.get(observation.assignment.id);
    if (!agents) { agents = []; issue.dispatches.set(observation.assignment.id, agents); }
    const rootRun = observation.parentAgentId.state === "known-parent" ? undefined :
      resolveOrchidNativeRoot(dispatch, runs) ?? runs.find(r => r.source === dispatch.source && r.id === dispatch.external && r.parentId === null);
    const run = observation.parentAgentId.state === "known-parent" ? nativeById.get(observation.agentId) : rootRun;
    agents.push(node(observation, dispatch, run, observations.observedAt, input.localCapacity,
      input.actions ?? [], input.actionsComplete ?? false));
  }
  const rows: IssueAgentTree[] = [...issues.values()].map(issue => ({ repo: issue.repo, issueNumber: issue.issueNumber,
    complete: true, reason: null,
    dispatches: [...issue.dispatches].map(([dispatchId, agents]) => {
      const root = agents.find(agent => agent.observation.parentAgentId.state === "confirmed-root");
      const childEvents = root === undefined ? [] : agents.filter(agent => agent.observation.parentAgentId.value === root.observation.agentId &&
        agent.startedAt !== null).map(agent => event(root.observation.agentId, "subagent-spawned", agent.startedAt!, "native", agent.observation.agentId));
      const decorated = root === undefined ? agents : agents.map(agent => agent === root ? { ...agent,
        timeline: { events: orderedEvents([...(agent.timeline?.events ?? []), ...childEvents]).slice(-32),
          truncated: (agent.timeline?.truncated ?? false) ||
            (agent.timeline?.events.length ?? 0) + childEvents.length > 32 } } : agent);
      return { dispatchId, agents: decorated.sort((a, b) => a.observation.agentId.localeCompare(b.observation.agentId)) };
    })
      .sort((a, b) => a.dispatchId.localeCompare(b.dispatchId)) }))
    .sort((a, b) => a.repo.owner.localeCompare(b.repo.owner) || a.repo.name.localeCompare(b.repo.name) || a.issueNumber - b.issueNumber);
  const snapshot: IssueAgentTreeSnapshot = { schema: 1, protocol: 1, observedAt: observations.observedAt,
    validUntil: new Date(Date.parse(observations.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ observation: observations.revision, issues: rows })),
    complete: observations.complete, reason: observations.reason, issues: rows };
  const decoded = readIssueAgentTreeSnapshot(snapshot);
  return decoded.ok ? decoded.snapshot : empty(decoded.reason === "oversized" ? "scan_limit" : "ancestry_unavailable");
}

/** Preserve good issue trees when a different receipt cannot establish ancestry. */
export function combineIssueAgentTreeSnapshots(input: {
  readonly observedAt: string;
  readonly entries: readonly { readonly repo: IssueAgentTree["repo"]; readonly issueNumber: number;
    readonly snapshot: IssueAgentTreeSnapshot }[];
  readonly globalReason?: IssueAgentTreeSnapshot["reason"];
}): IssueAgentTreeSnapshot {
  const issues: IssueAgentTree[] = [];
  const agentIds = new Set<string>();
  const issueKeys = new Set<string>();
  let overflow = false;
  const fits = (candidate: IssueAgentTree): boolean => issues.length < MAX_AGENT_OBSERVATIONS &&
    agentIds.size + candidate.dispatches.reduce((count, dispatch) => count + dispatch.agents.length, 0) <= MAX_AGENT_OBSERVATIONS &&
    Buffer.byteLength(JSON.stringify({ schema: 1, protocol: 1, observedAt: input.observedAt,
      validUntil: input.observedAt, revision: "a".repeat(64), complete: false,
      reason: "ancestry_unavailable", issues: [...issues, candidate] })) <= MAX_ISSUE_AGENT_TREE_BYTES;
  for (const entry of input.entries) {
    const key = `${entry.repo.owner.toLowerCase()}/${entry.repo.name.toLowerCase()}#${entry.issueNumber}`;
    if (issueKeys.has(key)) { overflow = true; continue; }
    issueKeys.add(key);
    const read = readIssueAgentTreeSnapshot(entry.snapshot);
    const issue = read.ok && read.snapshot.complete && read.snapshot.observedAt === input.observedAt &&
      read.snapshot.issues.length === 1 && read.snapshot.issues[0]?.repo.owner === entry.repo.owner &&
      read.snapshot.issues[0]?.repo.name === entry.repo.name && read.snapshot.issues[0]?.issueNumber === entry.issueNumber
      ? read.snapshot.issues[0] : null;
    const ids = issue?.dispatches.flatMap(dispatch => dispatch.agents.map(agent => agent.observation.agentId)) ?? [];
    const unavailable: IssueAgentTree = { repo: entry.repo, issueNumber: entry.issueNumber, complete: false,
      reason: read.ok && !read.snapshot.complete ? read.snapshot.reason : "binding_unavailable", dispatches: [] };
    const candidate = issue !== null && ids.every(id => !agentIds.has(id)) ? issue : unavailable;
    if (fits(candidate)) {
      issues.push(candidate);
      if (candidate.complete) ids.forEach(id => agentIds.add(id));
    } else if (fits({ ...unavailable, reason: "scan_limit" })) {
      issues.push({ ...unavailable, reason: "scan_limit" });
      overflow = true;
    } else overflow = true;
  }
  issues.sort((a, b) => a.repo.owner.localeCompare(b.repo.owner) || a.repo.name.localeCompare(b.repo.name) || a.issueNumber - b.issueNumber);
  const firstIncomplete = issues.find(issue => !issue.complete);
  const reason = input.globalReason ?? (overflow ? "scan_limit" : firstIncomplete?.reason ?? null);
  const complete = reason === null;
  const snapshot: IssueAgentTreeSnapshot = { schema: 1, protocol: 1, observedAt: input.observedAt,
    validUntil: new Date(Date.parse(input.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ issues, reason })), complete, reason, issues };
  const read = readIssueAgentTreeSnapshot(snapshot);
  return read.ok ? read.snapshot : { ...snapshot, complete: false, reason: "source_unavailable", issues: [] };
}
