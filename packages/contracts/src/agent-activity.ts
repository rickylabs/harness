/** Agent activity shapes: the step, its lifecycle state and the coverage of a published window. */
import type { AgentUnavailableReason } from "./agent-observations.js";
import type { AgentActivityTargetKind } from "./issue-agent-tree.js";

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
  readonly source: "codex-rollout" | "claude-transcript" | "agy-transcript" | "opencode-transcript";
  /**
   * Additive in the next contracts minor, on tool, command and file steps only: the native step's
   * observed end, or `unknown` where the producer cannot prove one. A step without it makes no claim.
   */
  readonly state?: AgentActivityState;
}
/** A native end the producer observed; `unknown` never means running, failed or zero. */
export const AGENT_ACTIVITY_STATES = ["completed", "failed", "cancelled", "unknown"] as const;
export type AgentActivityState = typeof AGENT_ACTIVITY_STATES[number];
/** Closed, canonically ordered reasons the published activity is narrower than the native run. */
export const AGENT_ACTIVITY_GAPS = ["tool-names-source-missing", "tool-names-source-invalid",
  "tool-names-budget-exhausted", "tool-names-truncated", "tool-names-lines-missing", "tool-names-vendor-truncated",
  "call-lifecycle-unproven", "in-progress-unattributed"] as const;
export type AgentActivityGap = typeof AGENT_ACTIVITY_GAPS[number];
/** Additive in the next contracts minor; empty `gaps` states full coverage of the published window. */
export interface AgentActivityCoverage { readonly gaps: readonly AgentActivityGap[] }
export type AgentActivity =
  | { readonly availability: "available"; readonly reason: null; readonly observedAt: string;
      readonly steps: readonly AgentActivityStep[]; readonly coverage?: AgentActivityCoverage }
  | { readonly availability: "unavailable"; readonly reason: AgentUnavailableReason; readonly observedAt: null;
      readonly steps: readonly [] };
