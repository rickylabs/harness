/**
 * `@rickylabs/provider-opencode` — a `SubagentProvider` over a long-lived `opencode serve`.
 *
 * E3's third provider (#55), and the first one that does not own the thing it launches.
 * `provider-claude` is a run's parent process; this package is a client of a server that was already
 * running and will still be running afterwards. Four properties follow from that, and each is argued
 * where it lives:
 *
 * - **The handle exists before the agent does** — `api.ts`. Creating the session and starting it are
 *   two calls, so a prompt whose reply is lost still leaves a run that can be observed, steered and
 *   stopped. It is the difference between an `unknown` you can go and look at and one you cannot.
 * - **A dispatch that cannot be watched is refused** — `provider.ts`. The `GET /event` stream is
 *   opened before the session is created, and a run is never launched into silence.
 * - **`router:` and `model:` are the wire's two fields, and a doubled prefix is refused** —
 *   `model.ts`. Neither stripping it nor sending it twice is knowledge; both are guesses that run
 *   the wrong model.
 * - **Nothing this package emits can carry a credential** — `secrets.ts`. It never reads one, and
 *   everything it says goes through one scrubbing boundary, because the strings that leak are the
 *   ones the server wrote.
 *
 * Nothing here has been run against a real `opencode serve`. The endpoints and request bodies come
 * from the vendor's HTTP documentation; every reply is read through a checked reader, so a shape
 * that is not what was assumed becomes an `unknown` the contract has a meaning for rather than a
 * `TypeError` in a background loop. Verifying it against the running server is #49.
 */

export {
  bagOf,
  promptBody,
  readBoolean,
  readHealth,
  readSessionId,
  segment,
  sessionBody,
  stringAt,
  PATHS,
  type Health,
  type PromptBody,
  type WireModel,
} from "./api.js";

export {
  classify,
  feed,
  readEvent,
  sessionOf,
  BUFFER_LIMIT,
  NO_FRAMES,
  type FrameState,
  type FrameStep,
  type OpencodeEvent,
  type Signal,
} from "./events.js";

export {
  baseUrlProblems,
  createTransport,
  describeOutcome,
  excerpt,
  joinUrl,
  refutes,
  EXCERPT_LIMIT,
  type FetchFn,
  type FetchInit,
  type FetchResponse,
  type HttpFn,
  type HttpMethod,
  type HttpOutcome,
  type HttpRequest,
  type StreamFn,
  type StreamOutcome,
  type StreamRequest,
  type TransportOptions,
} from "./http.js";

export { translateModel, untranslated, type Translation } from "./model.js";

export {
  applySignal,
  busSpoke,
  describe,
  isOver,
  markFinished,
  markQueued,
  markSessionCreated,
  markStopped,
  markStopping,
  markUnknown,
  newRun,
  reservedRun,
  unverified,
  type NewRun,
  type RunRecord,
} from "./run.js";

export {
  basename,
  leaks,
  pathIsCredentialFile,
  scrub,
  CREDENTIAL_FILES,
} from "./secrets.js";

export {
  OpencodeProvider,
  createProvider,
  CAPABILITIES,
  DEFAULT_ID,
  type OpencodeProviderOptions,
} from "./provider.js";

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/provider-opencode" as const;

export type PackageName = typeof PACKAGE_NAME;
