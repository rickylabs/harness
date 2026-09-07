/**
 * What the provider knows about a run, and the fold that keeps it true.
 *
 * Pure functions over a value, for the reason `provider-claude`'s `run.ts` gives: a background task
 * folding events into shared mutable state, in a process also serving `observe` and `stop`, is a
 * race worth designing out rather than reasoning about. The store is a `Map` of these and the only
 * mutation in the package is replacing an entry.
 *
 * ## `queued` finally means something
 *
 * The contract splits alive into `queued` and `running` because "queued for forty minutes" is a
 * governance problem and "executing for forty minutes" is not. `provider-claude` can barely use the
 * distinction — it holds the process, so the first message it sees is the run working. Here the two
 * are genuinely different states: `POST /session/:id/prompt_async` returns `204` the moment the
 * server has *accepted* the prompt, and the first bus event says it has started acting on it. A run
 * that sits in `queued` is a run the server took and has not begun, which is exactly the condition
 * the split was invented to make visible.
 *
 * ## `unknown` is a state a run can come back from
 *
 * The other consequence of the handle existing before the agent does. When a prompt's reply is lost
 * the run is genuinely `unknown` — the server may be working, or may never have received it — but
 * the session id is already ours, so events for it still arrive, and the first one upgrades the
 * record to `running` on its own. `unknown` here is a gap in knowledge that closes by itself, not a
 * dead end, and `isOver` deliberately does not include it.
 */

import type { RunLiveness } from "@rickylabs/subagents";

import type { Signal } from "./events.js";

/** Everything the provider knows about one run. */
export interface RunRecord {
  readonly runId: string;
  /** The opencode session id. Minted by `POST /session`, before the agent exists. */
  readonly external: string | null;
  readonly liveness: RunLiveness;
  /** One line about the most recent thing that happened. Never carries prompt or agent text. */
  readonly detail: string;
  /** The model id the matrix pinned, as it went into the prompt body. */
  readonly askedModel: string;
  /** The router it went through, which is the prompt body's `providerID`. */
  readonly router: string;
  /** Bus events seen for this session. A heartbeat, not a transcript. */
  readonly events: number;
  /** ISO time the run was created. */
  readonly startedAt: string;
  /** ISO time of the last state change. */
  readonly updatedAt: string;
  /** ISO time of the last bus event, or `null` if none has arrived. */
  readonly lastEventAt: string | null;
  /** Set by `stop`, so an event that follows reads as deliberate rather than as a failure. */
  readonly stopping: boolean;
  readonly stopReason: string | null;
  /** Paths worth handing to whoever collects evidence. See `secrets.ts` for what may not go in. */
  readonly artifacts: readonly string[];
}

/** RunLiveness values from which nothing further can happen. `unknown` is not one of them. */
const TERMINAL: readonly RunLiveness[] = ["finished", "failed"];

export function isOver(record: RunRecord): boolean {
  return TERMINAL.includes(record.liveness);
}

export interface NewRun {
  readonly runId: string;
  readonly external: string | null;
  readonly askedModel: string;
  readonly router: string;
  readonly at: string;
  readonly artifacts: readonly string[];
}

/** A run whose session exists and whose agent has not been asked for anything yet. */
export function newRun(options: NewRun): RunRecord {
  return {
    runId: options.runId,
    external: options.external,
    liveness: "queued",
    detail: "session created; the prompt has not been accepted yet",
    askedModel: options.askedModel,
    router: options.router,
    events: 0,
    startedAt: options.at,
    updatedAt: options.at,
    lastEventAt: null,
    stopping: false,
    stopReason: null,
    artifacts: options.artifacts,
  };
}

/**
 * A run id that is spoken for, before there is anything to speak for it.
 *
 * `dispatch` awaits twice — the bus, then `POST /session` — before it has a session id to store, and
 * a store that only gains its entry at the end of that is a store two concurrent dispatches can both
 * pass the duplicate check on. So the id is claimed first and the session id filled in after, which
 * makes the reservation itself the thing a second caller collides with.
 *
 * `external` is `null` and the liveness is `queued`, both truthfully: the id is taken, and nothing
 * has been asked of anyone yet.
 */
export function reservedRun(options: Omit<NewRun, "external">): RunRecord {
  return {
    ...newRun({ ...options, external: null }),
    detail: "the run id is claimed; the session is being created",
  };
}

/**
 * Whether the bus has said anything about this run.
 *
 * The provider learns a run's state two ways, and only one of them is reliable. A reply to an HTTP
 * request describes what the server had decided by the time it wrote the reply; a bus event
 * describes what the session actually did. When the two disagree the bus is right, because it is
 * later and because it is the session speaking rather than a request handler.
 *
 * So this guards the two writes that happen *after* an await on a prompt reply. Without it, a `204`
 * that spent six seconds in transit lands on a record the bus has already carried to `finished` and
 * resets it to `queued` — an ended run reported as one that has not started.
 */
export function busSpoke(record: RunRecord): boolean {
  return record.lastEventAt !== null;
}

function advance(record: RunRecord, at: string, patch: Partial<RunRecord>): RunRecord {
  return { ...record, ...patch, updatedAt: at };
}

/**
 * The session exists. The reservation becomes a run with a handle on it.
 *
 * Still `queued`, and for the same reason `newRun` starts there: a session is a place for an agent,
 * not an agent. What changes is that there is now something to observe, steer and stop.
 */
export function markSessionCreated(record: RunRecord, external: string, at: string): RunRecord {
  return advance(record, at, {
    external,
    detail: "session created; the prompt has not been accepted yet",
  });
}

/** The server has the prompt. Still `queued`: accepted is not started. */
export function markQueued(record: RunRecord, at: string): RunRecord {
  return advance(record, at, {
    liveness: "queued",
    detail: "the server accepted the prompt; waiting for the session to begin work",
  });
}

/**
 * The prompt's reply never arrived.
 *
 * Not a failure and not a success. The session id is already ours, so the run stays observable and
 * the next bus event for it resolves this by itself — which is why `unknown` is a liveness here and
 * not an error.
 */
export function markUnknown(record: RunRecord, detail: string, at: string): RunRecord {
  return advance(record, at, { liveness: "unknown", detail });
}

/** Record that a stop was asked for, so what happens next reads as deliberate. */
export function markStopping(record: RunRecord, reason: string, at: string): RunRecord {
  return advance(record, at, { stopping: true, stopReason: reason });
}

/** The server confirmed the abort. */
export function markStopped(record: RunRecord, reason: string, at: string): RunRecord {
  return markFinished(record, `stopped: ${reason}`, at);
}

/**
 * The run is over, for a reason the caller words itself.
 *
 * Separate from `markStopped` because not every ending is a stop. The server answering "there was
 * nothing to abort" ends the run just as definitely, and recording it as `stopped:` would put a
 * sentence in telemetry that says we ended something we did not.
 */
export function markFinished(record: RunRecord, detail: string, at: string): RunRecord {
  return advance(record, at, { liveness: "finished", detail });
}

/**
 * Fold one bus event into the record.
 *
 * Events after the run is over are ignored rather than reopening it: a session that has gone idle
 * has finished, and a late `message.updated` behind that describes work already accounted for.
 */
export function applySignal(record: RunRecord, signal: Signal, at: string): RunRecord {
  if (isOver(record)) return record;
  switch (signal.kind) {
    case "activity": {
      const events = record.events + 1;
      return advance(record, at, {
        liveness: "running",
        events,
        lastEventAt: at,
        detail: `working (${events} events)`,
      });
    }
    case "idle":
      return advance(record, at, {
        liveness: "finished",
        lastEventAt: at,
        detail: record.stopping
          ? `stopped: ${record.stopReason ?? "no reason given"}`
          : "the session went idle, so the run is over",
      });
    case "error":
      return advance(record, at, {
        liveness: "failed",
        lastEventAt: at,
        detail: `the session reported an error: ${signal.detail}`,
      });
    case "gone":
      // A session that disappears under a live run is only a failure if nobody asked for it. When a
      // stop is in flight, the session going away *is* the stop working.
      return advance(record, at, {
        liveness: record.stopping ? "finished" : "failed",
        lastEventAt: at,
        detail: record.stopping
          ? `stopped: ${record.stopReason ?? "no reason given"}`
          : "the session was deleted while the run was live, so its outcome is not known",
      });
    case "connected":
    case "ignored":
      return record;
  }
}

/** The line `observe` reports when the event stream is connected and the record is current. */
export function describe(record: RunRecord): string {
  return record.detail;
}

/**
 * What `observe` may honestly say when the record is not backed by a live view of the session.
 *
 * The failure this exists to prevent has already been paid for once in this repository: a stale
 * snapshot rendered as confident, current-looking output with no freshness stamp. Everything this
 * provider knows about a live run arrives on the bus. Without a bus carrying this run's events, the
 * record is a photograph — it was true, and nothing says it still is.
 *
 * There are two ways to be in that position and they are equally disqualifying. The bus can be
 * *down*, which is obvious. The bus can also be *up but new*: a reconnect gives back a socket, not
 * the events that went missing while there was none, and the run may have finished inside the gap.
 * `reason` is the whole head clause rather than a parenthetical so each caller can say which of the
 * two it is in its own words.
 *
 * A terminal record is exempt, and that is not an inconsistency: `finished` and `failed` are facts
 * about something that already happened and they do not expire. Only a claim about the present is
 * downgraded, and the detail says when the photograph was taken.
 */
export function unverified(
  record: RunRecord,
  reason: string,
): { readonly liveness: RunLiveness; readonly detail: string } {
  if (isOver(record)) return { liveness: record.liveness, detail: record.detail };
  const seen = record.lastEventAt ?? record.startedAt;
  return {
    liveness: "unknown",
    detail:
      `${reason}, so this run's state cannot be confirmed; ` +
      `as of ${seen} it was ${record.liveness}: ${record.detail}`,
  };
}
