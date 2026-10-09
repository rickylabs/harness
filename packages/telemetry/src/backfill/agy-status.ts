/** The agy trajectory step and status codes, owned once (measured on 1.2.14 and 1.3.2 stores). */
import type { AgentActivityState } from "@rickylabs/harness-contracts";

export const AGY_STEP_TYPE = { user: 14, planner: 15, result: 132 } as const;
/** Every status a trajectory step may carry; any other value invalidates the conversation. */
export const AGY_STEP_STATUSES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12];
/** In progress as recorded; whether the step is still executing is not provable from the row alone. */
export const AGY_PENDING_STATUSES: readonly number[] = [1, 2, 8, 9, 11];
export const AGY_CANCELLED_STATUSES: readonly number[] = [6, 12];
export const AGY_ERROR_STATUS = 7;
export const AGY_DONE_STATUS = 3;

/** A native step's end exactly as the completion authority reads these codes; anything else is unknown. */
export function agyResultState(status: number): AgentActivityState {
  if (status === AGY_DONE_STATUS) return "completed";
  if (status === AGY_ERROR_STATUS) return "failed";
  return AGY_CANCELLED_STATUSES.includes(status) ? "cancelled" : "unknown";
}
