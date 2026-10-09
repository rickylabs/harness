/**
 * What a call to the server came back as, and the distinction the whole provider is built on.
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
 */

/**
 * What came back.
 *
 * `ok` carries the parsed body, which is empty for the `204` replies `prompt_async` sends — an
 * empty body is a successful answer, not a malformed one.
 */
export type HttpOutcome =
  | { readonly kind: "ok"; readonly status: number; readonly body: unknown }
  | { readonly kind: "http"; readonly status: number; readonly detail: string }
  | { readonly kind: "malformed"; readonly detail: string }
  | { readonly kind: "unreachable"; readonly detail: string };

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

/**
 * The event stream, once asked for.
 *
 * `open` carries the stream's items in arrival order, already framed and parsed by the SDK; reading
 * them is `events.ts`'s job. `closed` is every way the stream could not be had, in a sentence a
 * refusal or an observation can quote. No status is needed here: a dispatch that cannot watch its
 * run is refused whatever the reason, so the stream's failure is a detail, not a verdict.
 */
export type StreamOutcome =
  | { readonly kind: "open"; readonly events: AsyncIterable<unknown> }
  | { readonly kind: "closed"; readonly detail: string };

/** How much of an error body reaches a detail string. Enough to diagnose, not enough to dump. */
export const EXCERPT_LIMIT = 200;

/** One line of an error body, truncated. Scrubbing is the provider's boundary, not this one's. */
export function excerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line === "") return "(empty body)";
  return line.length <= EXCERPT_LIMIT ? line : `${line.slice(0, EXCERPT_LIMIT)}…`;
}

/**
 * One bounded read of a session, its children or its messages.
 *
 * A read never licenses anything, so it does not need `refutes()`'s split. It needs a different one:
 * `missing` is the server's own `404` for that id, which is the only reply that says the session is
 * not there; `oversized` is a reply that passed the caller's byte cap and was cut off unread, which
 * is a bound, not a fault; `unavailable` is everything else, including a `5xx` and no answer at all.
 * `bytes` is what was read off the wire either way, so a caller can account for its budget.
 */
export type ReadOutcome =
  | { readonly kind: "ok"; readonly body: unknown; readonly bytes: number }
  | { readonly kind: "missing"; readonly bytes: number }
  | { readonly kind: "oversized"; readonly bytes: number }
  | { readonly kind: "unavailable"; readonly bytes: number };
