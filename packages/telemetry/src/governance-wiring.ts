/**
 * Telemetry's wiring of `@rickylabs/governance`: the producer name and string order it stamps and sorts with.
 * Governance owns neither; every endpoint and host comes from the operator's source descriptor.
 */
import type { GovernanceWiring } from "@rickylabs/governance";
import { compareStrings } from "./order.js";
import { wireProducer, type TelemetryWireFamily } from "./producer-names.js";

/** The producer and order for one wire family; absent family is the legacy producer. */
export const governanceWiring = (wireFamily: TelemetryWireFamily = "legacy"): GovernanceWiring =>
  ({ producer: wireProducer(wireFamily), order: compareStrings });
