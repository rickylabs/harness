/**
 * The read seam between the agy provider and the telemetry producer (additive in 0.43.0): one bound
 * store's conversations, decoded by the provider from agy's retained SQLite trajectory. Native codes
 * stay in the provider; these neutral values are what telemetry's completion rules read. Values are
 * private native data (the response text is screened before any frame); never published in a snapshot.
 */

/** A trajectory step's kind: a user turn, a planner response, a tool-result step, or anything else. */
export type AgyStepKind = "user" | "planner" | "result" | "other";
/** A step's native status: in progress as recorded, or ended done, in error, cancelled; else other. */
export type AgyStepStatus = "pending" | "done" | "error" | "cancelled" | "other";
/** A planner response's native stop reason: the explicit stop, a cancellation, an error, or another reason. */
export type AgyStopReason = "explicit-stop" | "cancelled" | "error" | "other";
/** The conversation summary's native state. */
export type AgySummaryState = "idle" | "active" | "other";

export interface AgyTrajectoryStep {
  readonly index: number;
  readonly kind: AgyStepKind;
  readonly status: AgyStepStatus;
  readonly createdAt: string;
  readonly completedAt: string | null;
  /** Whether the step carries a typed planner response (possibly empty). */
  readonly hasResponse: boolean;
  /** Planner responses only: the typed response text and its stop reason; null otherwise. */
  readonly responseText: string | null;
  readonly stopReason: AgyStopReason | null;
  readonly hasError: boolean;
}

export interface AgyConversationSnapshot {
  readonly conversationId: string;
  readonly parentId: string | null;
  /** The private trajectory database path: the run origin and a watch hint, never published. */
  readonly origin: string;
  readonly startedAt: string;
  /** The latest native update across the trajectory, never later than the summary's own time. */
  readonly updatedAt: string;
  readonly summaryState: AgySummaryState;
  readonly summaryRunning: boolean;
  readonly childActive: boolean;
  readonly notFullyIdle: boolean;
  /** The summary row's killed column, and the native summary's killed flag, kept apart as read. */
  readonly killedColumn: boolean;
  readonly killedNative: boolean;
  readonly interrupted: boolean;
  readonly steps: readonly AgyTrajectoryStep[];
  /** The single local workspace root from the summary metadata, or null when absent or not exactly one. */
  readonly workspaceRoot: string | null;
}

/** One bound store read: the bound root and its descendants, every byte counted, or a typed refusal. */
export type AgyStoreRead =
  | { readonly conversations: readonly AgyConversationSnapshot[]; readonly bytesRead: number;
      /** Private database paths for a watch loop; never evidence. */
      readonly files: readonly string[]; readonly reason: null }
  | { readonly conversations: readonly []; readonly bytesRead: number; readonly files: readonly string[];
      readonly reason: "scan_limit" | "source_unavailable" };
