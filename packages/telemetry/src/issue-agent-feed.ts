import { producerAgentCost, validateWireFamily, type TelemetryWireFamily } from "./producer-names.js";
/** Pure per-issue projection of the existing dispatcher/native ancestry join. */
import { createHash } from "node:crypto";
import { readAgentObservations, readIssueAgentTreeSnapshot, AGENT_ACTION_ACCEPTED_REASONS, AGENT_ACTION_REJECTED_REASONS, MAX_AGENT_HISTORY, MAX_AGENT_OBSERVATIONS,
  MAX_ISSUE_AGENT_TREE_BYTES, MAX_AGENT_RESOURCE_POINTS, ISSUE_AGENT_TREE_FRESH_MS, AGENT_EFFORTS,
  projectRouteIdentity, publicOpenCodeModel,
  type AgentHistoryEvent, type AgentObservation, type AgentObservations, type AgentTreeValue, type AgentRoutePolicy,
  type AgentResourceHistory, type AgentTimelineEvent, type AgentTimelineReason, type AgentTokenSource,
  type IssueLaunchBlock, type IssueAgentTree, type IssueAgentTreeAgent, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import type { NativeRootResolver } from "./host-reads.js";
import type { HostCapacityReading } from "./host-capacity.js";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import type { ClaudeChildCompletion, RunRecord } from "./model.js";
import { issueTokenUsage } from "./issue-token-usage.js";
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
function publicObservation(observation: AgentObservation, source: string | null): AgentObservation {
  const clean = (leaf: { readonly value: string | null; readonly source: string }, model = false, provider?: string | null) =>
    ({ ...leaf, value: (model && source === "opencode" ? publicOpenCodeModel(leaf.value, provider) : publicLabel(leaf.value)) ? leaf.value : null });
  const side = (name: "requested" | "observed") => ({
    provider: clean(observation.route[name].provider), model: clean(observation.route[name].model, true, observation.route[name].provider.value),
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

/** Require the exact bound root and an unbroken native sidechain before sharing its process observation. */
function verifiedClaudeSidechain(observation: AgentObservation, dispatch: DispatchEvidence,
  run: RunRecord | undefined, rootRun: RunRecord | undefined, runs: readonly RunRecord[],
  observations: readonly AgentObservation[]): boolean {
  if (observation.parentAgentId.state !== "known-parent" || dispatch.source !== "claude" ||
      run?.source !== "claude" || run.parentId === null || rootRun?.source !== "claude" ||
      rootRun.parentId !== null || rootRun.id === run.id ||
      !observations.some(row => row.assignment.id === observation.assignment.id &&
        row.parentAgentId.state === "confirmed-root" && row.agentId === opaque("agent", dispatch.runId))) return false;
  const byId = new Map<string, RunRecord>();
  for (const candidate of runs.filter(candidate => candidate.source === "claude")) {
    if (byId.has(candidate.id)) return false;
    byId.set(candidate.id, candidate);
  }
  let current = run;
  const seen = new Set<string>();
  while (current.parentId !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) return false;
    const expectedParent = parent.id === rootRun.id
      ? opaque("agent", dispatch.runId) : opaque("agent", `claude\0${parent.id}`);
    if (current === run && observation.parentAgentId.value !== expectedParent) return false;
    if (parent.id === rootRun.id) return true;
    current = parent;
  }
  return false;
}

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
  localCapacity: HostCapacityReading | undefined, actions: readonly PublicActionReceipt[], actionsComplete: boolean,
  verifiedClaudeChild: boolean, childCompletion: ClaudeChildCompletion | null, wireFamily: TelemetryWireFamily): IssueAgentTreeAgent {
  const root = observation.parentAgentId.state !== "known-parent";
  const provenAncestry = observation.parentAgentId.state === "confirmed-root" || observation.parentAgentId.state === "known-parent";
  const harness = root ? safe(dispatch.harness ?? dispatch.source, "dispatch") : safe(run?.source, "native");
  const provider = root ? safe(observation.route.requested.provider.value, "dispatch") : safe(run?.identity.provider, "native");
  const modelValue = root ? observation.route.requested.model.value : run?.identity.model;
  const model = dispatch.source === "opencode" && publicOpenCodeModel(modelValue, root ? observation.route.requested.provider.value : run?.identity.provider)
    ? { value: modelValue, source: root ? "dispatch" as const : "native" as const, reason: null } :
      dispatch.source === "opencode" ? unavailable : safe(modelValue, root ? "dispatch" : "native");
  const requestedEffort = observation.parentAgentId.state === "confirmed-root"
    ? observation.route.requested.effort.value : null;
  const effort: AgentTreeValue = typeof requestedEffort === "string" &&
    AGENT_EFFORTS.includes(requestedEffort as typeof AGENT_EFFORTS[number])
    ? { value: requestedEffort, source: "dispatch", reason: null }
    : requestedEffort !== null ? { value: null, source: "unavailable", reason: "binding_invalid" } : unavailable;
  const parentAgentId = observation.parentAgentId.state === "known-parent" ? observation.parentAgentId.value : null;
  const router = provenAncestry && dispatch.router?.value === "direct" && dispatch.router.source === "dispatch" &&
    (dispatch.source === "codex" || dispatch.source === "claude" || dispatch.source === "agy" || dispatch.source === "opencode") ? dispatch.router : unavailable;
  const unboundRevision = { value: null, scope: "root-dispatch", source: "unavailable", reason: "source_not_bound" } as const;
  const profileRevision = provenAncestry ? dispatch.profileRevision ?? unboundRevision : unboundRevision;
  const matrixRevision = provenAncestry ? dispatch.matrixRevision ?? unboundRevision : unboundRevision;
  const start = time(run?.startedAt, now);
  const outcomeAt = time(run?.updatedAt, now);
  // A Claude sidechain shares its verified root's native process. Only the
  // paired, same-dispatch seat and process absence can end that child.
  const processScope = root || verifiedClaudeChild;
  const laterChildStart = verifiedClaudeChild && observation.running.value === true
    ? time(observation.running.observedAt ?? undefined, now) : null;
  const afterLatestStart = (at: string | null): string | null =>
    at !== null && laterChildStart !== null && laterChildStart > at ? null : at;
  const seatAt = afterLatestStart(processScope ? time(dispatch.stop?.seatObservedAt ?? undefined, now) : null);
  const processAt = afterLatestStart(processScope ? time(dispatch.stop?.processObservedAt ?? undefined, now) : null);
  const stopCandidate = seatAt !== null && processAt !== null ? (seatAt > processAt ? seatAt : processAt) : null;
  const childObservationAfter = (seat: string | null, process: string | null, terminal: string | null): boolean =>
    !verifiedClaudeChild || start !== null && seat !== null && process !== null && terminal !== null &&
      seat >= start && process >= start &&
      (observation.running.observedAt === null || observation.running.observedAt <= terminal);
  const stopAt = !childObservationAfter(seatAt, processAt, stopCandidate)
    ? null : stopCandidate;
  const teardownSeatAt = afterLatestStart(processScope ? time(dispatch.teardown?.seatObservedAt ?? undefined, now) : null);
  const teardownProcessAt = afterLatestStart(processScope ? time(dispatch.teardown?.processObservedAt ?? undefined, now) : null);
  const teardownCandidate = teardownSeatAt !== null && teardownProcessAt !== null
    ? (teardownSeatAt > teardownProcessAt ? teardownSeatAt : teardownProcessAt) : null;
  const teardownAt = !childObservationAfter(teardownSeatAt, teardownProcessAt, teardownCandidate)
    ? null : teardownCandidate;
  // A Claude root whose last turn had completed before the teardown was done, not cut off: the
  // teardown (an operator timeout, say) ends its seat, and its outcome is the completed turn.
  // #516 (2026-09-30) finished at its prompt, was torn down 14 minutes later and read Failed.
  const turnEndedAt = root && run?.source === "claude" ? time(run.turnEndedAt, now) : null;
  const finishedBeforeTeardown = teardownAt !== null && turnEndedAt !== null && turnEndedAt <= teardownAt &&
    (start === null || turnEndedAt >= start) ? turnEndedAt : null;
  // A verified Claude child ends natively only on its parent's own task-notification for exactly this
  // child: completed or failed, at or after its start and its last transcript record, and not
  // superseded by a later matched Start. Any other status, or any doubt, leaves the rules below.
  const completionAt = verifiedClaudeChild && childCompletion !== null && childCompletion.status !== "other"
    ? time(childCompletion.at, now) : null;
  const childEndAt = completionAt !== null && start !== null && completionAt >= start &&
    outcomeAt !== null && outcomeAt <= completionAt &&
    (laterChildStart === null || laterChildStart <= completionAt) ? completionAt : null;
  const actionState: IssueAgentTreeAgent["actionState"] = stopAt !== null
    ? { state: "stopped", observedAt: stopAt, reason: null }
    : seatAt !== null ? { state: "stopping", observedAt: seatAt, reason: null }
      : { state: "unknown", observedAt: null, reason: "source_not_bound" };
  const nativeClock = run?.source === "opencode" ? time(run.terminalAt, now) : null;
  const nativeTerminal = !(run?.source === "claude" && !root) && (run?.source !== "opencode" || nativeClock !== null) &&
    (run?.outcome === "complete" || run?.outcome === "failed") && outcomeAt !== null;
  const liveness: IssueAgentTreeAgent["liveness"] = nativeTerminal
    ? { state: "ended", evidence: "native-outcome", observedAt: nativeClock ?? now, reason: null }
    : childEndAt !== null ? { state: "ended", evidence: "native-outcome", observedAt: childEndAt, reason: null }
    : stopAt !== null ? { state: "ended", evidence: "stop-observation", observedAt: stopAt, reason: null }
    : teardownAt !== null ? { state: "ended", evidence: "teardown-observation", observedAt: teardownAt, reason: null }
    : seatAt !== null ? { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" }
    : teardownSeatAt !== null ? { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" }
    : observation.running.value === true && observation.running.observedAt !== null
      ? { state: "running", evidence: "runtime-observation", observedAt: observation.running.observedAt, reason: null }
    : observation.running.value === false && observation.running.observedAt !== null
      ? { state: "idle", evidence: "runtime-observation", observedAt: observation.running.observedAt, reason: null }
      : { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" };
  // A native terminal outcome ends at its own record's time when the reader measured one
  // (run.terminalAt: Codex task_complete / error / turn_aborted), never at updatedAt, which is only
  // the last activity. Before this, a Codex child that finished showed "ended" with no end time
  // (RUN-453, 2026-09-30); a run without an exact terminal time still has none.
  const terminalAt = time(run?.terminalAt, now);
  const latestStepAt = (run?.activitySteps ?? []).reduce<string | null>((latest, step) => {
    const at = time(step.at, now);
    return at !== null && (latest === null || at > latest) ? at : latest;
  }, null);
  const nativeEndAt = liveness.state === "ended" && liveness.evidence === "native-outcome" && childEndAt === null &&
    terminalAt !== null && start !== null && terminalAt >= start &&
    (latestStepAt === null || terminalAt >= latestStepAt) ? terminalAt : null;
  const endedBy: IssueAgentTreeAgent["endedBy"] = liveness.state === "ended" && liveness.evidence === "stop-observation" ? "stop"
    : liveness.state === "ended" && liveness.evidence === "teardown-observation" ? dispatch.teardown!.cause : null;
  const terminalOutcome: IssueAgentTreeAgent["terminalOutcome"] = liveness.state === "ended"
    ? liveness.evidence === "stop-observation"
      ? { value: "cancelled", source: "stop-observation", observedAt: stopAt!, reason: null }
    : liveness.evidence === "teardown-observation"
      ? finishedBeforeTeardown !== null
        ? { value: "succeeded", source: "native-outcome", observedAt: finishedBeforeTeardown, reason: null }
        : { value: "cancelled", source: "teardown-observation", observedAt: teardownAt!, reason: null }
    : childEndAt !== null
      ? { value: childCompletion!.status === "completed" ? "succeeded" : "failed", source: "native-outcome", observedAt: childEndAt, reason: null }
    : run!.outcome === "complete"
      ? { value: "succeeded", source: "native-outcome", observedAt: nativeClock ?? now, reason: null }
      : run!.terminalCause === "error" || run!.terminalCause === "cancelled"
        ? { value: run!.terminalCause === "error" ? "failed" : "cancelled", source: "native-outcome", observedAt: nativeClock ?? now, reason: null }
        : { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" }
    : { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" };
  const unplaced = { value: null, basis: "unavailable", observedAt: null, reason: "source_not_bound" } as const;
  const host = provenAncestry && dispatch.host && /^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(dispatch.host) &&
    time(dispatch.observedAt, now) !== null
    ? { value: dispatch.host, basis: "placement", observedAt: dispatch.observedAt!, reason: null } as const : unplaced;
  const missingCapacity = (reason: "source_not_bound" | "observer-unavailable" | "binding_invalid" | "source_stale") =>
    producerAgentCost(reason, wireFamily).localCapacity;
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
  const running = (liveness.state !== "running" && observation.running.value === true) ||
    (liveness.state !== "idle" && observation.running.value === false)
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
  const launchBudget = root ? dispatch.budget ?? { tokenLimit: null, source: "unavailable", reason: "source_not_bound" } as const
    : { tokenLimit: null, source: "unavailable", reason: "source_not_bound" } as const;
  // Each accepted raise receipt is written only after Orchid's native goal
  // notification, get read-back and state persistence. A missing or partial
  // action scan cannot supersede the original launch budget.
  const verifiedRaises = root && actionsComplete && launchBudget.tokenLimit !== null
    ? actions.flatMap(receipt => {
      const at = receiptTime(receipt.observedAt ?? undefined, now);
      if (receipt.action !== "raise_budget" || receipt.outcome !== "accepted" ||
          receipt.reason !== "goal_budget_updated" || receipt.agentId !== observation.agentId ||
          receipt.dispatchId !== observation.assignment.id || receipt.issueNumber !== observation.issueNumber ||
          receipt.repository?.toLowerCase() !== `${observation.repo.owner}/${observation.repo.name}`.toLowerCase() ||
          at === null || typeof receipt.tokenBudget !== "number" || !Number.isSafeInteger(receipt.tokenBudget) ||
          receipt.tokenBudget <= launchBudget.tokenLimit) return [];
      return [{ at, tokenLimit: receipt.tokenBudget }];
    }) : [];
  const raisedBudget = verifiedRaises.reduce<number | null>((highest, receipt) =>
    Math.max(highest ?? launchBudget.tokenLimit!, receipt.tokenLimit), null);
  const budget: IssueAgentTreeAgent["budget"] = raisedBudget === null ? launchBudget
    : { tokenLimit: raisedBudget, source: "action-receipt", reason: null };
  const steps = (run?.activitySteps ?? []).filter(step => time(step.at, now) !== null).slice(0, 20);
  const activity: NonNullable<IssueAgentTreeAgent["activity"]> = run !== undefined && time(run.updatedAt, now) !== null
    ? { availability: "available", reason: null, observedAt: run.updatedAt, steps }
    : { availability: "unavailable", reason: "source_not_bound", observedAt: null, steps: [] };
  const tokenUsage = issueTokenUsage(run, budget.tokenLimit,
    run !== undefined && time(run.updatedAt, now) !== null ? run.updatedAt : null);
  const nativeSamples = run?.tokenSamples;
  const tokenPoints = nativeSamples?.points.map(point => ({ at: time(point.at, now), usedTokens: point.usedTokens }));
  const validTokenPoints = tokenUsage.usedTokens !== null && nativeSamples !== undefined && !nativeSamples.invalid &&
    nativeSamples.partial !== true &&
    tokenPoints !== undefined && tokenPoints.length > 0 && tokenPoints.length <= MAX_AGENT_RESOURCE_POINTS &&
    tokenPoints.every(point => point.at !== null && Number.isSafeInteger(point.usedTokens) && point.usedTokens >= 0) &&
    tokenPoints.every((point, i) => i === 0 || point.at! > tokenPoints[i - 1]!.at! &&
      point.usedTokens > tokenPoints[i - 1]!.usedTokens) &&
    tokenPoints.at(-1)!.usedTokens === tokenUsage.usedTokens;
  const tokens: AgentResourceHistory["tokens"] = validTokenPoints
    ? { points: tokenPoints.map(point => ({ at: point.at!, usedTokens: point.usedTokens })),
        truncated: nativeSamples.truncated, source: tokenUsage.source as AgentTokenSource, reason: null }
    : { points: [], truncated: false, source: "unavailable",
        // A history read only at its head and tail is served as incomplete, never as a full series.
        reason: nativeSamples?.invalid || nativeSamples?.partial === true ? "source_incomplete"
          : run === undefined ? "source_not_bound" : "measurement_missing" };
  const launchAt = root ? time(dispatch.observedAt, now) : null;
  const budgetPoints = launchAt !== null && launchBudget.tokenLimit !== null
    ? [{ at: launchAt, tokenLimit: launchBudget.tokenLimit, source: launchBudget.source },
      ...verifiedRaises.map(raise => ({ ...raise, source: "action-receipt" as const }))]
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [];
  const validBudgetPoints = root && actionsComplete && budgetPoints.length > 0 &&
    budgetPoints.every((point, i) => i === 0 || point.source === "action-receipt" &&
      point.at > budgetPoints[i - 1]!.at && point.tokenLimit > budgetPoints[i - 1]!.tokenLimit) &&
    budgetPoints.at(-1)!.tokenLimit === budget.tokenLimit && budgetPoints.at(-1)!.source === budget.source;
  const budgets: AgentResourceHistory["budgets"] = validBudgetPoints
    ? { points: budgetPoints.length <= MAX_AGENT_RESOURCE_POINTS ? budgetPoints :
        [budgetPoints[0]!, ...budgetPoints.slice(-(MAX_AGENT_RESOURCE_POINTS - 1))],
        truncated: budgetPoints.length > MAX_AGENT_RESOURCE_POINTS, reason: null }
    : { points: [], truncated: false,
        reason: !root ? "source_not_bound" : !actionsComplete ? "source_incomplete" : "measurement_missing" };
  const resourceHistory: AgentResourceHistory = { tokens, budgets };
  const events: AgentTimelineEvent[] = [];
  if (root && time(dispatch.observedAt, now) !== null) events.push(event(observation.agentId, "dispatched", dispatch.observedAt!, "dispatch"));
  if (start !== null) events.push(event(observation.agentId, "started", start, "native"));
  if (liveness.state === "ended" && terminalOutcome.value !== null) {
    const end = liveness.evidence === "native-outcome" && childEndAt === null ? nativeEndAt ?? outcomeAt : liveness.observedAt;
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
      ? receipt.reason === AGENT_ACTION_ACCEPTED_REASONS[receipt.action]
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
    profileRevision, matrixRevision,
    effort, parentAgentId,
    location: { host, container: unplaced, seat: unplaced }, nativeDepth,
    budget,
    quotaRegime: seam === "codex" || seam === "claude" ? { value: "subscription", reason: null }
      : { value: null, reason: "source_not_bound" },
    liveness, actionState, endedBy, terminalOutcome, startedAt: start, startedAtReason: start === null ? "run_not_found" : null,
    endedAt: endedBy === "stop" ? stopAt : endedBy === "timeout" || endedBy === "teardown" ? teardownAt
      : liveness.state === "ended" && childEndAt !== null ? childEndAt : nativeEndAt,
    endedAtReason: endedBy === null && !(liveness.state === "ended" && childEndAt !== null) && nativeEndAt === null
      ? "measurement_missing" : null,
    transcript: { value: null, reason: "source_not_bound" },
    history: history(observation, dispatch, run, now, root), historyTruncated: false,
    activity, tokenUsage, resourceHistory, timeline };
}

/** Invalid or partial ancestry is never repackaged as a complete tree. */
export function buildIssueAgentTreeSnapshot(input: {
  readonly wireFamily?: TelemetryWireFamily;
  readonly observations: AgentObservations;
  readonly dispatches: readonly DispatchEvidence[];
  readonly runs: readonly RunRecord[];
  readonly localCapacity?: HostCapacityReading;
  readonly actions?: readonly PublicActionReceipt[];
  readonly actionsComplete?: boolean;
  /**
   * The native tree was read whole from its roots but its extent was bounded: the rows say
   * `scan_limit` and keep the agents read, never a complete claim. Contract 0.37 and later.
   */
  readonly bounded?: boolean;
  /** The dispatch host's private native-root join; without one, only an explicit dispatch reference binds. */
  readonly host?: NativeRootResolver;
}): IssueAgentTreeSnapshot {
  const wireFamily = validateWireFamily(input.wireFamily);
  const { dispatches, runs } = input;
  const dispatchById = new Map(dispatches.map(d => [opaque("assignment", d.runId), d]));
  const observations: AgentObservations = { ...input.observations,
    agents: input.observations.agents.map(raw => {
      const dispatch = dispatchById.get(raw.assignment.id);
      const publicRow = publicObservation(raw, dispatch?.source ?? null);
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
      input.host?.resolveNativeRoot(dispatch, runs) ?? runs.find(r => r.source === dispatch.source && r.id === dispatch.external && r.parentId === null);
    const run = observation.parentAgentId.state === "known-parent" ? nativeById.get(observation.agentId) : rootRun;
    const boundRoot = observation.parentAgentId.state === "known-parent"
      ? input.host?.resolveNativeRoot(dispatch, runs) ?? runs.find(r => r.source === dispatch.source && r.id === dispatch.external && r.parentId === null)
      : rootRun;
    const verifiedClaudeChild = verifiedClaudeSidechain(observation, dispatch, run, boundRoot, runs, observations.agents);
    // The notification lands in the child's direct parent session; ids are unique among Claude runs here.
    const parentRun = verifiedClaudeChild ? runs.find(candidate => candidate.source === "claude" && candidate.id === run!.parentId) : undefined;
    const childCompletion = parentRun?.childCompletions?.find(entry => entry.childId === run!.id) ?? null;
    agents.push(node(observation, dispatch, run, observations.observedAt, input.localCapacity,
      input.actions ?? [], input.actionsComplete ?? false, verifiedClaudeChild, childCompletion, wireFamily));
  }
  const bounded = input.bounded === true;
  const rows: IssueAgentTree[] = [...issues.values()].map(issue => ({ repo: issue.repo, issueNumber: issue.issueNumber,
    complete: !bounded, reason: bounded ? "scan_limit" as const : null,
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
    complete: observations.complete && !bounded, reason: observations.reason ?? (bounded ? "scan_limit" : null), issues: rows };
  const decoded = readIssueAgentTreeSnapshot(snapshot);
  return decoded.ok ? decoded.snapshot : empty(decoded.reason === "oversized" ? "scan_limit" : "ancestry_unavailable");
}

/** Preserve good issue trees when a different receipt cannot establish ancestry. */
export function combineIssueAgentTreeSnapshots(input: {
  readonly observedAt: string;
  readonly entries: readonly { readonly repo: IssueAgentTree["repo"]; readonly issueNumber: number;
    readonly snapshot: IssueAgentTreeSnapshot; readonly launchBlock?: IssueLaunchBlock }[];
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
    const row = read.ok && read.snapshot.observedAt === input.observedAt &&
      read.snapshot.issues.length === 1 && read.snapshot.issues[0]?.repo.owner === entry.repo.owner &&
      read.snapshot.issues[0]?.repo.name === entry.repo.name && read.snapshot.issues[0]?.issueNumber === entry.issueNumber
      ? read.snapshot.issues[0]! : null;
    // A bounded tree keeps the agents it read; any other incomplete snapshot keeps none.
    const issue = row !== null && read.ok && (read.snapshot.complete ||
      (!row.complete && row.reason === "scan_limit" && read.snapshot.reason === "scan_limit" && row.dispatches.length > 0))
      ? row : null;
    const ids = issue?.dispatches.flatMap(dispatch => dispatch.agents.map(agent => agent.observation.agentId)) ?? [];
    const unavailable: IssueAgentTree = { repo: entry.repo, issueNumber: entry.issueNumber, complete: false,
      reason: read.ok && !read.snapshot.complete ? read.snapshot.reason : "binding_unavailable", dispatches: [],
      ...(entry.launchBlock === undefined ? {} : { launchBlock: entry.launchBlock }) };
    const tree = issue !== null && ids.every(id => !agentIds.has(id)) ? issue : unavailable;
    // The receipt proves the block independently of native coverage. Count it in the byte cap.
    const candidate = entry.launchBlock === undefined ? tree : { ...tree, launchBlock: entry.launchBlock };
    if (fits(candidate)) {
      issues.push(candidate);
      if (tree === issue) ids.forEach(id => agentIds.add(id));
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
