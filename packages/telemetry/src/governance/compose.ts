import type { RegimeStatus } from "@rickylabs/harness-contracts";
import { parseGovernanceObservation, unavailableGovernance, type ParsedGovernance } from "../observations.js";
import { instant, type GovernanceSource, type Leg } from "../source.js";
import { mapAdmissions, unreadRegimes } from "./admissions.js";

export interface CollectedSources {
  readonly usage: Leg<RegimeStatus>;
  readonly spend: Leg<RegimeStatus>;
  readonly capacity: Leg<RegimeStatus>;
  readonly events: readonly unknown[];
  readonly logDegraded: boolean;
}

/** Completion and evaluation clocks are separate. Successful leaves retain their source stamps. */
export function composeGovernance(source: GovernanceSource, collected: CollectedSources, completion: string, now = completion): ParsedGovernance {
  const notes: string[] = ["pending approvals unobserved"];
  const expiries: number[] = [];
  const regimes = unreadRegimes("source unavailable");
  let ok = true;
  try { instant(completion); instant(now); } catch {
    return { governance: unavailableGovernance("envelope-invalid"), notes: ["envelope-invalid"], ok: false };
  }
  for (const [index, name] of (["usage", "spend", "capacity"] as const).entries()) {
    const leg = collected[name];
    let note: string | null = null;
    if (source[name] === null) note = `${name}: not-configured`;
    else if (!leg.ok) { note = `${name}: ${leg.code}`; ok = false; }
    else {
      let reason: string | null = null;
      try {
        const observed = Date.parse(instant(leg.observedAt));
        const until = Date.parse(instant(leg.validUntil));
        if (until < observed) reason = "shape-mismatch";
        else if (observed > Date.parse(completion)) reason = "future-source";
        else if (until < Date.parse(completion)) reason = "stale-source";
      } catch { reason = "shape-mismatch"; }
      if (reason !== null) { note = `${name}: ${reason}`; ok = false; }
      else { regimes[index] = leg.value; expiries.push(Date.parse(leg.validUntil)); }
    }
    if (note !== null) { regimes[index] = { ...regimes[index]!, note }; notes.push(note); }
  }
  const recorded = source.admissions === null
    ? { admissions: [], ok: true, notes: ["admissions: not-configured"] }
    : mapAdmissions(collected.events, completion, collected.logDegraded);
  notes.push(...recorded.notes);
  ok &&= recorded.ok;
  for (const admission of recorded.admissions) expiries.push(Date.parse(admission.validUntil));
  if (expiries.length === 0) {
    return { governance: unavailableGovernance("no successful live sources"), notes, ok: false };
  }
  const governance = parseGovernanceObservation({
    observedAt: completion, validUntil: new Date(expiries.reduce((minimum, until) => Math.min(minimum, until), Infinity)).toISOString(), provenance: "reader:composed",
    state: { generatedAt: completion, regimes, pending: [], notes }, admissions: recorded.admissions,
  }, now);
  if (governance.availability === "unavailable") {
    return { governance: unavailableGovernance("envelope-invalid"), notes: [...notes, "envelope-invalid"], ok: false };
  }
  return { governance, notes, ok };
}
