/** Admission freshness and the unread regime triple: pure rules over contract types. */
import type { AdmissionDropReason, RecordedAdmission, RegimeStatus } from "@rickylabs/harness-contracts";

/** Freshness of one validity interval at an evaluation instant; the contract checks it on decode. */
export const freshnessAt = (validUntil: string, at: string): RecordedAdmission["freshness"] =>
  Date.parse(at) > Date.parse(validUntil) ? "stale" : "fresh";

/** Recorded admissions, each decoded by the published contract at collection completion.
 * The contract owns reason semantics: a public-safe code identifier, never prose or a path. */
export interface RecordedAdmissions {
  readonly admissions: readonly RecordedAdmission[];
  readonly ok: boolean;
  readonly notes: readonly string[];
  readonly codes: readonly AdmissionDropReason[];
}
export function unreadRegimes(note: string): RegimeStatus[] {
  return [
    { regime: "subscription", state: "allow", accounts: [], note },
    { regime: "metered", state: "allow", providers: [], note },
    { regime: "capacity", state: "allow", hosts: [], note },
  ];
}
