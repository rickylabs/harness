/**
 * The read seam onto `opencode serve`, for an observer that did not start the session.
 *
 * Verb-shaped like `server.ts`, and separate from it because an observer needs none of the launch
 * verbs and a launcher needs none of these. `src/adapters/sdk-session-reader.ts` implements it over
 * `@opencode-ai/sdk`. Every read answers with a `ReadOutcome` instead of throwing.
 */

import type { ReadOutcome } from "../domain/outcome.js";

/** The caller's bound on one read: at most `maxBytes` off the wire, and abandoned when `signal` aborts. */
export interface ReadBounds {
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

/** The server-wide event stream, reduced to the session each event names. */
export type SessionEvents =
  | { readonly kind: "open"; readonly sessions: AsyncIterable<string> }
  | { readonly kind: "closed"; readonly detail: string };

export interface OpencodeSessionReader {
  /** `GET /session/:id`. */
  session(sessionID: string, bounds: ReadBounds): Promise<ReadOutcome>;
  /** `GET /session/:id/children`: the sessions whose `parentID` is this one. */
  children(sessionID: string, bounds: ReadBounds): Promise<ReadOutcome>;
  /** `GET /session/:id/message?limit=`: the latest `limit` messages with their parts, oldest first. */
  messages(sessionID: string, limit: number, bounds: ReadBounds): Promise<ReadOutcome>;
  /** `GET /event`, opened once; aborting `signal` closes it. Never retried here. */
  sessionEvents(signal: AbortSignal): Promise<SessionEvents>;
}
