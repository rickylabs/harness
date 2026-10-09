/**
 * The runs a provider is holding: by run id, by session id, and the deadline each one may carry.
 */

import { timeoutMs, type DispatchRequest, type RunRef } from "@rickylabs/subagents";

import { isOver, type RunRecord } from "./run.js";

/** Everything held for one run: the record, and the timer that may end it. */
export interface Live {
  record: RunRecord;
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * Which bus connection this record was last confirmed against.
   *
   * Behind the bus's generation means a connection was lost and replaced since anything was heard
   * about this run, so the record predates a gap of unknown length and nothing has spoken for it.
   */
  generation: number;
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const maybe = timer as { unref?: () => void };
  if (typeof maybe.unref === "function") maybe.unref();
}

export class RunTable {
  readonly #runs = new Map<string, Live>();
  /** Session id to run id. The bus is server-wide, so every event has to be routed. */
  readonly #bySession = new Map<string, string>();

  has(runId: string): boolean {
    return this.#runs.has(runId);
  }

  /**
   * Claim a run id, synchronously.
   *
   * The caller asks `has` and then claims before its first `await`, so two dispatches for the same id
   * that both reached the question before either had a session to store cannot both be told no.
   */
  claim(runId: string, live: Live): void {
    this.#runs.set(runId, live);
  }

  bindSession(sessionId: string, runId: string): void {
    this.#bySession.set(sessionId, runId);
  }

  /** The run an event for `sessionId` is about, or `null` when this provider is not holding one. */
  forSession(sessionId: string): Live | null {
    const runId = this.#bySession.get(sessionId);
    if (runId === undefined) return null;
    return this.#runs.get(runId) ?? null;
  }

  /**
   * The run this ref names, or nothing.
   *
   * A `RunRef` carries two identifiers and both have to agree. The run id finds the record; the
   * external id, when the caller supplies one, has to be the session this provider is actually
   * holding under it. A ref built from an older dispatch of the same id — the shape a refused
   * dispatch and its licensed retry produce — would otherwise steer or stop a session it does not
   * name, which is the failure the `external` field exists to make impossible.
   */
  known(run: RunRef, providerId: string): Live | null {
    if (run.provider !== providerId) return null;
    const live = this.#runs.get(run.runId);
    if (live === undefined) return null;
    if (run.external !== null && live.record.external !== null && run.external !== live.record.external) {
      return null;
    }
    return live;
  }

  /**
   * Drop a run this provider is no longer holding, so its id and session are reusable.
   *
   * `sessionId` is `null` on the paths that release a reservation made before any session existed.
   * Those must release the id too: it was claimed to close a race, and a claim that outlives the
   * refusal it was taken for would turn every refused dispatch into a permanently burnt run id.
   */
  forget(runId: string, sessionId: string | null): void {
    const live = this.#runs.get(runId);
    if (live !== undefined) this.clearTimer(live);
    this.#runs.delete(runId);
    if (sessionId !== null) this.#bySession.delete(sessionId);
  }

  /**
   * Honour the request's deadline.
   *
   * Same argument as `provider-claude`'s: a dispatch that names a deadline and then runs past it
   * forever is a lease nobody reclaims. The difference is what expiry does — there it aborts a child
   * this process owns, here it sends an abort to a server that may ignore it, and `stop` reports
   * which of those happened. The timer is unref'd so it never keeps a process alive on its own.
   */
  armTimeout(live: Live, request: DispatchRequest, expire: (reason: string) => void): void {
    const ms = timeoutMs(request);
    if (ms === null) return;
    const timeout = request.timeout;
    const timer = setTimeout(() => {
      if (isOver(live.record)) return;
      expire(`timeout after ${timeout}`);
    }, ms);
    unref(timer);
    live.timer = timer;
  }

  clearTimer(live: Live): void {
    if (live.timer === null) return;
    clearTimeout(live.timer);
    live.timer = null;
  }

  /** Every run held, live and finished. */
  all(): readonly Live[] {
    return [...this.#runs.values()];
  }
}
