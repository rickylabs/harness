/** Strict row decoders for the issue-agent tree. Internal to the package; the public reader is issue-agent-tree-read.ts. */
import { AGENT_UNAVAILABLE_REASONS, type AgentUnavailableReason } from "./agent-observations.js";
import { publicOpenCodeModel } from "./opencode-identity.js";
import { AGENT_ACTION_ACCEPTED_REASONS, AGENT_ACTION_REJECTED_REASONS, AGENT_EFFORTS, AGENT_HISTORY_KINDS, AGENT_TOKEN_SOURCES,
  MAX_AGENT_ACTIVITY_STEPS, MAX_AGENT_HISTORY, MAX_AGENT_RESOURCE_POINTS, MAX_AGENT_TIMELINE_EVENTS,
  publicActivityTarget, publicActivityText,
  type AgentActionKind, type AgentActionState, type AgentActivity, type AgentActivityStep, type AgentBudget,
  type AgentBudgetHistory, type AgentBudgetPoint, type AgentHistoryKind, type AgentLaunchRevision, type AgentNativeDepth,
  type AgentPlacementValue, type AgentQuotaRegime, type AgentResourceHistory, type AgentRoutePolicy,
  type AgentTerminalOutcome, type AgentTimeline, type AgentTimelineEvent, type AgentTimelineReason, type AgentTokenHistory, type AgentToolLifecycle,
  type AgentTokenSource, type AgentTokenUsage, type AgentTreeLiveness, type AgentTreeLocation, type AgentTreeValue,
  type IssueAgentTreeAgent, type IssueAgentTreeReading } from "./issue-agent-tree.js";

export class Invalid extends Error { constructor(readonly reason: Exclude<IssueAgentTreeReading, { ok: true }>["reason"] = "invalid") { super(reason); } }
export const bad = (reason?: Invalid["reason"]): never => { throw new Invalid(reason); };
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return bad();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !own.includes(key))) return bad();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc) || !desc.enumerable) return bad();
    out[key] = desc.value;
  }
  return out;
}
export function array(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > cap) return bad(value instanceof Array && value.length > cap ? "oversized" : "invalid");
  if (Reflect.ownKeys(value).length !== value.length + 1) return bad();
  return Array.from({ length: value.length }, (_, i) => {
    const desc = Object.getOwnPropertyDescriptor(value, String(i));
    if (!desc || !("value" in desc) || !desc.enumerable) return bad();
    return desc.value;
  });
}
export function stamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return bad();
  return value;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) return bad();
  return value;
}
function reason(value: unknown): AgentUnavailableReason {
  if (typeof value !== "string" || !AGENT_UNAVAILABLE_REASONS.includes(value as AgentUnavailableReason)) return bad();
  return value as AgentUnavailableReason;
}
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
function activityRow(value: unknown, capturedAt: string): AgentActivity {
  const row = record(value, ["availability", "reason", "observedAt", "steps"]);
  const steps = array(row.steps, MAX_AGENT_ACTIVITY_STEPS);
  if (row.availability === "unavailable" && row.observedAt === null && steps.length === 0) {
    return { availability: "unavailable", reason: reason(row.reason), observedAt: null, steps: [] };
  }
  if (row.availability !== "available" || row.reason !== null) return bad();
  const observedAt = stamp(row.observedAt);
  if (observedAt > capturedAt) return bad();
  const ids = new Set<string>();
  const decoded = steps.map(value => {
    const s = record(value, ["id", "at", "kind", "toolName", "commandHead", "filePath", "summary", "source",
      ...["target", "lifecycle"].filter(key => Object.hasOwn(value as object, key))]);
    if (typeof s.id !== "string" || !/^step_[a-f0-9]{64}$/.test(s.id) || ids.has(s.id)) return bad();
    ids.add(s.id);
    const at = stamp(s.at);
    if (at > observedAt || !["tool", "command", "file", "message"].includes(s.kind as string) ||
        (s.source !== "codex-rollout" && s.source !== "claude-transcript" && s.source !== "agy-transcript" && s.source !== "opencode-transcript")) return bad();
    if (s.toolName !== null && (typeof s.toolName !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(s.toolName))) return bad();
    if (s.commandHead !== null && (typeof s.commandHead !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}(?: [A-Za-z0-9][A-Za-z0-9_.-]{0,31})?$/.test(s.commandHead))) return bad();
    if (s.filePath !== null && (typeof s.filePath !== "string" || s.filePath.length > 256 ||
        !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(s.filePath) ||
        s.filePath.split("/").some(part => part === "." || part === ".." ||
          publicActivityTarget("file", part) === null))) return bad();
    if (s.summary !== null && publicActivityText(s.summary) !== s.summary) return bad();
    let target: AgentActivityStep["target"];
    if (Object.hasOwn(s, "target")) {
      if (s.target === null) target = null;
      else {
        const t = record(s.target, ["kind", "value"]);
        if (t.kind !== "command" && t.kind !== "file" && t.kind !== "search") return bad();
        if (publicActivityTarget(t.kind, t.value) !== t.value) return bad();
        if (t.kind === "command" && (s.kind !== "command" || s.commandHead !== t.value)) return bad();
        if (t.kind === "file" && (s.kind !== "file" || typeof s.filePath !== "string" ||
          !["read_file", "write_file", "Read", "Edit", "Write", "NotebookEdit"].includes(s.toolName as string) ||
          s.filePath.split("/").at(-1) !== t.value)) return bad();
        if (t.kind === "search" && (s.toolName !== "Grep" && s.toolName !== "Glob")) return bad();
        target = { kind: t.kind, value: t.value as string };
      }
    }
    return { id: s.id, at, kind: s.kind as AgentActivityStep["kind"], toolName: s.toolName as string | null,
      commandHead: s.commandHead as string | null, filePath: s.filePath as string | null,
      summary: s.summary as string | null, source: s.source as AgentActivityStep["source"],
      ...(Object.hasOwn(s, "target") ? { target: target ?? null } : {}),
      ...(Object.hasOwn(s, "lifecycle") ? { lifecycle: lifecycleRow(s.lifecycle, observedAt) } : {}) };
  });
  for (let i = 1; i < decoded.length; i++) if (decoded[i - 1]!.at < decoded[i]!.at) return bad();
  return { availability: "available", reason: null, observedAt, steps: decoded };
}
/** A tool call's lifecycle: a pending call has no clock; a running one a start; a finished one both, in order. */
function lifecycleRow(value: unknown, observedAt: string): AgentToolLifecycle | null {
  if (value === null) return null;
  const row = record(value, ["state", "startedAt", "endedAt"]);
  if (row.state === "pending") {
    if (row.startedAt !== null || row.endedAt !== null) return bad();
    return { state: "pending", startedAt: null, endedAt: null };
  }
  if (row.state !== "running" && row.state !== "completed" && row.state !== "error") return bad();
  const startedAt = stamp(row.startedAt);
  if (startedAt > observedAt) return bad();
  if (row.state === "running") return row.endedAt === null ? { state: "running", startedAt, endedAt: null } : bad();
  const endedAt = stamp(row.endedAt);
  if (endedAt < startedAt || endedAt > observedAt) return bad();
  return { state: row.state === "error" ? "error" : "completed", startedAt, endedAt };
}
const tokenSource = (value: unknown): value is AgentTokenSource =>
  typeof value === "string" && (AGENT_TOKEN_SOURCES as readonly string[]).includes(value);
function tokenUsageRow(value: unknown, capturedAt: string, budgetTokens: number | null): AgentTokenUsage {
  const row = record(value, ["usedTokens", "budgetTokens", "observedAt", "source", "reason"]);
  if (row.budgetTokens !== budgetTokens) return bad();
  if (row.usedTokens === null && row.observedAt === null && row.source === "unavailable") {
    return { usedTokens: null, budgetTokens, observedAt: null, source: "unavailable", reason: reason(row.reason) };
  }
  if (typeof row.usedTokens !== "number" || !Number.isSafeInteger(row.usedTokens) || row.usedTokens < 0 ||
      !tokenSource(row.source) || row.reason !== null) return bad();
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
    if (!tokenSource(tokens.source) ||
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
    ...(Object.hasOwn(row, "activity") ? { activity: activityRow(row.activity, capturedAt) } : {}),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(resourceHistory === undefined ? {} : { resourceHistory }),
    ...(timeline === undefined ? {} : { timeline }) };
}
