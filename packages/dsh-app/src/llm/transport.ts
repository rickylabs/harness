/**
 * The one place in this package that opens a socket.
 *
 * `@rickylabs/llm-local` deliberately stops short of this: `endpoint.ts` says where a request goes
 * and `health.ts` says what came back of it, and both take the exchange as data so neither needs a
 * network to test. Registering an adapter on `ctx.llm` finally needs the missing half, and this file
 * is all of it — a function from a request value to a response value, with every decision about what
 * to send and what a response means living somewhere else.
 *
 * ## Why the seam is a function type rather than a class
 *
 * `stream()` is handed a `Transport` at construction. A test supplies an array of strings; the
 * daemon supplies `fetchTransport()`. The adapter cannot tell the difference, which is the point:
 * the SSE framing, the chunk translation, the refusals and the usage arithmetic are all reachable
 * from a test with no server running, and only the twenty lines below are not.
 *
 * ## Why the exchange union mirrors `llm-local`'s
 *
 * `health.ts` already answers "did we reach it, and if so with what" as a two-member union, because
 * *no answer* and *an answer we did not like* have different remedies and collapsing them loses the
 * one that matters. The same split is worth as much here: a connection refused names a server that
 * is not running, and an HTTP 400 names a request we built wrong. This union carries a stream where
 * `Exchange` carries a body, and is otherwise the same shape for the same reason.
 *
 * ## Nothing here inspects the body
 *
 * Not the status, not the headers, not a byte of the payload. A transport that decided what a 429
 * meant would be a second place the protocol is interpreted, and the first place — `stream.ts` — is
 * the one with the tests. The status is passed up as a number and the body as text.
 */

/** A request, as data: everything the socket needs and nothing it has to derive. */
export interface WireRequest {
  readonly url: string;
  /** Already merged: content type, accept, attribution, and any credential the caller bound. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

/**
 * What came back.
 *
 * `reached: false` is a transport fault — DNS, connection refused, TLS, an abort before the response
 * head arrived. `reached: true` is an HTTP response of any status, including the ones that mean the
 * request was wrong.
 */
export type WireExchange =
  | { readonly reached: false; readonly error: string }
  | {
      readonly reached: true;
      readonly status: number;
      /** Decoded response-body text, in whatever pieces the socket delivered it. */
      readonly chunks: AsyncIterable<string>;
    };

/** Send a request, get an exchange. Never throws: a fault is a value. */
export type Transport = (request: WireRequest) => Promise<WireExchange>;

/**
 * Read a `fetch` response body as decoded text pieces.
 *
 * Byte-level, because an SSE frame boundary and a UTF-8 code-point boundary have nothing to do with
 * each other: a multi-byte character split across two network reads decodes to a replacement
 * character unless the decoder is told the stream continues. `TextDecoder` with `{ stream: true }`
 * holds the partial sequence; the final flush emits whatever it was still holding.
 */
async function* decodeBody(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const text = decoder.decode(step.value, { stream: true });
      if (text !== "") yield text;
    }
  } finally {
    reader.releaseLock();
  }
  const tail = decoder.decode();
  if (tail !== "") yield tail;
}

/**
 * A response with no body at all — a 204, or a server that closed after the head.
 *
 * An empty iterable rather than a refusal, because "reached, and it said nothing" is a real outcome
 * that the layer above already has a name for: a stream that ends with no finish reason becomes
 * `INCOMPLETE_STREAM`, which is exactly what happened.
 */
async function* noBody(): AsyncIterable<string> {
  // nothing
}

/**
 * The real transport.
 *
 * `impl` exists so the loopback test can hand in a `fetch` bound to a server it started, and so this
 * function is not the only thing standing between the suite and a network. It is not a general
 * injection point — the adapter injects at the `Transport` seam above, which is coarser and cheaper.
 *
 * A rejected `fetch` becomes `reached: false` carrying the error's message. The message is a Node
 * diagnostic ("fetch failed", "The operation was aborted"), never anything the caller supplied, so
 * it cannot carry a credential from the request into a log.
 */
export function fetchTransport(impl: typeof fetch = fetch): Transport {
  return async (request: WireRequest): Promise<WireExchange> => {
    let response: Response;
    try {
      response = await impl(request.url, {
        method: "POST",
        headers: { ...request.headers },
        body: request.body,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (error) {
      return { reached: false, error: error instanceof Error ? error.message : String(error) };
    }
    return {
      reached: true,
      status: response.status,
      chunks: response.body === null ? noBody() : decodeBody(response.body),
    };
  };
}
