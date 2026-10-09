/**
 * `@rickylabs/provider-codex` — the Codex `app-server` JSON-RPC route-identity prerequisite for the
 * `ctx.subagents` seam.
 *
 * Owned by E3 · #33. The route-identity protocol prerequisite ships here, while attachment,
 * ownership, observation, steering and a composed `SubagentProvider` remain gated by #53.
 *
 * This file is the package's only entry and re-exports its public API, nothing else.
 */

export { threadStartRequest, turnStartRequest, type CodexJsonRpcRequest } from "./src/domain/protocol.js";
export type { CodexProtocolPort } from "./src/ports/protocol-port.js";
export {
  startVerifiedCodexTurn,
  type CodexStartRequest,
  type CodexStartResult,
} from "./src/application/start-turn.js";
