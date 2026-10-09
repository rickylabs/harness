/**
 * How the opencode provider is configured, and what it declares it can do.
 */

import type { ProviderCapabilities } from "@rickylabs/subagents";

import type { OpencodeServer } from "../ports/server.js";

/** Registration id when a deployment does not name one. */
export const DEFAULT_ID = "opencode-http";

/**
 * How long opening the event stream waits for the server's first event before answering without it.
 *
 * The same bound, and the same reasoning, as `provider-claude`'s `DEFAULT_READY_MS`: long enough
 * that a cold server is not mistaken for a dead one, short enough that a coordinator dispatching a
 * wave is not blocked behind one wedged connection. A dispatch that hits it is refused with nothing
 * sent, because a run nobody can watch is not launched.
 */
export const DEFAULT_READY_MS = 60_000;

/**
 * What this provider can do.
 *
 * Both opencode harnesses, because the difference between `opencode` and `opencode-run` is how a
 * divybot agent is invoked, and neither reaches this server differently: a prompt is a prompt. All
 * three optional calls are real — `observe` off the event bus, `steer` as a second prompt into the
 * same session, `stop` as an abort of the session.
 */
export const CAPABILITIES: ProviderCapabilities = {
  harnesses: ["opencode", "opencode-run"],
  observe: true,
  steer: true,
  stop: true,
};

export interface OpencodeProviderOptions {
  /** The server. `createSdkServer` builds the real one over `@opencode-ai/sdk`. */
  readonly server: OpencodeServer;
  /** Registration id. Defaults to `opencode-http`. */
  readonly id?: string;
  /**
   * A directory worth collecting evidence from, if the deployment has one.
   *
   * Reported as an artifact, so it is published. Deliberately not defaulted to the opencode data
   * directory: that is where `auth.json` lives, and pointing evidence collection at it would be a
   * leak with a delay on it. A `logDir` that names a credential file is refused outright.
   */
  readonly logDir?: string;
  /** The server-side agent to run prompts as, when a deployment configures one. */
  readonly agent?: string;
  /** Prefix for the session title a run is created with. Never carries the prompt. */
  readonly titlePrefix?: string;
  /** Milliseconds opening the event stream waits for its first event. Defaults to `DEFAULT_READY_MS`. */
  readonly readyTimeoutMs?: number;
  /** Clock, injected so the suite can assert on timestamps. */
  readonly now?: () => Date;
}
