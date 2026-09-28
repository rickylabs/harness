/** Per-issue dispatch trees. Every identity here is opaque; no native session key or path is public. */
import { readAgentObservations, MAX_AGENT_OBSERVATIONS, AGENT_UNAVAILABLE_REASONS, type AgentObservation,
  type AgentObservations, type AgentUnavailableReason } from "./agent-observations.js";
import type { RepoRef } from "./snapshot.js";

export const ISSUE_AGENT_TREE_SCHEMA = 1 as const;
export const ISSUE_AGENT_TREE_FRESH_MS = 15_000;
export const MAX_ISSUE_AGENT_TREE_BYTES = 2_097_152;
export const MAX_AGENT_HISTORY = 16;
export const MAX_AGENT_ACTIVITY_STEPS = 20;
export const MAX_AGENT_TIMELINE_EVENTS = 32;
/** One canonical screen for producer prose and its public snapshot decoder. */
export function publicActivityText(value: unknown): string | null {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) return null;
  const candidate = value.trim();
  const fixedDottedTool = candidate === "Used functions.exec" || candidate === "Used functions.update_plan";
  if (candidate.length < 3 || candidate.length > 120 ||
      !/^[A-Za-z0-9][A-Za-z0-9 .,;:!?()'_-]*$/.test(candidate) ||
      /(?:secret|password|credential|private|bearer|token|api.?key|github_pat_|gh[pousr]_|\bsk-[A-Za-z0-9]{12,})/i.test(candidate) ||
      /(?:\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[a-f0-9]{24,}\b|[A-Za-z0-9_-]{32,})/i.test(candidate) ||
      (!fixedDottedTool && /\b[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+\b/i.test(candidate)) ||
      /\b(?:recovery|backup|verification|one[- ]time|otp|mfa|2fa|passcode|pin)\b/i.test(candidate) ||
      /\b(?:code|key)\s+[A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/i.test(candidate) ||
      /\b\d{6,8}\b|\b\d{3}(?:[ -]\d{3})+\b|\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/.test(candidate)) return null;
  return candidate;
}
export const AGENT_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type AgentActivityTargetKind = "command" | "file" | "search";
/** Reject the whole target when it does not pass the same public prose screen. */
export function publicActivityTarget(kind: AgentActivityTargetKind, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 120 || value !== value.trim()) return null;
  if (kind === "file") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value) || value.includes("..")) return null;
    return publicActivityText(value.replace(/[._-]+/g, " ")) === null ? null : value;
  }
  if (kind === "command" && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}(?: [A-Za-z0-9][A-Za-z0-9_.-]{0,31})?$/.test(value)) return null;
  return publicActivityText(value) === value ? value : null;
}
export const AGENT_HISTORY_KINDS = ["dispatch-observed", "run-started-observed", "run-activity-observed", "stop-seat-observed", "stop-process-observed", "teardown-seat-observed", "teardown-process-observed"] as const;
export type AgentHistoryKind = typeof AGENT_HISTORY_KINDS[number];
export interface AgentHistoryEvent { readonly dispatchId: string; readonly kind: AgentHistoryKind; readonly at: string }
export type AgentTreeValueSource = "dispatch" | "native" | "unavailable";
export type AgentTreeValue =
  | { readonly value: string; readonly source: "dispatch" | "native"; readonly reason: null }
  | { readonly value: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
/** Pins the root dispatch context; on a child this does not claim the child loaded that profile. */
export type AgentLaunchRevision =
  | { readonly value: string; readonly scope: "root-dispatch"; readonly source: "dispatch"; readonly reason: null }
  | { readonly value: null; readonly scope: "root-dispatch"; readonly source: "unavailable";
      readonly reason: AgentUnavailableReason };
export type AgentBudget =
  | { readonly tokenLimit: number; readonly source: "issue-override" | "route-default" | "action-receipt"; readonly reason: null }
  | { readonly tokenLimit: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentNativeDepth =
  | { readonly value: number; readonly source: "native"; readonly reason: null }
  | { readonly value: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentRoutePolicy =
  | { readonly value: "netscript-matrix"; readonly digest: string; readonly source: "dispatch"; readonly reason: null }
  | { readonly value: null; readonly digest: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentQuotaRegime =
  | { readonly value: "subscription" | "metered" | "local"; readonly reason: null }
  | { readonly value: null; readonly reason: AgentUnavailableReason };
export type AgentTreeLiveness =
  | { readonly state: "unknown"; readonly evidence: null; readonly observedAt: null; readonly reason: AgentUnavailableReason }
  | { readonly state: "running"; readonly evidence: "runtime-observation"; readonly observedAt: string; readonly reason: null }
  | { readonly state: "ended"; readonly evidence: "native-outcome" | "stop-observation" | "teardown-observation"; readonly observedAt: string; readonly reason: null };
export type AgentActionState =
  | { readonly state: "unknown"; readonly observedAt: null; readonly reason: AgentUnavailableReason }
  | { readonly state: "stopping" | "stopped"; readonly observedAt: string; readonly reason: null };
export type AgentPlacementValue =
  | { readonly value: string; readonly basis: "placement" | "runtime"; readonly observedAt: string; readonly reason: null }
  | { readonly value: null; readonly basis: "unavailable"; readonly observedAt: null; readonly reason: AgentUnavailableReason };
export interface AgentTreeLocation {
  readonly host: AgentPlacementValue;
  readonly container: AgentPlacementValue;
  readonly seat: AgentPlacementValue;
}
export type AgentTerminalOutcome =
  | { readonly value: "succeeded" | "failed" | "cancelled"; readonly source: "native-outcome" | "stop-observation" | "teardown-observation"; readonly observedAt: string; readonly reason: null }
  | { readonly value: null; readonly source: "unavailable"; readonly observedAt: null; readonly reason: AgentUnavailableReason };

/** Public-safe, bounded descriptions of the bound native agent's recent work. */
export interface AgentActivityStep {
  readonly id: string;
  readonly at: string;
  readonly kind: "tool" | "command" | "file" | "message";
  readonly toolName: string | null;
  readonly commandHead: string | null;
  /** Repository-relative only; an absolute native path is never published. */
  readonly filePath: string | null;
  readonly summary: string | null;
  /** Additive in the next contracts minor; a screened, tool-specific display target. */
  readonly target?: { readonly kind: AgentActivityTargetKind; readonly value: string } | null;
  readonly source: "codex-rollout" | "claude-transcript";
}
export type AgentActivity =
  | { readonly availability: "available"; readonly reason: null; readonly observedAt: string;
      readonly steps: readonly AgentActivityStep[] }
  | { readonly availability: "unavailable"; readonly reason: AgentUnavailableReason; readonly observedAt: null;
      readonly steps: readonly [] };
/** Input + output is the total; reasoning and cache counts are subsets. */
export type AgentTokenUsage =
  | { readonly usedTokens: number; readonly budgetTokens: number | null; readonly observedAt: string;
      readonly source: "codex-token-count" | "claude-usage"; readonly reason: null }
  | { readonly usedTokens: null; readonly budgetTokens: number | null; readonly observedAt: null;
      readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export const AGENT_ACTION_ACCEPTED_REASONS = {
  stop: "workspace_close_delivered", steer: "prompt_delivered", send: "prompt_delivered",
  raise_budget: "goal_budget_updated", retry: "retry_dispatched",
} as const;
export type AgentActionKind = keyof typeof AGENT_ACTION_ACCEPTED_REASONS;
export const AGENT_ACTION_REJECTED_REASONS = ["digest_conflict", "request_invalid", "payload_invalid", "action_invalid",
  "repository_mismatch", "identity_mismatch", "agent_not_stoppable", "agent_not_running", "agent_not_live",
  "retry_requires_terminal_successor_contract", "goal_not_raiseable", "budget_ceiling_unset", "budget_ceiling_exceeded",
  "budget_not_increased", "retry_unavailable", "retry_issue_unavailable", "retry_target_unavailable",
  "retry_pins_unavailable", "retry_terminal_unproven", "retry_in_flight", "retry_preflight_unavailable",
  "dispatch_lookup_limit", "dispatch_receipt_unavailable"] as const;
export type AgentTimelineReason = typeof AGENT_ACTION_ACCEPTED_REASONS[AgentActionKind] |
  typeof AGENT_ACTION_REJECTED_REASONS[number] | "native-complete" | "native-error" | "native-cancelled" |
  "stop" | "timeout" | "teardown";
export interface AgentTimelineEvent {
  readonly id: string;
  readonly at: string;
  readonly kind: "dispatched" | "started" | "subagent-spawned" | "goal-updated" | "goal-complete" |
    "action-accepted" | "action-rejected" | "ended";
  readonly action: AgentActionKind | null;
  readonly relatedAgentId: string | null;
  readonly source: "dispatch" | "native" | "goal" | "action-receipt" | "terminal";
  readonly outcome: "succeeded" | "failed" | "cancelled" | null;
  /** Additive in 0.12; a closed code from the receipt or verified terminal observation. */
  readonly reason?: AgentTimelineReason | null;
}
export interface AgentTimeline { readonly events: readonly AgentTimelineEvent[]; readonly truncated: boolean }

export interface IssueAgentTreeAgent {
  /** Equals both enclosing dispatchId and observation.assignment.id. */
  readonly dispatchId: string;
  /** Existing validated ancestry, location, route and separate cost rows. */
  readonly observation: AgentObservation;
  readonly harness: AgentTreeValue;
  readonly provider: AgentTreeValue;
  /** Actual request gateway, evidenced by the bound dispatch transport or inherited ancestry. */
  readonly router: AgentTreeValue;
  /** Matrix policy is separate from the gateway; its digest comes from a bound receipt. */
  readonly routePolicy: AgentRoutePolicy;
  /** Additive in 0.15: exact pinned target-repo commit, scoped to this root dispatch. */
  readonly profileRevision?: AgentLaunchRevision;
  /** Additive in 0.15: exact pinned NetScript matrix commit, scoped to this root dispatch. */
  readonly matrixRevision?: AgentLaunchRevision;
  readonly model: AgentTreeValue;
  /** Additive: request effort for this exact agent; never inherited by a child. */
  readonly effort?: AgentTreeValue;
  /** Additive: verified opaque parent identity, null for a confirmed root. */
  readonly parentAgentId?: string | null;
  readonly location: AgentTreeLocation;
  readonly budget: AgentBudget;
  /** A child's measured native spawn depth; roots and legacy frames remain unavailable. */
  readonly nativeDepth: AgentNativeDepth;
  readonly quotaRegime: AgentQuotaRegime;
  readonly liveness: AgentTreeLiveness;
  /** A stop remains separate from native liveness until both seat and process absence are verified. */
  readonly actionState: AgentActionState;
  readonly endedBy: "stop" | "timeout" | "teardown" | null;
  readonly terminalOutcome: AgentTerminalOutcome;
  readonly startedAt: string | null;
  readonly startedAtReason: AgentUnavailableReason | null;
  /** Last activity is never treated as an end timestamp. */
  readonly endedAt: string | null;
  readonly endedAtReason: AgentUnavailableReason | null;
  /** No sanitized excerpt source exists yet. */
  readonly transcript: { readonly value: null; readonly reason: "source_not_bound" };
  readonly history: readonly AgentHistoryEvent[];
  readonly historyTruncated: boolean;
  /** Additive in contracts 0.11; absent on earlier producers. */
  readonly activity?: AgentActivity;
  readonly tokenUsage?: AgentTokenUsage;
  readonly timeline?: AgentTimeline;
}
export interface IssueAgentTreeDispatch {
  readonly dispatchId: string;
  readonly agents: readonly IssueAgentTreeAgent[];
}
/** Closed Orchid pre-launch refusals. Inconclusive post-launch outcomes are excluded. */
export const ISSUE_LAUNCH_REFUSAL_REASONS = [
  "goal-budget-invalid", "goal-objective-invalid", "codex-effort-invalid", "receipt-owner-invalid",
  "source-missing", "source-invalid", "revision-invalid", "receipt-root-invalid", "target-revision-invalid",
  "issue-invalid", "issue-identity-missing", "brief-routing-invalid", "grant-conflict", "pin-invalid",
  "profile-invalid", "profile-unavailable", "override-worklog-unavailable", "authorization-required",
  "authorization-invalid", "override-required", "override-invalid", "route-unavailable", "routing-invalid",
  "resolution-failed", "quota-unavailable", "harness-conflict", "router-unsupported", "host-unavailable",
  "receipt-persistence-failed", "dispatch-persistence-failed",
] as const;
export type IssueLaunchRefusalReason = typeof ISSUE_LAUNCH_REFUSAL_REASONS[number];
export interface IssueLaunchRefusal {
  readonly state: "refused";
  readonly reason: IssueLaunchRefusalReason;
  readonly at: string;
  readonly dispatchId: string;
  readonly source: "orchid";
}
export interface IssueAgentTree {
  readonly repo: RepoRef;
  readonly issueNumber: number;
  /** A failed issue is retained with a typed reason and no unverified tree prefix. */
  readonly complete: boolean;
  readonly reason: AgentObservations["reason"];
  readonly dispatches: readonly IssueAgentTreeDispatch[];
  /** Additive in 0.14: a verified issue-level refusal needs no agent row. */
  readonly launchRefusal?: IssueLaunchRefusal;
}
export interface IssueAgentTreeSnapshot {
  readonly schema: 1;
  readonly protocol: 1;
  readonly observedAt: string;
  /** A stopped 5-second producer is stale after 15 seconds. */
  readonly validUntil: string;
  readonly revision: string;
  /** Dispatch/native ancestry coverage, not a claim that every optional field is observed. */
  readonly complete: boolean;
  readonly reason: AgentObservations["reason"];
  readonly issues: readonly IssueAgentTree[];
}
/** A restarted producer chooses a new generation and begins at sequence zero with a full snapshot. */
export interface IssueAgentTreeFrame {
  readonly type: "snapshot";
  readonly generation: string;
  readonly sequence: number;
  readonly snapshot: IssueAgentTreeSnapshot;
}
export type IssueAgentTreeReading =
  | { readonly ok: true; readonly snapshot: IssueAgentTreeSnapshot }
  | { readonly ok: false; readonly reason: "invalid" | "oversized" | "ambiguous-ancestry" | "unsupported-schema" };

class Invalid extends Error { constructor(readonly reason: Exclude<IssueAgentTreeReading, { ok: true }>["reason"] = "invalid") { super(reason); } }
const bad = (reason?: Invalid["reason"]): never => { throw new Invalid(reason); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
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
function array(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > cap) return bad(value instanceof Array && value.length > cap ? "oversized" : "invalid");
  if (Reflect.ownKeys(value).length !== value.length + 1) return bad();
  return Array.from({ length: value.length }, (_, i) => {
    const desc = Object.getOwnPropertyDescriptor(value, String(i));
    if (!desc || !("value" in desc) || !desc.enumerable) return bad();
    return desc.value;
  });
}
function stamp(value: unknown): string {
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
function valueRow(value: unknown): AgentTreeValue {
  const row = record(value, ["value", "source", "reason"]);
  if (row.source === "unavailable" && row.value === null) return { value: null, source: "unavailable", reason: reason(row.reason) };
  if ((row.source !== "dispatch" && row.source !== "native") || row.reason !== null) return bad();
  return { value: label(row.value), source: row.source, reason: null };
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
  if (row.value !== "netscript-matrix" || row.source !== "dispatch" || row.reason !== null ||
      typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)) return bad();
  return { value: "netscript-matrix", digest: row.digest, source: "dispatch", reason: null };
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
      ...(Object.hasOwn(value as object, "target") ? ["target"] : [])]);
    if (typeof s.id !== "string" || !/^step_[a-f0-9]{64}$/.test(s.id) || ids.has(s.id)) return bad();
    ids.add(s.id);
    const at = stamp(s.at);
    if (at > observedAt || !["tool", "command", "file", "message"].includes(s.kind as string) ||
        (s.source !== "codex-rollout" && s.source !== "claude-transcript")) return bad();
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
function agent(value: unknown, capturedAt: string, dispatchId: string): Omit<IssueAgentTreeAgent, "observation"> & { readonly observation: unknown } {
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
  else if (live.state === "running" && live.evidence === "runtime-observation" && live.reason === null) liveness = { state: "running", evidence: "runtime-observation", observedAt: stamp(live.observedAt), reason: null };
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
  if (liveness.state === "ended" && liveness.evidence === "teardown-observation" &&
    (terminalOutcome.value !== "cancelled" || terminalOutcome.source !== "teardown-observation")) return bad();
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
  return { dispatchId, observation: row.observation, harness: valueRow(row.harness), provider: valueRow(row.provider),
    router, routePolicy, model: valueRow(row.model),
    ...(profileRevision === undefined ? {} : { profileRevision, matrixRevision: matrixRevision! }),
    ...(effort === undefined ? {} : { effort }),
    ...(parentAgentId === undefined ? {} : { parentAgentId: parentAgentId as string | null }),
    location, budget: decodedBudget, nativeDepth,
    quotaRegime, liveness, actionState, endedBy, terminalOutcome, startedAt, startedAtReason, endedAt, endedAtReason,
    transcript: { value: null, reason: "source_not_bound" }, history, historyTruncated: row.historyTruncated,
    ...(Object.hasOwn(row, "activity") ? { activity: activityRow(row.activity, capturedAt) } : {}),
    ...(Object.hasOwn(row, "tokenUsage") ? { tokenUsage: tokenUsageRow(row.tokenUsage, capturedAt, decodedBudget.tokenLimit) } : {}),
    ...(timeline === undefined ? {} : { timeline }) };
}

/** Strictly decode grouped ancestry before a cockpit stores or renders it. */
export function readIssueAgentTreeSnapshot(input: unknown): IssueAgentTreeReading {
  try {
    const row = record(input, ["schema", "protocol", "observedAt", "validUntil", "revision", "complete", "reason", "issues"]);
    if (row.schema !== 1 || row.protocol !== 1) return bad("unsupported-schema");
    const observedAt = stamp(row.observedAt);
    const validUntil = stamp(row.validUntil);
    if (validUntil !== new Date(Date.parse(observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString()) return bad();
    if (typeof row.revision !== "string" || !/^[a-f0-9]{64}$/.test(row.revision) || typeof row.complete !== "boolean") return bad();
    if (row.complete ? row.reason !== null : !["source_not_bound", "source_unavailable", "binding_unavailable", "scan_limit", "ancestry_unavailable"].includes(row.reason as string)) return bad();
    const issues: IssueAgentTree[] = [];
    let agentCount = 0;
    const agentIds = new Set<string>();
    const issueKeys = new Set<string>();
    const legacyPartials = new Set<number>();
    for (const rawIssue of array(row.issues, MAX_AGENT_OBSERVATIONS)) {
      const legacy = !Object.hasOwn(rawIssue as object, "complete") && !Object.hasOwn(rawIssue as object, "reason");
      const hasRefusal = Object.hasOwn(rawIssue as object, "launchRefusal");
      const issue = record(rawIssue, legacy ? ["repo", "issueNumber", "dispatches"] :
        ["repo", "issueNumber", "complete", "reason", "dispatches", ...(hasRefusal ? ["launchRefusal"] : [])]);
      if (legacy && hasRefusal) return bad();
      const legacyPartial = legacy && !row.complete && row.reason === "ancestry_unavailable";
      const issueComplete = legacy ? !legacyPartial : issue.complete;
      const issueReason = legacyPartial ? "ancestry_unavailable" : legacy ? null : issue.reason;
      if (typeof issueComplete !== "boolean" || (issueComplete ? issueReason !== null :
          !["source_not_bound", "source_unavailable", "binding_unavailable", "scan_limit", "ancestry_unavailable"].includes(issueReason as string))) return bad();
      const repo = record(issue.repo, ["owner", "name"]);
      if (typeof repo.owner !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(repo.owner) || repo.owner.length > 39 ||
          typeof repo.name !== "string" || !/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/.test(repo.name) || repo.name.length > 100 ||
          typeof issue.issueNumber !== "number" || !Number.isSafeInteger(issue.issueNumber) || issue.issueNumber < 1) return bad();
      const issueKey = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}#${issue.issueNumber}`;
      if (issueKeys.has(issueKey)) return bad("ambiguous-ancestry");
      issueKeys.add(issueKey);
      let launchRefusal: IssueLaunchRefusal | undefined;
      if (hasRefusal) {
        const refusal = record(issue.launchRefusal, ["state", "reason", "at", "dispatchId", "source"]);
        if (refusal.state !== "refused" || refusal.source !== "orchid" ||
            !ISSUE_LAUNCH_REFUSAL_REASONS.includes(refusal.reason as IssueLaunchRefusalReason) ||
            typeof refusal.dispatchId !== "string" || !/^assignment_[a-f0-9]{64}$/.test(refusal.dispatchId)) return bad();
        const at = stamp(refusal.at);
        if (at > observedAt) return bad();
        launchRefusal = { state: "refused", reason: refusal.reason as IssueLaunchRefusalReason,
          at, dispatchId: refusal.dispatchId, source: "orchid" };
      }
      const dispatches: IssueAgentTreeDispatch[] = [];
      const dispatchIds = new Set<string>();
      for (const rawDispatch of array(issue.dispatches, MAX_AGENT_OBSERVATIONS)) {
        const dispatch = record(rawDispatch, ["dispatchId", "agents"]);
        if (typeof dispatch.dispatchId !== "string" || !/^assignment_[a-f0-9]{64}$/.test(dispatch.dispatchId) || dispatchIds.has(dispatch.dispatchId)) return bad("ambiguous-ancestry");
        dispatchIds.add(dispatch.dispatchId);
        const agents = array(dispatch.agents, MAX_AGENT_OBSERVATIONS).map(a => agent(a, observedAt, dispatch.dispatchId as string)) as IssueAgentTreeAgent[];
        if (agents.length === 0) return bad();
        for (const a of agents) {
          const observed = record(a.observation, ["agentId", "repo", "issueNumber", "assignment", "parentAgentId", "workspace", "tab", "pane", "terminal", "running", "route", "cost", "observedAt", "revision"].concat(
            Object.hasOwn(a.observation as object, "routeObservedReasons") ? ["routeObservedReasons"] : []));
          const assignment = record(observed.assignment, ["id", "dispatcher", "basis"]);
          const agentRepo = record(observed.repo, ["owner", "name"]);
          if (assignment.id !== dispatch.dispatchId || agentRepo.owner !== repo.owner || agentRepo.name !== repo.name || observed.issueNumber !== issue.issueNumber) return bad("ambiguous-ancestry");
          if (agentIds.has(a.observation.agentId)) return bad("ambiguous-ancestry");
          agentIds.add(a.observation.agentId);
          agentCount++;
        }
        dispatches.push({ dispatchId: dispatch.dispatchId, agents });
      }
      if (legacyPartial ? dispatches.length === 0 : issueComplete ? dispatches.length === 0 && launchRefusal === undefined : dispatches.length !== 0) return bad();
      if (legacyPartial) legacyPartials.add(issues.length);
      issues.push({ repo: { owner: repo.owner, name: repo.name }, issueNumber: issue.issueNumber,
        complete: issueComplete, reason: issueReason as IssueAgentTree["reason"], dispatches,
        ...(launchRefusal === undefined ? {} : { launchRefusal }) });
    }
    if (agentCount > MAX_AGENT_OBSERVATIONS) return bad("oversized");
    if (row.complete && issues.some(issue => !issue.complete)) return bad();
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      if (!issue.complete && !legacyPartials.has(i)) continue;
      const all = issue.dispatches.flatMap(dispatch => dispatch.agents);
      const base: AgentObservations = { schema: 1, protocol: 1, observedAt, revision: row.revision,
        complete: !legacyPartials.has(i), reason: legacyPartials.has(i) ? "ancestry_unavailable" : null,
        agents: all.map(a => a.observation) };
      const read = readAgentObservations(base);
      if (!read.ok) return bad(read.reason === "oversized" ? "oversized" : read.reason === "ambiguous-ancestry" ? "ambiguous-ancestry" : "invalid");
      const safe = new Map(read.observation.agents.map(a => [a.agentId, a]));
      const publicAgents = new Map(all.map(a => [a.observation.agentId, a]));
      for (const dispatch of issue.dispatches) {
        const root = dispatch.agents.find(a => safe.get(a.observation.agentId)?.parentAgentId.state === "confirmed-root");
        for (const a of dispatch.agents) {
          for (const field of ["profileRevision", "matrixRevision"] as const) {
            const pin = a[field];
            if (pin?.value !== null && pin !== undefined && root?.[field]?.value !== pin.value) return bad();
          }
        }
      }
      for (const a of all) {
        const capacity = safe.get(a.observation.agentId)?.cost.localCapacity;
        if (capacity?.availability === "available" && (a.location.host.value === null ||
          capacity.measurement.host !== a.location.host.value || capacity.validUntil === null || capacity.validUntil < validUntil)) return bad();
        const running = safe.get(a.observation.agentId)?.running;
        if (a.liveness.state === "running") {
          if (running?.value !== true || running.observedAt !== a.liveness.observedAt ||
              running.validUntil === null || running.validUntil < validUntil) return bad();
        } else if (running?.value === true) return bad();
        const parent = safe.get(a.observation.agentId)?.parentAgentId;
        if (a.parentAgentId !== undefined && a.parentAgentId !== (parent?.state === "known-parent" ? parent.value : null)) return bad();
        if (a.effort !== undefined) {
          const requested = parent?.state === "confirmed-root" ? safe.get(a.observation.agentId)?.route.requested.effort.value : null;
          const known = typeof requested === "string" && AGENT_EFFORTS.includes(requested as typeof AGENT_EFFORTS[number]);
          if (known ? a.effort.value !== requested || a.effort.source !== "dispatch"
            : a.effort.value !== null || a.effort.source !== "unavailable" ||
              a.effort.reason !== (requested === null ? "source_not_bound" : "binding_invalid")) return bad();
        }
        if (a.nativeDepth.value !== null && (parent?.state !== "known-parent" || a.harness.source !== "native")) return bad();
        if (parent?.state === "known-parent") {
          if (a.budget.tokenLimit !== null || a.provider.source === "dispatch" || a.model.source === "dispatch" ||
              a.harness.source === "dispatch" || a.routePolicy.value !== null) return bad();
          const parentRouter = publicAgents.get(parent.value)?.router;
          if (a.router.value !== null && (!parentRouter || parentRouter.value !== a.router.value || parentRouter.source !== "dispatch")) return bad();
        } else if (a.router.value !== null) {
          if (parent?.state !== "confirmed-root") return bad();
          if (a.harness.source !== "dispatch" || a.router.value !== "direct" ||
              (a.harness.value !== "codex" && a.harness.value !== "claude")) return bad();
        }
        if (a.routePolicy.value !== null && parent?.state !== "confirmed-root") return bad();
      }
      issues[i] = legacyPartials.has(i) ? { ...issue, dispatches: [] } :
        { ...issue, dispatches: issue.dispatches.map(dispatch => ({ ...dispatch,
          agents: dispatch.agents.map(a => ({ ...a, observation: safe.get(a.observation.agentId)! })) })) };
    }
    const snapshot: IssueAgentTreeSnapshot = { schema: 1, protocol: 1, observedAt, validUntil, revision: row.revision,
      complete: row.complete, reason: row.reason as IssueAgentTreeSnapshot["reason"], issues };
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_ISSUE_AGENT_TREE_BYTES) return bad("oversized");
    return { ok: true, snapshot };
  } catch (error) { return { ok: false, reason: error instanceof Invalid ? error.reason : "invalid" }; }
}
