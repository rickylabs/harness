/**
 * The transport, and the distinction the whole provider is built on.
 *
 * ## Why an outcome union instead of `throw`
 *
 * `SubagentProvider`'s difficult word is `unknown`, and for an HTTP-backed provider the word is
 * decided here rather than in the verbs. A rejected `fetch` and a `409` are the same JavaScript
 * event — an exception, or a value nobody looked at — and they are opposite facts:
 *
 * - **The server read the request and declined it.** Nothing launched that we did not see launch, so
 *   a caller may act on that, including by trying again.
 * - **Anything else.** The request may have been received, executed, and its response lost.
 *   `isSafeToRetry` licenses a retry only for `refused`, precisely so that this case cannot put a
 *   second agent on the branch the first one is already holding.
 *
 * `refutes()` is that split as a callable predicate, so the verbs read it instead of re-deriving it
 * from an error message. A `malformed` reply is on the ambiguous side on purpose: the server did
 * respond, but we could not read what it said, and "it did something and we do not know what" is
 * exactly what `unknown` is for.
 *
 * ## Why a `5xx` does not refute anything
 *
 * The distinction is not "did bytes come back". `502`, `503` and `504` are what an intermediary says
 * when it could not get an answer out of the thing behind it — a statement about the proxy's
 * patience, not about whether the origin ran the request. A `504` on `prompt_async` is the precise
 * shape of *the agent started and the gateway stopped waiting*. A `500` is the origin saying it
 * failed, with no promise about how far it got first.
 *
 * Only the `4xx` class is the server having read the request, evaluated it, and said no, and only
 * that class proves nothing is executing. Reading every status as a definite answer is how a live
 * run gets reported `refused`, and `refused` is the one verdict `isSafeToRetry` licenses — so the
 * coordinator would dispatch a second agent onto a branch the first is still holding.
 *
 * ## Why `fetch` is injected
 *
 * The same argument `provider-claude`'s `sdk.ts` makes about the Agent SDK, one size down.
 * `@opencode-ai/sdk` is a generated HTTP client over the endpoints below; taking it as a dependency
 * would add a package and a version to CI in exchange for types we can write here in forty lines and
 * a wire format we would still have to verify. So the slice of `fetch` this package uses is declared
 * rather than imported, `dsh-app` binds the real one, and the suite binds a fake.
 *
 * The honesty that costs is the same, and is stated once: **nothing here has been run against a real
 * `opencode serve`.** The endpoint set and the request bodies come from the vendor's own HTTP
 * documentation; the response *shapes* are read by the checked readers in `api.ts` and never by
 * property access, so a field that is not what we assumed produces a `malformed` outcome — a state
 * the contract has a meaning for — rather than a `TypeError` in a background loop.
 */

/** The methods this package uses. Anything else would be a new capability, not a new call. */
export type HttpMethod = "GET" | "POST" | "DELETE";

export interface HttpRequest {
  readonly method: HttpMethod;
  /** Server-absolute, beginning with `/`. Joined onto the base url by the transport. */
  readonly path: string;
  /** JSON-encoded when present. Absent means no body and no content type. */
  readonly body?: unknown;
}

/**
 * What came back.
 *
 * `ok` carries the parsed body, which is `null` for the `204` replies `prompt_async` sends — an
 * empty body is a successful answer, not a malformed one.
 */
export type HttpOutcome =
  | { readonly kind: "ok"; readonly status: number; readonly body: unknown }
  | { readonly kind: "http"; readonly status: number; readonly detail: string }
  | { readonly kind: "malformed"; readonly detail: string }
  | { readonly kind: "unreachable"; readonly detail: string };

/** One request, one outcome. `dsh-app` binds the real transport; the suite binds a fake. */
export type HttpFn = (request: HttpRequest) => Promise<HttpOutcome>;

/**
 * Whether this outcome proves the request had no effect.
 *
 * The predicate the verbs branch on. `true` licenses `refused` — and only `refused`, because
 * `isSafeToRetry` licenses a retry on exactly that word. `false` means the only honest verdict is
 * `unknown`, whatever the detail says.
 *
 * A `4xx` is a refutation: the server read the request, evaluated it, and declined. A `5xx` is not,
 * for the reason argued in this module's header — see "Why a `5xx` does not refute anything".
 */
export function refutes(outcome: HttpOutcome): boolean {
  return outcome.kind === "http" && outcome.status < 500;
}

/** A one-line description of an outcome, for a detail string. Never includes a response body verbatim. */
export function describeOutcome(outcome: HttpOutcome): string {
  switch (outcome.kind) {
    case "ok":
      return `HTTP ${outcome.status}`;
    case "http":
      return `HTTP ${outcome.status}: ${outcome.detail}`;
    case "malformed":
      return `the server replied with something this provider could not read: ${outcome.detail}`;
    case "unreachable":
      return `the server could not be reached: ${outcome.detail}`;
  }
}

export interface StreamRequest {
  readonly path: string;
  /** Aborting this closes the connection. The provider owns exactly one, for the life of the stream. */
  readonly signal: AbortSignal;
}

/**
 * A long-lived response body, as decoded text chunks in arrival order.
 *
 * Chunks are not frames: an SSE frame can span two chunks and a chunk can hold three frames.
 * Reassembly is `events.ts`'s job and is a pure function, which is what lets it be tested against
 * the split points a real socket produces rather than the tidy ones a fake would.
 */
export type StreamOutcome =
  | { readonly kind: "open"; readonly chunks: AsyncIterable<string> }
  | { readonly kind: "http"; readonly status: number; readonly detail: string }
  | { readonly kind: "unreachable"; readonly detail: string };

export type StreamFn = (request: StreamRequest) => Promise<StreamOutcome>;

/** The slice of `fetch`'s init this package sets. */
export interface FetchInit {
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/**
 * The slice of a `fetch` response this package reads.
 *
 * `body` is typed `unknown` for the same reason `sdk.ts` types its stream `unknown`: the platform's
 * own declaration varies by runtime and by `lib`, and nothing the vendor ships should fail to
 * satisfy this type for a reason that is really about our guess. Whether it can actually be iterated
 * is asked at runtime, once, in `streamOf`.
 */
export interface FetchResponse {
  readonly status: number;
  text(): Promise<string>;
  readonly body?: unknown;
}

export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResponse>;

/** How much of an error body reaches a detail string. Enough to diagnose, not enough to dump. */
export const EXCERPT_LIMIT = 200;

/** One line of an error body, truncated. Scrubbing is the provider's boundary, not this one's. */
export function excerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line === "") return "(empty body)";
  return line.length <= EXCERPT_LIMIT ? line : `${line.slice(0, EXCERPT_LIMIT)}…`;
}

/**
 * Why this base url cannot be used, or nothing.
 *
 * The scheme check is not decoration. `new URL("n5:4096")` parses — with scheme `n5:` and the rest
 * as an opaque path — so a host:port written without a scheme is a *valid* URL object that no
 * request will ever reach. Checking `protocol` is what turns that into a refusal at configuration
 * time instead of an `unreachable` on every dispatch.
 */
export function baseUrlProblems(baseUrl: string): readonly string[] {
  const problems: string[] = [];
  if (baseUrl.trim() === "") {
    problems.push("the server url is empty");
    return problems;
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    problems.push(`the server url ${JSON.stringify(baseUrl)} is not a url`);
    return problems;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    problems.push(
      `the server url ${JSON.stringify(baseUrl)} has scheme ${JSON.stringify(url.protocol)}; ` +
        "a host:port written without http:// parses as a url and reaches nothing",
    );
  }
  if (url.hostname === "") problems.push(`the server url ${JSON.stringify(baseUrl)} names no host`);
  return problems;
}

/** Join a server-absolute path onto a base url, without doubling or dropping the separator. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

export interface TransportOptions {
  /** Where `opencode serve` is listening. Absolute, with a scheme. */
  readonly baseUrl: string;
  readonly fetch: FetchFn;
  /**
   * Headers added to every request.
   *
   * Present because a deployment may put the server behind something that wants one. It is a
   * deliberate non-feature of this package to read a credential from disk or an environment
   * variable — see `secrets.ts`. Whatever goes here was handed in by the composition root.
   */
  readonly headers?: Record<string, string>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a value can be `for await`-ed. Asked of a response body once, at runtime. */
function asyncIterable(value: unknown): AsyncIterable<unknown> | null {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  const method = (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
  return typeof method === "function" ? (value as AsyncIterable<unknown>) : null;
}

/** Decode a byte stream to text, carrying multi-byte characters across chunk boundaries. */
async function* decode(source: AsyncIterable<unknown>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of source) {
    if (typeof chunk === "string") {
      yield chunk;
      continue;
    }
    if (chunk instanceof Uint8Array) {
      const text = decoder.decode(chunk, { stream: true });
      if (text !== "") yield text;
    }
  }
  const tail = decoder.decode();
  if (tail !== "") yield tail;
}

/**
 * Build the two transports over one `fetch`.
 *
 * They are returned together because they are one connection's worth of configuration, and a
 * deployment that had a working `http` and a differently-configured `stream` would observe a server
 * it was not dispatching to.
 */
export function createTransport(options: TransportOptions): {
  readonly http: HttpFn;
  readonly stream: StreamFn;
} {
  const headers = options.headers ?? {};

  const http: HttpFn = async (request) => {
    const url = joinUrl(options.baseUrl, request.path);
    const hasBody = request.body !== undefined;
    let response: FetchResponse;
    try {
      response = await options.fetch(url, {
        method: request.method,
        headers: { accept: "application/json", ...(hasBody ? { "content-type": "application/json" } : {}), ...headers },
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      });
    } catch (error) {
      return { kind: "unreachable", detail: messageOf(error) };
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      // The status arrived and the body did not. The server answered, but not readably.
      return { kind: "malformed", detail: `HTTP ${response.status}, body unreadable: ${messageOf(error)}` };
    }

    if (response.status >= 400) {
      return { kind: "http", status: response.status, detail: excerpt(text) };
    }
    if (text.trim() === "") return { kind: "ok", status: response.status, body: null };
    try {
      return { kind: "ok", status: response.status, body: JSON.parse(text) };
    } catch (error) {
      return { kind: "malformed", detail: `HTTP ${response.status}, body is not json: ${messageOf(error)}` };
    }
  };

  const stream: StreamFn = async (request) => {
    const url = joinUrl(options.baseUrl, request.path);
    let response: FetchResponse;
    try {
      response = await options.fetch(url, {
        method: "GET",
        headers: { accept: "text/event-stream", ...headers },
        signal: request.signal,
      });
    } catch (error) {
      return { kind: "unreachable", detail: messageOf(error) };
    }
    if (response.status >= 400) {
      return { kind: "http", status: response.status, detail: `HTTP ${response.status}` };
    }
    const source = asyncIterable(response.body);
    if (source === null) {
      // Not a failure of the server. Node's response body is async-iterable and a browser's is not,
      // and a provider that silently reported "no events" on such a runtime would be a coordinator
      // that watches nothing while claiming to watch everything.
      return {
        kind: "unreachable",
        detail: "this runtime's response body cannot be iterated, so the event stream cannot be read",
      };
    }
    return { kind: "open", chunks: decode(source) };
  };

  return { http, stream };
}
