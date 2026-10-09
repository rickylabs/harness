/** Issue-agent tree bounds and closed vocabularies, shared by the snapshot reader and its row decoders. */
export const MAX_AGENT_HISTORY = 16;
export const MAX_AGENT_RESOURCE_POINTS = 16;
export const MAX_AGENT_TIMELINE_EVENTS = 32;
export const AGENT_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const AGENT_HISTORY_KINDS = ["dispatch-observed", "run-started-observed", "run-activity-observed", "stop-seat-observed", "stop-process-observed", "teardown-seat-observed", "teardown-process-observed"] as const;
export const AGENT_ACTION_ACCEPTED_REASONS = {
  stop: "workspace_close_delivered", steer: "prompt_delivered", send: "prompt_delivered",
  raise_budget: "goal_budget_updated", retry: "retry_dispatched",
} as const;
export const AGENT_ACTION_REJECTED_REASONS = ["digest_conflict", "request_invalid", "payload_invalid", "action_invalid",
  "repository_mismatch", "identity_mismatch", "agent_not_stoppable", "agent_not_running", "agent_not_live",
  "retry_requires_terminal_successor_contract", "goal_not_raiseable", "budget_ceiling_unset", "budget_ceiling_exceeded",
  "budget_not_increased", "retry_unavailable", "retry_issue_unavailable", "retry_target_unavailable",
  "retry_pins_unavailable", "retry_terminal_unproven", "retry_in_flight", "retry_preflight_unavailable",
  "dispatch_lookup_limit", "dispatch_receipt_unavailable"] as const;
