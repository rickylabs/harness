/** How an agy step's neutral status (decoded by the provider) is published as an activity state. */
import type { AgentActivityState, AgyStepStatus } from "@rickylabs/harness-contracts";

/** Exactly the ends the completion rules read; anything else, in progress included, is unknown. */
export function agyResultState(status: AgyStepStatus): AgentActivityState {
  if (status === "done") return "completed";
  if (status === "error") return "failed";
  return status === "cancelled" ? "cancelled" : "unknown";
}
