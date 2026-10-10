/**
 * The shapes of a bounded read of a vendor's session server (0.41.0), owned here because two ports
 * share them: the provider's read port (`@rickylabs/provider-opencode`) answers with them and
 * telemetry's server port consumes them. Each port stays its own interface; neither copies these.
 */

/** The caller's bound on one read: at most `maxBytes` off the wire, and abandoned when `signal` aborts. */
export interface NativeReadBounds {
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

/**
 * One bounded read. `missing` is the server's own `404` for that id, the only reply that says the
 * session is not there; `oversized` passed the caller's byte cap and was cut off unread, a bound and
 * not a fault; `unavailable` is everything else, including a `5xx` and no answer at all. `bytes` is
 * what came off the wire either way, so a caller can account for its budget.
 */
export type NativeReadOutcome =
  | { readonly kind: "ok"; readonly body: unknown; readonly bytes: number }
  | { readonly kind: "missing" | "oversized" | "unavailable"; readonly bytes: number };

/** The server-wide event stream reduced to the session each event names: a change hint, never evidence. */
export type NativeSessionEvents =
  | { readonly kind: "open"; readonly sessions: AsyncIterable<string> }
  | { readonly kind: "closed"; readonly detail: string };
