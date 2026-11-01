/** Strict per-field row decoders shared by the issue-agent tree reader; internal to this package. */
import { AGENT_UNAVAILABLE_REASONS, type AgentUnavailableReason } from "./agent-observations.js";
import { publicOpenCodeModel } from "./opencode-identity.js";
import { MAX_AGENT_RESOURCE_POINTS, MAX_AGENT_ACTIVITY_STEPS, MAX_AGENT_TIMELINE_EVENTS, publicActivityText,
  publicActivityTarget, type AgentTreeValue, type AgentLaunchRevision, type AgentBudget,
  type AgentNativeDepth, type AgentRoutePolicy, type AgentPlacementValue, type AgentActivityStep,
  type AgentActivity, type AgentTokenUsage, type AgentBudgetPoint, type AgentTokenHistory,
  type AgentBudgetHistory, type AgentResourceHistory, AGENT_ACTION_ACCEPTED_REASONS, type AgentActionKind,
  AGENT_ACTION_REJECTED_REASONS, type AgentTimelineReason, type AgentTimelineEvent, type AgentTimeline,
  type IssueAgentTreeReading } from "./issue-agent-tree-shapes.js";

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
export function label(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) return bad();
  return value;
}
export function reason(value: unknown): AgentUnavailableReason {
  if (typeof value !== "string" || !AGENT_UNAVAILABLE_REASONS.includes(value as AgentUnavailableReason)) return bad();
  return value as AgentUnavailableReason;
}
export function valueRow(value: unknown, model?: { provider: string | null }): AgentTreeValue {
  const row = record(value, ["value", "source", "reason"]);
  if (row.source === "unavailable" && row.value === null) return { value: null, source: "unavailable", reason: reason(row.reason) };
  if ((row.source !== "dispatch" && row.source !== "native") || row.reason !== null) return bad();
  if (model !== undefined && !publicOpenCodeModel(row.value, model.provider)) return bad();
  return { value: model === undefined ? label(row.value) : row.value as string, source: row.source, reason: null };
}
export function launchRevisionRow(value: unknown): AgentLaunchRevision {
  const row = record(value, ["value", "scope", "source", "reason"]);
  if (row.scope !== "root-dispatch") return bad();
  if (row.source === "unavailable" && row.value === null) return {
    value: null, scope: "root-dispatch", source: "unavailable", reason: reason(row.reason),
  };
  if (row.source !== "dispatch" || row.reason !== null ||
      typeof row.value !== "string" || !/^[a-f0-9]{40}$/.test(row.value)) return bad();
  return { value: row.value, scope: "root-dispatch", source: "dispatch", reason: null };
}
export function depthRow(value: unknown): AgentNativeDepth {
  const row = record(value, ["value", "source", "reason"]);
  if (row.value === null && row.source === "unavailable") {
    return { value: null, source: "unavailable", reason: reason(row.reason) };
  }
  if (row.source !== "native" || row.reason !== null || typeof row.value !== "number" ||
      !Number.isSafeInteger(row.value) || row.value < 1) return bad();
  return { value: row.value, source: "native", reason: null };
}
export function policyRow(value: unknown): AgentRoutePolicy {
  const row = record(value, ["value", "digest", "source", "reason"]);
  if (row.value === null && row.digest === null && row.source === "unavailable") {
    return { value: null, digest: null, source: "unavailable", reason: reason(row.reason) };
  }
  if ((row.value !== "netscript-matrix" && row.value !== "harness-matrix") || row.source !== "dispatch" || row.reason !== null ||
      typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)) return bad();
  return { value: row.value, digest: row.digest, source: "dispatch", reason: null };
}
export function placement(value: unknown, capturedAt: string): AgentPlacementValue {
  const row = record(value, ["value", "basis", "observedAt", "reason"]);
  if (row.value === null && row.basis === "unavailable" && row.observedAt === null) {
    return { value: null, basis: "unavailable", observedAt: null, reason: reason(row.reason) };
  }
  if ((row.basis !== "placement" && row.basis !== "runtime") || row.reason !== null) return bad();
  const observedAt = stamp(row.observedAt);
  if (observedAt > capturedAt) return bad();
  return { value: label(row.value), basis: row.basis, observedAt, reason: null };
}
export function activityRow(value: unknown, capturedAt: string): AgentActivity {
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
      ...(Object.hasOwn(value as object, "target") ? ["target"] : [])]);
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
      ...(Object.hasOwn(s, "target") ? { target: target ?? null } : {}) };
  });
  for (let i = 1; i < decoded.length; i++) if (decoded[i - 1]!.at < decoded[i]!.at) return bad();
  return { availability: "available", reason: null, observedAt, steps: decoded };
}
export function tokenUsageRow(value: unknown, capturedAt: string, budgetTokens: number | null): AgentTokenUsage {
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
export function resourceHistoryRow(value: unknown, capturedAt: string, root: boolean,
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
export function timelineRow(value: unknown, capturedAt: string): AgentTimeline {
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
