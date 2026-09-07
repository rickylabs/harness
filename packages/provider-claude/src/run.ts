/**
 * What the provider knows about a run, and the fold that keeps it true.
 *
 * `observe` on this provider does not go and ask anything. The SDK's message stream is already open
 * — the provider is holding it — so the record is updated as messages arrive and `observe` is a read
 * of memory. That is worth being explicit about, because it inverts the usual cost: observation is
 * free and instantaneous here, where a PTY-scraping provider has to go look. It is also why the
 * decorator in `dsh-app` that writes an event only when liveness *changes* is the right decorator
 * for this provider rather than a lossy one.
 *
 * ## The record is a value
 *
 * Every transition is a pure function from a record and a message to a new record. The store in
 * `provider.ts` is a `Map` of them and the only mutation in the package is replacing an entry. A
 * background loop folding messages into shared mutable state, in a process also serving `observe`
 * and `stop` calls, is a race worth designing out rather than reasoning about.
 *
 * ## Where a turn ends and a run ends
 *
 * In streaming-input mode `result` is a *turn* boundary, not necessarily the end of the session: the
 * CLI emits it and then waits for more input. This provider treats the first `result` as the end of
 * the run and closes the inbox, and that is a decision rather than a reading of the protocol.
 *
 * The alternative — keep the session open and report it as still running — puts the contract in an
 * impossible position. `RunLiveness` has no `idle`. Reporting `running` makes a supervisor wait forever
 * on an agent that is waiting on it; reporting `finished` releases the lease while a live CLI still
 * holds the worktree, which is the two-agents-on-one-branch failure the lease exists to prevent.
 * Ending the run at the first `result` makes the reported state true either way, and leaves steering
 * meaning what it should mean: interjecting while the agent is working.
 */

import type { RunLiveness } from "@rickylabs/subagents";

/** Everything the provider knows about one run. */
export interface RunRecord {
  readonly runId: string;
  /** The vendor's session id, once the init message has named it. */
  readonly external: string | null;
  readonly liveness: RunLiveness;
  /** One line about the most recent thing that happened. Never carries prompt or agent text. */
  readonly detail: string;
  /** The model id the matrix pinned, as it was passed to `query()`. */
  readonly askedModel: string;
  /** The model id the CLI reported resolving. `null` until the init message arrives. */
  readonly reportedModel: string | null;
  /** Assistant and user messages seen. A heartbeat, not a transcript. */
  readonly turns: number;
  /** What the run cost, once the result message says. */
  readonly costUsd: number | null;
  /** ISO time the run was created. */
  readonly startedAt: string;
  /** ISO time of the last message or lifecycle change. */
  readonly updatedAt: string;
  /** Set by `stop`, so a stream that dies afterwards reads as finished rather than failed. */
  readonly stopping: boolean;
  /** Why `stop` was called, for the detail line. */
  readonly stopReason: string | null;
  /** Paths worth handing to whoever collects evidence. See `provider.ts` for what goes in. */
  readonly artifacts: readonly string[];
}

/** RunLiveness values from which nothing further can happen. */
const TERMINAL: readonly RunLiveness[] = ["finished", "failed"];

/** Whether the run is over. */
export function isOver(record: RunRecord): boolean {
  return TERMINAL.includes(record.liveness);
}

export interface NewRun {
  readonly runId: string;
  readonly askedModel: string;
  readonly at: string;
  readonly artifacts: readonly string[];
}

/** A run that has been created but has not yet said anything. */
export function newRun(options: NewRun): RunRecord {
  return {
    runId: options.runId,
    external: null,
    liveness: "queued",
    detail: "dispatched; waiting for the session to announce itself",
    askedModel: options.askedModel,
    reportedModel: null,
    turns: 0,
    costUsd: null,
    startedAt: options.at,
    updatedAt: options.at,
    stopping: false,
    stopReason: null,
    artifacts: options.artifacts,
  };
}

/**
 * The model the CLI resolved, when it is not the one that was asked for.
 *
 * Recorded, deliberately not enforced. The pins the matrix hands out (`opus-5`, `sonnet-5`) are not
 * necessarily the spelling a CLI reports back — a gateway that canonicalises an alias into a fully
 * versioned id would trip a strict comparison on every healthy run, and a check that fires on
 * healthy runs gets switched off. Turning this into a refusal is #59's, once there is one real
 * observation per model to calibrate it against. Until then the difference is *visible*, in the
 * dispatch detail and in every observation, which is the half that costs nothing to be wrong about.
 */
export function modelNote(record: RunRecord): string | null {
  const reported = record.reportedModel;
  if (reported === null || reported === record.askedModel) return null;
  return `asked ${record.askedModel}, running ${reported}`;
}

function advance(record: RunRecord, at: string, patch: Partial<RunRecord>): RunRecord {
  return { ...record, ...patch, updatedAt: at };
}

/**
 * Fold one SDK message into the record.
 *
 * Messages after the run is over are ignored rather than reopening it: a `result` closes the inbox,
 * and anything still in flight behind it describes a run whose state has already been reported.
 */
export function applyMessage(
  record: RunRecord,
  message: unknown,
  at: string,
  readers: MessageReaders,
): RunRecord {
  if (isOver(record)) return record;

  const init = readers.readInit(message);
  if (init !== null) {
    // The model note is deliberately *not* folded into the detail here. `describe` appends it to
    // every observation, so baking it in as well would print it twice on the one observation that
    // matters most — the first.
    return advance(record, at, {
      external: init.sessionId,
      liveness: "running",
      reportedModel: init.model,
      detail: "session started",
    });
  }

  const result = readers.readResult(message);
  if (result !== null) {
    const failed = result.isError;
    const subtype = result.subtype ?? (failed ? "error" : "success");
    return advance(record, at, {
      liveness: failed ? "failed" : "finished",
      detail: `run ${failed ? "ended in error" : "completed"} (${subtype}) after ${
        result.numTurns ?? record.turns
      } turns`,
      ...(result.costUsd === null ? {} : { costUsd: result.costUsd }),
    });
  }

  if (readers.isTurn(message)) {
    const turns = record.turns + 1;
    return advance(record, at, { liveness: "running", turns, detail: `working (${turns} turns)` });
  }

  return record;
}

/**
 * The three readers `applyMessage` needs, passed in.
 *
 * Injected rather than imported so the fold can be tested against messages that are not the SDK's,
 * and so a correction to the vendor's shape stays inside `sdk.ts`.
 */
export interface MessageReaders {
  readonly readInit: (
    message: unknown,
  ) => { readonly sessionId: string; readonly model: string | null } | null;
  readonly readResult: (message: unknown) => {
    readonly subtype: string | null;
    readonly isError: boolean;
    readonly numTurns: number | null;
    readonly costUsd: number | null;
  } | null;
  readonly isTurn: (message: unknown) => boolean;
}

/** Record that a stop was asked for, so what happens next reads as deliberate. */
export function markStopping(record: RunRecord, reason: string, at: string): RunRecord {
  return advance(record, at, { stopping: true, stopReason: reason });
}

/**
 * The stream is over.
 *
 * Reached by every exit — the generator returning, the generator throwing, the controller being
 * aborted — so that no path leaves a run reporting `running` forever. A run that was being stopped
 * ends `finished`: the stream dying is the stop working, not a failure.
 */
export function endStream(record: RunRecord, at: string, error: string | null): RunRecord {
  if (isOver(record)) return record;
  if (record.stopping) {
    const reason = record.stopReason ?? "no reason given";
    return advance(record, at, { liveness: "finished", detail: `stopped: ${reason}` });
  }
  if (error !== null) {
    return advance(record, at, { liveness: "failed", detail: `the run ended: ${error}` });
  }
  return advance(record, at, {
    liveness: "failed",
    detail: "the message stream ended without a result, so the run's outcome is not known",
  });
}

/**
 * The line `observe` reports.
 *
 * The model note is appended to every observation rather than only to the dispatch, because the
 * dispatch detail is read once and observations are what a coordinator actually looks at.
 */
export function describe(record: RunRecord): string {
  const note = modelNote(record);
  return note === null ? record.detail : `${record.detail}; ${note}`;
}
