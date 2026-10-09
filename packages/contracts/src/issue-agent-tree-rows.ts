/** Row decoders for one issue-agent tree agent; internal to the snapshot reader. */
import { publicOpenCodeModel } from "./opencode-identity.js";
import { readAgentActivity } from "./agent-activity.js";
import { AGENT_ACTION_ACCEPTED_REASONS, AGENT_ACTION_REJECTED_REASONS, AGENT_EFFORTS, AGENT_HISTORY_KINDS,
  MAX_AGENT_HISTORY, MAX_AGENT_RESOURCE_POINTS, MAX_AGENT_TIMELINE_EVENTS } from "./issue-agent-tree-constants.js";
import { array, bad, label, reason, record, stamp } from "./issue-agent-tree-decode.js";
import type { AgentActionKind, AgentActionState, AgentBudget, AgentBudgetHistory, AgentBudgetPoint, AgentHistoryKind,
  AgentLaunchRevision, AgentNativeDepth, AgentPlacementValue, AgentQuotaRegime, AgentResourceHistory, AgentRoutePolicy,
  AgentTerminalOutcome, AgentTimeline, AgentTimelineEvent, AgentTimelineReason, AgentTokenHistory, AgentTokenUsage,
  AgentTreeLiveness, AgentTreeLocation, AgentTreeValue, IssueAgentTreeAgent } from "./issue-agent-tree.js";

function valueRow(value: unknown, model?: { provider: string | null }): AgentTreeValue {
  const row = record(value, ["value", "source", "reason"]);
  if (row.source === "unavailable" && row.value === null) return { value: null, source: "unavailable", reason: reason(row.reason) };
  if ((row.source !== "dispatch" && row.source !== "native") || row.reason !== null) return bad();
  if (model !== undefined && !publicOpenCodeModel(row.value, model.provider)) return bad();
  return { value: model === undefined ? label(row.value) : row.value as string, source: row.source, reason: null };
}
function launchRevisionRow(value: unknown): AgentLaunchRevision {
  const row = record(value, ["value", "scope", "source", "reason"]);
  if (row.scope !== "root-dispatch") return bad();
  if (row.source === "unavailable" && row.value === null) return {
    value: null, scope: "root-dispatch", source: "unavailable", reason: reason(row.reason),
  };
  if (row.source !== "dispatch" || row.reason !== null ||
      typeof row.value !== "string" || !/^[a-f0-9]{40}$/.test(row.value)) return bad();
  return { value: row.value, scope: "root-dispatch", source: "dispatch", reason: null };
}
function depthRow(value: unknown): AgentNativeDepth {
  const row = record(value, ["value", "source", "reason"]);
  if (row.value === null && row.source === "unavailable") {
    return { value: null, source: "unavailable", reason: reason(row.reason) };
  }
  if (row.source !== "native" || row.reason !== null || typeof row.value !== "number" ||
      !Number.isSafeInteger(row.value) || row.value < 1) return bad();
  return { value: row.value, source: "native", reason: null };
}
function policyRow(value: unknown): AgentRoutePolicy {
  const row = record(value, ["value", "digest", "source", "reason"]);
  if (row.value === null && row.digest === null && row.source === "unavailable") {
    return { value: null, digest: null, source: "unavailable", reason: reason(row.reason) };
  }
  if ((row.value !== "netscript-matrix" && row.value !== "harness-matrix") || row.source !== "dispatch" || row.reason !== null ||
      typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)) return bad();
  return { value: row.value, digest: row.digest, source: "dispatch", reason: null };
}
function placement(value: unknown, capturedAt: string): AgentPlacementValue {
  const row = record(value, ["value", "basis", "observedAt", "reason"]);
  if (row.value === null && row.basis === "unavailable" && row.observedAt === null) {
    return { value: null, basis: "unavailable", observedAt: null, reason: reason(row.reason) };
  }
  if ((row.basis !== "placement" && row.basis !== "runtime") || row.reason !== null) return bad();
  const observedAt = stamp(row.observedAt);
  if (observedAt > capturedAt) return bad();
  return { value: label(row.value), basis: row.basis, observedAt, reason: null };
}
function tokenUsageRow(value: unknown, capturedAt: string, budgetTokens: number | null): AgentTokenUsage {
  const row = record(value, ["usedTokens", "budgetTokens", "observedAt", "source", "reason"]);
  if (row.budgetTokens !== budgetTokens) return bad();
  if (row.usedTokens === null && row.observedAt === null && row.source === "unavailable") {
    return { usedTokens: null, budgetTokens, observedAt: null, source: "unavailable", reason: reason(row.reason) };
  }
  if (typeof row.usedTokens !== "number" || !Number.isSafeInteger(row.usedTokens) || row.usedTokens < 0 ||
      (row.source !== "codex-token-count" && row.source !== "claude-usage") || row.reason !== null) return bad();
  const observedAt = stamp(row.observedAt);
  if (observedAt > capturedAt) return bad();
  return { usedTokens: row.usedTokens, budgetTokens, observedAt, source: row.source, reason: null };
}
function resourceHistoryRow(value: unknown, capturedAt: string, root: boolean,
  budget: AgentBudget, usage: AgentTokenUsage | undefined): AgentResourceHistory {
  const row = record(value, ["tokens", "budgets"]);
  const tokens = record(row.tokens, ["points", "truncated", "source", "reason"]);
  let tokenHistory: AgentTokenHistory;
  if (tokens.source === "unavailable") {
    if (tokens.reason === null || tokens.truncated !== false || array(tokens.points, 0).length !== 0) return bad();
    tokenHistory = { points: [], truncated: false, source: "unavailable", reason: reason(tokens.reason) };
  } else {
    if ((tokens.source !== "codex-token-count" && tokens.source !== "claude-usage") ||
        tokens.reason !== null || typeof tokens.truncated !== "boolean" ||
        usage?.source !== tokens.source || usage.usedTokens === null) return bad();
    const points = array(tokens.points, MAX_AGENT_RESOURCE_POINTS).map(point => {
      const p = record(point, ["at", "usedTokens"]), at = stamp(p.at);
      if (at > capturedAt || typeof p.usedTokens !== "number" || !Number.isSafeInteger(p.usedTokens) || p.usedTokens < 0) return bad();
      return { at, usedTokens: p.usedTokens };
    });
    if (points.length === 0 || tokens.truncated && points.length !== MAX_AGENT_RESOURCE_POINTS ||
        points.at(-1)!.usedTokens !== usage.usedTokens) return bad();
    for (let i = 1; i < points.length; i++) if (points[i - 1]!.at >= points[i]!.at ||
        points[i - 1]!.usedTokens >= points[i]!.usedTokens) return bad();
    tokenHistory = { points, truncated: tokens.truncated, source: tokens.source, reason: null };
  }
  const budgets = record(row.budgets, ["points", "truncated", "reason"]);
  let budgetHistory: AgentBudgetHistory;
  if (budgets.reason !== null) {
    if (budgets.truncated !== false || array(budgets.points, 0).length !== 0) return bad();
    budgetHistory = { points: [], truncated: false, reason: reason(budgets.reason) };
  } else {
    if (!root || budget.tokenLimit === null || typeof budgets.truncated !== "boolean") return bad();
    const points = array(budgets.points, MAX_AGENT_RESOURCE_POINTS).map(point => {
      const p = record(point, ["at", "tokenLimit", "source"]), at = stamp(p.at);
      if (at > capturedAt || typeof p.tokenLimit !== "number" || !Number.isSafeInteger(p.tokenLimit) ||
          p.tokenLimit <= 0 || !["route-default", "issue-override", "action-receipt"].includes(p.source as string)) return bad();
      return { at, tokenLimit: p.tokenLimit,
        source: p.source as AgentBudgetPoint["source"] };
    });
    if (points.length === 0 || budgets.truncated && points.length !== MAX_AGENT_RESOURCE_POINTS ||
        points[0]!.source === "action-receipt" || points.at(-1)!.tokenLimit !== budget.tokenLimit ||
        points.at(-1)!.source !== budget.source) return bad();
    for (let i = 1; i < points.length; i++) if (points[i]!.source !== "action-receipt" ||
        points[i - 1]!.at >= points[i]!.at || points[i - 1]!.tokenLimit >= points[i]!.tokenLimit) return bad();
    budgetHistory = { points, truncated: budgets.truncated, reason: null };
  }
  return { tokens: tokenHistory, budgets: budgetHistory };
}
function timelineRow(value: unknown, capturedAt: string): AgentTimeline {
  const row = record(value, ["events", "truncated"]);
  if (typeof row.truncated !== "boolean") return bad();
  const ids = new Set<string>();
  const events = array(row.events, MAX_AGENT_TIMELINE_EVENTS).map(value => {
    const hasReason = Object.hasOwn(value as object, "reason");
    const e = record(value, ["id", "at", "kind", "action", "relatedAgentId", "source", "outcome",
      ...(hasReason ? ["reason"] : [])]);
    if (typeof e.id !== "string" || !/^event_[a-f0-9]{64}$/.test(e.id) || ids.has(e.id)) return bad();
    ids.add(e.id);
    const at = stamp(e.at);
    if (at > capturedAt) return bad();
    const kinds = { dispatched: "dispatch", started: "native", "subagent-spawned": "native",
      "goal-updated": "goal", "goal-complete": "goal", "action-accepted": "action-receipt",
      "action-rejected": "action-receipt", ended: "terminal" } as const;
    if (!Object.hasOwn(kinds, e.kind as string) || e.source !== kinds[e.kind as keyof typeof kinds]) return bad();
    const actionKind = e.kind === "action-accepted" || e.kind === "action-rejected";
    if (actionKind ? !Object.hasOwn(AGENT_ACTION_ACCEPTED_REASONS, e.action as string) : e.action !== null) return bad();
    if (e.kind === "subagent-spawned" ? typeof e.relatedAgentId !== "string" || !/^agent_[a-f0-9]{64}$/.test(e.relatedAgentId) : e.relatedAgentId !== null) return bad();
    if (e.kind === "ended" ? !["succeeded", "failed", "cancelled"].includes(e.outcome as string) : e.outcome !== null) return bad();
    if (hasReason) {
      const validReason = e.kind === "action-accepted"
        ? e.reason === AGENT_ACTION_ACCEPTED_REASONS[e.action as AgentActionKind]
        : e.kind === "action-rejected" ? AGENT_ACTION_REJECTED_REASONS.includes(e.reason as typeof AGENT_ACTION_REJECTED_REASONS[number])
          : e.kind === "ended" ? ["native-complete", "native-error", "native-cancelled", "stop", "timeout", "teardown"].includes(e.reason as string)
            : e.reason === null;
      if (!validReason) return bad();
    }
    return { id: e.id, at, kind: e.kind as AgentTimelineEvent["kind"], action: e.action as AgentTimelineEvent["action"],
      relatedAgentId: e.relatedAgentId as string | null, source: e.source as AgentTimelineEvent["source"],
      outcome: e.outcome as AgentTimelineEvent["outcome"],
      ...(hasReason ? { reason: e.reason as AgentTimelineReason | null } : {}) };
  });
  for (let i = 1; i < events.length; i++) if (events[i - 1]!.at > events[i]!.at) return bad();
  return { events, truncated: row.truncated };
}
export function agent(value: unknown, capturedAt: string, dispatchId: string): Omit<IssueAgentTreeAgent, "observation"> & { readonly observation: unknown } {
  const keys = ["dispatchId", "observation", "harness", "provider", "router", "model", "location", "budget", "quotaRegime", "liveness", "terminalOutcome", "startedAt", "startedAtReason", "endedAt", "endedAtReason", "transcript", "history", "historyTruncated"];
  const row = record(value, [...keys,
    ...(Object.hasOwn(value as object, "routePolicy") ? ["routePolicy"] : []),
    ...(Object.hasOwn(value as object, "profileRevision") ? ["profileRevision"] : []),
    ...(Object.hasOwn(value as object, "matrixRevision") ? ["matrixRevision"] : []),
    ...(Object.hasOwn(value as object, "effort") ? ["effort"] : []),
    ...(Object.hasOwn(value as object, "parentAgentId") ? ["parentAgentId"] : []),
    ...(Object.hasOwn(value as object, "nativeDepth") ? ["nativeDepth"] : []),
    ...(Object.hasOwn(value as object, "actionState") ? ["actionState"] : []),
    ...(Object.hasOwn(value as object, "endedBy") ? ["endedBy"] : []),
    ...(Object.hasOwn(value as object, "activity") ? ["activity"] : []),
    ...(Object.hasOwn(value as object, "tokenUsage") ? ["tokenUsage"] : []),
    ...(Object.hasOwn(value as object, "resourceHistory") ? ["resourceHistory"] : []),
    ...(Object.hasOwn(value as object, "timeline") ? ["timeline"] : [])]);
  if (row.dispatchId !== dispatchId) return bad("ambiguous-ancestry");
  const budget = record(row.budget, ["tokenLimit", "source", "reason"]);
  let decodedBudget: AgentBudget;
  if (budget.tokenLimit === null && budget.source === "unavailable") decodedBudget = { tokenLimit: null, source: "unavailable", reason: reason(budget.reason) };
  else if ((budget.source === "issue-override" || budget.source === "route-default" || budget.source === "action-receipt") &&
    typeof budget.tokenLimit === "number" && Number.isSafeInteger(budget.tokenLimit) &&
    (budget.source === "action-receipt" ? budget.tokenLimit > 0 : budget.tokenLimit >= 0) && budget.reason === null) {
    decodedBudget = { tokenLimit: budget.tokenLimit, source: budget.source, reason: null };
  } else return bad();
  const quota = record(row.quotaRegime, ["value", "reason"]);
  let quotaRegime: AgentQuotaRegime;
  if (quota.value === null) quotaRegime = { value: null, reason: reason(quota.reason) };
  else if (["subscription", "metered", "local"].includes(quota.value as string) && quota.reason === null) {
    quotaRegime = { value: quota.value as "subscription" | "metered" | "local", reason: null };
  } else return bad();
  const locationRow = record(row.location, ["host", "container", "seat"]);
  const location: AgentTreeLocation = { host: placement(locationRow.host, capturedAt),
    container: placement(locationRow.container, capturedAt), seat: placement(locationRow.seat, capturedAt) };
  const live = record(row.liveness, ["state", "evidence", "observedAt", "reason"]);
  let liveness: AgentTreeLiveness;
  if (live.state === "unknown" && live.evidence === null && live.observedAt === null) liveness = { state: "unknown", evidence: null, observedAt: null, reason: reason(live.reason) };
  else if ((live.state === "running" || live.state === "idle") && live.evidence === "runtime-observation" && live.reason === null) liveness = { state: live.state, evidence: "runtime-observation", observedAt: stamp(live.observedAt), reason: null };
  else if (live.state === "ended" && (live.evidence === "native-outcome" || live.evidence === "stop-observation" || live.evidence === "teardown-observation") && live.reason === null) liveness = { state: "ended", evidence: live.evidence, observedAt: stamp(live.observedAt), reason: null };
  else return bad();
  if (liveness.observedAt !== null && liveness.observedAt > capturedAt) return bad();
  const actionRow = Object.hasOwn(row, "actionState") ? record(row.actionState, ["state", "observedAt", "reason"]) : null;
  let actionState: AgentActionState = { state: "unknown", observedAt: null, reason: "source_not_bound" };
  if (actionRow !== null) {
    if (actionRow.state === "unknown" && actionRow.observedAt === null) actionState = { state: "unknown", observedAt: null, reason: reason(actionRow.reason) };
    else if ((actionRow.state === "stopping" || actionRow.state === "stopped") && actionRow.reason === null) {
      actionState = { state: actionRow.state, observedAt: stamp(actionRow.observedAt), reason: null };
    } else return bad();
  }
  if (actionState.observedAt !== null && actionState.observedAt > capturedAt) return bad();
  const endedBy = Object.hasOwn(row, "endedBy") ? row.endedBy : null;
  if (endedBy !== null && endedBy !== "stop" && endedBy !== "timeout" && endedBy !== "teardown") return bad();
  if (actionState.state === "stopping" && liveness.state === "running") return bad();
  if (actionState.state === "stopped" && liveness.state === "running") return bad();
  if (liveness.state === "ended" && liveness.evidence === "stop-observation" && (actionState.state !== "stopped" || endedBy !== "stop")) return bad();
  if (endedBy === "stop" && (liveness.state !== "ended" || liveness.evidence !== "stop-observation")) return bad();
  if (liveness.state === "ended" && liveness.evidence === "teardown-observation" && endedBy !== "timeout" && endedBy !== "teardown") return bad();
  if ((endedBy === "timeout" || endedBy === "teardown") && (liveness.state !== "ended" || liveness.evidence !== "teardown-observation")) return bad();
  const terminal = record(row.terminalOutcome, ["value", "source", "observedAt", "reason"]);
  let terminalOutcome: AgentTerminalOutcome;
  if (terminal.value === null && terminal.source === "unavailable" && terminal.observedAt === null) {
    terminalOutcome = { value: null, source: "unavailable", observedAt: null, reason: reason(terminal.reason) };
  } else if (["succeeded", "failed", "cancelled"].includes(terminal.value as string) &&
    (terminal.source === "native-outcome" || ((terminal.source === "stop-observation" || terminal.source === "teardown-observation") && terminal.value === "cancelled")) && terminal.reason === null) {
    terminalOutcome = { value: terminal.value as "succeeded" | "failed" | "cancelled", source: terminal.source, observedAt: stamp(terminal.observedAt), reason: null };
  } else return bad();
  if (terminalOutcome.observedAt !== null && terminalOutcome.observedAt > capturedAt) return bad();
  if (liveness.state !== "ended" && terminalOutcome.value !== null) return bad();
  if (liveness.state === "ended" && liveness.evidence === "stop-observation" &&
    (terminalOutcome.value !== "cancelled" || terminalOutcome.source !== "stop-observation")) return bad();
  if (terminalOutcome.source === "stop-observation" && (liveness.state !== "ended" || liveness.evidence !== "stop-observation")) return bad();
  // A teardown ends the seat. The outcome is the teardown's cancellation, or (0.27.0) a native
  // success the agent completed at or before the teardown: it had finished and sat at its prompt.
  if (liveness.state === "ended" && liveness.evidence === "teardown-observation" &&
    !(terminalOutcome.value === "cancelled" && terminalOutcome.source === "teardown-observation") &&
    !(terminalOutcome.value === "succeeded" && terminalOutcome.source === "native-outcome" &&
      terminalOutcome.observedAt <= liveness.observedAt)) return bad();
  if (terminalOutcome.source === "teardown-observation" && (liveness.state !== "ended" || liveness.evidence !== "teardown-observation")) return bad();
  const startedAt = row.startedAt === null ? null : stamp(row.startedAt);
  const endedAt = row.endedAt === null ? null : stamp(row.endedAt);
  if ((startedAt !== null && startedAt > capturedAt) || (endedAt !== null && (startedAt === null || endedAt < startedAt || endedAt > capturedAt))) return bad();
  if (endedBy === "stop" && (endedAt === null || endedAt !== actionState.observedAt)) return bad();
  if ((endedBy === "timeout" || endedBy === "teardown") && (endedAt === null || endedAt !== liveness.observedAt)) return bad();
  const startedAtReason = startedAt === null ? reason(row.startedAtReason) : row.startedAtReason === null ? null : bad();
  const endedAtReason = endedAt === null ? reason(row.endedAtReason) : row.endedAtReason === null ? null : bad();
  const transcript = record(row.transcript, ["value", "reason"]);
  if (transcript.value !== null || transcript.reason !== "source_not_bound") return bad();
  const history = array(row.history, MAX_AGENT_HISTORY).map(event => {
    const h = record(event, ["dispatchId", "kind", "at"]);
    if (h.dispatchId !== dispatchId) return bad("ambiguous-ancestry");
    if (!AGENT_HISTORY_KINDS.includes(h.kind as AgentHistoryKind)) return bad();
    const at = stamp(h.at);
    if (at > capturedAt) return bad();
    return { dispatchId, kind: h.kind as AgentHistoryKind, at };
  });
  if (typeof row.historyTruncated !== "boolean" || (row.historyTruncated && history.length !== MAX_AGENT_HISTORY)) return bad();
  for (let i = 1; i < history.length; i++) {
    if (`${history[i - 1]!.at}\0${history[i - 1]!.kind}` >= `${history[i]!.at}\0${history[i]!.kind}`) return bad();
  }
  const router = valueRow(row.router);
  if (router.value !== null && router.source !== "dispatch") return bad();
  const routePolicy = Object.hasOwn(row, "routePolicy") ? policyRow(row.routePolicy)
    : { value: null, digest: null, source: "unavailable", reason: "source_not_bound" } as const;
  const hasProfileRevision = Object.hasOwn(row, "profileRevision");
  const hasMatrixRevision = Object.hasOwn(row, "matrixRevision");
  if (hasProfileRevision !== hasMatrixRevision) return bad();
  const profileRevision = hasProfileRevision ? launchRevisionRow(row.profileRevision) : undefined;
  const matrixRevision = hasMatrixRevision ? launchRevisionRow(row.matrixRevision) : undefined;
  const effort = Object.hasOwn(row, "effort") ? valueRow(row.effort) : undefined;
  if (effort?.value !== null && effort?.value !== undefined &&
      (effort.source !== "dispatch" || !AGENT_EFFORTS.includes(effort.value as typeof AGENT_EFFORTS[number]))) return bad();
  const parentAgentId = Object.hasOwn(row, "parentAgentId") ? row.parentAgentId : undefined;
  if (parentAgentId !== undefined && parentAgentId !== null &&
      (typeof parentAgentId !== "string" || !/^agent_[a-f0-9]{64}$/.test(parentAgentId))) return bad();
  const nativeDepth = Object.hasOwn(row, "nativeDepth") ? depthRow(row.nativeDepth)
    : { value: null, source: "unavailable", reason: "source_not_bound" } as const;
  const timeline = Object.hasOwn(row, "timeline") ? timelineRow(row.timeline, capturedAt) : undefined;
  for (const event of timeline?.events ?? []) {
    if (event.kind !== "ended" || event.reason === undefined) continue;
    const expected = endedBy ?? (terminalOutcome.value === "succeeded" ? "native-complete"
      : terminalOutcome.value === "failed" ? "native-error"
        : terminalOutcome.value === "cancelled" ? "native-cancelled" : null);
    if (event.reason !== expected || event.outcome !== terminalOutcome.value ||
        (endedBy === null && terminalOutcome.source !== "native-outcome")) return bad();
  }
  const tokenUsage = Object.hasOwn(row, "tokenUsage")
    ? tokenUsageRow(row.tokenUsage, capturedAt, decodedBudget.tokenLimit) : undefined;
  const resourceHistory = Object.hasOwn(row, "resourceHistory")
    ? resourceHistoryRow(row.resourceHistory, capturedAt, parentAgentId === null, decodedBudget, tokenUsage) : undefined;
  const harness = valueRow(row.harness), provider = valueRow(row.provider);
  return { dispatchId, observation: row.observation, harness, provider,
    router, routePolicy, model: valueRow(row.model, harness.value === "opencode" ? { provider: provider.value } : undefined),
    ...(profileRevision === undefined ? {} : { profileRevision, matrixRevision: matrixRevision! }),
    ...(effort === undefined ? {} : { effort }),
    ...(parentAgentId === undefined ? {} : { parentAgentId: parentAgentId as string | null }),
    location, budget: decodedBudget, nativeDepth,
    quotaRegime, liveness, actionState, endedBy, terminalOutcome, startedAt, startedAtReason, endedAt, endedAtReason,
    transcript: { value: null, reason: "source_not_bound" }, history, historyTruncated: row.historyTruncated,
    ...(Object.hasOwn(row, "activity") ? { activity: readAgentActivity(row.activity, capturedAt) } : {}),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(resourceHistory === undefined ? {} : { resourceHistory }),
    ...(timeline === undefined ? {} : { timeline }) };
}
