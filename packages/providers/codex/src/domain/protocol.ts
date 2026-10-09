/**
 * The Codex `app-server` JSON-RPC wire this package speaks: the two request shapes and the two
 * response readers.
 *
 * Pure. Every reply is read through a checked reader rather than by property access, so a missing,
 * malformed or uncorrelated reply becomes `null` or an unobserved route instead of a `TypeError`.
 * The readers select the four route fields only; they never copy a raw response or an error payload.
 */

import type { RouteIdentityInput } from "@rickylabs/harness-contracts/route";

export interface CodexJsonRpcRequest {
  readonly id: string;
  readonly method: "thread/start" | "turn/start";
  readonly params: Readonly<Record<string, unknown>>;
}

export interface JsonObject {
  readonly [key: string]: unknown;
}

export interface ParsedThreadStart {
  readonly correlated: boolean;
  readonly errored: boolean;
  readonly threadId: string | null;
  readonly observed: RouteIdentityInput;
}

export const UNOBSERVED_ROUTE: RouteIdentityInput = {
  provider: undefined,
  model: undefined,
  effort: undefined,
  cwd: undefined,
};

export function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

export function nonblank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function threadStartRequest(
  id: string,
  route: Readonly<{ provider: string; model: string; effort: string; cwd: string }>,
): CodexJsonRpcRequest {
  return {
    id,
    method: "thread/start",
    params: {
      modelProvider: route.provider,
      model: route.model,
      cwd: route.cwd,
      config: { model_reasoning_effort: route.effort },
    },
  };
}

export function turnStartRequest(id: string, threadId: string, input: string): CodexJsonRpcRequest {
  return {
    id,
    method: "turn/start",
    params: {
      threadId,
      input: [{ type: "text", text: input, textElements: [] }],
    },
  };
}

export function parseThreadStart(raw: unknown, expectedId: string): ParsedThreadStart {
  const response = object(raw);
  if (response === null || response.id !== expectedId) {
    return { correlated: false, errored: false, threadId: null, observed: UNOBSERVED_ROUTE };
  }
  if ("error" in response) {
    return { correlated: true, errored: true, threadId: null, observed: UNOBSERVED_ROUTE };
  }
  const result = object(response.result);
  if (result === null) {
    return { correlated: true, errored: false, threadId: null, observed: UNOBSERVED_ROUTE };
  }
  const thread = object(result.thread);
  return {
    correlated: true,
    errored: false,
    threadId: nonblank(thread?.id),
    observed: {
      provider: result.modelProvider,
      model: result.model,
      effort: result.reasoningEffort,
      cwd: result.cwd,
    },
  };
}

export function parseTurnId(raw: unknown, expectedId: string): string | null {
  const response = object(raw);
  if (response === null || response.id !== expectedId || "error" in response) return null;
  const result = object(response.result);
  const turn = object(result?.turn);
  return nonblank(turn?.id);
}
