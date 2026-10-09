/** Synthetic wiring for this package's tests: what a composition root passes in. Test support only. */
import type { GovernanceWiring, SourcePolicy } from "../src/ports/source.js";

/** A synthetic spend endpoint; the real one is wired in by the caller, never named in this package. */
export const SPEND_URL = "https://spend.invalid/api/v1/key";
export const policy: SourcePolicy = { spendUrl: SPEND_URL };
/** The legacy producer the published fixtures carry, and a code-unit string order. */
export const wiring: GovernanceWiring = { producer: "dsh-telemetry", order: (a, b) => a < b ? -1 : a > b ? 1 : 0 };
