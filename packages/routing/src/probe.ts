/**
 * Availability, which is the one fact in this package with an expiry date.
 *
 * Everything else `routing` holds is true until somebody edits it: a model id, a lane's chain, the
 * family a model belongs to. Availability is not like that. A subscription window empties and
 * refills; a relay balance only goes down; a staged rollout turns a model on for some accounts on a
 * Tuesday. E4.3 (#59) states the consequence in one line — **time-sliding facts must never be
 * committed** — and this module is where that stops being a rule people remember and starts being a
 * type they cannot get around.
 *
 * `admit.ts` says of itself that "nothing here opens a socket, reads a file, or looks at a quota".
 * That is still true, and it is why this file sits beside it rather than inside it. Admission asks
 * whether a pairing is *permitted*; this asks whether it is *possible right now*. The second
 * question cannot be answered from a table, and the first must never be answered from a probe.
 *
 * ## Nothing here opens a socket either
 *
 * A caller takes the observation — an HTTP call, a `codex --version`, a CLI invocation against the
 * model in question — and hands the result in. This module decides what that result *means*: how
 * long it is worth, whether it says what the caller thinks it says, and what may be dispatched on
 * it. The split is the same one `telemetry`'s liveness module and `subagents`' lease module make,
 * and for the same reason: a decision that opens a socket cannot be tested, and an availability rule
 * that cannot be tested is a rule that will be wrong on the day it matters.
 *
 * It also does not re-check that the model is pinned. `admitDispatch` refuses an unknown id already,
 * with three distinct refusals for the three ways an id can be wrong, and a second copy of that check
 * here would be a second answer to a question that must only have one. This module is about time.
 *
 * ## The failure it exists to prevent is success-coded
 *
 * This is the third instance in the repo of the same bug shape, and by now it is the house's most
 * expensive one. `@rickylabs/llm-local`'s budget floor exists because a reasoning model given a
 * ten-token ceiling returns HTTP 200 with empty content. `admit.ts` exists because a provider handed
 * an id it does not recognise runs to completion against something else and reports success.
 *
 * #59 names the third: ask codex-cli for a model it does not have metadata for and it prints
 *
 *     Model metadata for 'some-model' not found. Defaulting to fallback metadata
 *
 * and then **runs the job**. Exit code zero. A probe that asserts on the status admits exactly the
 * run it was written to refuse — with the wrong context window and the wrong reasoning defaults, so
 * the output is worse in a way no field of the receipt records. `degraded` exists as a verdict of
 * its own because neither of the two obvious ones is true: the destination did not refuse, and what
 * came back is not what was asked for.
 *
 * ## Absence of the warning is only evidence if the probe got far enough to print it
 *
 * The obvious reading of #59's second criterion — assert on the absence of that line — is wrong on
 * its own, and wrong in the direction that costs money. A probe that died on authentication, or
 * that answered 500 before loading anything, also contains no warning. Scanning its output finds
 * nothing and reports the model healthy.
 *
 * So an observation carries `reachable` and `completed` as separate fields. `reachable` says the
 * destination answered at all; `completed` says the probe reached the point where the warning would
 * have been printed had it applied. Only `completed` makes silence meaningful. Reachable and not
 * completed is `unknown` — not `available`, because nothing was established, and not `unavailable`,
 * because something answered.
 *
 * ## A committed constant may refuse, and may never permit
 *
 * #59's first criterion keeps static allowances "only as a documented fallback", and the sharp form
 * of that is asymmetric. A constant saying *this is unavailable* is safe in the only way that
 * matters: being wrong costs a dispatch that did not happen. A constant saying *this is available*
 * is the entire failure — it is a value somebody typed weeks ago, spending a subscription window or
 * real money today, and it looks exactly like a reading.
 *
 * So `availabilityOf` refuses a fallback of `available` (`constant-claims-available`) and answers
 * `unknown` instead. Every verdict also carries its `source`, so a caller cannot receive a constant
 * without also receiving the word for what it is, and `mayDispatch` requires both `available` and
 * `probe`. That last check is deliberately redundant with the refusal above: `Verdict` is an
 * interface, a caller can build one by hand, and the gate should fail closed when they do.
 *
 * The third criterion — that no allowance snapshot is ever committed — is not enforceable from
 * inside a module, because the mistake is a file, not a call. `scripts/check-snapshots.mjs` is the
 * other half, and it runs in `build`.
 */

import { parseGoDuration } from "@rickylabs/subagents";

/**
 * What may be said about a destination's readiness for one model.
 *
 * Four rather than two, for the reason `@rickylabs/llm-local`'s capability matrix needs three: with
 * a smaller vocabulary every case that does not fit has to be filed as something false. `degraded`
 * and `unknown` are the two that would otherwise have to lie.
 */
export const AVAILABILITIES = ["available", "degraded", "unavailable", "unknown"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

const AVAILABILITY_TEXT: Readonly<Record<Availability, string>> = {
  available: "answered, and running on its own metadata",
  degraded: "answered, on fallback metadata — it will run, with the wrong ceiling and defaults",
  unavailable: "refused, or did not answer",
  unknown: "nothing was established, so no claim is made",
};

/** One line for a verdict, for a log or a receipt. Total over the four. */
export const describeAvailability = (availability: Availability): string =>
  AVAILABILITY_TEXT[availability];

/**
 * Where a verdict came from.
 *
 * `none` is not a stylistic third member. A verdict resting on nothing is a distinct state from one
 * resting on a documented constant, and collapsing them would hide which of the two a coordinator
 * was acting on when it declined to dispatch.
 */
export const SOURCES = ["probe", "fallback", "none"] as const;
export type Source = (typeof SOURCES)[number];

/** Every way a request for an availability verdict can be refused, or a verdict qualified. */
export const PROBE_REFUSALS = [
  "no-target",
  "no-model",
  "observation-mismatch",
  "clock-unreadable",
  "observed-in-future",
  "freshness-not-a-duration",
  "no-observation",
  "stale-observation",
  "probe-incomplete",
  "fallback-metadata",
  "endpoint-unreachable",
  "constant-claims-available",
] as const;
export type ProbeRefusal = (typeof PROBE_REFUSALS)[number];

const REFUSAL_TEXT: Readonly<Record<ProbeRefusal, string>> = {
  "no-target": "the request names no destination",
  "no-model": "the request names no model",
  "observation-mismatch": "the observation is about something else",
  "clock-unreadable": "a timestamp is not a date, so age cannot be computed",
  "observed-in-future": "the observation is stamped after the reference clock",
  "freshness-not-a-duration": "the freshness window is not a duration this package can read",
  "no-observation": "nothing was probed",
  "stale-observation": "the observation is older than the freshness window",
  "probe-incomplete": "the probe answered but did not run far enough to establish anything",
  "fallback-metadata": "the destination ran the model on fallback metadata",
  "endpoint-unreachable": "the destination did not answer",
  "constant-claims-available": "a committed constant asserted availability, which it may not",
};

/** What a refusal means, in the terms an operator would use. Total over `PROBE_REFUSALS`. */
export const describeProbeRefusal = (reason: ProbeRefusal): string => REFUSAL_TEXT[reason];

/** One reason a verdict is not a clean `available`. */
export interface ProbeProblem {
  readonly reason: ProbeRefusal;
  readonly message: string;
  /** The model the problem is about, or `null` when the request did not name one. */
  readonly model: string | null;
}

/** A problem as one line, prefixed by the model when there is one. */
export const describeProbeProblem = (problem: ProbeProblem): string =>
  problem.model === null ? problem.message : `${problem.model}: ${problem.message}`;

/**
 * What a probe saw. Produced by a caller; nothing in this package produces one.
 *
 * `output` is whatever the probe printed — a response body, a CLI's combined streams. It is scanned
 * for the metadata warning and for nothing else, and it is never echoed into a problem message,
 * because a probe's output is one of the places a credential can end up.
 */
export interface Observation {
  /** The destination probed: a harness, a router, a backend. Not validated here. */
  readonly target: string;
  readonly model: string;
  /** ISO 8601. */
  readonly observedAt: string;
  /** The destination answered at all. */
  readonly reachable: boolean;
  /** The probe reached the point where a metadata warning would have been printed. */
  readonly completed: boolean;
  readonly output: string;
}

/** A question about one destination and one model, at one moment. */
export interface AvailabilityRequest {
  readonly target: string;
  readonly model: string;
  /** The most recent probe, or `null`/absent when there has been none. */
  readonly observation?: Observation | null;
  /** The documented constant, consulted only when no fresh observation exists. Never `available`. */
  readonly fallback?: Availability;
  /** A Go duration. Defaults to `DEFAULT_FRESHNESS`. */
  readonly freshness?: string;
}

/** The answer, and what it rests on. */
export interface Verdict {
  readonly target: string;
  readonly model: string;
  readonly availability: Availability;
  readonly source: Source;
  /** When the evidence was taken, or `null` when the verdict rests on no observation. */
  readonly observedAt: string | null;
  readonly problems: readonly ProbeProblem[];
}

/**
 * How long a probe is worth.
 *
 * Ten minutes is short enough that a window emptied mid-plan is caught before the next dispatch, and
 * long enough that a planning pass over a dozen lanes does not re-probe for each one. It is a
 * default and not a policy: a caller that knows its destination refills hourly should say so.
 */
export const DEFAULT_FRESHNESS = "10m";

/**
 * The string the whole of #59's second criterion turns on.
 *
 * Matched case-insensitively and on its own, without the sentence that usually precedes it, because
 * the prefix is the part a vendor is free to reword in a point release and the marker is the part
 * that has to keep meaning what it means.
 */
export const FALLBACK_METADATA_MARKER = "Defaulting to fallback metadata";

const MARKER_LOWER = FALLBACK_METADATA_MARKER.toLowerCase();

/** Whether a probe's output says the destination fell back to generic metadata for something. */
export function readsFallbackMetadata(output: string): boolean {
  return output.toLowerCase().includes(MARKER_LOWER);
}

const NAMED_WARNING = /Model metadata for\s+['"`]?([^'"`\r\n]+?)['"`]?\s+not found/gi;

/**
 * The models a probe's output names in a metadata warning, in the order they appear.
 *
 * Empty when the output warns without naming anything, which is not the same as no warning — see
 * `availabilityOf`, where an unattributable warning is treated as being about the model asked for.
 */
export function fallbackMetadataModels(output: string): readonly string[] {
  const names: string[] = [];
  for (const match of output.matchAll(NAMED_WARNING)) {
    const name = match[1]?.trim();
    if (name === undefined || name.length === 0) continue;
    if (!names.some((seen) => seen === name)) names.push(name);
  }
  return names;
}

/** Whether an observation is inside the freshness window. Fails closed on an unreadable clock. */
export function isFresh(observation: Observation, at: string, freshness?: string): boolean {
  const window = durationMs(freshness ?? DEFAULT_FRESHNESS);
  if (window === null || window < 0) return false;
  const observed = msOf(observation.observedAt);
  const now = msOf(at);
  if (observed === null || now === null) return false;
  if (observed > now) return false;
  return now - observed <= window;
}

/**
 * Everything wrong with an observation that is decidable without a request beside it.
 *
 * Exported so a caller can reject one before storing it, rather than storing something that will
 * silently never be trusted.
 */
export function checkObservation(observation: Observation, at: string): readonly ProbeProblem[] {
  const problems: ProbeProblem[] = [];
  const model = observation.model.trim() === "" ? null : observation.model;
  const say = (reason: ProbeRefusal, message: string): void => {
    problems.push({ reason, message, model });
  };

  if (observation.target.trim() === "") say("no-target", "the observation names no destination");
  if (model === null) say("no-model", "the observation names no model");

  const observed = msOf(observation.observedAt);
  const now = msOf(at);
  if (observed === null) {
    say("clock-unreadable", `\`observedAt\` is not a date: ${JSON.stringify(observation.observedAt)}`);
  }
  if (now === null) {
    say("clock-unreadable", `the reference clock is not a date: ${JSON.stringify(at)}`);
  }
  if (observed !== null && now !== null && observed > now) {
    say(
      "observed-in-future",
      "stamped after the reference clock, so its age cannot be computed — re-probe, or fix the clock",
    );
  }

  return problems;
}

/**
 * What may be believed about `request.model` at `request.target`, as of `at`.
 *
 * Never throws. A caller reads `availability` to decide and `problems` to explain, and calls
 * `mayDispatch` rather than comparing `availability` itself.
 */
export function availabilityOf(request: AvailabilityRequest, at: string): Verdict {
  const problems: ProbeProblem[] = [];
  const model = request.model.trim() === "" ? null : request.model;
  const say = (reason: ProbeRefusal, message: string): void => {
    problems.push({ reason, message, model });
  };

  const settle = (
    availability: Availability,
    source: Source,
    observedAt: string | null,
  ): Verdict => ({
    target: request.target,
    model: request.model,
    availability,
    source,
    observedAt,
    problems,
  });

  const onFallback = (): Verdict => {
    const fallback = request.fallback;
    if (fallback === undefined) return settle("unknown", "none", null);
    if (fallback === "available") {
      say(
        "constant-claims-available",
        "a documented fallback may refuse and may not permit — a constant that says `available` is " +
          "spending today on something written weeks ago",
      );
      return settle("unknown", "fallback", null);
    }
    return settle(fallback, "fallback", null);
  };

  if (request.target.trim() === "") say("no-target", "the request names no destination");
  if (model === null) say("no-model", "the request names no model");

  const window = durationMs(request.freshness ?? DEFAULT_FRESHNESS);
  if (window === null || window < 0) {
    say(
      "freshness-not-a-duration",
      `not a non-negative Go duration: ${JSON.stringify(request.freshness ?? DEFAULT_FRESHNESS)}`,
    );
  }

  const observation = request.observation ?? null;
  if (observation === null) {
    say("no-observation", "no probe has been taken, so nothing current is known");
    return onFallback();
  }

  for (const problem of checkObservation(observation, at)) problems.push(problem);

  if (observation.model !== request.model) {
    say(
      "observation-mismatch",
      `the observation is about \`${observation.model}\`, not \`${request.model}\``,
    );
  }
  if (observation.target !== request.target) {
    say(
      "observation-mismatch",
      `the observation is from \`${observation.target}\`, not \`${request.target}\``,
    );
  }

  const observed = msOf(observation.observedAt);
  const now = msOf(at);
  if (window !== null && window >= 0 && observed !== null && now !== null && observed <= now) {
    if (now - observed > window) {
      say(
        "stale-observation",
        `probed ${Math.round((now - observed) / 1000)}s ago, outside a ${request.freshness ?? DEFAULT_FRESHNESS} window`,
      );
    }
  }

  if (problems.length > 0) return onFallback();

  if (!observation.reachable) {
    say("endpoint-unreachable", "the destination did not answer");
    return settle("unavailable", "probe", observation.observedAt);
  }

  if (!observation.completed) {
    say(
      "probe-incomplete",
      "answered, but stopped before anything was established — silence in this output is not evidence",
    );
    return settle("unknown", "probe", observation.observedAt);
  }

  if (readsFallbackMetadata(observation.output)) {
    const named = fallbackMetadataModels(observation.output);
    const ours = named.length === 0 || named.some((name) => name === request.model);
    if (ours) {
      say(
        "fallback-metadata",
        named.length === 0
          ? "warned about fallback metadata without naming a model, which is not attributable to " +
            "anything else in this output"
          : "the destination has no metadata for it and used generic defaults — it will run, with " +
            "the wrong context window",
      );
      return settle("degraded", "probe", observation.observedAt);
    }
  }

  return settle("available", "probe", observation.observedAt);
}

/**
 * Whether a dispatch may go out on this verdict.
 *
 * Both halves are checked. `availabilityOf` already refuses to hand `available` to a constant, so
 * the source test is redundant against verdicts this module produced — and `Verdict` is an
 * interface, so it is not redundant against one a caller assembled.
 */
export function mayDispatch(verdict: Verdict): boolean {
  return verdict.availability === "available" && verdict.source === "probe";
}

/** A verdict as one line, for a log or a receipt. Never includes the probe's output. */
export function describeVerdict(verdict: Verdict): string {
  const when = verdict.observedAt === null ? "no observation" : verdict.observedAt;
  return `${verdict.target}/${verdict.model}: ${verdict.availability} (${verdict.source}, ${when})`;
}

// ── clocks and durations ─────────────────────────────────────────────────────

function msOf(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function durationMs(text: string): number | null {
  const ns = parseGoDuration(text);
  return ns === null ? null : ns / 1e6;
}
