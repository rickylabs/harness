import type { AdmissionDropReason, RegimeStatus } from "@rickylabs/harness-contracts";
import { parseGovernanceObservation, type AdmissionObservation } from "../observations.js";
import { instant, object, positive } from "../source.js";
import { compareStrings } from "../order.js";

/** The published contract owns reason semantics; producers own public-safe code identifiers.
 * Reject prose and paths at this live edge, without inventing a governance-reason taxonomy.
 */
const machineReason = (value: unknown): value is string => typeof value === "string" &&
  value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
export interface RecordedAdmissions {
  readonly admissions: readonly AdmissionObservation[];
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

/** Never derives an item or decision timestamp from the log identity or transport timestamp. */
export function mapAdmissions(events: readonly unknown[], completion: string, degraded = false): RecordedAdmissions {
  if (degraded) return { admissions: [], ok: false, notes: ["admissions: log-unreadable"], codes: [] };
  type Candidate = { at: number | null; observation: AdmissionObservation | null; identity: string | null };
  const groups = new Map<string, Candidate[]>();
  let malformed = false;
  let unscoped = false;
  for (const event of events) {
    let envelope: Record<string, unknown>;
    try { envelope = object(event); } catch { malformed = true; unscoped = true; continue; }
    if (envelope.kind !== "governance.admission") continue;
    let key: string;
    let detail: Record<string, unknown>;
    try {
      detail = object(envelope.detail);
      const item = positive(object(detail.item).number);
      if (!["subscription", "metered", "capacity"].includes(String(detail.regime))) throw new Error();
      key = `${item}:${String(detail.regime)}`;
    } catch { malformed = true; unscoped = true; continue; }
    let at: number | null = null;
    try { at = Date.parse(instant(detail.observedAt)); } catch { /* Unknown ordering blocks this key. */ }
    let observation: AdmissionObservation | null = null;
    let identity: string | null = null;
    try {
      instant(envelope.at);
      instant(detail.observedAt);
      instant(detail.validUntil);
      if (typeof envelope.runId !== "string" || envelope.runId.trim().length === 0) throw new Error();
      const outcome = object(detail.outcome);
      if (!machineReason(outcome.reason)) throw new Error();
      const parsed = parseGovernanceObservation({
        observedAt: completion, validUntil: completion, provenance: "reader:recorded-admission",
        state: { generatedAt: completion, regimes: unreadRegimes(nullNote), pending: [], notes: [] },
        admissions: [{ ...detail, provenance: "reader:recorded-admission" }],
      }, completion);
      if (parsed.availability === "unavailable" || parsed.admissions[0] === undefined) throw new Error();
      const a = parsed.admissions[0];
      // Compare validated operator detail privately, before withholding it from the projection.
      identity = JSON.stringify([a.state, Date.parse(a.validUntil), a.outcome.reason, a.outcome.detail, a.outcome.approval ?? null]);
      observation = { item: a.item, regime: a.regime, state: a.state,
        observedAt: new Date(Date.parse(a.observedAt)).toISOString(), validUntil: new Date(Date.parse(a.validUntil)).toISOString(), provenance: "reader:recorded-admission",
        outcome: { accepted: false, reason: a.outcome.reason, detail: "Recorded gate refusal; private operator detail withheld. Admission is not execution evidence." } };
    } catch { malformed = true; }
    const group = groups.get(key) ?? [];
    group.push({ at, observation, identity });
    groups.set(key, group);
  }
  const notes: string[] = [];
  const codes: AdmissionDropReason[] = [];
  if (malformed) { notes.push("admissions: shape-mismatch; malformed records rejected"); codes.push("shape-mismatch"); }
  if (unscoped) return { admissions: [], ok: false, notes, codes };
  const admissions: AdmissionObservation[] = [];
  for (const group of groups.values()) {
    if (group.some(candidate => candidate.at === null)) continue;
    const newest = group.reduce((at, candidate) => Math.max(at, candidate.at!), -Infinity);
    const latest = group.filter(candidate => candidate.at === newest);
    if (latest.some(candidate => candidate.observation === null)) continue;
    if (new Set(latest.map(candidate => candidate.identity)).size !== 1) {
      notes.push("admissions: admission-conflict");
      codes.push("admission-conflict");
      continue;
    }
    const observation = latest[0]!.observation!;
    if (Date.parse(observation.validUntil) < Date.parse(completion)) {
      notes.push("admissions: stale-source");
      codes.push("stale-source");
      continue;
    }
    admissions.push(observation);
  }
  admissions.sort((a, b) => a.item.number - b.item.number || compareStrings(a.regime, b.regime));
  if (admissions.length === 0) notes.push("admissions: no-admissions; no current admission decision recorded");
  return { admissions, ok: notes.length === 0, notes: [...new Set(notes)], codes: [...new Set(codes)] };
}
const nullNote = "admission validation only";
