/**
 * `@rickylabs/provider-opencode` — a `SubagentProvider` over a long-lived `opencode serve`.
 *
 * E3's third provider (#55), and the first one that does not own the thing it launches.
 * `provider-claude` is a run's parent process; this package is a client of a server that was already
 * running and will still be running afterwards. Five properties follow from that, and each is argued
 * where it lives:
 *
 * - **The transport is the vendor's SDK** — `src/adapters/sdk-server.ts`, over `@opencode-ai/sdk`.
 *   Paths, bodies, decoding and event framing are the SDK's; this package keeps only the policy the
 *   SDK has no opinion about.
 * - **The handle exists before the agent does** — `src/domain/api.ts`. Creating the session and
 *   starting it are two calls, so a prompt whose reply is lost still leaves a run that can be
 *   observed, steered and stopped.
 * - **A dispatch that cannot be watched is refused** — `src/application/provider.ts`. The event
 *   stream is opened before the session is created, and a run is never launched into silence.
 * - **`router:` and `model:` are the wire's two fields, and a doubled prefix is refused** —
 *   `src/application/model.ts`. Neither stripping it nor sending it twice is knowledge; both are
 *   guesses that run the wrong model.
 * - **An observer reads through its own port** — `src/ports/session-reader.ts`, over the same SDK in
 *   `src/adapters/sdk-session-reader.ts`: session, children, messages and the session each event
 *   names, every reply byte-capped. Telemetry's issue reader composes it.
 * - **Nothing this package emits can carry a credential** — `src/domain/secrets.ts`. It never reads
 *   one, and everything it says goes through one scrubbing boundary, because the strings that leak
 *   are the ones the server wrote.
 *
 * The launch verbs have not been run against a real `opencode serve`; verifying them is #49. The read
 * side is checked against a recorded 1.18.35 session. Every reply is read through a checked reader, so a shape that is not what was assumed
 * becomes an `unknown` the contract has a meaning for rather than a `TypeError` in a background loop.
 *
 * This file is the package's only entry and re-exports its public API, nothing else.
 */

export {
  bagOf,
  promptBody,
  readBoolean,
  readSessionId,
  stringAt,
  type PromptBody,
  type WireModel,
} from "./src/domain/api.js";

export { classify, readEvent, sessionOf, type OpencodeEvent, type Signal } from "./src/domain/events.js";

export {
  describeOutcome,
  excerpt,
  refutes,
  EXCERPT_LIMIT,
  type HttpOutcome,
  type ReadOutcome,
  type StreamOutcome,
} from "./src/domain/outcome.js";

export { basename, leaks, pathIsCredentialFile, scrub, CREDENTIAL_FILES } from "./src/domain/secrets.js";

export type { OpencodeServer } from "./src/ports/server.js";

export type { OpencodeSessionReader, ReadBounds, SessionEvents } from "./src/ports/session-reader.js";

export { baseUrlProblems, createSdkServer, type SdkServerOptions } from "./src/adapters/sdk-server.js";

export { createSdkSessionReader } from "./src/adapters/sdk-session-reader.js";

export { translateModel, untranslated, type Translation } from "./src/application/model.js";

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
} from "./src/application/run.js";

export {
  CAPABILITIES,
  DEFAULT_ID,
  DEFAULT_READY_MS,
  type OpencodeProviderOptions,
} from "./src/application/options.js";

export { OpencodeProvider, createProvider } from "./src/application/provider.js";
