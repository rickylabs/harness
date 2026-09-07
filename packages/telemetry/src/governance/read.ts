import { readGovernanceSnapshot, type GovernanceReadSnapshot, type UnavailableReason } from "@rickylabs/harness-contracts";
import type { ComposedGovernance } from "./compose.js";

/** Fixed failure diagnostic; no source input, path or unvalidated producer detail is reflected. */
export function governanceRead(observed: ComposedGovernance, evaluatedAt: string): GovernanceReadSnapshot {
  const view = observed.governance;
  const common = { schema: 1, protocol: 1, producer: "dsh-telemetry", evaluatedAt,
    complete: observed.ok, sources: observed.coverage, notes: [...observed.notes] };
  const unavailableReason = (view.availability === "unavailable"
    ? view.unavailableReason === "envelope-invalid" ? "envelope-invalid"
      : [observed.coverage.usage, observed.coverage.spend, observed.coverage.capacity, observed.coverage.admissions]
        .every(source => source.status === "not-configured") ? "not-configured" : "no-successful-sources"
    : null) satisfies UnavailableReason | null;
  const document = { ...common, availability: view.availability, observedAt: view.observedAt,
    validUntil: view.validUntil, provenance: view.provenance, unavailableReason,
    state: view.state, admissions: view.admissions.map(a => ({ item: a.item.number, regime: a.regime,
      state: a.state, observedAt: a.observedAt, validUntil: a.validUntil, freshness: a.availability,
      provenance: a.provenance, reason: a.outcome.reason, accepted: false })) };
  // The public decoder projects each state/coverage field into owned data and enforces caps before
  // serialization. Refusal is fail-closed, never truncation or an invented drop reason.
  const decoded = readGovernanceSnapshot(document);
  if (!decoded.ok) throw new Error("governance document unavailable");
  return decoded.snapshot;
}
