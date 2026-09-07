/** Pure durable-state validation and replay. No clock, filesystem or process observations. */
import type {
  DeliveryReceipt, EffectStatus, IntentKey, OwnerClaim, OwnerClosed, ReceiptEntry, SessionPending,
  StoreCheckpoint, StoreEntry, StoreRefusal, StoreResult, StoreScope, StoreState,
} from "@rickylabs/harness-contracts";
import { canonicalJson, digest } from "./canonical.js";
import { intentEntryOf, proofFromReceipt, receiptEntryOf } from "./journal.js";

export const success = <T>(value: T): StoreResult<T> => ({ ok: true, value });
export const refuse = (refusal: StoreRefusal): { readonly ok: false; readonly refusal: StoreRefusal } => ({ ok: false, refusal });
export const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
export const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const integer = (v: unknown, min = 1): v is number => Number.isSafeInteger(v) && (v as number) >= min;
export const fields = (v: Record<string, unknown>, names: string): boolean => same(Object.keys(v).sort(), names.split(" ").sort());
export function validScope(v: unknown): v is StoreScope {
  return object(v) && fields(v, "repository milestone") && text(v.repository) && text(v.milestone);
}
export function validKey(v: unknown): v is IntentKey {
  return object(v) && fields(v, "repository task workflowStep attempt inputRevision") && text(v.repository) &&
    text(v.task) && text(v.workflowStep) && integer(v.attempt) && text(v.inputRevision);
}
export function validReceipt(v: unknown): v is DeliveryReceipt {
  return object(v) && (v.delivered === true ? fields(v, "delivered reference") && text(v.reference)
    : v.delivered === false && fields(v, "delivered reason") && text(v.reason));
}
export function validPending(v: unknown): v is SessionPending {
  return object(v) && fields(v, "status key generation sinceEntry") && v.status === "pending" &&
    validKey(v.key) && integer(v.generation) && integer(v.sinceEntry);
}
function validTerminal(v: unknown): v is EffectStatus {
  if (!object(v) || !validKey(v.key) || !integer(v.generation) || !integer(v.sinceEntry)) return false;
  switch (v.status) {
    case "unknown": return fields(v, "status key generation sinceEntry");
    case "sent": return fields(v, "status key generation sinceEntry receiptSequence reference") && integer(v.receiptSequence) && text(v.reference);
    case "unsent": return fields(v, "status key generation sinceEntry proof") && object(v.proof) &&
      fields(v.proof, "receiptSequence receiptDigest reason") && integer(v.proof.receiptSequence) &&
      text(v.proof.receiptDigest) && text(v.proof.reason);
    default: return false;
  }
}
export function envelope<T extends object>(body: T, at: string): T & { readonly version: 1; readonly at: string; readonly digest: string } {
  const content = { ...body, version: 1 as const };
  return { ...content, at, digest: digest(content) };
}
export type DiskRecord = StoreCheckpoint | StoreEntry | OwnerClaim | OwnerClosed;
export type RecordKind = "checkpoint" | "entry" | "claim" | "closed";
const base = "version at digest";
function schema(v: Record<string, unknown>, kind: RecordKind): boolean {
  if (!text(v.at) || !text(v.digest)) return false;
  if (kind === "entry") {
    if (!integer(v.sequence) || !integer(v.generation) || !validKey(v.key) || !text(v.inputDigest) || !text(v.outputDigest)) return false;
    return v.kind === "intent" ? fields(v, `${base} kind sequence generation key inputDigest outputDigest`)
      : v.kind === "receipt" && fields(v, `${base} kind sequence generation key intentSequence receipt inputDigest outputDigest`) &&
        integer(v.intentSequence) && validReceipt(v.receipt);
  }
  if (kind === "checkpoint") return fields(v, `${base} scope generation lastEntry entriesDigest terminal pendingAtCheckpoint`) &&
    validScope(v.scope) && integer(v.generation) && integer(v.lastEntry, 0) && text(v.entriesDigest) &&
    Array.isArray(v.terminal) && v.terminal.every(validTerminal) && Array.isArray(v.pendingAtCheckpoint) && v.pendingAtCheckpoint.every(validPending);
  if (kind === "closed") return fields(v, `${base} generation lastEntry claimDigest`) && integer(v.generation) && integer(v.lastEntry, 0) && text(v.claimDigest);
  return fields(v, `${base} scope generation owner predecessor`) && validScope(v.scope) && integer(v.generation) &&
    object(v.owner) && fields(v.owner, "pid startToken hostToken") && integer(v.owner.pid) && text(v.owner.startToken) && text(v.owner.hostToken) &&
    (v.predecessor === null || (object(v.predecessor) && fields(v.predecessor, "generation disposition claimDigest") &&
      integer(v.predecessor.generation) && ["closed", "dead"].includes(String(v.predecessor.disposition)) && text(v.predecessor.claimDigest)));
}
/** Reject unencodable caller data as a named refusal, before a pure fold can throw. */
function readTypedRecord(value: unknown, kind: RecordKind, record: string): StoreResult<DiskRecord> {
  try { return readStoreRecord(JSON.stringify(value), kind, record); }
  catch { return refuse({ kind: "invalid-input" }); }
}

/** Strictly reads one whole record. JSON trailing whitespace is allowed; trailing data is not. */
export function readStoreRecord(source: string, kind: "checkpoint", record: string): StoreResult<StoreCheckpoint>;
export function readStoreRecord(source: string, kind: "entry", record: string): StoreResult<StoreEntry>;
export function readStoreRecord(source: string, kind: "claim", record: string): StoreResult<OwnerClaim>;
export function readStoreRecord(source: string, kind: "closed", record: string): StoreResult<OwnerClosed>;
export function readStoreRecord(source: string, kind: RecordKind, record: string): StoreResult<DiskRecord>;
export function readStoreRecord(source: string, kind: RecordKind, record: string): StoreResult<DiskRecord> {
  const bad = (reason: "json" | "version" | "schema" | "digest") => refuse({
    kind: kind === "entry" ? "entry-corrupt" : kind === "checkpoint" ? "checkpoint-corrupt" : "ownership-record-corrupt", reason, record,
  });
  let v: unknown;
  try { v = JSON.parse(source); } catch { return bad("json"); }
  if (!object(v)) return bad("schema");
  if (v.version !== 1) return bad("version");
  if (!schema(v, kind)) return bad("schema");
  const { at: _at, digest: stored, ...body } = v;
  if (digest(body) !== stored) return bad("digest");
  if (kind === "entry") {
    const e = v as unknown as StoreEntry;
    const expected = e.kind === "intent" ? intentEntryOf(e.key, e.sequence, e.generation, e.at)
      : receiptEntryOf({ status: "pending", key: e.key, generation: e.generation, sinceEntry: e.intentSequence }, e.receipt, e.sequence, e.at);
    if (!same(e, expected)) return bad("digest");
  }
  return success(v as unknown as DiskRecord);
}

/** Full tuple encoding is the map key. No truncated hash is used for equality. */
export const intentIdentity = (key: IntentKey): string => canonicalJson([key.repository, key.task, key.workflowStep, key.attempt, key.inputRevision]);
export function settlePending(pending: SessionPending, entry: ReceiptEntry): StoreResult<EffectStatus> {
  const validated = readTypedRecord(entry, "entry", "receipt");
  if (!validated.ok) return validated;
  if (!validPending(pending) || pending.status !== "pending" || !same(pending.key, entry.key) || pending.generation !== entry.generation ||
      pending.sinceEntry !== entry.intentSequence || entry.sequence <= pending.sinceEntry) return refuse({ kind: "chronology", sequence: entry.sequence });
  const identity = { key: structuredClone(pending.key), generation: pending.generation, sinceEntry: pending.sinceEntry };
  if (entry.receipt.delivered) return success({ ...identity, status: "sent", receiptSequence: entry.sequence, reference: entry.receipt.reference });
  const proof = proofFromReceipt({ ...entry, receipt: entry.receipt });
  return proof.ok ? success({ ...identity, status: "unsent", proof: proof.value }) : proof;
}
export function orphanPending(pending: SessionPending): EffectStatus {
  return { status: "unknown", key: structuredClone(pending.key), generation: pending.generation, sinceEntry: pending.sinceEntry };
}
/** Replay the complete tail before closing receipt-less intents. Terminal unknown has no outgoing edge. */
export function foldStore(checkpoint: StoreCheckpoint, tail: readonly StoreEntry[], openGeneration: number | null): StoreResult<StoreState> {
  const validated = readTypedRecord(checkpoint, "checkpoint", "checkpoint");
  if (!validated.ok) return validated;
  if (openGeneration !== null && (!integer(openGeneration) || openGeneration < checkpoint.generation)) return refuse({ kind: "generation-regression", sequence: checkpoint.lastEntry });
  for (const effect of [...checkpoint.terminal, ...checkpoint.pendingAtCheckpoint]) {
    if (effect.generation > checkpoint.generation || effect.sinceEntry > checkpoint.lastEntry ||
        effect.key.repository !== checkpoint.scope.repository) return refuse({ kind: "chronology", sequence: effect.sinceEntry });
    const receiptSequence = effect.status === "sent" ? effect.receiptSequence : effect.status === "unsent" ? effect.proof.receiptSequence : null;
    if (receiptSequence !== null && (receiptSequence <= effect.sinceEntry || receiptSequence > checkpoint.lastEntry))
      return refuse({ kind: "chronology", sequence: receiptSequence });
  }
  const terminal = new Map(checkpoint.terminal.map(e => [intentIdentity(e.key), structuredClone(e)]));
  const pending = new Map(checkpoint.pendingAtCheckpoint.map(e => [intentIdentity(e.key), structuredClone(e)]));
  if (terminal.size !== checkpoint.terminal.length || pending.size !== checkpoint.pendingAtCheckpoint.length ||
      [...pending.keys()].some(k => terminal.has(k))) return refuse({ kind: "chronology", sequence: checkpoint.lastEntry });
  let sequence = checkpoint.lastEntry;
  let generation = checkpoint.generation;
  for (const entry of tail) {
    const validatedEntry = readTypedRecord(entry, "entry", String(entry.sequence));
    if (!validatedEntry.ok) return validatedEntry;
    if (entry.key.repository !== checkpoint.scope.repository) return refuse({ kind: "scope-mismatch" });
    if (entry.sequence !== sequence + 1) return refuse({ kind: "journal-gap", sequence: sequence + 1 });
    if (entry.generation < generation || (openGeneration !== null && entry.generation > openGeneration)) return refuse({ kind: "generation-regression", sequence: entry.sequence });
    sequence = entry.sequence; generation = entry.generation;
    const key = intentIdentity(entry.key);
    if (entry.kind === "intent") {
      if (terminal.has(key) || pending.has(key)) return refuse({ kind: "chronology", sequence });
      pending.set(key, { status: "pending", key: structuredClone(entry.key), generation, sinceEntry: sequence });
    } else {
      if (terminal.get(key)?.status === "unknown") return refuse({ kind: "receipt-after-orphan", sequence });
      const intent = pending.get(key);
      if (!intent) return refuse({ kind: "chronology", sequence });
      const settled = settlePending(intent, entry);
      if (!settled.ok) return settled;
      pending.delete(key); terminal.set(key, settled.value);
    }
  }
  for (const [key, intent] of pending) {
    if (intent.generation !== openGeneration) { terminal.set(key, orphanPending(intent)); pending.delete(key); }
  }
  const byKey = (a: { readonly key: IntentKey }, b: { readonly key: IntentKey }) => (intentIdentity(a.key) < intentIdentity(b.key) ? -1 : intentIdentity(a.key) > intentIdentity(b.key) ? 1 : 0);
  return success({ terminal: [...terminal.values()].sort(byKey), pending: [...pending.values()].sort(byKey), lastEntry: sequence });
}
export function checkpointOf(scope: StoreScope, generation: number, entries: readonly StoreEntry[], state: StoreState, at: string): StoreCheckpoint {
  return envelope({ scope: structuredClone(scope), generation, lastEntry: state.lastEntry,
    entriesDigest: digest(entries.map(e => e.digest)), terminal: structuredClone(state.terminal), pendingAtCheckpoint: structuredClone(state.pending) }, at);
}
export const genesisOf = (scope: StoreScope, generation: number, at: string): StoreCheckpoint =>
  checkpointOf(scope, generation, [], { terminal: [], pending: [], lastEntry: 0 }, at);

/** Retained history is authoritative: a checkpoint may not invent, omit or alter an effect. */
export function validateHistory(checkpoint: StoreCheckpoint, entries: readonly StoreEntry[]): StoreResult<void> {
  for (const [i, entry] of entries.entries()) {
    if (entry.sequence !== i + 1) return refuse({ kind: "journal-gap", sequence: i + 1 });
    if (entry.key.repository !== checkpoint.scope.repository) return refuse({ kind: "scope-mismatch" });
  }
  if (checkpoint.lastEntry > entries.length) return refuse({ kind: "journal-gap", sequence: entries.length + 1 });
  const prefix = entries.slice(0, checkpoint.lastEntry);
  if (digest(prefix.map(e => e.digest)) !== checkpoint.entriesDigest) return refuse({ kind: "checkpoint-corrupt", reason: "digest", record: "checkpoint" });
  const folded = foldStore(genesisOf(checkpoint.scope, 1, checkpoint.at), prefix, checkpoint.generation);
  if (!folded.ok) return folded;
  if (!same(folded.value.terminal, checkpoint.terminal) || !same(folded.value.pending, checkpoint.pendingAtCheckpoint))
    return refuse({ kind: "checkpoint-corrupt", reason: "schema", record: "checkpoint" });
  return success(undefined);
}
