import type { CodexJsonRpcRequest } from "../domain/protocol.js";

/**
 * Transport-only port. It neither owns request ids nor certifies correlation.
 * Implementations return the raw response without filtering or echoing request values.
 */
export interface CodexProtocolPort {
  request(request: CodexJsonRpcRequest): Promise<unknown>;
}
