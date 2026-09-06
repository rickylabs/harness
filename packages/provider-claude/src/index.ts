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
 * - **The SDK is injected, not depended on** — `sdk.ts`. Its `linux-x64` platform binary unpacks to
 *   ~216 MB and it declares three peers; none of that belongs in every CI job to obtain types for a
 *   module the suite never runs against the real thing.
 * - **Streaming input, not a string prompt** — `inbox.ts`. `Query.interrupt()` exists only in that
 *   mode, so `steer: true` and `stop: true` are downstream of one choice.
 * - **A run ends at its first `result`** — `run.ts`. In streaming-input mode that is a turn boundary,
 *   and the contract has no `idle`; reporting `running` strands a supervisor, reporting `finished`
 *   while the CLI still holds the worktree is the failure the lease exists to prevent.
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
} from "./env.js";

export { Inbox } from "./inbox.js";

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
} from "./run.js";

export {
  isTurn,
  readInit,
  readResult,
  userMessage,
  type AgentQuery,
  type InitLine,
  type QueryFn,
  type QueryOptions,
  type ResultLine,
  type SdkUserMessage,
} from "./sdk.js";

export {
  ClaudeProvider,
  createProvider,
  timeoutMs,
  untranslated,
  CAPABILITIES,
  DEFAULT_ID,
  DEFAULT_READY_MS,
  TIMER_CEILING_MS,
  type ClaudeProviderOptions,
} from "./provider.js";

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/provider-claude" as const;

export type PackageName = typeof PACKAGE_NAME;
