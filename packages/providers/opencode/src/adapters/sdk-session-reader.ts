/**
 * The read side of `opencode serve` over the official `@opencode-ai/sdk` client: one session, its
 * children, its messages and the session each event is about.
 *
 * `sdk-server.ts` launches and steers; this file only reads, for an observer that did not start the
 * session and must not touch it. The SDK still owns the transport — endpoint paths, query encoding,
 * JSON decoding and the `GET /event` framing — and this adapter adds the two things an observer
 * needs that the SDK has no opinion about:
 *
 * - **A byte cap on every reply.** `session.messages()` returns every part of every message, tool
 *   output included, so a reply's size is the agent's business, not ours. Each call gets its own
 *   metered `fetch`: the SDK reads the body through it, and past the cap the stream errors before the
 *   rest is buffered. That reply is `oversized`, never a prefix parsed as if it were the whole.
 * - **A byte cap on every event frame.** The SDK buffers `GET /event` text until a blank line ends a
 *   frame, and a server-sent frame has no size of its own. The event stream is read through a
 *   `fetch` that counts each frame's bytes as they arrive and, past `MAX_EVENT_FRAME_BYTES`, cancels
 *   the connection and errors the body before the SDK holds the excess. The SDK still does the
 *   framing; this only counts, so a frame under the cap reaches it byte for byte.
 * - **One word per reply.** `ok`, the server's own `404` (`missing`), `oversized`, or `unavailable`
 *   (`NativeReadOutcome` in `@rickylabs/harness-contracts`). Nothing here reads a body's shape; the
 *   caller's checked readers do.
 *
 * The event side reduces each server-wide event to the session it names (`sessionOf`) and drops the
 * rest, so a caller holds a session id, never an event payload — the payloads carry the agent's text.
 * Memory per stream is one frame at most, plus the chunk in hand.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";

import type { NativeReadBounds, NativeReadOutcome, NativeSessionEvents } from "@rickylabs/harness-contracts";

import { readEvent, sessionOf } from "../domain/events.js";
import type { OpencodeSessionReader } from "../ports/session-reader.js";
import { openEvents, type SdkServerOptions } from "./sdk-server.js";

/** The most one server-sent event may hold before its blank line. A message part, tool output included, fits. */
export const MAX_EVENT_FRAME_BYTES = 1_048_576;

export interface SdkSessionReaderOptions extends SdkServerOptions {
  /** The per-frame cap on `GET /event`; `MAX_EVENT_FRAME_BYTES` when omitted. */
  readonly maxEventFrameBytes?: number;
}

/**
 * The response with a body that shows each chunk to `admit` before anything downstream reads it. A
 * refused chunk is never passed on: the source is cancelled and the body errors instead.
 */
function guarded(response: Response, admit: (chunk: Uint8Array) => boolean): Response {
  const source = response.body;
  // A body-less reply (every 101, 204, 205 and 304 is one) has nothing to count and no stream to rebuild.
  if (source === null) return response;
  const reader = source.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (!admit(value)) {
        await reader.cancel();
        controller.error(new RangeError("the reply passed its read bound"));
        return;
      }
      controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Bytes read so far, and whether the cap was passed. One per call. */
interface Meter {
  bytes: number;
  over: boolean;
}

/** A `fetch` whose response body errors once more than `maxBytes` have been read from it. */
function metered(inner: typeof fetch, maxBytes: number, meter: Meter): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> =>
    guarded(await inner(input, init), (chunk) => {
      meter.bytes += chunk.byteLength;
      meter.over = meter.bytes > maxBytes;
      return !meter.over;
    })) as typeof fetch;
}

/**
 * A `fetch` whose event stream errors once one frame passes `maxFrameBytes`. A frame is its lines with
 * their line endings, every byte counted once; the empty line that ends it belongs to no frame. Lines
 * end at LF, CR or CRLF, as the SSE grammar (and the SDK's own split) has it. Each connection counts
 * from zero.
 */
function framed(inner: typeof fetch, maxFrameBytes: number): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    // `closing`: the last byte was a CR that ended the frame, so an LF after it is that same empty line.
    let frame = 0, line = 0, carriage = false, closing = false;
    return guarded(await inner(input, init), (chunk) => {
      for (const byte of chunk) {
        const crlf = byte === 0x0a && carriage, ended = closing;
        carriage = byte === 0x0d; closing = false;
        if (crlf) {
          if (ended) continue;
        } else if (byte === 0x0a || byte === 0x0d) {
          if (line === 0) { frame = 0; closing = carriage; continue; }
          line = 0;
        } else line += 1;
        frame += 1;
        if (frame > maxFrameBytes) return false;
      }
      return true;
    });
  }) as typeof fetch;
}

/** The fields of an SDK result this adapter reads. `response` is absent when `fetch` rejected. */
interface SdkResult {
  readonly data?: unknown;
  readonly response?: Response | undefined;
}

/** One bounded SDK call, as a read outcome. Never throws. */
async function read(base: typeof fetch, bounds: NativeReadBounds,
  call: (options: { fetch: typeof fetch; signal: AbortSignal }) => Promise<SdkResult>): Promise<NativeReadOutcome> {
  const meter: Meter = { bytes: 0, over: false };
  let result: SdkResult;
  try {
    result = await call({ fetch: metered(base, bounds.maxBytes, meter), signal: bounds.signal });
  } catch {
    // The SDK returns a rejected `fetch`; what throws is a body it could not finish reading or parse.
    return { kind: meter.over ? "oversized" : "unavailable", bytes: meter.bytes };
  }
  if (meter.over) return { kind: "oversized", bytes: meter.bytes };
  const response = result.response;
  if (response === undefined) return { kind: "unavailable", bytes: meter.bytes };
  if (response.status === 404) return { kind: "missing", bytes: meter.bytes };
  if (!response.ok) return { kind: "unavailable", bytes: meter.bytes };
  return { kind: "ok", body: result.data, bytes: meter.bytes };
}

/** Every item off the stream that names a session, as that session's id. */
async function* sessionsOf(events: AsyncIterable<unknown>): AsyncGenerator<string> {
  for await (const item of events) {
    const event = readEvent(item);
    const session = event === null ? null : sessionOf(event);
    if (session !== null) yield session;
  }
}

async function openSessionEvents(client: OpencodeClient, signal: AbortSignal): Promise<NativeSessionEvents> {
  const opened = await openEvents(client, signal);
  return opened.kind === "open" ? { kind: "open", sessions: sessionsOf(opened.events) } : opened;
}

/** Build the read port over the SDK client. Same options as `createSdkServer`, plus the event frame cap. */
export function createSdkSessionReader(options: SdkSessionReaderOptions): OpencodeSessionReader {
  const base = options.fetch ?? globalThis.fetch;
  const client = (fetch: typeof globalThis.fetch): OpencodeClient => createOpencodeClient({
    baseUrl: options.baseUrl,
    fetch,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  const reads = client(base), events = client(framed(base, options.maxEventFrameBytes ?? MAX_EVENT_FRAME_BYTES));
  return {
    session: (sessionID, bounds) => read(base, bounds, (call) => reads.session.get({ sessionID }, call)),
    children: (sessionID, bounds) => read(base, bounds, (call) => reads.session.children({ sessionID }, call)),
    messages: (sessionID, limit, bounds) =>
      read(base, bounds, (call) => reads.session.messages({ sessionID, limit }, call)),
    sessionEvents: (signal) => openSessionEvents(events, signal),
  };
}
