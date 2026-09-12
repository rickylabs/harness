/**
 * Consuming a UHP response stream, and the one thing a stream must never be asked to decide.
 *
 * Spike S11, issue #289 — the buildable half. Run artifacts: `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * ## What this module is for
 *
 * `POST /v1/responses` with `stream: true` answers `text/event-stream`. This module turns those bytes
 * into one of exactly three states: an open stream with partial output, a finished stream with a
 * terminal response, or a refusal. There is no fourth state, and in particular there is no
 * "mostly worked" — see the fail-closed section below.
 *
 * ## Requirement A of #289, which is why the freshness API looks the way it does
 *
 * **Freshness must not be derivable from a lifecycle status.** `LivenessState` (`live`, `recent`,
 * `stalled`, `quiet`) is computed strictly from evidence timestamps. A lifecycle frame —
 * `response.created`, `response.in_progress`, or any terminal event — is a *claim about state*. It is
 * not evidence that anything grew, and #85 is the whole reason this repository exists: a coordinator
 * that renders a claim as work shows a green board over six hours of nothing.
 *
 * The brief asked for a signature that cannot express the violation rather than a comment asking
 * nobody to commit it, so:
 *
 * - `uhpFreshness()` takes evidence, a clock reading and window bounds. It has no status parameter,
 *   no response parameter and no boolean. There is nowhere to put a lifecycle status.
 * - `UhpFreshnessEvidence` carries a module-private brand. Only `readUhpStream` mints one, and only
 *   from a delta or an output-item frame. A hand-written object cast to the type is rejected at
 *   runtime by `uhpFreshness`, so the type is not merely advisory.
 * - `UhpFreshnessEvidence.kind` is `"delta" | "item"`. A lifecycle status is not spellable in it.
 *
 * The timestamps are **the reading clock's**, not the server's. Streaming §1 defines no per-event
 * timestamp — verified by retrieval on 2026-09-12 — so the only honest stamp available is "when this
 * client saw the frame arrive". That is what a freshness question is actually asking, and it is
 * marked here rather than left for a reader to assume. `Response.created_at` is not used: it dates
 * the task, not the growth.
 *
 * `stalled` is deliberately unreachable from this module. In `@rickylabs/telemetry` a node becomes
 * `stalled` only when something *claims* to be running and cannot show recent growth, and that claim
 * is the executor's lifecycle — a different question, answered by `RunLiveness` in `uhp-lifecycle.ts`.
 * Joining the two is telemetry's job and #206's boundary. Producing `stalled` here would mean reading
 * a lifecycle status inside the freshness path, which is the exact defect requirement A forbids.
 *
 * ## Fail closed, and what that means precisely
 *
 * A refused stream yields no terminal response, no text and no freshness evidence. Not a truncated
 * answer, not the last frame seen: nothing. Two different facts — "the task finished" and "the stream
 * stopped" — must not share a representation, because a decoder that conflates them reports a killed
 * run as a completed one. The refusal is sticky: once a stream has been refused, later well-formed
 * frames cannot rehabilitate it, because a stream that has already lost a frame cannot be reassembled
 * by receiving a different one.
 *
 * A refused stream is also **not a failed run**. `uhp-lifecycle.ts` maps a refusal to `unknown`: we
 * could not read the wire, which is a statement about our reading and not about the agent's work.
 *
 * ## Citations
 *
 * All retrieved 2026-09-12 against UHP `2026-08-11`,
 * https://unifiedharnessprotocol.org/spec/2026-08-11/streaming:
 *
 * - "Every event MUST carry `type` and `sequence_number`", numbering "MUST start at `0` and increase
 *   by exactly 1 per event within a stream", so that clients "detect dropped messages rather than
 *   silently missing data".
 * - "`response.created` is the first event."
 * - "Exactly one terminal event is the last" — one of `response.completed`, `response.incomplete`,
 *   `response.failed`.
 * - "A cancelled task terminates with `response.failed` carrying `status: \"cancelled\"` in the
 *   response object", and "The status field, not the event name, is authoritative."
 * - "An `error` event MUST be followed by a terminal event. A stream that emits `error` and then stops
 *   without a terminal event is malformed."
 * - "A dropped connection MUST NOT abort the task. The work continues server-side."
 *
 * The last one is why `end()` on an unterminated stream is `truncated` rather than `failed`: the task
 * is probably still running, and the client's next move is to re-query, not to mourn.
 *
 * ## What this module does not prove
 *
 * Nothing about a live HarnessRouter. Every stream it has ever consumed came from `uhp-mock.ts`,
 * written from the specification. That gap is issue #294's, is blocked on infrastructure, and is
 * recorded as unproven in `.llm/runs/uhp-stream-adapter--s11/verification.md`.
 */

import {
  UHP_DELTA_EVENTS,
  UHP_ERROR_EVENT,
  UHP_INERT_EVENTS,
  UHP_ITEM_EVENTS,
  UHP_LIFECYCLE_EVENTS,
  isUhpTerminalEvent,
  isUhpTerminalStatus,
  type UhpResponse,
  type UhpTerminalStatus,
} from "./uhp-wire.js";

/* -------------------------------------------------------------------------------------------------
 * Freshness evidence — minted here, nowhere else
 * ---------------------------------------------------------------------------------------------- */

/**
 * The two things that count as growth on a UHP stream.
 *
 * `delta` is output that was produced: tokens exist that did not exist before. `item` is an output
 * item boundary: a unit of output opened or closed. Nothing else on the wire is growth, and a
 * lifecycle status is not spellable here.
 */
export type UhpFreshnessKind = "delta" | "item";

/**
 * The brand. Not exported, so no caller can name the key, and checked at runtime, so no caller can
 * forge one with a cast either.
 *
 * This is the mechanism behind requirement A. Freshness evidence exists only where the reader
 * observed something grow; it cannot be conjured from a status by any caller, in any package, by
 * accident or on purpose, without editing this file.
 */
const MINTED: unique symbol = Symbol("@rickylabs/subagents.uhp.freshness");

/**
 * One observation that something grew, at a time.
 *
 * In-process only: the brand is a `Symbol`, so this does not survive `JSON.stringify`. That is
 * deliberate. If a verdict needs to cross a boundary, send the verdict — evidence is for the process
 * that witnessed it.
 */
export interface UhpFreshnessEvidence {
  /** ISO 8601, from the reading clock. When this client saw the frame, not what the server claimed. */
  readonly at: string;
  readonly kind: UhpFreshnessKind;
  readonly [MINTED]: true;
}

function mint(kind: UhpFreshnessKind, at: string): UhpFreshnessEvidence {
  return { at, kind, [MINTED]: true };
}

function isMinted(value: unknown): value is UhpFreshnessEvidence {
  return typeof value === "object" && value !== null
    && (value as { [MINTED]?: unknown })[MINTED] === true
    && typeof (value as { at?: unknown }).at === "string";
}

/* -------------------------------------------------------------------------------------------------
 * Freshness classification — timestamps in, state out, no status anywhere
 * ---------------------------------------------------------------------------------------------- */

/**
 * The three states freshness alone can support.
 *
 * `stalled` is excluded in the type, not in prose: it requires a running *claim*, which is a
 * lifecycle status, which this path must never see. `@rickylabs/telemetry` owns that join.
 */
export type UhpFreshness = Exclude<"live" | "recent" | "stalled" | "quiet", "stalled">;

/** The boundaries, in milliseconds. Passed in so tests never sleep. Mirrors telemetry's windows. */
export interface UhpFreshnessWindows {
  readonly liveMs: number;
  readonly recentMs: number;
}

/** Fifteen minutes and a day, the same two numbers `@rickylabs/telemetry` defends in its own header. */
export const DEFAULT_UHP_WINDOWS: UhpFreshnessWindows = {
  liveMs: 15 * 60 * 1000,
  recentMs: 24 * 60 * 60 * 1000,
};

export interface UhpFreshnessVerdict {
  readonly state: UhpFreshness;
  /** Which kind of growth the verdict rests on, or `none` when nothing grew. */
  readonly from: UhpFreshnessKind | "none";
  readonly at: string | null;
  readonly ageMs: number | null;
}

/**
 * Classify growth evidence into a freshness state.
 *
 * Three parameters, and not one of them can carry a lifecycle status. An unbranded item is dropped
 * rather than trusted: a forged object is not evidence, and silently honouring one would reopen the
 * hole the brand closes. An unparseable timestamp is dropped for the same reason telemetry drops it —
 * it is not weaker evidence, it is no evidence.
 *
 * Newest wins rather than strongest-kind, because the question is when something last happened: a
 * four-hour-old delta does not outrank an item boundary from two minutes ago.
 */
export function uhpFreshness(
  evidence: readonly UhpFreshnessEvidence[],
  now: string,
  windows: UhpFreshnessWindows = DEFAULT_UHP_WINDOWS,
): UhpFreshnessVerdict {
  const nowMs = Date.parse(now);
  let bestMs = Number.NEGATIVE_INFINITY;
  let best: UhpFreshnessEvidence | null = null;

  for (const item of evidence) {
    if (!isMinted(item)) continue;
    const ms = Date.parse(item.at);
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = item;
  }

  if (best === null || !Number.isFinite(nowMs)) {
    return { state: "quiet", from: "none", at: null, ageMs: null };
  }

  // Clamped at zero: a host whose clock is ahead is common and harmless, and a negative age renders
  // as growth in the future.
  const ageMs = Math.max(0, nowMs - bestMs);
  const state: UhpFreshness = ageMs <= windows.liveMs
    ? "live"
    : ageMs <= windows.recentMs
    ? "recent"
    : "quiet";
  return { state, from: best.kind, at: best.at, ageMs };
}

/* -------------------------------------------------------------------------------------------------
 * Stream state
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a stream was refused. Every member is a rule the specification states, and each one is a place
 * a lenient decoder would have returned a partial answer instead.
 */
export type UhpStreamRefusal =
  /** A `data:` payload was not JSON, or was JSON that is not an object. */
  | "unparseable-frame"
  /** No string `type`. Streaming §1 makes it mandatory on every event. */
  | "untyped-frame"
  /** `sequence_number` absent, not an integer, or not exactly one more than the last. */
  | "sequence-broken"
  /** `response.created` was not first, or arrived twice. */
  | "created-misplaced"
  /** A frame arrived after the terminal event, which must be last. */
  | "frame-after-terminal"
  /** A frame's `response`, `item` or `delta` payload was absent or the wrong shape. */
  | "frame-unreadable"
  /** A terminal frame whose `response.status` is not one of the four terminal statuses. */
  | "non-terminal-status"
  /** An `error` event with no terminal event after it. Streaming §1 calls that stream malformed. */
  | "error-without-terminal"
  /** The bytes ended mid-frame, or ended with no terminal event. The task may well still be running. */
  | "truncated";

/** The `error` event's payload: `code`, `message`, `param`. */
export interface UhpStreamError {
  readonly code: string | null;
  readonly message: string | null;
  readonly param: string | null;
}

/** A stream still open: frames have arrived, no terminal event yet, nothing is wrong. */
export interface UhpStreamOpen {
  readonly ok: true;
  readonly done: false;
  /** The initial response from `response.created`: its id, and the session it is in. */
  readonly created: UhpResponse | null;
  /** Output text so far, from `response.output_text.delta` frames only. Honestly partial. */
  readonly text: string;
  readonly freshness: readonly UhpFreshnessEvidence[];
  readonly frames: number;
  /** Frames whose `type` the specification does not define. Ignored, counted, never acted on. */
  readonly ignored: number;
  readonly error: UhpStreamError | null;
}

/** A stream that reached exactly one terminal event carrying a terminal status. */
export interface UhpStreamDone {
  readonly ok: true;
  readonly done: true;
  /**
   * The authoritative outcome, read from `response.status` and never from the event name — the
   * chapter says so, and `cancelled` arrives on a `response.failed` frame.
   */
  readonly status: UhpTerminalStatus;
  readonly response: UhpResponse;
  readonly created: UhpResponse | null;
  readonly text: string;
  readonly freshness: readonly UhpFreshnessEvidence[];
  readonly frames: number;
  readonly ignored: number;
  readonly error: UhpStreamError | null;
}

/**
 * A refusal. Note what is absent: no response, no text, no freshness, no frame count.
 *
 * A caller cannot partially apply what it cannot reach. This is the fail-closed requirement expressed
 * in the type rather than in a warning.
 */
export interface UhpStreamRefused {
  readonly ok: false;
  readonly refusal: UhpStreamRefusal;
  /** Deterministic, and free of raw payload bytes: a malformed frame is described, never quoted. */
  readonly detail: string;
}

export type UhpStreamState = UhpStreamOpen | UhpStreamDone | UhpStreamRefused;

/* -------------------------------------------------------------------------------------------------
 * The reader
 * ---------------------------------------------------------------------------------------------- */

export interface UhpStreamReader {
  /** Feed bytes as they arrive. Chunk boundaries are arbitrary and may split a frame. */
  push(chunk: string): void;
  /** The state right now. While a stream is open this is the in-flight view. */
  state(): UhpStreamState;
  /** No more bytes are coming. An open stream becomes `truncated` here, never `completed`. */
  end(): UhpStreamState;
}

const DELTA_EVENTS: ReadonlySet<string> = new Set(UHP_DELTA_EVENTS);
const ITEM_EVENTS: ReadonlySet<string> = new Set(UHP_ITEM_EVENTS);
const INERT_EVENTS: ReadonlySet<string> = new Set(UHP_INERT_EVENTS);
const LIFECYCLE_EVENTS: ReadonlySet<string> = new Set(UHP_LIFECYCLE_EVENTS);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Split a buffer into complete SSE event blocks, keeping the incomplete tail.
 *
 * The tail matters: `end()` treats a non-blank tail as a truncated frame. A reader that discarded it
 * would accept a stream cut mid-frame as merely short.
 */
function blocks(buffer: string): { readonly ready: readonly string[]; readonly rest: string } {
  const parts = buffer.split("\n\n");
  return { ready: parts.slice(0, -1), rest: parts[parts.length - 1] ?? "" };
}

/**
 * Extract the `data` payload of one SSE block, or `null` when the block carries none.
 *
 * Multiple `data:` lines join with a newline, per the EventSource format UHP streams over. Comment
 * lines (`:` keep-alives) and other fields are ignored, and a block with no `data:` line at all is a
 * keep-alive: it must not consume a sequence number, because the server never numbered it.
 */
function payloadOf(block: string): string | null {
  const lines = block.split("\n");
  const data: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.length === 0 || line.startsWith(":")) continue;
    if (line.startsWith("data:")) data.push(line.slice("data:".length).replace(/^ /, ""));
  }
  return data.length === 0 ? null : data.join("\n");
}

/** Create a reader. `clock` is called once per growth frame, so tests can advance time per frame. */
export function createUhpStreamReader(clock: () => string = () => new Date().toISOString()): UhpStreamReader {
  let buffer = "";
  let expected = 0;
  let frames = 0;
  let ignored = 0;
  let text = "";
  let created: UhpResponse | null = null;
  let terminal: { readonly response: UhpResponse; readonly status: UhpTerminalStatus } | null = null;
  let error: UhpStreamError | null = null;
  let refused: UhpStreamRefused | null = null;
  const freshness: UhpFreshnessEvidence[] = [];

  function refuse(refusal: UhpStreamRefusal, detail: string): UhpStreamRefused {
    // Sticky. The first refusal is the true one; later frames describe a stream already lost.
    refused ??= { ok: false, refusal, detail };
    return refused;
  }

  function consume(block: string): void {
    if (refused !== null) return;
    const payload = payloadOf(block);
    if (payload === null) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      refuse("unparseable-frame", `frame ${expected} is not JSON`);
      return;
    }
    if (!isObject(parsed)) {
      refuse("unparseable-frame", `frame ${expected} is not a JSON object`);
      return;
    }

    const type = nonblank(parsed["type"]);
    if (type === null) {
      refuse("untyped-frame", `frame ${expected} carries no event type`);
      return;
    }
    if (terminal !== null) {
      refuse("frame-after-terminal", `${type} arrived after the terminal event, which must be last`);
      return;
    }
    const sequence = parsed["sequence_number"];
    if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence !== expected) {
      refuse(
        "sequence-broken",
        `${type} carries sequence ${typeof sequence === "number" ? String(sequence) : "no integer"}, expected ${expected}`,
      );
      return;
    }
    const first = expected === 0;
    if (first !== (type === "response.created")) {
      refuse(
        "created-misplaced",
        first
          ? `the first event is ${type}, and Streaming 1 makes response.created first`
          : "response.created arrived twice",
      );
      return;
    }

    expected += 1;
    frames += 1;

    if (isUhpTerminalEvent(type)) {
      const response = parsed["response"];
      if (!isObject(response)) {
        refuse("frame-unreadable", `${type} carries no response object`);
        return;
      }
      const status = response["status"];
      if (!isUhpTerminalStatus(status)) {
        // The event name is not consulted. A terminal frame that reports `in_progress`, or a status
        // this protocol version does not define, is a server contradiction and not a finished run.
        refuse(
          "non-terminal-status",
          `${type} reports a status that is not terminal, and the status field is authoritative`,
        );
        return;
      }
      terminal = { response: response as unknown as UhpResponse, status };
      return;
    }

    if (LIFECYCLE_EVENTS.has(type)) {
      const response = parsed["response"];
      if (!isObject(response)) {
        refuse("frame-unreadable", `${type} carries no response object`);
        return;
      }
      // Deliberately no freshness evidence. Requirement A of #289: a lifecycle frame is a claim about
      // state, and this is the line where treating it as growth would have been convenient.
      if (type === "response.created") created = response as unknown as UhpResponse;
      return;
    }

    if (DELTA_EVENTS.has(type)) {
      const delta = parsed["delta"];
      if (typeof delta !== "string") {
        refuse("frame-unreadable", `${type} carries no string delta`);
        return;
      }
      // Only assistant output text accumulates. A reasoning summary and a tool-call argument are
      // growth, and they are not the answer.
      if (type === "response.output_text.delta") text += delta;
      freshness.push(mint("delta", clock()));
      return;
    }

    if (ITEM_EVENTS.has(type)) {
      if (!isObject(parsed["item"])) {
        refuse("frame-unreadable", `${type} carries no item object`);
        return;
      }
      freshness.push(mint("item", clock()));
      return;
    }

    if (type === UHP_ERROR_EVENT) {
      const payloadError = isObject(parsed["error"]) ? parsed["error"] : parsed;
      error = {
        code: nonblank(payloadError["code"]),
        message: nonblank(payloadError["message"]),
        param: nonblank(payloadError["param"]),
      };
      return;
    }

    if (INERT_EVENTS.has(type)) return;

    // An event type this protocol version does not define. The chapter is silent on what a client
    // must do, so the conservative reading applies: it cannot be growth, it cannot be terminal, and
    // it is counted rather than silently dropped. It still consumed a sequence number, which is why
    // the counter advanced above.
    ignored += 1;
  }

  function current(): UhpStreamState {
    if (refused !== null) return refused;
    if (terminal !== null) {
      return {
        ok: true,
        done: true,
        status: terminal.status,
        response: terminal.response,
        created,
        text,
        freshness: [...freshness],
        frames,
        ignored,
        error,
      };
    }
    return { ok: true, done: false, created, text, freshness: [...freshness], frames, ignored, error };
  }

  return {
    push(chunk) {
      if (refused !== null) return;
      buffer += chunk;
      const split = blocks(buffer);
      buffer = split.rest;
      for (const block of split.ready) consume(block);
    },
    state: current,
    end() {
      if (refused !== null) return refused;
      if (buffer.trim().length > 0) {
        // Bytes that never became a frame. The connection died mid-event.
        return refuse("truncated", "the stream ended part-way through an event");
      }
      if (terminal === null) {
        return error !== null
          ? refuse(
            "error-without-terminal",
            "an error event was not followed by a terminal event, which Streaming 1 calls malformed",
          )
          : refuse(
            "truncated",
            `the stream ended after ${frames} frames with no terminal event; the task may still be running server-side`,
          );
      }
      return current();
    },
  };
}

/** Read a whole stream from chunks as they would arrive on the wire. */
export function readUhpStream(
  chunks: Iterable<string>,
  clock?: () => string,
): UhpStreamState {
  const reader = createUhpStreamReader(clock);
  for (const chunk of chunks) reader.push(chunk);
  return reader.end();
}

/** Read a whole stream from one body. The convenience form; `readUhpStream` is the honest one. */
export function consumeUhpStream(body: string, clock?: () => string): UhpStreamState {
  return readUhpStream([body], clock);
}
