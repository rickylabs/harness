import { SOURCE_FAILURE_REASONS, type SourceFailureReason, type SourceDiscardReason, type MeterCoverage, type GovernanceSourceCoverage, type RegimeStatus,
  type TransportAvailability } from "@rickylabs/harness-contracts";
import { parseGovernanceObservation, unavailableGovernance, type ParsedGovernance } from "../observations.js";
import { instant, type GovernanceSource, type Leg } from "../source.js";
import { mapAdmissions, unreadRegimes } from "./admissions.js";

export interface CollectedSources {
  readonly usage: Leg<RegimeStatus>;
  readonly spend: Leg<RegimeStatus>;
  readonly capacity: Leg<RegimeStatus>;
  readonly events: readonly unknown[];
  readonly logDegraded: boolean;
  /** Required when the source configures transportAvailability. */
  readonly transportAvailability?: Leg<TransportAvailability>;
}

export interface ComposedGovernance extends ParsedGovernance {
  readonly coverage: GovernanceSourceCoverage;
  /** Its own validity, beside the governance envelope. Omitted when the source is not configured. */
  readonly transportAvailability?: TransportAvailability | null;
}

/** A leg's time checks, shared by the meters and transport availability. */
function discardReason(leg: { readonly observedAt: string; readonly validUntil: string }, completion: string): SourceDiscardReason | null {
  try {
    const observed = Date.parse(instant(leg.observedAt));
    const until = Date.parse(instant(leg.validUntil));
    if (until < observed) return "shape-mismatch";
    if (observed > Date.parse(completion)) return "future-source";
    if (until < Date.parse(completion)) return "stale-source";
    return null;
  } catch { return "shape-mismatch"; }
}

function composeTransportAvailability(source: GovernanceSource, leg: Leg<TransportAvailability> | undefined,
  completion: string, now: string): { coverage: MeterCoverage | null; value: TransportAvailability | null; note: string | null } {
  if (!source.transportAvailability) return { coverage: null, value: null, note: null };
  if (leg === undefined || !leg.ok) {
    const code = leg === undefined ? "shape-mismatch" : leg.code;
    const reason = SOURCE_FAILURE_REASONS.includes(code as SourceFailureReason) ? code as SourceFailureReason : "shape-mismatch";
    return { coverage: { status: "failed", reason }, value: null, note: `transportAvailability: ${reason}` };
  }
  const reason = discardReason(leg, completion);
  if (reason !== null) return { coverage: { status: "discarded", reason }, value: null, note: `transportAvailability: ${reason}` };
  return { coverage: { status: "read", observedAt: leg.observedAt, validUntil: leg.validUntil,
    freshness: Date.parse(now) > Date.parse(leg.validUntil) ? "stale" : "fresh", provenance: "reader:divybot-transport-availability" },
    value: leg.value, note: null };
}
const PROVENANCE = { usage: "reader:opencode-usage", spend: "reader:openrouter-key", capacity: "reader:cgroup-memory" } as const;

/** Completion and evaluation clocks are separate. Successful leaves retain their source stamps. */
export function composeGovernance(source: GovernanceSource, collected: CollectedSources, completion: string, now = completion): ComposedGovernance {
  const meters: Record<"usage" | "spend" | "capacity", MeterCoverage> = {
    usage: source.usage === null ? { status: "not-configured" } : { status: "failed", reason: "shape-mismatch" },
    spend: source.spend === null ? { status: "not-configured" } : { status: "failed", reason: "shape-mismatch" },
    capacity: source.capacity === null ? { status: "not-configured" } : { status: "failed", reason: "shape-mismatch" },
  };
  const availability = composeTransportAvailability(source, collected.transportAvailability, completion, now);
  // Only a configured source adds its keys, so an unconfigured document stays byte-identical to 0.27.0.
  const configured = availability.coverage === null ? {} : { transportAvailability: availability.coverage };
  const transportAvailability = availability.coverage === null ? {} : { transportAvailability: availability.value };
  let coverage: GovernanceSourceCoverage = { ...meters, admissions: source.admissions === null ? { status: "not-configured" } : { status: "failed", reason: "shape-mismatch" }, approvals: { status: "not-observed" },
    ...configured };
  const notes: string[] = ["pending approvals unobserved"];
  const expiries: number[] = [];
  const regimes = unreadRegimes("source unavailable");
  let ok = true;
  try { instant(completion); instant(now); } catch {
    return { governance: unavailableGovernance("envelope-invalid"), notes: ["envelope-invalid"], ok: false, coverage, ...transportAvailability };
  }
  for (const [index, name] of (["usage", "spend", "capacity"] as const).entries()) {
    const leg = collected[name];
    let note: string | null = null;
    if (source[name] === null) note = `${name}: not-configured`;
    else if (!leg.ok) {
      note = `${name}: ${leg.code}`; ok = false;
      meters[name] = { status: "failed", reason: SOURCE_FAILURE_REASONS.includes(leg.code as SourceFailureReason) ? leg.code as SourceFailureReason : "shape-mismatch" };
    }
    else {
      const reason = discardReason(leg, completion);
      if (reason !== null) { note = `${name}: ${reason}`; ok = false; meters[name] = { status: "discarded", reason }; }
      else {
        regimes[index] = leg.value; expiries.push(Date.parse(leg.validUntil));
        meters[name] = { status: "read", observedAt: leg.observedAt, validUntil: leg.validUntil,
          freshness: Date.parse(now) > Date.parse(leg.validUntil) ? "stale" : "fresh", provenance: PROVENANCE[name] };
      }
    }
    if (note !== null) { regimes[index] = { ...regimes[index]!, note }; notes.push(note); }
  }
  const recorded = source.admissions === null
    ? { admissions: [], ok: true, notes: ["admissions: not-configured"], codes: [] }
    : mapAdmissions(collected.events, completion, collected.logDegraded);
  if (availability.note !== null) { notes.push(availability.note); ok = false; }
  coverage = { ...meters, approvals: { status: "not-observed" }, ...configured, admissions: source.admissions === null
    ? { status: "not-configured" }
    : collected.logDegraded ? { status: "failed", reason: "log-unreadable" }
    : { status: "read", records: recorded.admissions.length, empty: recorded.admissions.length === 0,
        dropped: recorded.codes, provenance: "reader:recorded-admission", collectedAt: completion } };
  notes.push(...recorded.notes);
  ok &&= recorded.ok;
  for (const admission of recorded.admissions) expiries.push(Date.parse(admission.validUntil));
  if (expiries.length === 0) {
    return { governance: unavailableGovernance("no successful live sources"), notes, ok: false, coverage, ...transportAvailability };
  }
  const governance = parseGovernanceObservation({
    observedAt: completion, validUntil: new Date(expiries.reduce((minimum, until) => Math.min(minimum, until), Infinity)).toISOString(), provenance: "reader:composed",
    state: { generatedAt: completion, regimes, pending: [], notes }, admissions: recorded.admissions,
  }, now);
  if (governance.availability === "unavailable") {
    return { governance: unavailableGovernance("envelope-invalid"), notes: [...notes, "envelope-invalid"], ok: false, coverage, ...transportAvailability };
  }
  return { governance, notes, ok, coverage, ...transportAvailability };
}
