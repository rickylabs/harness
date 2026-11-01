/** Pure per-agent metadata and execution projection; current native roots own execution. */
import { AGENT_ACTION_ACCEPTED_REASONS, AGENT_ACTION_REJECTED_REASONS, MAX_AGENT_HISTORY,
  MAX_AGENT_RESOURCE_POINTS, ISSUE_AGENT_TREE_FRESH_MS, AGENT_EFFORTS, publicOpenCodeModel,
  type AgentHistoryEvent, type AgentObservation, type AgentTreeValue,
  type AgentResourceHistory, type AgentTimelineEvent, type AgentTimelineReason, type IssueAgentTreeAgent,
  type DispatchEvidence } from "@rickylabs/harness-contracts";
import { producerAgentCost, type TelemetryWireFamily } from "./producer-names.js";
import { processedInputTokens, type ClaudeChildCompletion, type RunRecord } from "./model.js";
import type { NativeRootObservation } from "./agent-observations.js";
import type { HostCapacityReading } from "./host-capacity.js";
import type { PublicActionReceipt } from "./action-receipt-cli.js";
import { digest, opaque, safe, time, receiptTime, event, orderedEvents, unavailable, unavailablePolicy } from "./issue-agent-tree-values.js";
/** Require the exact bound root and an unbroken native sidechain before sharing its process observation. */
export function verifiedClaudeSidechain(observation: AgentObservation, dispatch: DispatchEvidence,
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

export function node(observation: AgentObservation, dispatch: DispatchEvidence, run: RunRecord | undefined, now: string,
  localCapacity: HostCapacityReading | undefined, actions: readonly PublicActionReceipt[], actionsComplete: boolean,
  verifiedClaudeChild: boolean, childCompletion: ClaudeChildCompletion | null, wireFamily: TelemetryWireFamily, nativeRoot?: NativeRootObservation): IssueAgentTreeAgent {
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
  const liveness: IssueAgentTreeAgent["liveness"] = nativeRoot !== undefined
    ? nativeRoot.completed
      ? { state: "ended", evidence: "native-outcome", observedAt: now, reason: null }
      : nativeRoot.running.value !== null && nativeRoot.running.observedAt !== null
        ? { state: nativeRoot.running.value ? "running" : "idle", evidence: "runtime-observation", observedAt: nativeRoot.running.observedAt, reason: null }
        : { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" }
    : nativeTerminal
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
  const nativeEndAt = nativeRoot === undefined && liveness.state === "ended" && liveness.evidence === "native-outcome" && childEndAt === null &&
    terminalAt !== null && start !== null && terminalAt >= start &&
    (latestStepAt === null || terminalAt >= latestStepAt) ? terminalAt : null;
  const endedBy: IssueAgentTreeAgent["endedBy"] = nativeRoot !== undefined ? null : liveness.state === "ended" && liveness.evidence === "stop-observation" ? "stop"
    : liveness.state === "ended" && liveness.evidence === "teardown-observation" ? dispatch.teardown!.cause : null;
  const terminalOutcome: IssueAgentTreeAgent["terminalOutcome"] = nativeRoot !== undefined
    ? { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" }
    : liveness.state === "ended"
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
  const input = run === undefined ? undefined : processedInputTokens(run.source, run.usage), output = run?.usage.outputTokens;
  const measured = (run?.source === "codex" || run?.source === "claude") && input !== undefined && output !== undefined && Number.isSafeInteger(input) && Number.isSafeInteger(output) &&
    input >= 0 && output >= 0 && Number.isSafeInteger(input + output) && time(run?.updatedAt, now) !== null;
  const tokenUsage: NonNullable<IssueAgentTreeAgent["tokenUsage"]> = measured
    ? { usedTokens: input! + output!, budgetTokens: budget.tokenLimit, observedAt: run!.updatedAt,
        source: run!.source === "codex" ? "codex-token-count" : "claude-usage", reason: null }
    : { usedTokens: null, budgetTokens: budget.tokenLimit, observedAt: null, source: "unavailable",
        reason: run === undefined ? "source_not_bound" : "measurement_missing" };
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
        truncated: nativeSamples.truncated, source: tokenUsage.source as "codex-token-count" | "claude-usage", reason: null }
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
    endedAt: nativeRoot !== undefined ? null : endedBy === "stop" ? stopAt : endedBy === "timeout" || endedBy === "teardown" ? teardownAt
      : liveness.state === "ended" && childEndAt !== null ? childEndAt : nativeEndAt,
    endedAtReason: nativeRoot !== undefined ? "measurement_missing" : endedBy === null && !(liveness.state === "ended" && childEndAt !== null) && nativeEndAt === null
      ? "measurement_missing" : null,
    transcript: { value: null, reason: "source_not_bound" },
    history: history(observation, dispatch, run, now, root), historyTruncated: false,
    activity, tokenUsage, resourceHistory, timeline };
}
