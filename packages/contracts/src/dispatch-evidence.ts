/** One dispatch as read from a dispatcher receipt or the telemetry log; no collection or inferred joins. */
import type { RouteIdentityEvidence } from "./route.js";
import type { OrchidRouteObservedReasons } from "./agent-observations.js";
import type { AgentBudget, AgentLaunchRevision, AgentRoutePolicy, AgentTreeValue, ISSUE_LAUNCH_BLOCK_REASONS,
  ISSUE_LAUNCH_REFUSAL_REASONS } from "./issue-agent-tree.js";
import type { RunSource } from "./runs.js";

export interface DispatchEvidence {
  readonly runId: string;
  readonly external: string | null;
  readonly source: RunSource | null;
  readonly route: RouteIdentityEvidence;
  readonly routeObservedReasons?: OrchidRouteObservedReasons;
  readonly observedAt?: string;
  readonly revision?: string;
  readonly linkageBasis?: "dispatcher-confirmed";
  readonly issue?: { readonly repo: string; readonly number: number } | null;
  readonly parentRunId?: string | null;
  readonly location?: { readonly paneId: string; readonly workspaceId: string } | null;
  /** Configured short name, certified against the private native binding. */
  readonly host?: string | null;
  /** Dispatch acknowledgement is not evidence of current liveness. */
  readonly dispatchState?: "launching" | "dispatched" | "uncertain";
  /** Sanitized dispatch-side transport identity, independent of native binding. */
  readonly harness?: "codex" | "claude" | "agy" | "opencode";
  /** Validated from Orchid's bound private dispatch record when the writer supplies it. */
  readonly budget?: AgentBudget;
  /** Actual gateway, derived only from a validated native CLI dispatch source. */
  readonly router?: AgentTreeValue;
  /** Bound private matrix receipt, distinct from the gateway. */
  readonly routePolicy?: AgentRoutePolicy;
  /** Exact pins of the root dispatch, each independently tied to its source receipt. */
  readonly profileRevision?: AgentLaunchRevision;
  readonly matrixRevision?: AgentLaunchRevision;
  /** Bound, separately verified Orchid stop observations for the root only. */
  readonly stop?: { readonly seatObservedAt: string | null; readonly processObservedAt: string | null };
  /** Bound, separately verified ordinary teardown observations for the root only. */
  readonly teardown?: { readonly cause: "timeout" | "teardown"; readonly seatObservedAt: string | null;
    readonly processObservedAt: string | null };
  /** Orchid's current herdr status for the bound Claude root: working, or stopped at its prompt. */
  readonly claudeStatus?: { readonly state: "working" | "idle"; readonly at: string };
}

/** Why a configured Orchid receipt root was refused as a whole. */
export type OrchidDispatchUnavailableReason =
  | "missing"
  | "not_directory"
  | "wrong_mode"
  | "relative_path"
  | "symlink"
  | "git_ancestor";
/** One closed issue launch state from Orchid's receipt root. */
export type OrchidLaunchState = {
  readonly issue: { readonly repo: string; readonly number: number };
  readonly dispatchId: string;
  readonly observedAt: string;
} & (
  | { readonly state: "refused"; readonly reasonCode: typeof ISSUE_LAUNCH_REFUSAL_REASONS[number] }
  | { readonly state: "blocked"; readonly reasonCode: typeof ISSUE_LAUNCH_BLOCK_REASONS[number] }
  | { readonly state: "launching" | "launched"; readonly reasonCode: null }
);
/** One read of Orchid's receipt root. Diagnostics echo only the configured root, never a record path. */
export interface OrchidDispatchRead {
  readonly root: string | undefined;
  readonly reason: OrchidDispatchUnavailableReason | null;
  readonly dispatches: readonly DispatchEvidence[];
  readonly launchStates: readonly OrchidLaunchState[];
  readonly notes: readonly string[];
  readonly degraded: boolean;
}
