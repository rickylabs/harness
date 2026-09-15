/** Additive native read surface. No issue assignment or per-turn route assertion. */
export type CodexReadReason = "field_absent" | "invalid_field" | "redacted" | "goal_absent" | "budget_unset" |
  "ancestry_unavailable" | "runtime_unavailable" | "identity_mismatch" | "source_unavailable" | "source_closed" |
  "request_timeout" | "invalid_response" | "response_mismatch" | "rpc_error" | "read_only_violation" |
  "oversized_frame" | "notification_overflow" | "scan_limit" | "invalid_options" | "read_in_progress" | "subscription_in_use";
export type CodexField<T> = { availability: "available"; value: T; reason: null } |
  { availability: "unavailable"; value: null; reason: CodexReadReason };
export type CodexGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
export interface CodexGoalObservation {
  goalObjective: CodexField<string>;
  goalStatus: CodexField<CodexGoalStatus>;
  tokenBudget: CodexField<number>;
  tokensUsed: CodexField<number>;
  secondsUsed: CodexField<number>;
  /** Native goal source timestamp, Unix seconds. Not a receipt or liveness timestamp. */
  goalUpdatedAt: CodexField<number>;
}
export interface CodexThreadObservation extends CodexGoalObservation {
  /** Existing opaque public native-child identity. Never the native thread/session identifier. */
  threadId: string;
  parentThreadId: CodexField<string>;
  cwd: CodexField<string>;
  gitBranch: CodexField<string>;
  gitOrigin: CodexField<string>;
  provider: CodexField<string>;
  model: CodexField<string>;
  effort: CodexField<string>;
  status: CodexField<"notLoaded" | "idle" | "systemError" | "active">;
  running: CodexField<boolean>;
  routeBasis: "configured-or-persisted";
}
export interface CodexThreadSnapshot {
  schema: 1;
  source: "codex-app-server";
  scope: "stored-all-sources-including-archived";
  /** Pagination and goal-read coverage. Missing optional values do not erase rows; failed goal RPCs make this false. Neither atomic nor a fleet ancestry claim. */
  complete: boolean;
  reason: CodexReadReason | null;
  observedAt: string;
  rows: CodexThreadObservation[];
}
export type CodexGoalEvent = { schema: 1; sequence: number; type: "goal_updated" | "goal_cleared";
  threadId: string; goal: CodexGoalObservation } |
  { schema: 1; sequence: number; type: "unavailable"; reason: CodexReadReason };
