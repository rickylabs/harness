import { readDispatchRefusal, readRecordedAdmission, type AdmissionDropReason, type RecordedAdmission,
  type RegimeStatus } from "@rickylabs/harness-contracts";
import { instant, object, positive } from "../source.js";
import { compareStrings } from "../order.js";

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

/** Never derives an item or decision timestamp from the log identity or transport timestamp. */
export function mapAdmissions(events: readonly unknown[], completion: string, degraded = false): RecordedAdmissions {
  if (degraded) return { admissions: [], ok: false, notes: ["admissions: log-unreadable"], codes: [] };
  type Candidate = { at: number | null; observation: RecordedAdmission | null; identity: string | null };
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
    let observation: RecordedAdmission | null = null;
    let identity: string | null = null;
    try {
      instant(envelope.at);
      if (typeof envelope.runId !== "string" || envelope.runId.trim().length === 0) throw new Error();
      const outcome = readDispatchRefusal(detail.outcome, instant(detail.observedAt));
      if (outcome === null) throw new Error();
      const observedAt = new Date(Date.parse(instant(detail.observedAt))).toISOString();
      const validUntil = new Date(Date.parse(instant(detail.validUntil))).toISOString();
      observation = readRecordedAdmission({ item: object(detail.item).number, regime: detail.regime, state: detail.state, observedAt,
        validUntil, freshness: freshnessAt(validUntil, completion), provenance: "reader:recorded-admission", reason: outcome.reason,
        accepted: outcome.accepted }, completion);
      if (observation === null) throw new Error();
      // Compare validated operator detail privately; the published read carries neither detail nor approval.
      identity = JSON.stringify([observation.state, Date.parse(observation.validUntil), outcome.reason, outcome.detail, outcome.approval ?? null]);
    } catch { malformed = true; }
    const group = groups.get(key) ?? [];
    group.push({ at, observation, identity });
    groups.set(key, group);
  }
  const notes: string[] = [];
  const codes: AdmissionDropReason[] = [];
  if (malformed) { notes.push("admissions: shape-mismatch; malformed records rejected"); codes.push("shape-mismatch"); }
  if (unscoped) return { admissions: [], ok: false, notes, codes };
  const admissions: RecordedAdmission[] = [];
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
  admissions.sort((a, b) => a.item - b.item || compareStrings(a.regime, b.regime));
  if (admissions.length === 0) notes.push("admissions: no-admissions; no current admission decision recorded");
  return { admissions, ok: notes.length === 0, notes: [...new Set(notes)], codes: [...new Set(codes)] };
}
