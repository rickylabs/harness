/** Per-issue dispatch trees. Every identity here is opaque; no native session key or path is public. */
import { readAgentObservations, MAX_AGENT_OBSERVATIONS, type AgentObservation,
  type AgentObservations, type AgentUnavailableReason } from "./agent-observations.js";
import type { RepoRef } from "./snapshot.js";
import { AGENT_ACTIVITY_GAPS, AGENT_ACTIVITY_PROVENANCES, AGENT_ACTIVITY_STATES, type AgentActivity, type AgentActivityGap,
  type AgentActivityProvenance, type AgentActivityState, type AgentActivityStep } from "./agent-activity.js";
import { AGENT_ACTION_ACCEPTED_REASONS, AGENT_ACTION_REJECTED_REASONS, AGENT_EFFORTS, AGENT_HISTORY_KINDS } from "./issue-agent-tree-constants.js";
import { Invalid, array, bad, reason, record, stamp } from "./issue-agent-tree-decode.js";
import { agent } from "./issue-agent-tree-rows.js";

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
export const MAX_AGENT_ACTIVITY_STEPS = 20;
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

/** Processed input + output: Codex input already holds cached input; Claude adds cache read and write. Reasoning is a subset. */
export type AgentTokenUsage =
  | { readonly usedTokens: number; readonly budgetTokens: number | null; readonly observedAt: string;
      readonly source: "codex-token-count" | "claude-usage"; readonly reason: null }
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
      readonly source: "codex-token-count" | "claude-usage"; readonly reason: null }
  | { readonly points: readonly []; readonly truncated: false; readonly source: "unavailable";
      readonly reason: AgentUnavailableReason };
export type AgentBudgetHistory =
  | { readonly points: readonly AgentBudgetPoint[]; readonly truncated: boolean; readonly reason: null }
  | { readonly points: readonly []; readonly truncated: false; readonly reason: AgentUnavailableReason };
export interface AgentResourceHistory {
  readonly tokens: AgentTokenHistory;
  readonly budgets: AgentBudgetHistory;
}
export type AgentActionKind = keyof typeof AGENT_ACTION_ACCEPTED_REASONS;
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


/** Strictly decode one agent's activity, as the snapshot reader does for every agent. */
export function readAgentActivity(value: unknown, capturedAt: string): AgentActivity {
  const hasCoverage = Object.hasOwn(value as object, "coverage");
  const row = record(value, ["availability", "reason", "observedAt", "steps", ...(hasCoverage ? ["coverage"] : [])]);
  const steps = array(row.steps, MAX_AGENT_ACTIVITY_STEPS);
  if (row.availability === "unavailable" && row.observedAt === null && steps.length === 0 && !hasCoverage) {
    return { availability: "unavailable", reason: reason(row.reason), observedAt: null, steps: [] };
  }
  if (row.availability !== "available" || row.reason !== null) return bad();
  const observedAt = stamp(row.observedAt);
  if (observedAt > capturedAt) return bad();
  const ids = new Set<string>();
  const decoded = steps.map(value => {
    const s = record(value, ["id", "at", "kind", "toolName", "commandHead", "filePath", "summary", "source",
      ...(Object.hasOwn(value as object, "target") ? ["target"] : []),
      ...(Object.hasOwn(value as object, "state") ? ["state"] : []),
      ...(Object.hasOwn(value as object, "provenance") ? ["provenance"] : [])]);
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
    if (Object.hasOwn(s, "state") && (s.kind === "message" ||
        !AGENT_ACTIVITY_STATES.includes(s.state as AgentActivityState))) return bad();
    // A requested call is a plan, not an execution: it never carries a native end.
    if (Object.hasOwn(s, "provenance") && (s.kind === "message" ||
        !AGENT_ACTIVITY_PROVENANCES.includes(s.provenance as AgentActivityProvenance) ||
        s.provenance === "requested" && Object.hasOwn(s, "state") && s.state !== "unknown")) return bad();
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
      ...(Object.hasOwn(s, "state") ? { state: s.state as AgentActivityState } : {}),
      ...(Object.hasOwn(s, "provenance") ? { provenance: s.provenance as AgentActivityProvenance } : {}) };
  });
  for (let i = 1; i < decoded.length; i++) if (decoded[i - 1]!.at < decoded[i]!.at) return bad();
  if (!hasCoverage) return { availability: "available", reason: null, observedAt, steps: decoded };
  const coverage = record(row.coverage, ["gaps"]);
  const gaps = array(coverage.gaps, AGENT_ACTIVITY_GAPS.length).map(gap =>
    AGENT_ACTIVITY_GAPS.includes(gap as AgentActivityGap) ? gap as AgentActivityGap : bad());
  // Unique and canonical, so equal coverage always serializes (and revisions) identically.
  for (let i = 1; i < gaps.length; i++) {
    if (AGENT_ACTIVITY_GAPS.indexOf(gaps[i - 1]!) >= AGENT_ACTIVITY_GAPS.indexOf(gaps[i]!)) return bad();
  }
  return { availability: "available", reason: null, observedAt, steps: decoded, coverage: { gaps } };
}

/** Strictly decode grouped ancestry before a cockpit stores or renders it. */
export function readIssueAgentTreeSnapshot(input: unknown): IssueAgentTreeReading {
  try {
    const row = record(input, ["schema", "protocol", "observedAt", "validUntil", "revision", "complete", "reason", "issues"]);
    if (row.schema !== 1 || row.protocol !== 1) return bad("unsupported-schema");
    const observedAt = stamp(row.observedAt);
    const validUntil = stamp(row.validUntil);
    if (!ISSUE_AGENT_TREE_ACCEPTED_FRESH_MS.some((ms) =>
      validUntil === new Date(Date.parse(observedAt) + ms).toISOString())) return bad();
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
      const hasBlock = Object.hasOwn(rawIssue as object, "launchBlock");
      const issue = record(rawIssue, legacy ? ["repo", "issueNumber", "dispatches"] :
        ["repo", "issueNumber", "complete", "reason", "dispatches", ...(hasRefusal ? ["launchRefusal"] : []),
          ...(hasBlock ? ["launchBlock"] : [])]);
      if ((legacy && (hasRefusal || hasBlock)) || (hasRefusal && hasBlock)) return bad();
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
      let launchBlock: IssueLaunchBlock | undefined;
      if (hasBlock) {
        const block = record(issue.launchBlock, ["state", "reason", "at", "dispatchId", "source"]);
        if (block.state !== "blocked" || block.source !== "orchid" ||
            !ISSUE_LAUNCH_BLOCK_REASONS.includes(block.reason as IssueLaunchBlockReason) ||
            typeof block.dispatchId !== "string" || !/^assignment_[a-f0-9]{64}$/.test(block.dispatchId)) return bad();
        const at = stamp(block.at);
        if (at > observedAt) return bad();
        launchBlock = { state: "blocked", reason: block.reason as IssueLaunchBlockReason,
          at, dispatchId: block.dispatchId, source: "orchid" };
      }
      const dispatches: IssueAgentTreeDispatch[] = [];
      const dispatchIds = new Set<string>();
      for (const rawDispatch of array(issue.dispatches, MAX_AGENT_OBSERVATIONS)) {
        const dispatch = record(rawDispatch, ["dispatchId", "agents"]);
        if (typeof dispatch.dispatchId !== "string" || !/^assignment_[a-f0-9]{64}$/.test(dispatch.dispatchId) || dispatchIds.has(dispatch.dispatchId)) return bad("ambiguous-ancestry");
        dispatchIds.add(dispatch.dispatchId);
        const agents = array(dispatch.agents, MAX_AGENT_OBSERVATIONS).map(a => agent(a, observedAt, dispatch.dispatchId as string, readAgentActivity)) as IssueAgentTreeAgent[];
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
      const bounded = !legacy && !issueComplete && issueReason === "scan_limit";
      if (legacyPartial ? dispatches.length === 0 : issueComplete ? dispatches.length === 0 && launchRefusal === undefined
        : dispatches.length !== 0 && !bounded) return bad();
      if (legacyPartial) legacyPartials.add(issues.length);
      issues.push({ repo: { owner: repo.owner, name: repo.name }, issueNumber: issue.issueNumber,
        complete: issueComplete, reason: issueReason as IssueAgentTree["reason"], dispatches,
        ...(launchRefusal === undefined ? {} : { launchRefusal }),
        ...(launchBlock === undefined ? {} : { launchBlock }) });
    }
    if (agentCount > MAX_AGENT_OBSERVATIONS) return bad("oversized");
    if (row.complete && issues.some(issue => !issue.complete)) return bad();
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      // A bounded issue's tree is checked as a closed tree, like a complete one.
      if (!issue.complete && !legacyPartials.has(i) && issue.dispatches.length === 0) continue;
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
        if (a.liveness.state === "running" || a.liveness.state === "idle") {
          if (running?.value !== (a.liveness.state === "running") || running.observedAt !== a.liveness.observedAt ||
              running.validUntil === null || running.validUntil < validUntil) return bad();
        } else if (running?.value === true || running?.value === false) return bad();
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
              (a.harness.value !== "codex" && a.harness.value !== "claude" && a.harness.value !== "agy" && a.harness.value !== "opencode")) return bad();
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
