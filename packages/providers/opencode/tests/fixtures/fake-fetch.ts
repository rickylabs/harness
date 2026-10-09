/**
 * Test support: a `fetch` the SDK client can be handed, so no suite opens a socket.
 *
 * Replies are real `Response` objects and the event stream is a real byte stream, because the SDK
 * parses both itself: a fake that skipped the bytes would test this package against a transport it
 * does not use. Not a test file, so the runner does not collect it.
 */

/** The synthetic server every suite points the client at. `.invalid` never resolves. */
export const BASE_URL = "http://opencode.example.invalid";

/** What the fake answers one request with: a status and a JSON or text body, or a network failure. */
export type Reply =
  | { readonly status: number; readonly json?: unknown; readonly text?: string; readonly contentType?: string }
  | { readonly fail: string };

export function json(status: number, body: unknown): Reply {
  return { status, json: body };
}

export function text(status: number, body: string): Reply {
  return { status, text: body, contentType: "text/plain" };
}

export function unreachable(detail: string): Reply {
  return { fail: detail };
}

/** Turn a reply into what `fetch` would have produced. Throws for a network failure, as `fetch` does. */
export function respond(reply: Reply): Response {
  if ("fail" in reply) throw new TypeError(reply.fail);
  if (reply.json !== undefined) {
    return new Response(JSON.stringify(reply.json), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }
  if (reply.text !== undefined) {
    return new Response(reply.text, {
      status: reply.status,
      headers: { "content-type": reply.contentType ?? "text/plain" },
    });
  }
  return new Response(null, { status: reply.status });
}

/** One `GET /event` connection whose frames a test writes, and can end or break on demand. */
export interface EventChannel {
  readonly response: Response;
  /** Send one event as an SSE frame. */
  send(event: unknown): void;
  /** Send raw stream text, for the framing cases. */
  raw(chunk: string | Uint8Array): void;
  /** End the connection cleanly, as a server restart or a proxy timeout would. */
  close(): void;
  /** Break the connection mid-stream. */
  fail(error: Error): void;
}

export function eventChannel(greet = true): EventChannel {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(started): void {
      controller = started;
    },
  });
  const live = (): ReadableStreamDefaultController<Uint8Array> => {
    if (controller === null) throw new Error("the event stream was never started");
    return controller;
  };
  const channel: EventChannel = {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    send: (event) => live().enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    raw: (chunk) => live().enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk),
    close: () => live().close(),
    fail: (error) => live().error(error),
  };
  // `opencode serve` greets every subscriber; the adapter treats that first event as "open".
  if (greet) channel.send({ type: "server.connected", properties: {} });
  return channel;
}

/** A request as the suites record it. */
export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly headers: Headers;
}

export async function record(request: Request): Promise<Recorded> {
  const raw = await request.clone().text();
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    body: raw === "" ? undefined : JSON.parse(raw),
    headers: request.headers,
  };
}

/** Let a background consume loop catch up with what the test just wrote. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}
