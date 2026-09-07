/**
 * @rickylabs/provider-codex — SubagentProvider over the codex app-server JSON-RPC protocol (ctx.subagents seam).
 *
 * Owned by E3 · #33. The route-identity protocol prerequisite ships here, while attachment,
 * ownership, observation, steering and a composed SubagentProvider remain gated by #53.
 */

/** Workspace package identifier. */
export const PACKAGE_NAME = "@rickylabs/provider-codex" as const;

export type PackageName = typeof PACKAGE_NAME;

export {
  startVerifiedCodexTurn,
  threadStartRequest,
  turnStartRequest,
} from "./protocol.js";
export type {
  CodexJsonRpcRequest,
  CodexProtocolPort,
  CodexStartRequest,
  CodexStartResult,
} from "./protocol.js";
