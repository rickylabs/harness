/** Synthetic values for this package's tests: what a composition root and an operator descriptor pass in. Test support only. */
import type { GovernanceWiring } from "../src/ports/source.js";

/** A synthetic spend endpoint and usage host; real ones come from the operator's descriptor, never from code. */
export const SPEND_URL = "https://spend.example.invalid/api/v1/key";
export const USAGE_HOST = "usage.example.invalid";
/** The legacy producer the published fixtures carry, and a code-unit string order. */
export const wiring: GovernanceWiring = { producer: "dsh-telemetry", order: (a, b) => a < b ? -1 : a > b ? 1 : 0 };
