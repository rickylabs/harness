import { createHash } from "node:crypto";
import type { CodexField, CodexGoalObservation, CodexGoalStatus, CodexReadReason, CodexThreadObservation, CodexThreadSnapshot } from "@rickylabs/harness-contracts";
export const object = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
export const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 65536 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
export const available = <T>(value: T): CodexField<T> => ({ availability: "available", value, reason: null });
export const unavailable = <T>(reason: CodexReadReason): CodexField<T> => ({ availability: "unavailable", value: null, reason });
// Same namespace as native child observations in agent-observations.ts. No reverse lookup.
export const publicThreadId = (id: string): string => "agent_" + createHash("sha256").update("agent\0codex\0" + id).digest("hex");
function stringField(v: unknown): CodexField<string> {
  return v === null || v === undefined ? unavailable("field_absent") : text(v) ? available(v) : unavailable("invalid_field");
}
function sensitive(v: unknown, include: boolean): CodexField<string> {
  return include ? stringField(v) : unavailable("redacted");
}
function counter(v: unknown, absent: CodexReadReason = "field_absent"): CodexField<number> {
  return v === null || v === undefined ? unavailable(absent)
    : Number.isSafeInteger(v) && (v as number) >= 0 ? available(v as number) : unavailable("invalid_field");
}
export function missingGoal(reason: CodexReadReason): CodexGoalObservation {
  return { goalObjective: unavailable(reason), goalStatus: unavailable(reason), tokenBudget: unavailable(reason),
    tokensUsed: unavailable(reason), secondsUsed: unavailable(reason), goalUpdatedAt: unavailable(reason) };
}
export function projectGoal(raw: unknown, nativeId: string, includeSensitive: boolean): CodexGoalObservation {
  if (raw === null) return missingGoal("goal_absent");
  const g = object(raw);
  if (!g) return missingGoal("invalid_response");
  if (g.threadId !== nativeId) return missingGoal("identity_mismatch");
  const statuses: readonly unknown[] = ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"];
  const goalStatus: CodexField<CodexGoalStatus> = g.status === null || g.status === undefined ? unavailable("field_absent")
    : statuses.includes(g.status) ? available(g.status as CodexGoalStatus) : unavailable("invalid_field");
  return { goalObjective: sensitive(g.objective, includeSensitive), goalStatus,
    tokenBudget: counter(g.tokenBudget, "budget_unset"), tokensUsed: counter(g.tokensUsed),
    secondsUsed: counter(g.timeUsedSeconds), goalUpdatedAt: counter(g.updatedAt) };
}
export function projectThread(t: Record<string, unknown>, goal: CodexGoalObservation, includeSensitive: boolean): CodexThreadObservation {
  const git = object(t.gitInfo), state = object(t.status)?.type;
  const known = state === "notLoaded" || state === "idle" || state === "systemError" || state === "active";
  return { threadId: publicThreadId(t.id as string),
    parentThreadId: t.parentThreadId === null || t.parentThreadId === undefined ? unavailable("ancestry_unavailable")
      : text(t.parentThreadId) ? available(publicThreadId(t.parentThreadId)) : unavailable("invalid_field"),
    cwd: sensitive(t.cwd, includeSensitive), gitBranch: stringField(git?.branch), gitOrigin: sensitive(git?.originUrl, includeSensitive),
    provider: stringField(t.modelProvider), model: stringField(t.model), effort: stringField(t.reasoningEffort),
    status: known ? available(state) : unavailable(state === undefined ? "field_absent" : "invalid_field"),
    running: state === "active" ? available(true) : state === "idle" ? available(false) : unavailable("runtime_unavailable"),
    routeBasis: "configured-or-persisted", ...goal };
}
/** Public evidence allowlist. Never spreads source values, identifiers, paths, objective or amounts. */
export function codexThreadEvidence(snapshot: CodexThreadSnapshot): unknown {
  const fields = ["parentThreadId", "cwd", "gitBranch", "gitOrigin", "provider", "model", "effort", "status", "running",
    "goalObjective", "goalStatus", "tokenBudget", "tokensUsed", "secondsUsed", "goalUpdatedAt"] as const;
  return { schema: 1, complete: snapshot.complete, reason: snapshot.reason, rowCount: snapshot.rows.length,
    fields: Object.fromEntries(fields.map(key => [key, { available: snapshot.rows.filter(r => r[key].availability === "available").length,
      unavailable: snapshot.rows.filter(r => r[key].availability === "unavailable").length,
      reasons: [...new Set(snapshot.rows.flatMap(r => r[key].reason === null ? [] : [r[key].reason]))].sort(),
      reasonCounts: Object.fromEntries([...new Set(snapshot.rows.flatMap(r => r[key].reason === null ? [] : [r[key].reason]))].sort().map(reason => [reason, snapshot.rows.filter(r => r[key].reason === reason).length])) }])) };
}
