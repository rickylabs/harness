/**
 * `OpencodeServer` over the official `@opencode-ai/sdk` client.
 *
 * The SDK owns the transport: endpoint paths, path escaping, request bodies, JSON encoding and
 * decoding, and the `GET /event` server-sent-event framing (`event.subscribe()`). This adapter owns
 * only the translation the SDK has no opinion about — turning each reply into the outcome union the
 * provider's verdicts are decided on (`src/domain/outcome.ts`):
 *
 * - **No response at all** (the SDK returns `response: undefined` when `fetch` rejects) is
 *   `unreachable`.
 * - **A non-2xx response** is `http` with its status, which is what `refutes()` reads: `4xx` refutes,
 *   `5xx` does not.
 * - **A reply that could not be read** (the SDK rejects when a JSON body does not parse, or when the
 *   server answers in HTML) is `malformed`.
 * - **Anything else** is `ok`, carrying the SDK's parsed data for the domain readers to check.
 *
 * `fetch` is passed straight to the SDK client's own `fetch` option. A composition root passes the
 * platform's; the suite passes a fake one, so no test opens a socket.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";

import type { PromptBody } from "../domain/api.js";
import { excerpt, type HttpOutcome, type StreamOutcome } from "../domain/outcome.js";
import type { OpencodeServer } from "../ports/server.js";

export interface SdkServerOptions {
  /** Where `opencode serve` is listening. Absolute, with a scheme; see `baseUrlProblems`. */
  readonly baseUrl: string;
  /** The SDK client's `fetch`. Defaults to the SDK's own choice, which is the platform's. */
  readonly fetch?: typeof fetch;
  /**
   * Headers added to every request.
   *
   * Present because a deployment may put the server behind something that wants one. It is a
   * deliberate non-feature of this package to read a credential from disk or an environment
   * variable — see `src/domain/secrets.ts`. Whatever goes here was handed in by the composition root.
   */
  readonly headers?: Record<string, string>;
}

/**
 * Why this base url cannot be used, or nothing.
 *
 * The scheme check is not decoration. A host and port written without a scheme parses as a URL —
 * with the host as the scheme and the port as an opaque path — so it is a *valid* URL object that no
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

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/** An error body as one line of text: the SDK hands back parsed JSON when it parsed, the text otherwise. */
function bodyText(error: unknown): string {
  if (error === undefined || error === null) return "";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** The fields of an SDK result this adapter reads. `response` is absent when `fetch` rejected. */
interface SdkResult {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response?: Response | undefined;
}

/** One SDK call, as an outcome. Never throws. */
async function outcomeOf(call: () => Promise<SdkResult>): Promise<HttpOutcome> {
  let result: SdkResult;
  try {
    result = await call();
  } catch (error) {
    // The SDK catches a rejected `fetch` and returns it; what reaches here is a reply it received and
    // could not read — a JSON body that does not parse, an HTML page where an API was expected.
    return { kind: "malformed", detail: messageOf(error) };
  }
  const response = result.response;
  if (response === undefined) return { kind: "unreachable", detail: messageOf(result.error) };
  if (!response.ok) {
    return { kind: "http", status: response.status, detail: excerpt(bodyText(result.error)) };
  }
  return { kind: "ok", status: response.status, body: result.data };
}

/** The first item of an SDK event stream, then the rest. A failure after it opened is rethrown. */
async function* resumed(
  first: unknown,
  stream: AsyncGenerator<unknown>,
  failure: () => unknown,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  yield first;
  for await (const item of stream) yield item;
  // The SDK reports a dropped connection through `onSseError` and then simply ends the generator.
  // Rethrowing it keeps "the stream failed" distinct from "the stream ended", as the bus reports it.
  const error = failure();
  if (error !== null && !signal.aborted) throw error instanceof Error ? error : new Error(messageOf(error));
}

/**
 * Open `event.subscribe()` and wait for its first event.
 *
 * The SDK connects lazily and retries forever by default. Neither suits a provider that must refuse a
 * dispatch it cannot watch, so retries are capped at one attempt — a reconnect is the provider's
 * decision, made on demand — and the stream counts as open only once the server has said something
 * on it: `opencode serve` greets every subscriber with `server.connected`, a native signal that the
 * subscription is live rather than an inference from a status line.
 */
export async function openEvents(client: OpencodeClient, signal: AbortSignal): Promise<StreamOutcome> {
  let failure: unknown = null;
  let stream: AsyncGenerator<unknown>;
  try {
    const subscription = await client.event.subscribe(undefined, {
      signal,
      sseMaxRetryAttempts: 1,
      onSseError: (error: unknown): void => {
        failure = error;
      },
    });
    stream = subscription.stream;
  } catch (error) {
    return { kind: "closed", detail: messageOf(error) };
  }
  let first: IteratorResult<unknown>;
  try {
    first = await stream.next();
  } catch (error) {
    return { kind: "closed", detail: messageOf(error) };
  }
  if (first.done === true) {
    const reason: unknown = failure;
    return { kind: "closed", detail: reason === null ? "the event stream ended before it opened" : messageOf(reason) };
  }
  return { kind: "open", events: resumed(first.value, stream, () => failure, signal) };
}

/** The SDK's prompt parameters for one `PromptBody`. `agent` only when the deployment set one. */
function promptParameters(sessionID: string, body: PromptBody): Parameters<OpencodeClient["session"]["promptAsync"]>[0] {
  return {
    sessionID,
    model: { providerID: body.model.providerID, modelID: body.model.modelID },
    parts: body.parts.map((part) => ({ type: part.type, text: part.text })),
    ...(body.agent === undefined ? {} : { agent: body.agent }),
  };
}

/** Build the server port over one SDK client. */
export function createSdkServer(options: SdkServerOptions): OpencodeServer {
  const client = createOpencodeClient({
    baseUrl: options.baseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  return {
    createSession: (title) => outcomeOf(() => client.session.create({ title })),
    prompt: (sessionId, body) => outcomeOf(() => client.session.promptAsync(promptParameters(sessionId, body))),
    abort: (sessionId) => outcomeOf(() => client.session.abort({ sessionID: sessionId })),
    remove: (sessionId) => outcomeOf(() => client.session.delete({ sessionID: sessionId })),
    events: (signal) => openEvents(client, signal),
  };
}
