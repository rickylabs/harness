/**
 * `EventFold` — the client side of the protocol: frames in, state out.
 *
 * The reason this lives in the published contract rather than in each cockpit is that the fold's
 * rules are not presentation. "Discard a frame from a dead generation", "a gap means resync", "an
 * older seq must not overwrite a newer value" are correctness properties of the wire, and two
 * hand-written implementations of them would differ exactly where the difference is invisible: both
 * screens keep rendering, one of them is wrong, and nothing says which.
 *
 * Nothing here performs I/O, reads a clock, or knows what a WebSocket is. A step is a pure function
 * of the fold and one frame, which is what makes the reconnect argument testable at all.
 *
 * ## The one invariant: the fold holds nothing a snapshot cannot restore
 *
 * Every field of `EventFold` is either bookkeeping about the connection or something a
 * `RemoteSnapshot` sets. That is not tidiness — it is the whole of acceptance criterion 1. A client
 * that accumulated anything else (a list of recently resolved approvals, a "last error", a count of
 * events seen per task) would have state that a resync cannot reproduce, and two clients that
 * received the same stream in a different order would disagree forever with no way to converge.
 *
 * So an `approval.resolved` event removes the pending approval and is otherwise a notification: the
 * caller still has the event and can toast it, but the fold keeps nothing, because the snapshot has
 * nowhere to put it.
 *
 * ## Deltas are an optimisation; the snapshot is the truth
 *
 * A valid snapshot on a bound stream overwrites and clears `needsResync`, even after a gap.
 * Deltas never *establish* state: one arriving before any snapshot is discarded and provokes a
 * resync rather than seeding a fold with a single task in it, because a fold seeded that way looks
 * complete and is not.
 *
 * ## What is counted and what is lost
 *
 * `seq` is per-generation and contiguous, so a gap is the only loss signal there is. Three cases
 * have to stay distinct or the signal breaks:
 *
 * - a frame this client does not understand still carries a `seq`, so it advances the counter and is
 *   tallied in `counts.counted`. A server that learns to report something new must not look like a
 *   lossy link.
 * - a frame whose envelope could not be read carries nothing usable, so it does *not* advance the
 *   counter — and the next frame therefore reports the gap it caused. That is deliberate: the loss
 *   is real, and it is better detected one frame late than not at all.
 * - a frame from another generation is not part of this sequence at all. It never advances the
 *   counter, because its seq is measured against a different origin.
 */

import { PROTOCOL_VERSION, readServerEvent } from "./events.js";
import type { FrameReading, HelloEvent, ResyncFrame, ServerEvent } from "./events.js";
import type { GovernanceState, PendingApproval } from "./governance.js";
import type { RemoteSnapshot, RepoRef } from "./snapshot.js";
import type { BoardAnomaly, Lifecycle, TaskView } from "./tasks.js";
import type { RunView } from "./runs.js";

/**
 * How many frames of each kind the fold has seen.
 *
 * Exposed rather than logged because a cockpit that can say "42 applied, 3 I did not understand, 1
 * unreadable" is answering the question this whole project exists to delete. A client silently
 * dropping frames looks identical to a quiet system.
 */
export interface FoldCounts {
  readonly applied: number;
  /** Envelope accepted, payload not understood. Forward compatibility, not loss. */
  readonly counted: number;
  /** Wrong generation, replayed seq, or a delta with no snapshot behind it. */
  readonly discarded: number;
  /** Envelope unreadable, or a protocol this client cannot speak. */
  readonly refused: number;
  /** How many times a resync was asked for. */
  readonly resyncs: number;
  /** How many frames are believed to have been lost, in total. */
  readonly gapped: number;
}

/** The client's state. Every non-bookkeeping field is one a `RemoteSnapshot` sets. */
export interface EventFold {
  readonly protocol: number | null;
  readonly repo: RepoRef | null;
  /** Last display generation, from `hello` or a cold HTTP snapshot; not proof of binding. */
  readonly generation: number | null;
  /** Current-stream binding. Omitted legacy values use `generation !== null`. */
  readonly bound?: boolean;
  /** The last seq applied or counted in this generation. Null before the first frame. */
  readonly lastSeq: number | null;
  /** `generatedAt` of the last applied snapshot. Null means this fold has no state yet. */
  readonly snapshotAt: string | null;
  /** The `at` of the last frame that changed anything. */
  readonly appliedAt: string | null;
  readonly lifecycle: Lifecycle | null;
  readonly complete: boolean;
  readonly tasks: ReadonlyMap<number, TaskView>;
  readonly runs: ReadonlyMap<string, RunView>;
  readonly anomalies: readonly BoardAnomaly[];
  readonly governance: GovernanceState | null;
  readonly notes: readonly string[];
  /** True from the moment a gap is seen until a snapshot lands. The state may be missing a removal. */
  readonly needsResync: boolean;
  readonly counts: FoldCounts;
}

export const FOLD_OUTCOMES = ["applied", "counted", "discarded", "refused"] as const;
export type FoldOutcome = (typeof FOLD_OUTCOMES)[number];

/**
 * What one frame did.
 *
 * `resync` is orthogonal to `outcome` on purpose: a frame can be applied *and* reveal that earlier
 * frames were lost. Collapsing the two would force the caller to choose between applying good data
 * and repairing the gap, and the honest answer is both.
 */
export interface FoldStep {
  readonly fold: EventFold;
  readonly outcome: FoldOutcome;
  /** The frame's kind, including kinds this client does not implement. Null when unreadable. */
  readonly kind: string | null;
  readonly detail: string;
  /** Non-null when the caller must send this frame to the server. */
  readonly resync: ResyncFrame | null;
}

export function emptyFold(): EventFold {
  return {
    protocol: null,
    repo: null,
    generation: null,
    bound: false,
    lastSeq: null,
    snapshotAt: null,
    appliedAt: null,
    lifecycle: null,
    complete: false,
    tasks: new Map(),
    runs: new Map(),
    anomalies: [],
    governance: null,
    notes: [],
    needsResync: false,
    counts: { applied: 0, counted: 0, discarded: 0, refused: 0, resyncs: 0, gapped: 0 },
  };
}

/**
 * Seed a fold from a snapshot fetched over `POST /api/snapshot` rather than over the socket.
 *
 * Retains the display generation and original timestamps, but binds no stream. `bound` is false,
 * `lastSeq` is null and `needsResync` is true. Only a current-link hello followed by a valid
 * snapshot restores synchronization; pre-hello frames cannot modify this retained board.
 */
export function foldFromSnapshot(snapshot: RemoteSnapshot): EventFold {
  const base = emptyFold();
  return {
    ...base,
    ...stateOfSnapshot(snapshot),
    generation: snapshot.generation,
    needsResync: true,
    appliedAt: snapshot.generatedAt,
    counts: plus(base.counts, { applied: 1 }),
  };
}

/** Internal binding predicate; not part of the package root API. */
export function isBound(fold: EventFold): boolean {
  return fold.bound ?? (fold.generation !== null);
}

/**
 * The frame to send when a bound fold has lost track.
 *
 * An unbound fold returns generation 0, the existing no-generation sentinel; hubs never assign 0.
 * A mismatched resync closes the link, so sending the unbound frame is a transport fault, not a
 * recovery request. Bound folds, including legacy values without `bound`, retain their generation
 * and optional lastSeq. Reconnect and wait for hello before requesting in-band recovery.
 */
export function resyncFrame(fold: EventFold): ResyncFrame {
  const generation = isBound(fold) ? (fold.generation ?? 0) : 0;
  return fold.lastSeq === null
    ? { kind: "resync", generation }
    : { kind: "resync", generation, lastSeq: fold.lastSeq };
}

/** Read a decoded value off the socket and fold it in one call. */
export function foldValue(fold: EventFold, value: unknown): FoldStep {
  return foldFrame(fold, readServerEvent(value));
}

/** Fold one already-read frame. */
export function foldFrame(fold: EventFold, reading: FrameReading): FoldStep {
  if (reading.ok) return applyEvent(fold, reading.event);
  if (reading.reason === "unreadable") return refuse(fold, null, reading.detail);
  return count(fold, reading.kind, reading.generation, reading.seq);
}

/**
 * The fold as a snapshot, or null when it has never had one.
 *
 * Tasks and runs come out sorted rather than in arrival order, so that two clients which received
 * the same events by different routes produce the same structure. Comparison is `<` on the raw
 * strings rather than `localeCompare`, because a client's locale must not change what "the same
 * state" means.
 *
 * `generation` is the last display generation, which may be retained while unbound;
 * `generatedAt` is when the data was produced. Between a `hello` and the snapshot answering it
 * those are two different moments, and `needsResync` is the field that says so.
 */
export function snapshotOf(fold: EventFold): RemoteSnapshot | null {
  if (
    fold.snapshotAt === null ||
    fold.repo === null ||
    fold.lifecycle === null ||
    fold.governance === null ||
    fold.protocol === null ||
    fold.generation === null
  ) {
    return null;
  }
  const tasks = [...fold.tasks.values()].sort((a, b) => a.number - b.number);
  const runs = [...fold.runs.values()].sort(compareRunIds);
  return {
    protocol: fold.protocol,
    generation: fold.generation,
    generatedAt: fold.snapshotAt,
    complete: fold.complete,
    repo: fold.repo,
    lifecycle: fold.lifecycle,
    tasks,
    runs,
    anomalies: fold.anomalies,
    governance: fold.governance,
    notes: fold.notes,
  };
}

function compareRunIds(a: RunView, b: RunView): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

type FoldStateFields = Pick<
  EventFold,
  | "protocol"
  | "repo"
  | "lifecycle"
  | "complete"
  | "tasks"
  | "runs"
  | "anomalies"
  | "governance"
  | "notes"
  | "snapshotAt"
  | "needsResync"
>;

function stateOfSnapshot(snapshot: RemoteSnapshot): FoldStateFields {
  const tasks = new Map<number, TaskView>();
  for (const task of snapshot.tasks) tasks.set(task.number, task);
  const runs = new Map<string, RunView>();
  for (const run of snapshot.runs) runs.set(run.id, run);
  return {
    protocol: snapshot.protocol,
    repo: snapshot.repo,
    lifecycle: snapshot.lifecycle,
    complete: snapshot.complete,
    tasks,
    runs,
    anomalies: snapshot.anomalies,
    governance: snapshot.governance,
    notes: snapshot.notes,
    snapshotAt: snapshot.generatedAt,
    needsResync: false,
  };
}

function plus(counts: FoldCounts, patch: Partial<FoldCounts>): FoldCounts {
  return {
    applied: counts.applied + (patch.applied ?? 0),
    counted: counts.counted + (patch.counted ?? 0),
    discarded: counts.discarded + (patch.discarded ?? 0),
    refused: counts.refused + (patch.refused ?? 0),
    resyncs: counts.resyncs + (patch.resyncs ?? 0),
    gapped: counts.gapped + (patch.gapped ?? 0),
  };
}

function refuse(fold: EventFold, kind: string | null, detail: string): FoldStep {
  return {
    fold: { ...fold, counts: plus(fold.counts, { refused: 1 }) },
    outcome: "refused",
    kind,
    detail,
    resync: null,
  };
}

/** Discards never advance `lastSeq`: a discarded frame's seq belongs to a sequence we are not in. */
function discard(fold: EventFold, kind: string, detail: string): FoldStep {
  return {
    fold: { ...fold, counts: plus(fold.counts, { discarded: 1 }) },
    outcome: "discarded",
    kind,
    detail,
    resync: null,
  };
}

type Sequencing =
  | { readonly ok: true; readonly gap: number }
  | { readonly ok: false; readonly detail: string };

function sequence(fold: EventFold, seq: number): Sequencing {
  if (fold.lastSeq === null) return { ok: true, gap: 0 };
  const expected = fold.lastSeq + 1;
  if (seq === expected) return { ok: true, gap: 0 };
  if (seq > expected) return { ok: true, gap: seq - expected };
  return { ok: false, detail: `seq ${seq} is behind ${fold.lastSeq} and would undo newer state` };
}

function boundTo(fold: EventFold): string {
  return !isBound(fold) || fold.generation === null ? "no generation" : `generation ${fold.generation}`;
}

function count(fold: EventFold, kind: string, generation: number, seq: number): FoldStep {
  if (!isBound(fold) || fold.generation === null || generation !== fold.generation) {
    return discard(fold, kind, `frame from generation ${generation}; bound to ${boundTo(fold)}`);
  }
  const seen = sequence(fold, seq);
  if (!seen.ok) return discard(fold, kind, seen.detail);
  const next: EventFold = {
    ...fold,
    lastSeq: seq,
    needsResync: fold.needsResync || seen.gap > 0,
    counts: plus(fold.counts, {
      counted: 1,
      gapped: seen.gap,
      resyncs: seen.gap > 0 ? 1 : 0,
    }),
  };
  return {
    outcome: "counted",
    fold: next,
    kind,
    detail:
      seen.gap > 0
        ? `unknown kind ${kind}, and ${seen.gap} frame(s) lost before it`
        : `unknown kind ${kind}`,
    resync: seen.gap > 0 ? resyncFrame(next) : null,
  };
}

function applyEvent(fold: EventFold, event: ServerEvent): FoldStep {
  if (event.kind === "hello") return applyHello(fold, event);

  if (!isBound(fold) || fold.generation === null || event.generation !== fold.generation) {
    return discard(
      fold,
      event.kind,
      `frame from generation ${event.generation}; bound to ${boundTo(fold)}`,
    );
  }
  const seen = sequence(fold, event.seq);
  if (!seen.ok) return discard(fold, event.kind, seen.detail);

  if (event.kind === "snapshot") {
    const snapshot = event.payload;
    if (snapshot.generation !== fold.generation) {
      return discard(
        fold,
        event.kind,
        `snapshot for generation ${snapshot.generation}; bound to ${boundTo(fold)}`,
      );
    }
    const next: EventFold = {
      ...fold,
      ...stateOfSnapshot(snapshot),
      lastSeq: event.seq,
      appliedAt: event.at,
      counts: plus(fold.counts, { applied: 1, gapped: seen.gap }),
    };
    return {
      fold: next,
      outcome: "applied",
      kind: event.kind,
      detail:
        seen.gap > 0
          ? `snapshot replaced the fold; the ${seen.gap} frame(s) lost before it no longer matter`
          : "snapshot replaced the fold",
      resync: null,
    };
  }

  if (fold.snapshotAt === null) {
    // The frame is well formed and in sequence, so its seq is real and worth keeping; what is
    // missing is the state it modifies. Advancing avoids reporting the same absence as a fresh
    // loss on every subsequent frame while the resync is in flight.
    const marked: EventFold = {
      ...fold,
      lastSeq: event.seq,
      needsResync: true,
      counts: plus(fold.counts, { discarded: 1, gapped: seen.gap, resyncs: 1 }),
    };
    return {
      fold: marked,
      outcome: "discarded",
      kind: event.kind,
      detail: `${event.kind} arrived before any snapshot; nothing to apply it to`,
      resync: resyncFrame(marked),
    };
  }

  const applied: EventFold = {
    ...applyDelta(fold, event),
    lastSeq: event.seq,
    appliedAt: event.at,
    needsResync: fold.needsResync || seen.gap > 0,
    counts: plus(fold.counts, {
      applied: 1,
      gapped: seen.gap,
      resyncs: seen.gap > 0 ? 1 : 0,
    }),
  };
  return {
    fold: applied,
    outcome: "applied",
    kind: event.kind,
    detail:
      seen.gap > 0 ? `${event.kind} applied, but ${seen.gap} frame(s) were lost before it` : event.kind,
    resync: seen.gap > 0 ? resyncFrame(applied) : null,
  };
}

/**
 * `hello` binds the current stream. While bound, only a strictly greater generation is accepted.
 * An unbound fold may accept a lower generation after a server restart, regardless of its retained
 * display generation. The caller must fence abandoned links before folding any frame; generation
 * numbers alone cannot identify a connection across restarts. `stepCockpit` supplies that fence.
 *
 * What `hello` deliberately does *not* do is clear the board. A phone walking out of range
 * reconnects constantly, and a fold that emptied itself on every bind would blank the screen each
 * time and refill it a moment later — motion that says "something broke" about the one event that
 * means the opposite. The snapshot that follows replaces every task and every run wholesale, so
 * nothing stale can survive it; until then the last known board stays on screen with `needsResync`
 * set, which is the honest description of what the client is looking at.
 */
function applyHello(fold: EventFold, event: HelloEvent): FoldStep {
  const { protocol, repo } = event.payload;
  if (protocol !== PROTOCOL_VERSION) {
    return refuse(
      fold,
      "hello",
      `server speaks protocol ${protocol}; this client speaks ${PROTOCOL_VERSION}`,
    );
  }
  if (isBound(fold) && fold.generation !== null && event.generation <= fold.generation) {
    return discard(
      fold,
      "hello",
      `hello for generation ${event.generation}; already bound to ${boundTo(fold)}`,
    );
  }
  const next: EventFold = {
    ...fold,
    protocol,
    repo,
    generation: event.generation,
    bound: true,
    lastSeq: event.seq,
    appliedAt: event.at,
    needsResync: true,
    counts: plus(fold.counts, { applied: 1 }),
  };
  return {
    fold: next,
    outcome: "applied",
    kind: "hello",
    detail: `bound to generation ${event.generation}`,
    resync: null,
  };
}

type DeltaEvent = Exclude<ServerEvent, { kind: "hello" } | { kind: "snapshot" }>;

function applyDelta(fold: EventFold, event: DeltaEvent): EventFold {
  switch (event.kind) {
    case "task.upserted": {
      const tasks = new Map(fold.tasks);
      tasks.set(event.payload.number, event.payload);
      return { ...fold, tasks };
    }
    case "task.removed": {
      const tasks = new Map(fold.tasks);
      tasks.delete(event.payload.number);
      return { ...fold, tasks };
    }
    case "run.upserted": {
      const runs = new Map(fold.runs);
      runs.set(event.payload.id, event.payload);
      return { ...fold, runs };
    }
    case "governance.changed":
      return { ...fold, governance: event.payload };
    case "anomalies.changed":
      return { ...fold, complete: event.payload.complete, anomalies: event.payload.anomalies };
    case "approval.requested":
      return withPending(fold, requested(pendingOf(fold), event.payload));
    case "approval.resolved":
      return withPending(
        fold,
        pendingOf(fold).filter((approval) => approval.id !== event.payload.id),
      );
  }
}

function pendingOf(fold: EventFold): readonly PendingApproval[] {
  return fold.governance === null ? [] : fold.governance.pending;
}

function withPending(fold: EventFold, pending: readonly PendingApproval[]): EventFold {
  if (fold.governance === null) return fold;
  const governance: GovernanceState = { ...fold.governance, pending };
  return { ...fold, governance };
}

/** Replace in place when the id is known, so a re-sent request does not draw the same card twice. */
function requested(
  pending: readonly PendingApproval[],
  approval: PendingApproval,
): readonly PendingApproval[] {
  const at = pending.findIndex((existing) => existing.id === approval.id);
  if (at < 0) return [...pending, approval];
  const next = [...pending];
  next[at] = approval;
  return next;
}
