/**
 * The read seam onto `opencode serve`, for an observer that did not start the session.
 *
 * Verb-shaped like `server.ts`, and separate from it because an observer needs none of the launch
 * verbs and a launcher needs none of these. `src/adapters/sdk-session-reader.ts` implements it over
 * `@opencode-ai/sdk`. Every read answers with a `NativeReadOutcome` instead of throwing. The bound,
 * outcome and event shapes are `@rickylabs/harness-contracts`', because telemetry's port shares them.
 */

import type { NativeReadBounds, NativeReadOutcome, NativeSessionEvents } from "@rickylabs/harness-contracts";

export interface OpencodeSessionReader {
  /** `GET /session/:id`. */
  session(sessionID: string, bounds: NativeReadBounds): Promise<NativeReadOutcome>;
  /** `GET /session/:id/children`: the sessions whose `parentID` is this one. */
  children(sessionID: string, bounds: NativeReadBounds): Promise<NativeReadOutcome>;
  /** `GET /session/:id/message?limit=`: the latest `limit` messages with their parts, oldest first. */
  messages(sessionID: string, limit: number, bounds: NativeReadBounds): Promise<NativeReadOutcome>;
  /** `GET /event`, opened once, every frame bounded; aborting `signal` closes it. Never retried here. */
  sessionEvents(signal: AbortSignal): Promise<NativeSessionEvents>;
}
