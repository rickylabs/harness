/**
 * The dispatch-outcome half of an admission as `status --json` and `tree --json` publish it. The
 * governance reading itself is the published contract's `GovernanceReadSnapshot`; nothing here parses it.
 */
import type { DispatchOutcome } from "@rickylabs/harness-contracts";

export type RefusedDispatch = Extract<DispatchOutcome, { readonly accepted: false }>;

export interface AdmissionItemRef {
  readonly number: number;
}
