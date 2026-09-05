/**
 * The dispatch payload, re-exported from where it now lives.
 *
 * This module used to be the definition. It moved to `@rickylabs/subagents` in #51, because E7's
 * forge needs the same grammar to write a `/swarm` block and cannot reach it through the kanban
 * projection without inverting the dependency graph — a CLI scaffolder depending on the board to
 * learn what a dispatch looks like is backwards.
 *
 * The file stays as a re-export rather than being deleted so that `@rickylabs/board`'s public
 * surface is exactly what it was. There is still only one definition and one grammar; #36 is
 * explicit that there must be, and a second copy here would be the thing it forbids.
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
} from "@rickylabs/subagents";
export type {
  DispatchRequest,
  Harness,
  ParsedSwarm,
  Router,
  SwarmOverrides,
  SwarmWarning,
} from "@rickylabs/subagents";
