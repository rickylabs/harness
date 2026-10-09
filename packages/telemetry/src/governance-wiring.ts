/**
 * Telemetry's wiring of `@rickylabs/governance`: the producer name and string order it stamps and sorts with,
 * and the one spend endpoint a governance source descriptor may name. Governance owns none of these.
 */
import { parseSource, type GovernanceSource, type GovernanceWiring } from "@rickylabs/governance";
import { compareStrings } from "./order.js";
import { wireProducer, type TelemetryWireFamily } from "./producer-names.js";

/** The metered spend endpoint `harness-telemetry` reads; a descriptor naming any other URL is refused. */
export const SPEND_URL = "https://openrouter.ai/api/v1/key";

/** Validate an operator descriptor against the endpoint this CLI is wired to. */
export const parseGovernanceSource = (value: unknown): GovernanceSource => parseSource(value, { spendUrl: SPEND_URL });

/** The producer and order for one wire family; absent family is the legacy producer. */
export const governanceWiring = (wireFamily: TelemetryWireFamily = "legacy"): GovernanceWiring =>
  ({ producer: wireProducer(wireFamily), order: compareStrings });
