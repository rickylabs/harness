import { readGovernanceSnapshot, type GovernanceReadSnapshot, type MeterCoverage } from "@rickylabs/harness-contracts";
import { wireProducer } from "../producer-names.js";
import { freshnessAt } from "./admissions.js";

/** Decode a composed document through the published contract before anyone reads it.
 * Fixed failure diagnostic; no source input, path or unvalidated producer detail is reflected. */
export function governanceRead(document: GovernanceReadSnapshot): GovernanceReadSnapshot {
  // The public decoder projects each state/coverage field into owned data and enforces caps before
  // serialization. Refusal is fail-closed, never truncation or an invented drop reason.
  const decoded = readGovernanceSnapshot(document);
  if (!decoded.ok) throw new Error("governance document unavailable");
  return decoded.snapshot;
}

function unread(unavailableReason: "not-configured" | "envelope-invalid", evaluatedAt: string, notes: readonly string[]): GovernanceReadSnapshot {
  return { schema: 1, protocol: 1, producer: wireProducer(), evaluatedAt, complete: false,
    sources: { usage: { status: "not-configured" }, spend: { status: "not-configured" }, capacity: { status: "not-configured" },
      admissions: { status: "not-configured" }, approvals: { status: "not-observed" } },
    notes: [...notes], availability: "unavailable", observedAt: null, validUntil: null, provenance: null,
    unavailableReason, state: null, admissions: [] };
}

/** The explicit unknown: nothing configured, nothing read, nothing implied. */
export const unconfiguredGovernance = (evaluatedAt: string): GovernanceReadSnapshot => unread("not-configured", evaluatedAt, []);

/** A requested document that could not be read or validated: unavailable, with the fixed reason as its note. */
export const invalidGovernance = (evaluatedAt: string, notes: readonly string[]): GovernanceReadSnapshot =>
  unread("envelope-invalid", evaluatedAt, notes);

export type GovernanceAt =
  | { readonly ok: true; readonly snapshot: GovernanceReadSnapshot }
  | { readonly ok: false; readonly detail: string };

/**
 * Read a stored governance document as of another instant. Every freshness is recomputed at
 * `evaluatedAt`, then the contract decodes the result again and re-checks every clock: an expired
 * read stays visible as stale, and one observed after `evaluatedAt` is refused.
 */
export function governanceAt(value: unknown, evaluatedAt: string): GovernanceAt {
  const stored = readGovernanceSnapshot(value);
  if (!stored.ok) return { ok: false, detail: stored.reason === "unsupported-schema" ? "unsupported schema" : stored.detail };
  const document = stored.snapshot;
  const meter = (coverage: MeterCoverage): MeterCoverage =>
    coverage.status === "read" ? { ...coverage, freshness: freshnessAt(coverage.validUntil, evaluatedAt) } : coverage;
  const sources = { ...document.sources, usage: meter(document.sources.usage), spend: meter(document.sources.spend),
    capacity: meter(document.sources.capacity),
    ...(document.sources.transportAvailability === undefined ? {} : { transportAvailability: meter(document.sources.transportAvailability) }) };
  const reread = readGovernanceSnapshot(document.availability === "unavailable"
    ? { ...document, evaluatedAt, sources }
    : { ...document, evaluatedAt, sources, availability: freshnessAt(document.validUntil, evaluatedAt),
        admissions: document.admissions.map(admission => ({ ...admission, freshness: freshnessAt(admission.validUntil, evaluatedAt) })) });
  return reread.ok ? { ok: true, snapshot: reread.snapshot } : { ok: false, detail: reread.reason === "unsupported-schema" ? "unsupported schema" : reread.detail };
}
