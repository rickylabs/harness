/** An in-memory fake for consumers of the port. It makes no durability or process-death claim. */
import type { DeliveryReceipt, EffectStatus, IntentKey, SessionPending, StateStore, StateStoreHandle,
  StoreCheckpoint, StoreEntry, StoreHolder, StoreResult, StoreScope, StoreState } from "@rickylabs/harness-contracts";
import { intentEntryOf, receiptEntryOf } from "./journal.js";
import { checkpointOf, foldStore, genesisOf, refuse, same, success, validKey, validPending, validReceipt, validScope } from "./state-store.js";

export class MemoryStateStore implements StateStore {
  private generation = 0;
  private held: StoreHolder | null = null;
  private dead = false;
  private checkpointValue: StoreCheckpoint | null = null;
  private entries: StoreEntry[] = [];
  private readonly scope: StoreScope;
  constructor(scope: StoreScope, private readonly clock: () => string) { this.scope = structuredClone(scope); }
  /** Test-only simulated process loss. Existing handles are fenced; recovery still requires identity. */
  simulateCrash(): void { if (this.held) this.dead = true; }
  async open(): Promise<StoreResult<StateStoreHandle>> {
    if (!validScope(this.scope)) return refuse({ kind: "invalid-input" });
    if (this.held) return refuse({ kind: this.dead ? "stale-lock" : "held", holder: structuredClone(this.held) });
    return this.acquire();
  }
  async recover(expected: StoreHolder): Promise<StoreResult<StateStoreHandle>> {
    if (!this.held || !same(this.held, expected)) return refuse({ kind: "holder-changed", holder: structuredClone(this.held ?? expected) });
    if (!this.dead) return refuse({ kind: "held", holder: structuredClone(this.held) });
    return this.acquire();
  }
  private acquire(): StoreResult<StateStoreHandle> {
    this.generation += 1;
    const held: StoreHolder = { generation: this.generation, owner: { pid: 1, startToken: `memory-${this.generation}`, hostToken: "memory" } };
    this.held = held; this.dead = false;
    let closing = false;
    let queue: Promise<unknown> = Promise.resolve();
    let closePromise: Promise<StoreResult<void>> | null = null;
    const run = <T>(fn: () => StoreResult<T>): Promise<StoreResult<T>> => {
      if (closing) return Promise.resolve(refuse({ kind: "closed" }));
      const result = queue.then(() => {
        if (this.dead || !same(this.held, held)) return refuse({ kind: "revoked", generation: this.generation });
        try { return fn(); } catch { return refuse({ kind: "invalid-input" }); }
      });
      queue = result; return result;
    };
    const state = (): StoreResult<StoreState> => this.checkpointValue
      ? foldStore(this.checkpointValue, this.entries.slice(this.checkpointValue.lastEntry), held.generation)
      : refuse({ kind: "uninitialised" });
    const save = (): StoreResult<StoreCheckpoint> => {
      const value = state(); if (!value.ok) return value;
      const at = this.clock(); if (!at?.trim()) return refuse({ kind: "invalid-input" });
      this.checkpointValue = checkpointOf(this.scope, held.generation, this.entries, value.value, at);
      return success(structuredClone(this.checkpointValue));
    };
    const append = (entry: StoreEntry): StoreResult<StoreState> => {
      const value = state(); if (!value.ok) return value;
      const cp = checkpointOf(this.scope, held.generation, this.entries, value.value, entry.at);
      const next = foldStore(cp, [entry], held.generation);
      if (next.ok) this.entries.push(entry);
      return next;
    };
    const handle: StateStoreHandle = {
      get holder() { return structuredClone(held); },
      initialize: () => run(() => {
        if (this.checkpointValue || this.entries.length) return refuse({ kind: "already-initialised" });
        const at = this.clock(); if (!at?.trim()) return refuse({ kind: "invalid-input" });
        this.checkpointValue = genesisOf(this.scope, held.generation, at);
        return success(structuredClone(this.checkpointValue));
      }),
      read: () => run(state),
      intent: (key: IntentKey) => {
        let input: IntentKey;
        try { input = structuredClone(key); } catch { return Promise.resolve(refuse({ kind: "invalid-input" })); }
        return run(() => {
          if (!validKey(input) || input.repository !== this.scope.repository) return refuse({ kind: "invalid-input" });
          const entry = intentEntryOf(input, this.entries.length + 1, held.generation, this.clock());
          const next = append(entry);
          return next.ok ? success(next.value.pending.find(p => same(p.key, input))!) : next;
        });
      },
      receipt: (pending: SessionPending, receipt: DeliveryReceipt) => {
        let input: SessionPending; let output: DeliveryReceipt;
        try { input = structuredClone(pending); output = structuredClone(receipt); } catch { return Promise.resolve(refuse({ kind: "invalid-input" })); }
        return run((): StoreResult<EffectStatus> => {
          if (!validPending(input) || !validReceipt(output)) return refuse({ kind: "invalid-input" });
          const value = state(); if (!value.ok) return value;
          if (value.value.terminal.some(e => same(e.key, input.key) && e.status === "unknown")) return refuse({ kind: "receipt-after-orphan", sequence: this.entries.length + 1 });
          if (input.generation !== held.generation || !value.value.pending.some(p => same(p, input))) return refuse({ kind: "chronology", sequence: this.entries.length + 1 });
          const next = append(receiptEntryOf(input, output, this.entries.length + 1, this.clock()));
          return next.ok ? success(next.value.terminal.find(p => same(p.key, input.key))!) : next;
        });
      },
      checkpoint: () => run(save),
      close: () => {
        if (closePromise) return closePromise;
        closing = true;
        closePromise = queue.then(() => {
          if (this.dead || !same(this.held, held)) return refuse({ kind: "revoked", generation: this.generation });
          this.held = null; return success(undefined);
        });
        return closePromise;
      },
    };
    return success(handle);
  }
}
