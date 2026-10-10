/** Per-issue dispatch trees. Every identity here is opaque; no native session key or path is public. */
import type { AgentObservation, AgentObservations, AgentUnavailableReason } from "./agent-observations.js";
import type { RepoRef } from "./snapshot.js";

export const ISSUE_AGENT_TREE_SCHEMA = 1 as const;
/**
 * How long a produced issue-agent tree claims to hold. At the watch's 5-second cadence with 2-7 s
 * reads, 15 s left about 3 s of slack, and one slow read expired the tree for every reader. 30 s
 * is at least three times the effective cadence.
 */
export const ISSUE_AGENT_TREE_FRESH_MS = 30_000;
/**
 * The validity windows a reader accepts: the current one and the earlier 15-second one, so
 * readers can upgrade before producers do. Any other window is refused, as before.
 */
export const ISSUE_AGENT_TREE_ACCEPTED_FRESH_MS: readonly number[] = [15_000, ISSUE_AGENT_TREE_FRESH_MS];
export const MAX_ISSUE_AGENT_TREE_BYTES = 2_097_152;
export const MAX_AGENT_HISTORY = 16;
export const MAX_AGENT_RESOURCE_POINTS = 16;
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
  | { readonly value: "netscript-matrix" | "harness-matrix"; readonly digest: string; readonly source: "dispatch"; readonly reason: null }
  | { readonly value: null; readonly digest: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentQuotaRegime =
  | { readonly value: "subscription" | "metered" | "local"; readonly reason: null }
  | { readonly value: null; readonly reason: AgentUnavailableReason };
export type AgentTreeLiveness =
  | { readonly state: "unknown"; readonly evidence: null; readonly observedAt: null; readonly reason: AgentUnavailableReason }
  | { readonly state: "running"; readonly evidence: "runtime-observation"; readonly observedAt: string; readonly reason: null }
  /** Observed stopped at its prompt: not running, and not ended (it can be prompted again). */
  | { readonly state: "idle"; readonly evidence: "runtime-observation"; readonly observedAt: string; readonly reason: null }
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
  /** Additive in 0.41.0: a tool call's native lifecycle, when the vendor reports one; absent elsewhere. */
  readonly lifecycle?: AgentToolLifecycle | null;
  readonly source: "codex-rollout" | "claude-transcript" | "agy-transcript" | "opencode-transcript";
}
/**
 * A tool call's native lifecycle and the clocks the vendor reports for that state (0.41.0). A requested
 * call is `pending` with no clock: it has not run, so it carries no start and never an end.
 */
export type AgentToolLifecycle =
  | { readonly state: "pending"; readonly startedAt: null; readonly endedAt: null }
  | { readonly state: "running"; readonly startedAt: string; readonly endedAt: null }
  | { readonly state: "completed" | "error"; readonly startedAt: string; readonly endedAt: string };
export type AgentActivity =
  | { readonly availability: "available"; readonly reason: null; readonly observedAt: string;
      readonly steps: readonly AgentActivityStep[] }
  | { readonly availability: "unavailable"; readonly reason: AgentUnavailableReason; readonly observedAt: null;
      readonly steps: readonly [] };
/** The native counter a measured used-tokens figure came from, one per vendor that has one (0.41.0 adds OpenCode). */
export const AGENT_TOKEN_SOURCES = Object.freeze(["codex-token-count", "claude-usage", "opencode-usage"] as const);
export type AgentTokenSource = typeof AGENT_TOKEN_SOURCES[number];
/**
 * Processed input + output. Codex input already holds cached input and its reasoning is a subset of output.
 * Claude adds cache read and write. OpenCode adds cache read and write and its reasoning, which its native
 * output excludes.
 */
export type AgentTokenUsage =
  | { readonly usedTokens: number; readonly budgetTokens: number | null; readonly observedAt: string;
      readonly source: AgentTokenSource; readonly reason: null }
  | { readonly usedTokens: null; readonly budgetTokens: number | null; readonly observedAt: null;
      readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
/** Independent native cumulative samples and confirmed root budget changes; never an issue-wide sum. */
export interface AgentTokenPoint { readonly at: string; readonly usedTokens: number }
export interface AgentBudgetPoint {
  readonly at: string;
  readonly tokenLimit: number;
  readonly source: "route-default" | "issue-override" | "action-receipt";
}
export type AgentTokenHistory =
  | { readonly points: readonly AgentTokenPoint[]; readonly truncated: boolean;
      readonly source: AgentTokenSource; readonly reason: null }
  | { readonly points: readonly []; readonly truncated: false; readonly source: "unavailable";
      readonly reason: AgentUnavailableReason };
export type AgentBudgetHistory =
  | { readonly points: readonly AgentBudgetPoint[]; readonly truncated: boolean; readonly reason: null }
  | { readonly points: readonly []; readonly truncated: false; readonly reason: AgentUnavailableReason };
export interface AgentResourceHistory {
  readonly tokens: AgentTokenHistory;
  readonly budgets: AgentBudgetHistory;
}
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
  /** Additive: bounded native points and immutable budget effects; absent on older producers. */
  readonly resourceHistory?: AgentResourceHistory;
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
  "resolution-failed", "quota-unavailable", "budget-reached", "budget-unavailable", "harness-conflict", "router-unsupported", "host-unavailable",
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
/** Additive in 0.30: a post-launch block is independent of native ancestry coverage. */
export const ISSUE_LAUNCH_BLOCK_REASONS = ["goal-prompt-unconfirmed"] as const;
export type IssueLaunchBlockReason = typeof ISSUE_LAUNCH_BLOCK_REASONS[number];
export interface IssueLaunchBlock {
  readonly state: "blocked";
  readonly reason: IssueLaunchBlockReason;
  readonly at: string;
  readonly dispatchId: string;
  readonly source: "orchid";
}
export interface IssueAgentTree {
  readonly repo: RepoRef;
  readonly issueNumber: number;
  /**
   * A failed issue is retained with a typed reason and no unverified tree prefix. Since 0.37 a
   * bounded issue (`complete: false`, reason `scan_limit`) may carry the tree it did read: a closed,
   * verified tree from its roots, validated exactly like a complete one, whose extent was bounded.
   * Every other incomplete reason still carries no dispatches.
   */
  readonly complete: boolean;
  readonly reason: AgentObservations["reason"];
  readonly dispatches: readonly IssueAgentTreeDispatch[];
  /** Additive in 0.14: a verified issue-level refusal needs no agent row. */
  readonly launchRefusal?: IssueLaunchRefusal;
  /** An independently verified block survives incomplete ancestry; activity does not clear it. */
  readonly launchBlock?: IssueLaunchBlock;
}
export interface IssueAgentTreeSnapshot {
  readonly schema: 1;
  readonly protocol: 1;
  readonly observedAt: string;
  /** observedAt + ISSUE_AGENT_TREE_FRESH_MS: a stopped 5-second producer is stale after 30 seconds. */
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
