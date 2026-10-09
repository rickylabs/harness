/**
 * The OpenCode server port telemetry owns (dependency inversion), beside `host-reads.ts`. The issue
 * reader needs one session, its children, its latest messages and a change signal; nothing here names
 * an endpoint. `@rickylabs/provider-opencode` exports `createSdkSessionReader`, which satisfies this
 * port structurally over `@opencode-ai/sdk`, so the provider never imports telemetry. Only the
 * composition root (`issue-agent-feed-cli.ts`) builds it, from `HARNESS_TELEMETRY_OPENCODE_SERVER`.
 */

/** One bounded read. `missing` is the server's own 404 for the id; `bytes` came off the wire either way. */
export type OpenCodeRead =
  | { readonly kind: "ok"; readonly body: unknown; readonly bytes: number }
  | { readonly kind: "missing" | "oversized" | "unavailable"; readonly bytes: number };

export interface OpenCodeReadBounds {
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

export interface OpenCodeSessionReads {
  session(sessionID: string, bounds: OpenCodeReadBounds): Promise<OpenCodeRead>;
  children(sessionID: string, bounds: OpenCodeReadBounds): Promise<OpenCodeRead>;
  /** The latest `limit` messages with their parts, oldest first. */
  messages(sessionID: string, limit: number, bounds: OpenCodeReadBounds): Promise<OpenCodeRead>;
  /** The server-wide event stream reduced to the session each event names. A change hint, never evidence. */
  sessionEvents(signal: AbortSignal): Promise<
    { readonly kind: "open"; readonly sessions: AsyncIterable<string> } | { readonly kind: "closed" }>;
}
