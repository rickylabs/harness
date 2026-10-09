/**
 * The one seam between this provider and `opencode serve`.
 *
 * Verb-shaped rather than path-shaped: the provider asks for a session, a prompt, an abort, a
 * deletion and the event stream, and never names an endpoint. `src/adapters/sdk-server.ts`
 * implements it over `@opencode-ai/sdk`; a suite can implement it over anything.
 *
 * Every call answers with an outcome instead of throwing, because the difference between "the server
 * declined" and "we do not know what happened" is the difference between `refused` and `unknown`
 * (see `src/domain/outcome.ts`). An implementation that threw would hand that decision to whoever
 * caught it.
 */

import type { PromptBody } from "../domain/api.js";
import type { HttpOutcome, StreamOutcome } from "../domain/outcome.js";

export interface OpencodeServer {
  /** Create a session. `ok` carries the session, whose id `readSessionId` reads. */
  createSession(title: string): Promise<HttpOutcome>;
  /** Start the agent on a session, or interject into it. `ok` means the server queued it. */
  prompt(sessionId: string, body: PromptBody): Promise<HttpOutcome>;
  /** Abort whatever the session is doing. `ok` carries the server's bare boolean. */
  abort(sessionId: string): Promise<HttpOutcome>;
  /** Delete a session nobody prompted. Best effort; the provider reads nothing from it. */
  remove(sessionId: string): Promise<HttpOutcome>;
  /** Open the server-wide event stream. Aborting `signal` closes it. */
  events(signal: AbortSignal): Promise<StreamOutcome>;
}
