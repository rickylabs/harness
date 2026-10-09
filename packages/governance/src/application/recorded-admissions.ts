/** Recorded admissions from the observability log, each decoded by the published contract at collection completion. */
import { readDispatchRefusal, readRecordedAdmission, type AdmissionDropReason, type RecordedAdmission } from "@rickylabs/harness-contracts";
import { freshnessAt, type RecordedAdmissions } from "../domain/admissions.js";
import { instant, object, positive } from "../domain/source.js";
import type { StringOrder } from "../ports/source.js";

/** Never derives an item or decision timestamp from the log identity or transport timestamp. */
export function mapAdmissions(events: readonly unknown[], completion: string, order: StringOrder, degraded = false): RecordedAdmissions {
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
  admissions.sort((a, b) => a.item - b.item || order(a.regime, b.regime));
  if (admissions.length === 0) notes.push("admissions: no-admissions; no current admission decision recorded");
  return { admissions, ok: notes.length === 0, notes: [...new Set(notes)], codes: [...new Set(codes)] };
}
