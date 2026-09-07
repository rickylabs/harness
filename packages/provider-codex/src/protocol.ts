import { randomUUID } from "node:crypto";

import {
  compareRouteIdentity,
  describeRouteEvidence,
  isRouteVerified,
  type DispatchResult,
  type RouteIdentityEvidence,
  type RouteIdentityInput,
  type RunRef,
} from "@rickylabs/subagents";

export interface CodexJsonRpcRequest {
  readonly id: string;
  readonly method: "thread/start" | "turn/start";
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Transport-only port. It neither owns request ids nor certifies correlation.
 * Implementations return the raw response without filtering or echoing request values.
 */
export interface CodexProtocolPort {
  request(request: CodexJsonRpcRequest): Promise<unknown>;
}

export interface CodexStartRequest {
  readonly runId: string;
  /** `RunRef.provider`: registration identity, distinct from the server model-provider id. */
  readonly registrationId: string;
  /** Exact server-vocabulary value sent as `thread/start.params.modelProvider`. */
  readonly modelProvider: string;
  readonly model: string;
  readonly effort: string;
  /** Canonical absolute cwd supplied by composition. This module performs no filesystem I/O. */
  readonly cwd: string;
  readonly input: string;
}

export type CodexStartResult = DispatchResult & {
  /** Present only after a correlated, structurally valid turn/start acknowledgement. */
  readonly turnId: string | null;
};

interface FrozenStartRequest {
  readonly runId: string;
  readonly registrationId: string;
  readonly route: Readonly<{
    provider: string;
    model: string;
    effort: string;
    cwd: string;
  }>;
  readonly input: string;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

interface ParsedThreadStart {
  readonly correlated: boolean;
  readonly errored: boolean;
  readonly threadId: string | null;
  readonly observed: RouteIdentityInput;
}

const UNOBSERVED_ROUTE: RouteIdentityInput = {
  provider: undefined,
  model: undefined,
  effort: undefined,
  cwd: undefined,
};

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function nonblank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function freezeRequest(request: CodexStartRequest): FrozenStartRequest {
  // Read every caller-owned value before the first await. Strings are immutable; this new object
  // prevents later property mutation from rewriting what the helper says it requested.
  return Object.freeze({
    runId: request.runId,
    registrationId: request.registrationId,
    route: Object.freeze({
      provider: request.modelProvider,
      model: request.model,
      effort: request.effort,
      cwd: request.cwd,
    }),
    input: request.input,
  });
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

function parseThreadStart(raw: unknown, expectedId: string): ParsedThreadStart {
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

function parseTurnId(raw: unknown, expectedId: string): string | null {
  const response = object(raw);
  if (response === null || response.id !== expectedId || "error" in response) return null;
  const result = object(response.result);
  const turn = object(result?.turn);
  return nonblank(turn?.id);
}

function ref(request: FrozenStartRequest, threadId: string): RunRef {
  return {
    runId: request.runId,
    provider: request.registrationId,
    external: threadId,
  };
}

function unknown(
  detail: string,
  route: RouteIdentityEvidence,
  run: RunRef | null = null,
): CodexStartResult {
  return { verdict: "unknown", run, detail, route, turnId: null };
}

function unattributedRoute(evidence: RouteIdentityEvidence, problem: string): RouteIdentityEvidence {
  const route = { ...evidence, status: "unknown" as const };
  return { ...route, detail: `${problem}; ${describeRouteEvidence(route)}` };
}

/**
 * Start one useful turn only after the raw thread/start response proves the exact applied route.
 *
 * The port is assumed to represent an initialized connection; #53 owns attachment and handshake.
 * This function performs no process, socket, filesystem, environment or authentication operation.
 */
export async function startVerifiedCodexTurn(
  port: CodexProtocolPort,
  request: CodexStartRequest,
): Promise<CodexStartResult> {
  const frozen = freezeRequest(request);
  const initialEvidence = compareRouteIdentity(frozen.route, UNOBSERVED_ROUTE);
  if (
    initialEvidence.invalid.some(({ side }) => side === "requested") ||
    nonblank(frozen.runId) === null ||
    nonblank(frozen.registrationId) === null ||
    nonblank(frozen.input) === null
  ) {
    return unknown(`dispatch request is invalid; ${initialEvidence.detail}`, initialEvidence);
  }

  const threadRequestId = randomUUID();
  let rawThread: unknown;
  try {
    rawThread = await port.request(threadStartRequest(threadRequestId, frozen.route));
  } catch {
    return unknown(
      `thread/start response is unavailable; ${initialEvidence.detail}`,
      initialEvidence,
    );
  }

  let parsed: ParsedThreadStart;
  let evidence: RouteIdentityEvidence;
  try {
    parsed = parseThreadStart(rawThread, threadRequestId);
    evidence = compareRouteIdentity(frozen.route, parsed.observed);
  } catch {
    return unknown("thread/start response could not be read; no useful turn is permitted", initialEvidence);
  }
  if (!parsed.correlated) {
    return unknown(`thread/start response id is absent or different; ${evidence.detail}`, evidence);
  }
  if (parsed.errored) {
    return unknown(`thread/start returned an error response; ${evidence.detail}`, evidence);
  }
  if (parsed.threadId === null) {
    const route = unattributedRoute(evidence, "thread/start response has no usable thread id");
    return unknown(route.detail, route);
  }

  const run = ref(frozen, parsed.threadId);
  if (evidence.status === "unknown") {
    return unknown(evidence.detail, evidence, run);
  }
  if (evidence.status === "mismatch") {
    return {
      verdict: "refused",
      // The thread is identified but has received no useful turn. Retaining the handle lets #53
      // reconcile or clean up that empty thread without adding cleanup behavior to this slice.
      run,
      detail: `${evidence.detail}; nothing useful was sent`,
      route: evidence,
      turnId: null,
    };
  }

  const turnRequestId = randomUUID();
  let rawTurn: unknown;
  try {
    rawTurn = await port.request(turnStartRequest(turnRequestId, parsed.threadId, frozen.input));
  } catch {
    return unknown("turn/start outcome is unknown after useful input was sent", evidence, run);
  }
  let turnId: string | null;
  try {
    turnId = parseTurnId(rawTurn, turnRequestId);
  } catch {
    return unknown("turn/start response could not be read after useful input was sent", evidence, run);
  }
  if (turnId === null) {
    return unknown("turn/start acknowledgement is absent or malformed after useful input was sent", evidence, run);
  }

  const accepted: CodexStartResult = {
    verdict: "accepted",
    run,
    turnId,
    route: evidence,
    detail: `turn ${turnId} accepted on verified thread ${parsed.threadId}; ${evidence.detail}`,
  };
  // This should be unreachable, but keeps the public return boundary fail closed if evidence shape
  // is changed independently later.
  return isRouteVerified(accepted)
    ? accepted
    : unknown("route evidence became unverifiable before the accepted result was returned", evidence, run);
}
