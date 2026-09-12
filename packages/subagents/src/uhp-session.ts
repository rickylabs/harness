/**
 * Multi-turn continuation over UHP: chaining on `previous_response_id`, keyed on our `runId`.
 *
 * Spike S11, issue #289. Run artifacts: `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * ## What the protocol gives us
 *
 * Sessions §1, retrieved 2026-09-12 against UHP `2026-08-11`
 * (https://unifiedharnessprotocol.org/spec/2026-08-11/sessions): a client continues a chain by sending
 * `previous_response_id`, and the server MUST then run the new task "in the same session, with the same
 * working directory and its files", give the harness "the conversational context of the earlier tasks",
 * use the same configured harness, and **"report the same `metadata.session_id`"**.
 *
 * The chain is on response ids rather than session ids on purpose — "the response id is what the client
 * already has", and it "leaves room for a server to branch from an earlier response later". An unknown
 * id is `404 response_not_found`; a forgotten chain is `404 session_expired`.
 *
 * Lifecycle §4: the session id "MUST be reported in the response's `metadata.session_id`", and
 * conformance check T-04 fails a response without one because "the session cannot be continued or
 * inspected".
 *
 * ## What we key on, and why it is not the session id
 *
 * `runId` — ours, minted before anything launches. The same rule `lease.ts` was built on: the vendor's
 * identifier belongs to the vendor, and a coordinator that keys its own records on it inherits every
 * decision the vendor makes about identity. Under UHP there are two concrete reasons:
 *
 * - The specification leaves room for a server to **branch** from an earlier response. Two runs can
 *   then share one `session_id`, and a ledger keyed on the session id would have them overwrite each
 *   other — one run silently becoming the other.
 * - The session id does not exist until the first response comes back. `RunRef.external` is `null`
 *   until there is something real to put in it, which is exactly what `provider.ts` says that field is
 *   for. A record keyed on a value that does not exist yet cannot be written before the run starts, and
 *   then there is a window in which something is executing and nothing can name it.
 *
 * So: the ledger is `Record<runId, UhpSession>`, and the session id rides in `RunRef.external`, where
 * it is a correlator for humans and for the server, never an identity for us.
 *
 * ## Fail closed
 *
 * Every refusal below is a server statement that contradicts the protocol, or our own bookkeeping
 * contradicting itself. None of them is recoverable by guessing:
 *
 * - **`chain-broken`** — the request did not continue the turn we recorded. An out-of-order or replayed
 *   continuation would attach a turn to the wrong parent, and the transcript would then read as a
 *   conversation that never happened.
 * - **`session-changed`** — the server reported a different `session_id` for a continued chain, which
 *   Sessions §1 forbids. It means a different working directory, and the files the earlier turn wrote
 *   are not there. Continuing regardless is how an agent is asked to edit a file it cannot see.
 * - **`session-unreported`** — no `session_id` at all. T-04's failure message is the whole argument:
 *   the session cannot be continued or inspected.
 * - **`prior-turn-open`** — the previous turn has not reached a terminal status. Security §5 has the
 *   server refuse a second concurrent task in one session (`session_busy`), because "two agents in one
 *   working directory is not a defined state". Sending it anyway trades a local refusal for a remote
 *   one and a wasted dispatch.
 * - **`replayed-response`** — a response id already recorded and already settled at a terminal status.
 *   One turn observed twice while it runs — `in_progress`, then terminal — is a different thing and is
 *   accepted as an advance of that turn; a second copy of a finished turn would double-count the
 *   conversation.
 * - **`unidentified-response`** — no usable `id`, so the chain cannot be continued from it.
 * - **`run-mismatch`** — a turn offered for a different `runId`. Cheap to check, and the one mistake a
 *   ledger keyed on the right thing can still make.
 *
 * Nothing here has met a live HarnessRouter; see `verification.md` for the split between what the mock
 * proved and what only issue #294 can.
 */

import type { RunRef } from "./provider.js";
import {
  isUhpTerminalStatus,
  type UhpCreateRequest,
  type UhpLifecycleStatus,
  type UhpResponse,
} from "./uhp-wire.js";

/* -------------------------------------------------------------------------------------------------
 * Records
 * ---------------------------------------------------------------------------------------------- */

/** One completed exchange in a chain, as recorded from a response we actually read. */
export interface UhpTurn {
  /** `Response.id`. The value the next turn's `previous_response_id` must carry. */
  readonly responseId: string;
  /** What this turn continued, or `null` for the first turn of a chain. */
  readonly previousResponseId: string | null;
  readonly status: UhpLifecycleStatus;
  /** The model that actually ran, or `null` when the server did not report one. Never a default. */
  readonly model: string | null;
}

/**
 * A run's UHP session, keyed by the coordinator's `runId`.
 *
 * `sessionId` is `null` until a response reports one. It is never guessed and never derived from a
 * request: only a server can tell us which session it ran our task in.
 */
export interface UhpSession {
  readonly runId: string;
  /** The `SubagentProvider.id` that owns this run. Supplied by the provider, not minted here. */
  readonly provider: string;
  readonly sessionId: string | null;
  readonly turns: readonly UhpTurn[];
}

/** Runs keyed on `runId`. Never on `sessionId`: a server may branch two runs out of one session. */
export type UhpSessionLedger = Readonly<Record<string, UhpSession>>;

export const EMPTY_UHP_LEDGER: UhpSessionLedger = Object.freeze({});

export type UhpSessionRefusal =
  | "unidentified-response"
  | "chain-broken"
  | "session-unreported"
  | "session-changed"
  | "prior-turn-open"
  | "replayed-response"
  | "run-mismatch";

export type UhpTurnResult =
  | { readonly ok: true; readonly session: UhpSession; readonly turn: UhpTurn }
  | { readonly ok: false; readonly refusal: UhpSessionRefusal; readonly detail: string };

export type UhpRequestResult =
  | { readonly ok: true; readonly request: UhpCreateRequest }
  | { readonly ok: false; readonly refusal: UhpSessionRefusal; readonly detail: string };

function nonblank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function refuse(refusal: UhpSessionRefusal, detail: string): { ok: false; refusal: UhpSessionRefusal; detail: string } {
  return { ok: false, refusal, detail };
}

/* -------------------------------------------------------------------------------------------------
 * Opening, naming, continuing
 * ---------------------------------------------------------------------------------------------- */

/** Open a session record before anything launches. No session id yet, because none exists yet. */
export function openUhpSession(runId: string, provider: string): UhpSession {
  return { runId, provider, sessionId: null, turns: [] };
}

/**
 * The run as both sides can name it.
 *
 * `external` is the UHP `session_id` — the provider's own handle, which is what `RunRef.external` is
 * defined to hold — and `null` while the server has not reported one.
 */
export function uhpRunRef(session: UhpSession): RunRef {
  return { runId: session.runId, provider: session.provider, external: session.sessionId };
}

/** The most recent recorded turn, or `null` for a chain that has not started. */
export function lastUhpTurn(session: UhpSession): UhpTurn | null {
  return session.turns.length === 0 ? null : (session.turns[session.turns.length - 1] ?? null);
}

/**
 * Build the request that continues this session.
 *
 * The continuation key comes from the ledger, never from a caller: a caller that has to supply
 * `previous_response_id` is a caller that can supply the wrong one, and the wrong one attaches a turn
 * to a conversation that did not happen. The first turn omits the field entirely rather than sending
 * `null`, because `null` is not one of the values Tasks §1.1 defines for it.
 */
export function nextUhpRequest(
  session: UhpSession,
  input: string,
  model?: string,
  stream = true,
): UhpRequestResult {
  // Assembled rather than spread so an absent model stays absent. Under `exactOptionalPropertyTypes`,
  // `model: undefined` and no `model` key are different requests, and the second is the one that means
  // "the server's configured default", which is what an unspecified model asks for.
  const base: UhpCreateRequest = model === undefined ? { input, stream } : { input, model, stream };
  const last = lastUhpTurn(session);
  if (last === null) return { ok: true, request: base };
  if (!isUhpTerminalStatus(last.status)) {
    return refuse(
      "prior-turn-open",
      `turn ${session.turns.length} on run ${session.runId} is still ${last.status}; a second concurrent task in one session is refused as session_busy, so it is not sent`,
    );
  }
  return { ok: true, request: { ...base, previous_response_id: last.responseId } };
}

/**
 * Record a turn, or refuse it.
 *
 * The request is an argument because the chain is a claim about *both* sides: the server's response id
 * is meaningless as a continuation unless the request that produced it continued the turn we think it
 * did. Checking only the response would let a response from an unrelated chain be appended as if it
 * belonged here.
 */
export function recordUhpTurn(
  session: UhpSession,
  request: UhpCreateRequest,
  response: UhpResponse,
): UhpTurnResult {
  const responseId = nonblank(response.id);
  if (responseId === null) {
    return refuse(
      "unidentified-response",
      `run ${session.runId} received a response with no usable id, so the chain cannot be continued from it`,
    );
  }

  const last = lastUhpTurn(session);
  const continued = nonblank(request.previous_response_id);

  // Two legitimate shapes, and they are not the same fact. `advance` is one turn being observed twice —
  // `in_progress` first, terminal later — which is what polling a live run looks like. `append` is a new
  // turn continuing the chain. Anything else is a refusal, and in particular re-recording a turn that
  // already reached a terminal status is a replay whichever shape it arrives in.
  const advancing = last !== null && responseId === last.responseId;
  if (advancing && isUhpTerminalStatus(last.status)) {
    return refuse(
      "replayed-response",
      `run ${session.runId} has already settled response ${responseId} as ${last.status}; a replay is not a new turn`,
    );
  }
  if (!advancing && session.turns.some((turn) => turn.responseId === responseId)) {
    return refuse(
      "replayed-response",
      `run ${session.runId} has already recorded response ${responseId}; a replay is not a new turn`,
    );
  }

  const expected = advancing ? last.previousResponseId : last === null ? null : last.responseId;
  if (continued !== expected) {
    return refuse(
      "chain-broken",
      `run ${session.runId} expected the request to continue ${expected ?? "no prior turn"} but it continued ${continued ?? "no prior turn"}`,
    );
  }
  if (!advancing && last !== null && !isUhpTerminalStatus(last.status)) {
    return refuse(
      "prior-turn-open",
      `run ${session.runId} has a prior turn still in ${last.status}; a chain may not fork off an unfinished turn`,
    );
  }

  const reported = nonblank(response.metadata?.session_id);
  if (reported === null) {
    return refuse(
      "session-unreported",
      `run ${session.runId} received a response with no metadata.session_id, so the session cannot be continued or inspected`,
    );
  }
  if (session.sessionId !== null && session.sessionId !== reported) {
    return refuse(
      "session-changed",
      `run ${session.runId} was in session ${session.sessionId} and the server reported ${reported}; a continued chain must report the same session, and a different one is a different working directory`,
    );
  }

  const turn: UhpTurn = {
    responseId,
    previousResponseId: continued,
    status: response.status,
    model: nonblank(response.model),
  };
  const turns = advancing ? [...session.turns.slice(0, -1), turn] : [...session.turns, turn];
  return { ok: true, turn, session: { ...session, sessionId: reported, turns } };
}

/* -------------------------------------------------------------------------------------------------
 * The ledger
 * ---------------------------------------------------------------------------------------------- */

/** Store a session under its `runId`, returning a new ledger. */
export function withUhpSession(ledger: UhpSessionLedger, session: UhpSession): UhpSessionLedger {
  return Object.freeze({ ...ledger, [session.runId]: session });
}

/** Look a run up by the only key this repository owns. */
export function uhpSessionOf(ledger: UhpSessionLedger, runId: string): UhpSession | undefined {
  return Object.hasOwn(ledger, runId) ? ledger[runId] : undefined;
}

/**
 * Every run the ledger knows to be in a given UHP session.
 *
 * Plural, and that is the point: a server may branch a second chain from an earlier response, so one
 * session id can legitimately cover more than one run. A lookup that returned a single run would have
 * to pick one, and picking one is how a branch erases its sibling.
 */
export function uhpRunsInSession(ledger: UhpSessionLedger, sessionId: string): readonly UhpSession[] {
  return Object.values(ledger).filter((session) => session.sessionId === sessionId);
}

/**
 * Record a turn straight into the ledger, refusing a turn offered for the wrong run.
 *
 * The `runId` argument is redundant with `session.runId` on purpose: this is the call a provider makes
 * from inside a dispatch loop, where the run id in hand and the session in hand come from different
 * places and are occasionally not the same run.
 */
export function recordUhpTurnInLedger(
  ledger: UhpSessionLedger,
  runId: string,
  request: UhpCreateRequest,
  response: UhpResponse,
): { readonly ok: true; readonly ledger: UhpSessionLedger; readonly session: UhpSession; readonly turn: UhpTurn }
  | { readonly ok: false; readonly refusal: UhpSessionRefusal; readonly detail: string } {
  const session = uhpSessionOf(ledger, runId);
  if (session === undefined) {
    return refuse("run-mismatch", `the ledger holds no run ${runId}, and a turn is not a reason to invent one`);
  }
  if (session.runId !== runId) {
    return refuse("run-mismatch", `the ledger entry under ${runId} names run ${session.runId}`);
  }
  const recorded = recordUhpTurn(session, request, response);
  if (!recorded.ok) return recorded;
  return { ok: true, ledger: withUhpSession(ledger, recorded.session), session: recorded.session, turn: recorded.turn };
}
