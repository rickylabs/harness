/**
 * Telemetry on the `ctx.subagents` seam — written while the run is still happening.
 *
 * E9 shipped a sink (#84), a rotation policy (#88), a `record` entry point and a reader that folds
 * the log back into runs (#86). What it never shipped was a **caller**. Nothing in this repository
 * has ever written a live event from a production path, which is why `dsh-telemetry status` can
 * only report what a transcript on this box happens to say after the fact. A sink with no caller is
 * not telemetry; it is a file format. This module is the caller.
 *
 * It is a decorator rather than a change to `SubagentProvider`, because instrumentation is not a
 * provider's job and a provider author who forgets it should not be able to produce a silent one.
 * Wrapping at the seam is not on its own enough to make that true — the only way to register a
 * provider is to replace the whole registry, and that path never passes through here — so each
 * wrapper leaves a `markInstrumented` mark and `selectProvider` refuses a registry holding anything
 * unmarked. The decorator is the mechanism; the refusal is what makes it a guarantee. See #208.
 *
 * ## Where it lives
 *
 * `packages/dsh-app` is the only package allowed to know both halves. `@rickylabs/subagents` and
 * `@rickylabs/telemetry` each have zero workspace dependencies and that is deliberate: a provider
 * contract that imported a sink would make every provider package depend on the observability
 * format, and a sink that imported the provider contract would make the log a subagent-only log.
 * The composition root is where the two are allowed to meet.
 *
 * ## The three rules it enforces at the writer
 *
 * `packages/telemetry/src/live.ts` states the rules the *reader* follows. A writer that ignored
 * them would simply move the fabrication one file upstream, so they are enforced here too.
 *
 * 1. **A seam is named, never guessed.** `RunSource` has three values and two of them are
 *    subscription seams with a window that can be exhausted, so a wrong one puts a fabricated fact
 *    into a quota report. `Harness` has six values; five map onto a seam and `agy` maps onto
 *    nothing, so a run on `agy` is written with **no** `source` key. The reader already counts and
 *    names such a run rather than inventing a seam for it.
 * 2. **An outcome is written only when the verb licenses one.** `RunOutcome` says how a run *ended*,
 *    and three of the four verbs here cannot know that. `stop` is the sharp case: it has no word for
 *    "ended on purpose", and `failed` would send a reader hunting a crash that never happened, so a
 *    successful stop writes an event with no outcome at all. See "Known gaps" below.
 * 3. **No prompt leaves this module.** `DispatchRequest.prompt` is free operator text and
 *    `steer(run, message)` is more of the same. Both are recorded by *shape* — the request's
 *    routing keys, the message's length — and never by content. The finding on #105 is the rule
 *    here: a field that can hold a prompt will eventually publish one.
 *
 * ## Why dispatch writes twice, and observe writes rarely
 *
 * `dispatch` writes a line **before** the provider is called and another after. That is not
 * symmetry for its own sake: a dispatch is the one verb that creates something the coordinator
 * does not yet have a handle on. If the process dies between the request and the verdict, the
 * before-line is the only evidence that an agent may be running somewhere, and `isSafeToRetry`
 * refuses to retry an `unknown` for exactly that reason. The other three verbs act on a run that is
 * already referenced: a lost `stop` line leaves a run that looks alive until the next observation
 * corrects it, which is a stale row rather than an orphaned process.
 *
 * `observe` writes only when the liveness it saw **differs from the last one this decorator saw**
 * for that run. A supervisor polling every few seconds would otherwise spend the log's whole
 * rotation budget on lines saying nothing changed, and evict the dispatch lines that carry the
 * story. A poll that saw nothing new is not something that happened.
 *
 * That memory is bounded — `DEFAULT_RUN_MEMORY` runs, least-recently-observed evicted first. A
 * daemon that stays up for weeks would otherwise keep one entry per run it ever watched, and this
 * decorator is written to run in exactly that daemon. The obvious alternative, forgetting a run once
 * its liveness is terminal, is a trap: a supervisor that polls a finished run once more would find
 * nothing remembered, write the same `finished` line again, forget again, and do that for as long as
 * anything kept asking. Eviction cannot loop that way, because it needs `DEFAULT_RUN_MEMORY` *other*
 * runs to be observed in between, and its whole cost is one repeated line for a run that busy.
 *
 * Every write is awaited before the wrapped call returns. The sink never throws — a failed write is
 * a note on the sink, not an exception — so awaiting cannot turn a telemetry problem into a
 * dispatch failure, and not awaiting would make "written as work happens" a claim with nothing
 * behind it.
 *
 * ## Known gaps, stated rather than papered over
 *
 * - **`stop` cannot say a run was stopped.** `RunOutcome` has four values and none of them mean
 *   "ended on purpose". The event and its verdict are recorded; the run's outcome is left to the
 *   next observation or to the transcript. Widening `RunOutcome` is a contract change and belongs
 *   on E9, not in a decorator.
 * - **The fold has no idea a dispatch is not yet a run.** Any event with a run id becomes a run in
 *   `foldLiveEvents`, so a dispatch that is refused, or that dies before its verdict, still appears
 *   as a live-only row. That is the reader's decision to make and the right place to fix it.
 * - **Nothing here can supply `branch`.** `DispatchRequest` carries routing, not a branch, and an
 *   `Observation`'s artifacts are paths that can name a home directory — which is why `origin` is
 *   excluded from the public projection. Artifacts are recorded as a count.
 */

import { instrumentedBy, markInstrumented } from "@rickylabs/subagents";
import type {
  DispatchRequest,
  DispatchResult,
  DispatchVerdict,
  Harness,
  Liveness,
  Observation,
  RunRef,
  SteerResult,
  StopResult,
  SubagentProvider,
  SubagentRegistry,
} from "@rickylabs/subagents";
import type { RunOutcome, RunSource, SessionTelemetrySink } from "@rickylabs/telemetry";

/**
 * The event kinds this decorator writes.
 *
 * `TelemetryEvent.kind` is a free string on purpose — the sink is a pipe, not a schema authority —
 * so these names have to carry their own discipline. They are prefixed with the seam because the
 * other seam is coming: `ctx.llm` meters tokens where this one meters a quota window, and a reader
 * totalling one must never accidentally total the other. `subagent.dispatch` and a future
 * `llm.dispatch` are different questions with the same verb.
 */
export const EVENT_KIND = {
  /** A dispatch was sent. Written before the provider is called, so a crash still leaves a trace. */
  dispatching: "subagent.dispatching",
  /** The dispatch verdict. */
  dispatch: "subagent.dispatch",
  /** An observation whose liveness differed from the previous one. */
  observe: "subagent.observe",
  /** A steer was delivered, or was not. */
  steer: "subagent.steer",
  /** A stop was requested. */
  stop: "subagent.stop",
} as const;

/** One of the five kinds above. */
export type EventKind = (typeof EVENT_KIND)[keyof typeof EVENT_KIND];

/**
 * Which seam each harness bills against.
 *
 * Spelled as a total `Record<Harness, ...>` rather than a lookup with a fallback, so adding a
 * harness to `HARNESSES` fails this compile and forces the question to be answered here. `agy` is
 * `null` because it is not one of the three seams `RunSource` names, and rule 1 above says an
 * unmapped harness is written with no seam rather than with a plausible one.
 */
const SEAM_OF_HARNESS: Readonly<Record<Harness, RunSource | null>> = {
  claude: "claude",
  codex: "codex",
  "codex-run": "codex",
  opencode: "opencode",
  "opencode-run": "opencode",
  agy: null,
};

/** The seam a harness bills against, or `null` when it maps onto none. */
export function sourceOfHarness(harness: Harness): RunSource | null {
  return SEAM_OF_HARNESS[harness];
}

/**
 * What a dispatch verdict licenses saying about the run.
 *
 * `accepted` means something is now running. `refused` means the operator asked for a run and did
 * not get one — a failure to launch is a failure worth surfacing, and the verdict and reason travel
 * on the same event so nobody has to guess which kind it was. `unknown` licenses nothing, which is
 * the whole reason the value exists.
 */
const OUTCOME_OF_VERDICT: Readonly<Record<DispatchVerdict, RunOutcome | null>> = {
  accepted: "running",
  refused: "failed",
  unknown: null,
};

/**
 * What an observation licenses saying about the run.
 *
 * `queued` maps to `running` rather than to nothing: `RunOutcome` distinguishes finished from
 * unfinished, and a queued run is certainly unfinished. `unknown` stays unknown — a provider that
 * cannot reach its executor does not know, and that is a fact about our knowledge, not the run.
 */
const OUTCOME_OF_LIVENESS: Readonly<Record<Liveness, RunOutcome | null>> = {
  queued: "running",
  running: "running",
  finished: "complete",
  failed: "failed",
  unknown: null,
};

/**
 * How much free text a single detail value may carry.
 *
 * Provider sentences are the reason a verdict can be acted on, so they are recorded — but they are
 * strings from somewhere else, and a log line that can grow without bound is a rotation policy
 * someone else wrote being quietly overruled.
 */
export const DETAIL_CAP = 240;

/** Flatten and cap one free-text detail value. */
export function clipDetail(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= DETAIL_CAP ? flat : `${flat.slice(0, DETAIL_CAP - 3)}...`;
}

/** What is worth recording about an error, without pretending to know its shape. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The routing of a dispatch, and nothing else.
 *
 * Every key here is one the caller chose from a matrix or a profile — the answer to "what was this
 * run supposed to be". `prompt` is absent by construction rather than by omission: it is the one
 * field of `DispatchRequest` this function does not read.
 */
function requestDetail(provider: string, request: DispatchRequest): Record<string, unknown> {
  const detail: Record<string, unknown> = { provider, harness: request.harness };
  const source = sourceOfHarness(request.harness);
  if (source !== null) detail.source = source;
  if (request.model !== undefined) detail.model = request.model;
  if (request.effort !== undefined) detail.effort = request.effort;
  if (request.profile !== undefined) detail.profile = request.profile;
  if (request.router !== undefined) detail.router = request.router;
  if (request.timeout !== undefined) detail.timeout = request.timeout;
  if (request.maxTokens !== undefined) detail.maxTokens = request.maxTokens;
  return detail;
}

/** The verdict, its reason, and an outcome only where the verdict licenses one. */
function verdictDetail(provider: string, result: DispatchResult): Record<string, unknown> {
  const detail: Record<string, unknown> = { provider, verdict: result.verdict };
  const outcome = OUTCOME_OF_VERDICT[result.verdict];
  if (outcome !== null) detail.outcome = outcome;
  if (result.run !== null && result.run.external !== null) detail.external = result.run.external;
  if (result.detail !== "") detail.note = clipDetail(result.detail);
  return detail;
}

/** Liveness, its reason, and how many artifacts were named — never which ones. */
function observationDetail(provider: string, observation: Observation): Record<string, unknown> {
  const detail: Record<string, unknown> = { provider, liveness: observation.liveness };
  const outcome = OUTCOME_OF_LIVENESS[observation.liveness];
  if (outcome !== null) detail.outcome = outcome;
  if (observation.artifacts.length > 0) detail.artifacts = observation.artifacts.length;
  if (observation.detail !== "") detail.note = clipDetail(observation.detail);
  return detail;
}

/**
 * How many runs' last-seen liveness one decorated provider remembers.
 *
 * Sized for the failure it prevents rather than tuned: a coordinator supervising more than a
 * thousand concurrent runs on one provider has a governance problem long before it has a memory one,
 * and below that ceiling nothing is ever evicted and no observation is ever written twice.
 */
export const DEFAULT_RUN_MEMORY = 1024;

/** What a decorated provider needs to write. */
export interface InstrumentOptions {
  /** Where events go. Shared across every provider on the seam, so appends serialise once. */
  readonly sink: SessionTelemetrySink;
  /**
   * The clock, as an ISO 8601 string.
   *
   * Injected rather than read inline so a test can pin timestamps: `at` is supplied by the caller
   * everywhere else in this subsystem, and a decorator that reached for `Date` directly would be
   * the one part of the pipeline that could not be replayed.
   */
  readonly now?: () => string;
  /**
   * How many runs to remember for the `observe` de-duplication. Defaults to `DEFAULT_RUN_MEMORY`.
   *
   * A positive integer. Zero is not "do not de-duplicate" — it is a decorator that forgets each run
   * between two polls and writes the same liveness forever — so it is refused rather than honoured.
   */
  readonly runMemory?: number;
}

/**
 * What this module signs its wrappers with.
 *
 * A name rather than a boolean, because a refusal that can say *what* wrapped a provider can also
 * say when something unexpected did — and because a second wrapper around one provider has to be
 * refusable, which needs the two to be distinguishable.
 */
export const WRAPPER = "@rickylabs/dsh-app/instrument";

/**
 * Wrap one provider so each of its four verbs leaves evidence as it happens.
 *
 * The wrapper delegates every member explicitly rather than spreading the provider. Spreading would
 * copy method references onto a new object, which silently breaks a class-based provider the moment
 * one of its methods touches `this`; it would also let a member added to `SubagentProvider` later
 * pass through uninstrumented. Listing them means a new verb fails this compile, which is the
 * failure we want.
 *
 * The result is marked with `markInstrumented`, which is what lets `selectProvider` tell a wrapped
 * provider from a raw one at the far end of the seam. The mark goes on the wrapper, never on the
 * provider handed in: marking the argument would make an unwrapped provider claim to be
 * instrumented the moment anyone wrapped a copy of it.
 */
export function instrumentProvider(
  provider: SubagentProvider,
  options: InstrumentOptions,
): SubagentProvider {
  // Refused here rather than left to `markInstrumented`, which cannot see it: the mark this function
  // writes goes on the wrapper it builds, and that object is new every time. Wrapping a wrapper would
  // therefore succeed quietly and write every event twice for the life of the daemon, with no way for
  // a reader of the log to tell the duplicate from a genuine retry.
  const already = instrumentedBy(provider);
  if (already !== null) {
    throw new Error(
      `provider ${provider.id} is already marked as instrumented by ${already}; wrapping it again ` +
        "would write every event twice",
    );
  }

  const sink = options.sink;
  const now = options.now ?? ((): string => new Date().toISOString());
  const capacity = options.runMemory ?? DEFAULT_RUN_MEMORY;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`runMemory must be a positive integer, not ${String(options.runMemory)}`);
  }

  /**
   * The last liveness this decorator saw per run — the reason `observe` is not a firehose.
   *
   * Insertion order is recency order, because `remember` re-inserts on every observation rather
   * than only on a change. Without that a run whose liveness is stable — which is most of them, and
   * exactly the ones being watched hardest — would be the first evicted.
   */
  const seen = new Map<string, Liveness>();

  const remember = (runId: string, liveness: Liveness): void => {
    seen.delete(runId);
    seen.set(runId, liveness);
    while (seen.size > capacity) {
      const oldest = seen.keys().next();
      if (oldest.done === true) break;
      seen.delete(oldest.value);
    }
  };

  const write = async (
    runId: string,
    kind: EventKind,
    detail: Record<string, unknown>,
  ): Promise<void> => {
    await sink.write({ at: now(), runId, kind, detail });
  };

  return markInstrumented({
    id: provider.id,
    capabilities: provider.capabilities,

    async dispatch(request: DispatchRequest, runId: string): Promise<DispatchResult> {
      await write(runId, EVENT_KIND.dispatching, requestDetail(provider.id, request));
      let result: DispatchResult;
      try {
        result = await provider.dispatch(request, runId);
      } catch (error) {
        // A throw is not a verdict. `unknown` is the honest one: the run may or may not have
        // launched, and `isSafeToRetry` reads that as "do not retry" for the same reason.
        await write(runId, EVENT_KIND.dispatch, {
          provider: provider.id,
          verdict: "unknown",
          note: clipDetail(reasonOf(error)),
        });
        throw error;
      }
      await write(runId, EVENT_KIND.dispatch, verdictDetail(provider.id, result));
      return result;
    },

    async observe(run: RunRef): Promise<Observation> {
      let observation: Observation;
      try {
        observation = await provider.observe(run);
      } catch (error) {
        // Forget what we last saw, so the next successful observation is recorded even if it
        // reports the same liveness. A gap in the log should not be able to hide a state change.
        seen.delete(run.runId);
        await write(run.runId, EVENT_KIND.observe, {
          provider: provider.id,
          liveness: "unknown",
          note: clipDetail(reasonOf(error)),
        });
        throw error;
      }
      const previous = seen.get(run.runId);
      // Recorded before the comparison decides anything, so that watching a run keeps it in memory
      // even across the long stretches where its liveness does not move.
      remember(run.runId, observation.liveness);
      if (previous !== observation.liveness) {
        await write(run.runId, EVENT_KIND.observe, observationDetail(provider.id, observation));
      }
      return observation;
    },

    async steer(run: RunRef, message: string): Promise<SteerResult> {
      let result: SteerResult;
      try {
        result = await provider.steer(run, message);
      } catch (error) {
        await write(run.runId, EVENT_KIND.steer, {
          provider: provider.id,
          verdict: "unknown",
          messageLength: message.length,
          note: clipDetail(reasonOf(error)),
        });
        throw error;
      }
      // The message itself is a prompt. Its length says a steer of some size happened, which is
      // what an operator reading a timeline needs, and says nothing about what was in it.
      const detail: Record<string, unknown> = {
        provider: provider.id,
        verdict: result.verdict,
        messageLength: message.length,
      };
      if (result.detail !== "") detail.note = clipDetail(result.detail);
      await write(run.runId, EVENT_KIND.steer, detail);
      return result;
    },

    async stop(run: RunRef, reason: string): Promise<StopResult> {
      let result: StopResult;
      try {
        result = await provider.stop(run, reason);
      } catch (error) {
        await write(run.runId, EVENT_KIND.stop, {
          provider: provider.id,
          verdict: "unknown",
          reason: clipDetail(reason),
          note: clipDetail(reasonOf(error)),
        });
        throw error;
      }
      // `reason` is recorded where `message` is not. A steer message is prose written *to* an
      // agent; a stop reason is a coordinator explaining a decision, and it is the entire value of
      // the record — a stop with no reason cannot be reviewed later by anything but guesswork.
      const detail: Record<string, unknown> = {
        provider: provider.id,
        verdict: result.verdict,
        reason: clipDetail(reason),
      };
      if (result.detail !== "") detail.note = clipDetail(result.detail);
      await write(run.runId, EVENT_KIND.stop, detail);
      return result;
    },
  }, WRAPPER);
}

/**
 * Wrap every provider on a registry.
 *
 * The registry, not the individual provider, is what the seam hands out, so this is the right place
 * to wrap. It is not on its own the reason no provider can be reached uninstrumented — this function
 * only sees the registries somebody remembers to pass it, and a provider package registering later
 * hands over a registry of its own that never comes through here. What closes that is the mark each
 * wrapper leaves and `selectProvider`'s refusal to dispatch through a registry missing one.
 *
 * Already-wrapped providers are refused rather than wrapped again: `instrumentProvider` throws on a
 * provider that already carries a mark, so double-instrumenting a registry fails at composition
 * instead of writing every event twice for the life of the daemon.
 */
export function instrumentRegistry(
  registry: SubagentRegistry,
  options: InstrumentOptions,
): SubagentRegistry {
  return { providers: registry.providers.map((provider) => instrumentProvider(provider, options)) };
}
