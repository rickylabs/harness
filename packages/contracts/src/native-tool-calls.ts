/**
 * The read seam between a vendor provider adapter and the telemetry producer (additive in 0.43.0). Values are private native data: telemetry screens them before any frame, and this
 * shape is never published in a snapshot.
 */
import type { AgentActivityGap } from "./agent-activity.js";

/** One native tool call the vendor's own log names; it carries no lifecycle and no result. */
export interface NativeToolCallDescriptor {
  /** The native trajectory step that issued the call. */
  readonly stepIndex: number;
  /** The call's position within that step, from 0. */
  readonly callIndex: number;
  readonly kind: "command" | "file" | "tool";
  /** A vendor built-in tool name from the provider's closed vocabulary, else null. */
  readonly toolName: string | null;
  readonly commandLine: string | null;
  readonly path: string | null;
}

/** A bounded read of one conversation's call descriptors, with the receipt coverage is computed from. */
export type NativeToolCallRead =
  | { readonly calls: readonly NativeToolCallDescriptor[];
      /** Every planner step decoded in the read, including steps that issued no call. */
      readonly decodedPlannerSteps: readonly number[];
      /** Planner steps the vendor marked as truncated in a field other than prose; their calls are dropped. */
      readonly vendorTruncatedSteps: readonly number[];
      /** True when the read began at the start of the log, so no earlier step can be missing from it. */
      readonly fromStart: boolean;
      /** The smallest step index decoded in the read. */
      readonly fromStepIndex: number;
      readonly bytesRead: number;
      readonly gap: null }
  | { readonly calls: readonly []; readonly decodedPlannerSteps: readonly []; readonly vendorTruncatedSteps: readonly [];
      readonly fromStart: false; readonly fromStepIndex: null; readonly bytesRead: number;
      readonly gap: Extract<AgentActivityGap, "tool-names-source-missing" | "tool-names-source-invalid" | "tool-names-budget-exhausted"> };
