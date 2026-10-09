/**
 * `startVerifiedCodexTurn`: start one useful Codex turn only after the server's own `thread/start`
 * reply proves the exact applied route (model provider, model, reasoning effort, cwd).
 *
 * The refusal ladder lives here. `unknown` is checked before `mismatch`: in the Codex dialect all four
 * route fields are observable, so both branches are reachable and that order is correct. A complete
 * mismatch is `refused` before useful work; anything after `turn/start` is `unknown`, so it never
 * licenses an automatic retry.
 */

import { randomUUID } from "node:crypto";

import {
  compareRouteIdentity,
  describeRouteEvidence,
  isRouteVerified,
  type DispatchResult,
  type RouteIdentityEvidence,
  type RunRef,
} from "@rickylabs/subagents";

import {
  nonblank,
  parseThreadStart,
  parseTurnId,
  threadStartRequest,
  turnStartRequest,
  UNOBSERVED_ROUTE,
  type ParsedThreadStart,
} from "../domain/protocol.js";
import type { CodexProtocolPort } from "../ports/protocol-port.js";

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
