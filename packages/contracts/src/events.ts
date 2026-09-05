/**
 * The live stream: `/api/remote.mux`.
 *
 * ## Deltas carry whole values, never patches
 *
 * `task.upserted` carries an entire `TaskView`, not the fields that changed. A patch protocol needs
 * every patch, in order, applied to the exact state the sender assumed — so one dropped frame
 * corrupts the state silently and stays corrupted. Whole values are idempotent and order-tolerant:
 * a duplicate is a no-op, and a gap is repaired by the next event about that task or by a resync.
 *
 * The cost is bandwidth on a LAN, which is the resource this system has most of.
 *
 * ## Generation and seq
 *
 * `generation` increments on every accepted connection. A frame whose generation is not the current
 * one is discarded without being applied — this is what makes reconnection safe, because the losing
 * half of a race between an old socket's last frames and a new socket's snapshot is identified by
 * data rather than by timing.
 *
 * `seq` is per-generation, starts at 0 with `hello`, and increments by exactly one. A gap means a
 * frame was lost and the client must resync. That is the entire loss-detection mechanism, and it
 * only works if every frame is numbered — including frames the client does not understand, which is
 * why `readServerEvent` reports `generation` and `seq` even when it rejects the kind.
 *
 * ## Connecting is subscribing
 *
 * There is no subscribe frame. A client connects, receives `hello`, then a `snapshot`, then deltas.
 *
 * The alternative — a subscription filter the client can change mid-stream — quietly breaks the
 * correctness argument this protocol rests on: "the snapshot plus every subsequent delta is the
 * current state" stops being true the moment the set of things being delivered can change without a
 * new snapshot, and the bug it produces is a stale row that no future event will ever correct. One
 * repository's board is small enough that filtering is a client-side concern, and that is where it
 * stays.
 *
 * The one client frame is `resync`, which asks for a fresh snapshot in the current generation.
 */

import type { BoardAnomaly, TaskView } from "./tasks.js";
import type { ApprovalResolution, GovernanceState, PendingApproval } from "./governance.js";
import type { RunView } from "./runs.js";
import type { RemoteSnapshot, RepoRef } from "./snapshot.js";

/** The WebSocket path. */
export const MUX_PATH = "/api/remote.mux" as const;

/**
 * The wire protocol version.
 *
 * Sent in `hello` and carried on every snapshot. A client that does not recognise it should say so
 * and stop rather than guess; a server that will not serve an old one answers commands with
 * `protocol-mismatch`.
 */
export const PROTOCOL_VERSION = 1 as const;

/**
 * The envelope every frame shares.
 *
 * The envelope is uniform so that loss detection, generation filtering and logging are one code path
 * that does not need to know any payload type. That is why `seq` and `generation` sit here rather
 * than inside the payloads that happen to need them.
 */
export interface Frame<K extends string, P> {
  readonly kind: K;
  readonly generation: number;
  readonly seq: number;
  /** When the server emitted the frame. */
  readonly at: string;
  readonly payload: P;
}

/** Opening frame of every connection; always `seq` 0. */
export type HelloEvent = Frame<"hello", { readonly protocol: number; readonly repo: RepoRef }>;

/** The whole state. Sent after `hello`, and again in answer to `resync`. */
export type SnapshotEvent = Frame<"snapshot", RemoteSnapshot>;

/** A task was created or changed. Carries the whole task. */
export type TaskUpsertedEvent = Frame<"task.upserted", TaskView>;

/**
 * A task left the board.
 *
 * Distinct from a task moving to a terminal phase, which is an upsert: this is transfer, deletion,
 * or falling outside what the projection covers. A client removes it rather than drawing it as done.
 */
export type TaskRemovedEvent = Frame<"task.removed", { readonly number: number }>;

/** A run started, advanced, or ended. Carries the whole run. */
export type RunUpsertedEvent = Frame<"run.upserted", RunView>;

/** Budget state changed. Carries all three regimes, for the reason given in `governance.ts`. */
export type GovernanceChangedEvent = Frame<"governance.changed", GovernanceState>;

/** Something needs a person. */
export type ApprovalRequestedEvent = Frame<"approval.requested", PendingApproval>;

/**
 * Something was decided — possibly by another cockpit, possibly by a timeout.
 *
 * Sent to every connection, including the one that made the decision, so that "the decision is
 * settled" arrives by the same path for everybody and a client needs no special case for its own
 * command's side effects.
 */
export type ApprovalResolvedEvent = Frame<"approval.resolved", ApprovalResolution>;

/**
 * The board's own report about itself changed.
 *
 * Separate from `snapshot` because an anomaly appearing — a truncated fetch, an item with two status
 * labels — is exactly the moment a client should stop trusting its counts, and it should not have to
 * wait for a full resync to hear about it.
 */
export type AnomaliesChangedEvent = Frame<
  "anomalies.changed",
  { readonly complete: boolean; readonly anomalies: readonly BoardAnomaly[] }
>;

export type ServerEvent =
  | HelloEvent
  | SnapshotEvent
  | TaskUpsertedEvent
  | TaskRemovedEvent
  | RunUpsertedEvent
  | GovernanceChangedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | AnomaliesChangedEvent;

export const EVENT_KINDS = [
  "hello",
  "snapshot",
  "task.upserted",
  "task.removed",
  "run.upserted",
  "governance.changed",
  "approval.requested",
  "approval.resolved",
  "anomalies.changed",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** A `Set`, not an object: a kind named `toString` must not find a method on a prototype chain. */
const KNOWN_KINDS: ReadonlySet<string> = new Set(EVENT_KINDS);

/** The only frame a client sends. Asks for a fresh snapshot without dropping the connection. */
export interface ResyncFrame {
  readonly kind: "resync";
  /** The generation the client believes it is in. A mismatch tells the server the client is stale. */
  readonly generation: number;
  /** Optional: the last `seq` the client applied, so a gap can be logged with its size. */
  readonly lastSeq?: number;
}

export type ClientFrame = ResyncFrame;

/**
 * The verdict of reading one frame off the socket.
 *
 * Three cases, not two, and the third is the point.
 *
 * A frame with an unrecognised `kind` is not garbage — it is almost always a server that has learned
 * to report something this client was built before. Reporting it as unreadable would be wrong twice:
 * it hides a normal, expected condition behind an error, and it loses the `seq`, so a forward-
 * compatible addition looks to the fold exactly like a dropped frame and triggers a resync that
 * fetches the same unknown event again. The client must be able to count a frame it cannot
 * understand, which means the envelope has to survive the failure to understand the payload.
 */
export type FrameReading =
  | { readonly ok: true; readonly event: ServerEvent }
  | { readonly ok: false; readonly reason: "unreadable"; readonly detail: string }
  | {
      readonly ok: false;
      readonly reason: "unknown-kind";
      readonly kind: string;
      readonly generation: number;
      readonly seq: number;
    };

/**
 * Read one decoded frame.
 *
 * Validates the envelope and the kind, and deliberately does not validate the payload. A contract
 * that rejected a payload carrying a field it did not know about would make every additive server
 * change a breaking one — the exact opposite of what a published package needs. The envelope is
 * what the fold's correctness depends on, so the envelope is what is checked.
 *
 * Takes an already-parsed value rather than a string: the caller knows whether frames arrive as text
 * or binary, and a parser that also owns transport decoding is harder to test than one that does not.
 */
export function readServerEvent(value: unknown): FrameReading {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "unreadable", detail: "frame is not an object" };
  }
  const frame = value as Record<string, unknown>;
  const kind = frame["kind"];
  if (typeof kind !== "string") {
    return { ok: false, reason: "unreadable", detail: "frame has no string kind" };
  }
  const generation = frame["generation"];
  const seq = frame["seq"];
  if (!Number.isInteger(generation) || !Number.isInteger(seq)) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `frame ${kind} has no integer generation and seq`,
    };
  }
  if (typeof frame["at"] !== "string") {
    return { ok: false, reason: "unreadable", detail: `frame ${kind} has no string at` };
  }
  if (!("payload" in frame)) {
    return { ok: false, reason: "unreadable", detail: `frame ${kind} has no payload` };
  }
  if (!KNOWN_KINDS.has(kind)) {
    return {
      ok: false,
      reason: "unknown-kind",
      kind,
      generation: generation as number,
      seq: seq as number,
    };
  }
  return { ok: true, event: frame as unknown as ServerEvent };
}
