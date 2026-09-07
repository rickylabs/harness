/** Local, single-host reference driver. Requires an existing directory on a local filesystem. */
import { open, readdir, readFile, link, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import type {
  DeliveryReceipt, EffectStatus, IntentKey, OwnerClaim, OwnerClosed, SessionPending, StateStore,
  StateStoreHandle, StoreCheckpoint, StoreEntry, StoreHolder, StoreRefusal, StoreResult, StoreScope, StoreState,
} from "@rickylabs/harness-contracts";
import { intentEntryOf, receiptEntryOf } from "./journal.js";
import { checkpointOf, envelope, foldStore, genesisOf, readStoreRecord, refuse, same, success,
  validateHistory, validKey, validPending, validReceipt, validScope } from "./state-store.js";

/** Hooks are fault/crash instrumentation, never an alternate liveness observer or PID source. */
export interface StoreIOPoint {
  readonly phase: "observed-predecessor" | "mid-temp-write" | "file-synced" | "published" | "before-directory-sync" | "directory-synced";
  readonly record: string;
}
export interface FileStateStoreOptions {
  readonly directory: string;
  readonly scope: StoreScope;
  readonly clock: () => string;
  readonly onPoint?: (point: StoreIOPoint) => void | Promise<void>;
}
class StoreFault extends Error {
  constructor(readonly refusal: StoreRefusal) { super(refusal.kind); }
}
const fault = (refusal: StoreRefusal): never => { throw new StoreFault(refusal); };
const errno = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code;
const failed = (e: unknown, operation: string) => refuse(e instanceof StoreFault ? e.refusal : { kind: "io-failure", operation });
const numberName = (n: number): string => String(n).padStart(16, "0");
export const entryName = (n: number): string => `entry.${numberName(n)}`;
export const claimName = (n: number): string => `owner.${n}.claim`;
export const closedName = (n: number): string => `owner.${n}.closed`;
interface History {
  readonly claims: readonly OwnerClaim[];
  readonly closed: ReadonlyMap<number, OwnerClosed>;
  readonly entries: readonly StoreEntry[];
  readonly checkpoint: StoreCheckpoint | null;
}
function unwrap<T>(r: StoreResult<T>): T { if (!r.ok) return fault(r.refusal); return r.value; }
function current(h: History): OwnerClaim | undefined { return h.claims.at(-1); }
function holder(claim: OwnerClaim): StoreHolder { return { generation: claim.generation, owner: structuredClone(claim.owner) }; }

class FileStoreDriver implements StateStore {
  private readonly options: FileStateStoreOptions;
  constructor(options: FileStateStoreOptions) {
    // Detach the scope now, before the first asynchronous operation can observe caller mutation.
    this.options = { ...options, directory: resolve(options.directory), scope: structuredClone(options.scope) };
  }
  async open(): Promise<StoreResult<StateStoreHandle>> { return this.acquire(null); }
  async recover(expectedHolder: StoreHolder): Promise<StoreResult<StateStoreHandle>> {
    return this.acquire(structuredClone(expectedHolder));
  }
  private async acquire(expected: StoreHolder | null): Promise<StoreResult<StateStoreHandle>> {
    try {
      if (!validScope(this.options.scope)) return refuse({ kind: "invalid-input" });
      // Corruption found here never publishes a claim. A racing defensive read can burn a claim.
      const history = await this.load(true);
      const prior = current(history);
      let disposition: "closed" | "dead" = "closed";
      if (expected !== null && (!prior || !same(holder(prior), expected))) {
        return refuse({ kind: "holder-changed", holder: prior ? holder(prior) : expected });
      }
      if (prior && !history.closed.has(prior.generation)) {
        const observed = this.liveness(prior);
        if (expected === null || observed !== "dead") return refuse({ kind: observed === "dead" ? "stale-lock" : observed === "live" ? "held" : "holder-liveness-unknown", holder: holder(prior) });
        disposition = "dead";
      } else if (expected !== null && prior) {
        // recover is not an alternate clean-open path or an excuse to skip the death check.
        return refuse({ kind: "holder-changed", holder: holder(prior) });
      }
      await this.load(); // With a closed/dead predecessor, data can no longer change beneath this read.
      const generation = (prior?.generation ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) return refuse({ kind: "invalid-input" });
      const claim: OwnerClaim = envelope({ scope: this.options.scope, generation,
        owner: { pid: process.pid, startToken: randomUUID(), hostToken: hostname() },
        predecessor: prior ? { generation: prior.generation, disposition, claimDigest: prior.digest } : null,
      }, this.now());
      await this.point("observed-predecessor", claimName(generation));
      await this.publish(claimName(generation), claim, false, { kind: "lost-race", generation });
      const after = await this.load();
      if (!same(current(after), claim)) return refuse({ kind: "revoked", generation: current(after)?.generation ?? generation });
      return success(new FileHandle(this, claim));
    } catch (e) { return failed(e, "acquire"); }
  }
  private liveness(claim: OwnerClaim): "dead" | "live" | "unknown" {
    if (claim.owner.hostToken !== hostname()) return "unknown";
    try { process.kill(claim.owner.pid, 0); return "live"; }
    catch (e) { return errno(e) === "ESRCH" ? "dead" : "unknown"; }
  }
  now(): string {
    const at = this.options.clock();
    if (typeof at !== "string" || !at.trim()) return fault({ kind: "invalid-input" });
    return at;
  }
  scope(): StoreScope { return structuredClone(this.options.scope); }
  private async point(phase: StoreIOPoint["phase"], record: string): Promise<void> { await this.options.onPoint?.({ phase, record }); }
  async publish(record: string, value: object, replace: boolean, taken: StoreRefusal): Promise<void> {
    const candidate = join(this.options.directory, `cand.${randomUUID()}`);
    let published = false;
    let ownsCandidate = false;
    try {
      const file = await open(candidate, "wx", 0o600);
      ownsCandidate = true;
      try {
        const bytes = Buffer.from(JSON.stringify(value) + "\n");
        const cut = Math.floor(bytes.length / 2);
        await file.writeFile(bytes.subarray(0, cut));
        await this.point("mid-temp-write", record);
        await file.writeFile(bytes.subarray(cut));
        await file.sync();
        await this.point("file-synced", record);
      } finally { await file.close(); }
      try {
        if (replace) await rename(candidate, join(this.options.directory, record));
        else await link(candidate, join(this.options.directory, record));
      } catch (e) { if (errno(e) === "EEXIST") return fault(taken); throw e; }
      published = true;
      await this.point("published", record);
      await this.point("before-directory-sync", record);
      const directory = await open(this.options.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
      await this.point("directory-synced", record);
    } catch (e) {
      if (published) return fault({ kind: "publication-uncertain", operation: record });
      if (e instanceof StoreFault) throw e;
      return fault({ kind: "io-failure", operation: record });
    } finally {
      // Only our unique candidate is removable. Permanent names are never removed, even on error.
      if (ownsCandidate) {
        try { await unlink(candidate); } catch { /* A renamed candidate is already absent. */ }
      }
    }
  }
  async load(ownershipOnly = false): Promise<History> {
    const names = await readdir(this.options.directory);
    const claims: OwnerClaim[] = [];
    const closed = new Map<number, OwnerClosed>();
    const entries: StoreEntry[] = [];
    let checkpoint: StoreCheckpoint | null = null;
    for (const name of names.sort()) {
      let kind: "claim" | "closed" | "checkpoint" | "entry";
      if (name === "checkpoint") kind = "checkpoint";
      else if (/^owner\.[1-9]\d*\.claim$/.test(name)) kind = "claim";
      else if (/^owner\.[1-9]\d*\.closed$/.test(name)) kind = "closed";
      else if (/^entry\.\d{16}$/.test(name)) kind = "entry";
      else if (name.startsWith("cand.")) continue;
      else return fault({ kind: name.startsWith("entry.") ? "entry-corrupt" : "ownership-record-corrupt", reason: "schema", record: name });
      if (ownershipOnly && kind === "checkpoint") continue;
      const record = unwrap(readStoreRecord(await readFile(join(this.options.directory, name), "utf8"), kind, name));
      if (kind === "claim") {
        const claim = record as OwnerClaim;
        if (claimName(claim.generation) !== name) return fault({ kind: "ownership-record-corrupt", reason: "schema", record: name });
        if (!same(claim.scope, this.options.scope)) return fault({ kind: "scope-mismatch" });
        claims.push(claim);
      } else if (kind === "closed") {
        const marker = record as OwnerClosed;
        if (closedName(marker.generation) !== name) return fault({ kind: "ownership-record-corrupt", reason: "schema", record: name });
        closed.set(marker.generation, marker);
      } else if (kind === "entry") {
        const entry = record as StoreEntry;
        if (entryName(entry.sequence) !== name) return fault({ kind: "entry-corrupt", reason: "schema", record: name });
        entries.push(entry);
      } else checkpoint = record as StoreCheckpoint;
    }
    claims.sort((a, b) => a.generation - b.generation);
    entries.sort((a, b) => a.sequence - b.sequence);
    const divergent = (a: number, b: number): never => fault({ kind: "generation-fork", generations: [a, b], sequence: entries.find(e => e.generation >= b)?.sequence ?? entries.length + 1 });
    for (const [i, claim] of claims.entries()) {
      const prior = claims[i - 1];
      if (claim.generation !== i + 1) return divergent(prior?.generation ?? 0, claim.generation);
      if (!prior) { if (claim.predecessor !== null) return divergent(0, claim.generation); }
      else if (claim.predecessor === null || claim.predecessor.generation !== prior.generation ||
        claim.predecessor.claimDigest !== prior.digest ||
        (claim.predecessor.disposition === "closed" && !closed.has(prior.generation)) ||
        (claim.predecessor.disposition === "dead" && closed.has(prior.generation))) return divergent(prior.generation, claim.generation);
    }
    if (ownershipOnly) return { claims, closed, entries, checkpoint };
    for (const [i, entry] of entries.entries()) {
      if (entry.sequence !== i + 1) return fault({ kind: "journal-gap", sequence: i + 1 });
    }
    for (const [g, marker] of closed) {
      const claim = claims[g - 1];
      if (marker.lastEntry > entries.length) return fault({ kind: "journal-gap", sequence: entries.length + 1 });
      if (!claim || marker.claimDigest !== claim.digest) return fault({ kind: "ownership-record-corrupt", reason: "schema", record: closedName(g) });
      const boundary = entries.filter(e => e.generation <= g).at(-1)?.sequence ?? 0;
      if (boundary !== marker.lastEntry) return fault({ kind: "generation-fork", generations: [g, g + 1], sequence: Math.min(boundary, marker.lastEntry) + 1 });
    }
    let previousGeneration = 1;
    for (const [i, entry] of entries.entries()) {
      if (entry.sequence !== i + 1) return fault({ kind: "journal-gap", sequence: i + 1 });
      if (!claims[entry.generation - 1] || entry.generation < previousGeneration) return fault({ kind: "generation-fork", generations: [previousGeneration, entry.generation], sequence: entry.sequence });
      previousGeneration = entry.generation;
    }
    if (!checkpoint && entries.length) return fault({ kind: "checkpoint-missing-with-history" });
    if (checkpoint) {
      if (!same(checkpoint.scope, this.options.scope)) return fault({ kind: "scope-mismatch" });
      if (!claims[checkpoint.generation - 1]) return fault({ kind: "generation-regression", sequence: checkpoint.lastEntry });
      unwrap(validateHistory(checkpoint, entries));
      const latest = claims.at(-1);
      unwrap(foldStore(checkpoint, entries.slice(checkpoint.lastEntry), latest && !closed.has(latest.generation) ? latest.generation : null));
    }
    return { claims, closed, entries, checkpoint };
  }
}

class FileHandle implements StateStoreHandle {
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  private sealed = false;
  private poisoned = false;
  private revoked: number | null = null;
  private closePromise: Promise<StoreResult<void>> | null = null;
  constructor(private readonly store: FileStoreDriver, private readonly claim: OwnerClaim) {}
  get holder(): StoreHolder { return holder(this.claim); }
  private run<T>(operation: () => Promise<T>): Promise<StoreResult<T>> {
    if (this.closing || this.sealed) return Promise.resolve(refuse({ kind: "closed" }));
    const result = this.queue.then(async (): Promise<StoreResult<T>> => {
      if (this.poisoned) return refuse({ kind: "poisoned" });
      if (this.revoked !== null) return refuse({ kind: "revoked", generation: this.revoked });
      try { return success(await operation()); }
      catch (e) {
        if (e instanceof StoreFault) {
          if (e.refusal.kind === "publication-uncertain") this.poisoned = true;
          if (e.refusal.kind === "sequence-taken" || e.refusal.kind === "revoked") this.revoked = e.refusal.kind === "revoked" ? e.refusal.generation : this.claim.generation;
        }
        return failed(e, "handle");
      }
    });
    this.queue = result;
    return result;
  }
  private async owned(): Promise<History> {
    const history = await this.store.load();
    const latest = current(history);
    if (!latest || !same(latest, this.claim) || history.closed.has(this.claim.generation)) return fault({ kind: "revoked", generation: latest?.generation ?? this.claim.generation });
    return history;
  }
  private state(history: History): StoreState {
    if (!history.checkpoint) return fault({ kind: "uninitialised" });
    return unwrap(foldStore(history.checkpoint, history.entries.slice(history.checkpoint.lastEntry), this.claim.generation));
  }
  initialize(): Promise<StoreResult<StoreCheckpoint>> {
    return this.run(async () => {
      const h = await this.owned();
      if (h.checkpoint || h.entries.length) return fault({ kind: "already-initialised" });
      const cp = genesisOf(this.store.scope(), this.claim.generation, this.store.now());
      await this.store.publish("checkpoint", cp, true, { kind: "already-initialised" });
      return cp;
    });
  }
  read(): Promise<StoreResult<StoreState>> { return this.run(async () => this.state(await this.owned())); }
  intent(key: IntentKey): Promise<StoreResult<SessionPending>> {
    let input: IntentKey;
    try { input = structuredClone(key); } catch { return Promise.resolve(refuse({ kind: "invalid-input" })); }
    return this.run(async () => {
      if (!validKey(input) || input.repository !== this.store.scope().repository) return fault({ kind: "invalid-input" });
      const h = await this.owned(); const state = this.state(h);
      const sequence = state.lastEntry + 1;
      const entry = intentEntryOf(input, sequence, this.claim.generation, this.store.now());
      const result = unwrap(foldStore(checkpointOf(this.store.scope(), this.claim.generation, h.entries, state, entry.at), [entry], this.claim.generation));
      await this.store.publish(entryName(sequence), entry, false, { kind: "sequence-taken", sequence });
      return result.pending.find(p => same(p.key, input))!;
    });
  }
  receipt(pending: SessionPending, receipt: DeliveryReceipt): Promise<StoreResult<EffectStatus>> {
    let input: SessionPending; let output: DeliveryReceipt;
    try { input = structuredClone(pending); output = structuredClone(receipt); } catch { return Promise.resolve(refuse({ kind: "invalid-input" })); }
    return this.run(async () => {
      if (!validPending(input) || !validReceipt(output)) return fault({ kind: "invalid-input" });
      const h = await this.owned(); const state = this.state(h);
      const sequence = state.lastEntry + 1;
      const terminal = state.terminal.find(e => same(e.key, input.key));
      if (terminal?.status === "unknown") return fault({ kind: "receipt-after-orphan", sequence });
      if (input.generation !== this.claim.generation || !state.pending.some(p => same(p, input))) return fault({ kind: "chronology", sequence });
      const entry = receiptEntryOf(input, output, sequence, this.store.now());
      const result = unwrap(foldStore(checkpointOf(this.store.scope(), this.claim.generation, h.entries, state, entry.at), [entry], this.claim.generation));
      await this.store.publish(entryName(sequence), entry, false, { kind: "sequence-taken", sequence });
      return result.terminal.find(p => same(p.key, input.key))!;
    });
  }
  checkpoint(): Promise<StoreResult<StoreCheckpoint>> {
    return this.run(async () => {
      const h = await this.owned();
      const cp = checkpointOf(this.store.scope(), this.claim.generation, h.entries, this.state(h), this.store.now());
      await this.store.publish("checkpoint", cp, true, { kind: "invalid-input" });
      return cp;
    });
  }
  close(): Promise<StoreResult<void>> {
    if (this.closePromise) return this.closePromise;
    this.closing = true; // Calls submitted after close cannot join the drain.
    this.closePromise = this.queue.then(async () => {
      this.sealed = true; // No future write can follow the marker, even if publishing it fails.
      if (this.poisoned) return refuse({ kind: "poisoned" });
      if (this.revoked !== null) return refuse({ kind: "revoked", generation: this.revoked });
      try {
        const h = await this.owned();
        const marker: OwnerClosed = envelope({ generation: this.claim.generation, lastEntry: h.entries.length, claimDigest: this.claim.digest }, this.store.now());
        await this.store.publish(closedName(this.claim.generation), marker, false, { kind: "revoked", generation: this.claim.generation });
        return success(undefined);
      } catch (e) { return failed(e, "close"); }
    });
    return this.closePromise;
  }
}

/** The public adapter exposes only acquisition; publication remains behind its owning handle. */
export class FileStateStore implements StateStore {
  private readonly driver: FileStoreDriver;
  constructor(options: FileStateStoreOptions) { this.driver = new FileStoreDriver(options); }
  open(): Promise<StoreResult<StateStoreHandle>> { return this.driver.open(); }
  recover(expectedHolder: StoreHolder): Promise<StoreResult<StateStoreHandle>> { return this.driver.recover(expectedHolder); }
}
