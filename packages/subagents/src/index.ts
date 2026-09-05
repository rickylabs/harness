/**
 * @rickylabs/subagents — the `ctx.subagents` seam.
 *
 * Owned by E3 · #33, defined by #51. Two things live here and they are one thing: the payload that
 * describes a run to be launched (`DispatchRequest`, and its `/swarm` wire format), and the
 * interface anything capable of launching one implements (`SubagentProvider`).
 *
 * ## Why this is its own package
 *
 * The dispatch payload was written for the board's projection of divybot's grammar, and it lived
 * in `@rickylabs/board`. It cannot stay there. E7's forge is the other consumer — it writes the
 * `/swarm` block into an issue body — and a package that generates CLI scaffolding has no business
 * depending on the kanban projection to find out what a dispatch looks like. Inverting that
 * dependency would make board a leaf that half the tree reaches through.
 *
 * It is also not in `@rickylabs/harness-contracts`. That package is E8's, published to npm for the two UIs,
 * and its own stub says not to add behaviour before that epic defines its contract. #79's scope
 * discipline settles it from the other side: a type that only makes sense for one surface does not
 * belong there, and the UIs never implement a provider — they read a board.
 *
 * So: a package both seams can depend on, which depends on neither. `@rickylabs/board` keeps its
 * public surface unchanged by re-exporting from here.
 *
 * ## The two halves
 *
 * `dispatch.ts` is a faithful port of Orchid's `parseOverrides`, pinned at commit
 * `d344bd037bcf10150fd12daef8ffa277576cd94a`, together with `go-grammar.ts` — Go's line splitting,
 * `unicode.IsSpace`, and RE2's `\s`, none of which agree with JavaScript's. That disagreement is
 * not pedantry: it is how a prompt line once parsed as a key and replaced the matrix-selected model
 * at launch.
 *
 * `provider.ts` is the interface, and the word it is built around is `unknown` — see its own
 * header. A provider that cannot reach its executor does not know whether the run is alive, and
 * reporting that as a failure is a specific, wrong claim with a destructive action attached.
 */

export {
  DEFAULT_HARNESS,
  DispatchEncodingError,
  HARNESSES,
  PROMPT_GUARD,
  ROUTERS,
  parseGoDuration,
  parseSwarm,
  renderSwarm,
  toDispatchRequest,
  validateDispatch,
} from "./dispatch.js";
export type {
  DispatchRequest,
  Harness,
  ParsedSwarm,
  Router,
  SwarmOverrides,
  SwarmWarning,
} from "./dispatch.js";

export {
  forbiddenCharactersIn,
  goIsFence,
  goKeyValue,
  goSplitLines,
  goTrimSpace,
} from "./go-grammar.js";
export type { GoKeyValue } from "./go-grammar.js";

export {
  CONTEXT_KEY,
  capabilityProblem,
  conformanceProblems,
  isSafeToRetry,
  registryProblems,
  retryGuidance,
  selectProvider,
} from "./provider.js";
export type {
  BlockRule,
  BlockedSelection,
  ConformanceProblem,
  ConformanceRule,
  DispatchResult,
  DispatchVerdict,
  Liveness,
  Observation,
  OptionalCall,
  ProviderCapabilities,
  Rejection,
  RejectionRule,
  RunRef,
  SelectedProvider,
  Selection,
  SelectionOptions,
  SteerResult,
  SteerVerdict,
  StopResult,
  StopVerdict,
  SubagentProvider,
  SubagentRegistry,
} from "./provider.js";

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/subagents" as const;

export type PackageName = typeof PACKAGE_NAME;
