/** Explicit producer selection; compatibility readers never rewrite received provenance. */
import { AGENT_COST_SOURCE_NAMES, unavailableAgentCost, type AgentCost, type AgentUnavailableReason } from "@rickylabs/harness-contracts";
import { OperatorConfigurationError, type OperatorEnvironment } from "./operator-environment.js";

export type TelemetryWireFamily = "harness" | "legacy";
export const WIRE_FAMILY_ENV = "HARNESS_TELEMETRY_WIRE_FAMILY";

/** Absence retains supported legacy clients; invalid values never silently choose a family. */
export function validateWireFamily(value: unknown = "legacy"): TelemetryWireFamily {
  if (value !== "harness" && value !== "legacy") throw new OperatorConfigurationError(`invalid ${WIRE_FAMILY_ENV}`);
  return value;
}
export function resolveWireFamily(env: OperatorEnvironment): TelemetryWireFamily {
  return validateWireFamily(env[WIRE_FAMILY_ENV]);
}
export function wireProducer(wireFamily: TelemetryWireFamily = "legacy"): string {
  return validateWireFamily(wireFamily) === "harness" ? "harness-telemetry" : "dsh-telemetry";
}

/** These rows originate here. Arbitrary observed rows must retain their own received source. */
export function producerAgentCost(reason: AgentUnavailableReason = "source_not_bound", wireFamily: TelemetryWireFamily = "legacy"): AgentCost {
  const index = validateWireFamily(wireFamily) === "harness" ? 0 : 1;
  const absent = unavailableAgentCost(reason);
  return {
    subscriptionHeadroom: { ...absent.subscriptionHeadroom, source: AGENT_COST_SOURCE_NAMES.subscriptionHeadroom[index] },
    meteredSpend: { ...absent.meteredSpend, source: AGENT_COST_SOURCE_NAMES.meteredSpend[index] },
    runTokens: { ...absent.runTokens, source: AGENT_COST_SOURCE_NAMES.runTokens[index] },
    localCapacity: { ...absent.localCapacity, source: AGENT_COST_SOURCE_NAMES.localCapacity[index] },
  };
}
