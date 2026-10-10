/**
 * The OpenCode server port telemetry owns (dependency inversion), beside `host-reads.ts`. The issue
 * reader needs one session, its children, its latest messages and a change signal; nothing here names
 * an endpoint. `@rickylabs/provider-opencode` exports `createSdkSessionReader`, which satisfies this
 * port structurally over `@opencode-ai/sdk`, so the provider never imports telemetry. Only the
 * composition root (`issue-agent-feed-cli.ts`) builds it, from `HARNESS_TELEMETRY_OPENCODE_SERVER`.
 * The bound, outcome and event shapes are `@rickylabs/harness-contracts`', shared with the provider.
 */
import type { NativeReadBounds, NativeReadOutcome, NativeSessionEvents } from "@rickylabs/harness-contracts";

export interface OpenCodeSessionReads {
  session(sessionID: string, bounds: NativeReadBounds): Promise<NativeReadOutcome>;
  children(sessionID: string, bounds: NativeReadBounds): Promise<NativeReadOutcome>;
  /** The latest `limit` messages with their parts, oldest first. */
  messages(sessionID: string, limit: number, bounds: NativeReadBounds): Promise<NativeReadOutcome>;
  /** The server-wide event stream reduced to the session each event names. A change hint, never evidence. */
  sessionEvents(signal: AbortSignal): Promise<NativeSessionEvents>;
}
