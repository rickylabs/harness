/** Durable orchestration evidence. This port performs no dispatch and chooses no production store. */
export interface StoreScope {
  readonly repository: string;
  readonly milestone: string;
}
export interface IntentKey {
  readonly repository: string;
  readonly task: string;
  readonly workflowStep: string;
  readonly attempt: number;
  readonly inputRevision: string;
}
export interface StoreOwner {
  readonly pid: number;
  readonly startToken: string;
  readonly hostToken: string;
}
export interface StoreHolder {
  readonly generation: number;
  readonly owner: StoreOwner;
}
export interface StoreEnvelope {
  readonly version: 1;
  /** Boundary clock; excluded from semantic digests. */
  readonly at: string;
  readonly digest: string;
}
export interface OwnerClaim extends StoreEnvelope, StoreHolder {
  readonly scope: StoreScope;
  readonly predecessor: null | {
    readonly generation: number;
    readonly disposition: "closed" | "dead";
    readonly claimDigest: string;
  };
}
export interface OwnerClosed extends StoreEnvelope {
  readonly generation: number;
  readonly lastEntry: number;
  readonly claimDigest: string;
}
export interface IntentEntry extends StoreEnvelope {
  readonly kind: "intent";
  readonly sequence: number;
  readonly generation: number;
  readonly key: IntentKey;
  readonly inputDigest: string;
  readonly outputDigest: string;
}
export type DeliveryReceipt =
  | { readonly delivered: true; readonly reference: string }
  | { readonly delivered: false; readonly reason: string };
export interface ReceiptEntry extends StoreEnvelope {
  readonly kind: "receipt";
  readonly sequence: number;
  readonly generation: number;
  readonly key: IntentKey;
  readonly intentSequence: number;
  readonly receipt: DeliveryReceipt;
  readonly inputDigest: string;
  readonly outputDigest: string;
}
export type StoreEntry = IntentEntry | ReceiptEntry;
declare const nonDelivery: unique symbol;
/** Created only from a validated negative receipt by coordinator's proofFromReceipt. */
export interface NonDeliveryProof {
  readonly [nonDelivery]: true;
  readonly receiptSequence: number;
  readonly receiptDigest: string;
  readonly reason: string;
}
export interface SessionPending {
  readonly status: "pending";
  readonly key: IntentKey;
  readonly generation: number;
  readonly sinceEntry: number;
}
interface EffectIdentity {
  readonly key: IntentKey;
  readonly generation: number;
  readonly sinceEntry: number;
}
/** Terminal states have no settlement transition. Unknown is never evidence of non-delivery. */
export type EffectStatus = EffectIdentity & (
  | { readonly status: "sent"; readonly receiptSequence: number; readonly reference: string }
  | { readonly status: "unsent"; readonly proof: NonDeliveryProof }
  | { readonly status: "unknown" }
);
export interface StoreState {
  readonly terminal: readonly EffectStatus[];
  readonly pending: readonly SessionPending[];
  readonly lastEntry: number;
}
export interface StoreCheckpoint extends StoreEnvelope {
  readonly scope: StoreScope;
  readonly generation: number;
  readonly lastEntry: number;
  readonly entriesDigest: string;
  readonly terminal: readonly EffectStatus[];
  readonly pendingAtCheckpoint: readonly SessionPending[];
}
export type StoreRefusal =
  | { readonly kind: "held" | "stale-lock" | "holder-liveness-unknown" | "holder-changed"; readonly holder: StoreHolder }
  | { readonly kind: "lost-race" | "revoked"; readonly generation: number }
  | { readonly kind: "generation-fork"; readonly generations: readonly [number, number]; readonly sequence: number }
  | { readonly kind: "checkpoint-corrupt" | "entry-corrupt" | "ownership-record-corrupt"; readonly reason: "version" | "schema" | "digest" | "json"; readonly record: string }
  | { readonly kind: "journal-gap" | "sequence-taken" | "generation-regression" | "receipt-after-orphan" | "chronology"; readonly sequence: number }
  | { readonly kind: "publication-uncertain" | "io-failure"; readonly operation: string }
  | { readonly kind: "uninitialised" | "already-initialised" | "checkpoint-missing-with-history" | "closed" | "poisoned" | "scope-mismatch" | "invalid-input" };
export type StoreResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: StoreRefusal };
/** A handle owns exactly one generation. All calls serialize; close permanently seals it. */
export interface StateStoreHandle {
  readonly holder: StoreHolder;
  /** Explicit genesis, legal only without any checkpoint or journal history. */
  initialize(): Promise<StoreResult<StoreCheckpoint>>;
  read(): Promise<StoreResult<StoreState>>;
  /** Await durable success before attempting the effect. Success does not authorize retries. */
  intent(key: IntentKey): Promise<StoreResult<SessionPending>>;
  /** Await durable success before acknowledging an effect. Only this session's pending intent can settle. */
  receipt(pending: SessionPending, receipt: DeliveryReceipt): Promise<StoreResult<EffectStatus>>;
  checkpoint(): Promise<StoreResult<StoreCheckpoint>>;
  /** Drain queued calls and permanently seal. A poisoned handle cannot publish a clean release. */
  close(): Promise<StoreResult<void>>;
}
export interface StateStore {
  /** Acquire once without waiting or retrying. Unclosed live and stale holders refuse by identity. */
  open(): Promise<StoreResult<StateStoreHandle>>;
  /** Expected identity is checked; the adapter must establish death itself. */
  recover(expectedHolder: StoreHolder): Promise<StoreResult<StateStoreHandle>>;
}
