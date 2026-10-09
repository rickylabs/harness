/**
 * `@rickylabs/provider-claude` — a `SubagentProvider` over the Claude Agent SDK's `query()`.
 *
 * The first of E3's four providers (#52). It launches the `claude` harness in this process rather
 * than through a terminal multiplexer, which is what lets it observe a run without going to look,
 * steer one while it is working, and stop one by ending the stream it is holding.
 *
 * Three things about this package are decisions rather than details, and each is argued where it
 * lives:
 *
 * - **The SDK is injected, not depended on** — `src/ports/sdk.ts`. Its `linux-x64` platform binary
 *   unpacks to ~216 MB and it declares three peers; none of that belongs in every CI job to obtain
 *   types for a module the suite never runs against the real thing.
 * - **Streaming input, not a string prompt** — `src/domain/inbox.ts`. `Query.interrupt()` exists
 *   only in that mode, so `steer: true` and `stop: true` are downstream of one choice.
 * - **A run ends at its first `result`** — `src/application/run.ts`. In streaming-input mode that is
 *   a turn boundary, and the contract has no `idle`; reporting `running` strands a supervisor,
 *   reporting `finished` while the CLI still holds the worktree is the failure the lease exists to
 *   prevent.
 *
 * This file is the package's only entry and re-exports its public API, nothing else.
 */

export {
  envProblems,
  fatalEnvProblems,
  homeOf,
  homeSurvived,
  isAbsolutePath,
  isolatedEnv,
  sameDir,
  CONFIG_DIR_VAR,
  HOME_VARS,
  type BaseEnv,
  type EnvProblem,
  type EnvRule,
} from "./src/domain/env.js";

export { Inbox } from "./src/domain/inbox.js";

export {
  isTurn,
  readInit,
  readResult,
  userMessage,
  type InitLine,
  type ResultLine,
  type SdkUserMessage,
} from "./src/domain/sdk-messages.js";

export type { AgentQuery, QueryFn, QueryOptions } from "./src/ports/sdk.js";

export {
  applyMessage,
  describe,
  endStream,
  isOver,
  markStopping,
  modelNote,
  newRun,
  type MessageReaders,
  type NewRun,
  type RunRecord,
} from "./src/application/run.js";

export {
  ClaudeProvider,
  createProvider,
  untranslated,
  CAPABILITIES,
  DEFAULT_ID,
  DEFAULT_READY_MS,
  type ClaudeProviderOptions,
} from "./src/application/provider.js";
