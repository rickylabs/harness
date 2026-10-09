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
 * - **One word per reply.** `ok`, the server's own `404` (`missing`), `oversized`, or `unavailable`
 *   (`src/domain/outcome.ts`). Nothing here reads a body's shape; the caller's checked readers do.
 *
 * The event side reduces each server-wide event to the session it names (`sessionOf`) and drops the
 * rest, so a caller holds a session id, never an event payload — the payloads carry the agent's text.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";

import { readEvent, sessionOf } from "../domain/events.js";
import type { ReadOutcome } from "../domain/outcome.js";
import type { OpencodeSessionReader, ReadBounds, SessionEvents } from "../ports/session-reader.js";
import { openEvents, type SdkServerOptions } from "./sdk-server.js";

/** Bytes read so far, and whether the cap was passed. One per call. */
interface Meter {
  bytes: number;
  over: boolean;
}

/** A `fetch` whose response body errors once more than `maxBytes` have been read from it. */
function metered(inner: typeof fetch, maxBytes: number, meter: Meter): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const response = await inner(input, init);
    const source = response.body;
    // A body-less status cannot be rebuilt with a stream; there is nothing to meter anyway.
    if (source === null || [101, 204, 205, 304].includes(response.status)) return response;
    const reader = source.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        meter.bytes += value.byteLength;
        if (meter.bytes > maxBytes) {
          meter.over = true;
          await reader.cancel();
          controller.error(new RangeError("the reply passed its read bound"));
          return;
        }
        controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }) as typeof fetch;
}

/** The fields of an SDK result this adapter reads. `response` is absent when `fetch` rejected. */
interface SdkResult {
  readonly data?: unknown;
  readonly response?: Response | undefined;
}

/** One bounded SDK call, as a read outcome. Never throws. */
async function read(base: typeof fetch, bounds: ReadBounds,
  call: (options: { fetch: typeof fetch; signal: AbortSignal }) => Promise<SdkResult>): Promise<ReadOutcome> {
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

async function openSessionEvents(client: OpencodeClient, signal: AbortSignal): Promise<SessionEvents> {
  const opened = await openEvents(client, signal);
  return opened.kind === "open" ? { kind: "open", sessions: sessionsOf(opened.events) } : opened;
}

/** Build the read port over one SDK client. Same options as `createSdkServer`. */
export function createSdkSessionReader(options: SdkServerOptions): OpencodeSessionReader {
  const base = options.fetch ?? globalThis.fetch;
  const client = createOpencodeClient({
    baseUrl: options.baseUrl,
    fetch: base,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  return {
    session: (sessionID, bounds) => read(base, bounds, (call) => client.session.get({ sessionID }, call)),
    children: (sessionID, bounds) => read(base, bounds, (call) => client.session.children({ sessionID }, call)),
    messages: (sessionID, limit, bounds) =>
      read(base, bounds, (call) => client.session.messages({ sessionID, limit }, call)),
    sessionEvents: (signal) => openSessionEvents(client, signal),
  };
}
