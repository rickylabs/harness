/**
 * The teardown deadline, and the only evidence that a run actually stopped.
 *
 * A `/swarm` block may carry `timeout:`. `@rickylabs/subagents` parses it — Go's own
 * `time.ParseDuration`, transliterated — and that is where criterion one of #77 already lives. What
 * the duration is *for* lives here: at the deadline the run is torn down, and the inbox issue that
 * spawned it is closed. An inbox issue left open behind a dead run is re-dispatched on the next
 * poll, which is how one wedged job becomes two.
 *
 * ## Teardown is verified by artefact, never by exit code
 *
 * The issue states the reason in as many words: *three agents have claimed to stop while their
 * process trees were still running.* An exit code is the run's own account of itself, taken at the
 * one moment it is least able to give one, and a supervisor that believes it will close an inbox
 * issue over a process that is still spending quota — with nothing left on the board pointing at it.
 *
 * So this module is the inverse of `@rickylabs/telemetry`'s `liveness.ts`, and deliberately shares
 * its doctrine. There, a node is green on a growing artefact, a new commit or a live turn, never on
 * an open socket. Here, a run is down when its artefacts have *stopped* growing, never when it says
 * it exited. `exited` is carried through every verdict and decides exactly one thing — the
 * `settling` state, which means *it claims to have finished and the files disagree.* It can never
 * produce `stopped`, and `stopped` is the only state that owes a close.
 *
 * ## The two errors are not symmetric
 *
 * Calling a live run stopped closes its inbox issue, and the run keeps burning a metered quota with
 * nothing on the board naming it. Calling a dead run live leaves the issue open one more tick, and
 * the next tick closes it. The settle window is generous for that reason, and it is a dial
 * ({@link TeardownInput.settle}) rather than a constant, because the right value is a property of
 * how fast the fleet's artefacts flush and not of this file.
 *
 * ## An orphan is a question, not a chore
 *
 * The last state is `orphaned`: an open inbox issue with no run behind it. It is reported and it
 * owes no step, because this command cannot tell a wedged run's leftovers from an issue the
 * dispatcher has simply not reached yet — and closing the second kind deletes work somebody asked
 * for. That is a judgement for whoever reads the refusal, and the whole value of naming it is that
 * until now nobody could see it at all.
 *
 * Offline and clock-explicit, like every other decision in this package. `at` is supplied rather
 * than read, so two runs over the same inputs decide the same way and a verdict stays true when it
 * is pasted into an issue.
 */

import { parseGoDuration } from "@rickylabs/subagents";

import type { TargetTable } from "./../targets/model.js";
import type { BridgeSource } from "./../targets/reconcile.js";
import { refOfInboxTitle } from "./trigger.js";

/**
 * The deadline a run gets when its `/swarm` block names none.
 *
 * Ours, and stated rather than assumed: upstream discards an unparseable `timeout:` "in silence,
 * leaving the run on the default deadline", and that default is a value in a Go binary this
 * repository does not read. Four hours is long enough that a real run is not cut off mid-task, and
 * short enough that a wedged one does not hold an inbox issue for a whole quota window.
 */
export const DEFAULT_TIMEOUT = "4h";

/** How long every artefact must be still before a run counts as down. See the header. */
export const DEFAULT_SETTLE = "5m";

/** Past this much overdue and still writing, nothing is enforcing the deadline at all. */
export const DEFAULT_STUCK = "1h";

/**
 * One file the run writes, as `stat` reports it.
 *
 * `bytes` is carried for the operator's eye — "41kb and growing" reads better than a bare
 * timestamp — but only `at` decides anything. An artefact whose `at` does not parse contributes
 * nothing in either direction; if that is all of them, {@link TeardownEvidence} falls to `none` and
 * the refusal says so.
 */
export interface Artefact {
  readonly path: string;
  /** ISO-8601, the artefact's last change. */
  readonly at: string;
  readonly bytes: number;
}

/** One run the fleet believes is live, and what was observed of it. */
export interface RunObservation {
  /** `owner/name#123` — the source ref its inbox issue mirrors. The join key. */
  readonly ref: string;
  readonly harness: string;
  /** ISO-8601. */
  readonly startedAt: string;
  /** The raw `timeout:` the block carried, or `""` for absent. Not pre-parsed — see the header. */
  readonly timeout: string;
  readonly artefacts: readonly Artefact[];
  /** Whether the harness claims to have finished. Decides `settling`, and nothing else. */
  readonly exited: boolean;
  readonly exitCode?: number;
}

/** One inbox issue, as the mirror titles name it. */
export interface InboxIssue {
  readonly number: number;
  /** `owner/name#123`, out of the `[owner/name#123]` title convention. */
  readonly ref: string;
  readonly open: boolean;
}

export interface TeardownInput {
  /** The tick's clock, ISO-8601. Supplied, never read — see the header. */
  readonly at: string;
  readonly runs: readonly RunObservation[];
  /** Every inbox issue, open and closed alike: a closed one is what makes teardown complete. */
  readonly inbox: readonly InboxIssue[];
  /** Go duration. Default {@link DEFAULT_TIMEOUT}. */
  readonly defaultTimeout?: string;
  /** Go duration. Default {@link DEFAULT_SETTLE}. */
  readonly settle?: string;
  /** Go duration. Default {@link DEFAULT_STUCK}. */
  readonly stuck?: string;
}

/**
 * What the verdict rests on.
 *
 * The distinction is the whole criterion. `artefact` is a measurement; `claim` is the run's own
 * word for it; `none` is neither. Only `artefact` can end in `stopped`.
 */
export const TEARDOWN_EVIDENCE = ["artefact", "claim", "none"] as const;
export type TeardownEvidence = (typeof TEARDOWN_EVIDENCE)[number];

/** Where a run is against its deadline, as a closed set. */
export const TEARDOWN_STATES = [
  /** Inside its deadline. Nothing owed. */
  "running",
  /** Past its deadline and still writing. The stop is owed. */
  "expired",
  /** It says it finished; the files say otherwise. Verified, not closed — see the header. */
  "settling",
  /** Every artefact still for the settle window, and the inbox issue is open. The close is owed. */
  "stopped",
  /** Still, and the inbox issue is closed. Teardown is complete. */
  "closed",
  /** An open inbox issue with no run behind it. Reported, never acted on. */
  "orphaned",
] as const;

export type TeardownState = (typeof TEARDOWN_STATES)[number];

/**
 * What teardown owes, in the order it is owed.
 *
 * `close` is last and never first. Closing the inbox issue before the process is down removes the
 * one thing on the board that names a run still spending quota; leaving it open one tick too long
 * costs a re-poll. The second is recoverable and visible, the first is neither.
 */
export const TEARDOWN_STEPS = ["stop", "verify", "close"] as const;
export type TeardownStep = (typeof TEARDOWN_STEPS)[number];

const STEPS: Readonly<Record<TeardownState, readonly TeardownStep[]>> = {
  running: [],
  expired: ["stop", "verify", "close"],
  settling: ["verify", "close"],
  stopped: ["close"],
  closed: [],
  orphaned: [],
};

export interface TeardownVerdict {
  readonly ref: string;
  /** `""` for an orphan, which has no run to have launched anything. */
  readonly harness: string;
  readonly inboxIssue: number | null;
  readonly inboxOpen: boolean;
  readonly state: TeardownState;
  readonly evidence: TeardownEvidence;
  /** Echoed back verbatim, including a value that did not parse. `""` for an orphan. */
  readonly startedAt: string;
  /** ISO-8601, or `null` when `startedAt` did not parse and there is therefore no deadline. */
  readonly deadline: string | null;
  /** Milliseconds past the deadline, `0` when not past it, `null` when there is no deadline. */
  readonly overdueMs: number | null;
  /** Milliseconds since the newest artefact changed, or `null` when none was observed. */
  readonly quietMs: number | null;
  /** The raw `timeout:` the block carried, or `""`. */
  readonly timeout: string;
  /** The deadline came from {@link TeardownInput.defaultTimeout}, not from the block. */
  readonly defaulted: boolean;
  /** Still owed, in {@link TEARDOWN_STEPS} order. `close` is dropped when there is nothing to close. */
  readonly steps: readonly TeardownStep[];
  /** The newest readable artefact, for the operator's eye. */
  readonly newest: Artefact | null;
  /** The run's own account of itself. Carried, and believed about nothing. */
  readonly exited: boolean;
}

export interface Teardown {
  readonly inbox: string;
  /** Echoed back, so a verdict read later says which clock produced it. */
  readonly at: string;
  readonly settleMs: number;
  readonly stuckMs: number;
  readonly verdicts: readonly TeardownVerdict[];
  /** Refs the run feed listed more than once. The first won; the rest were dropped. */
  readonly duplicates: readonly string[];
}

/**
 * The inbox issues in a set of board projections, by the ref each one's title mirrors.
 *
 * Open and closed alike, deliberately, for the same reason `mirroredRefs` reads both: a closed
 * mirror is what says teardown finished, and dropping it would make every completed run look like a
 * run with no issue to close.
 *
 * Pull requests are excluded even though GitHub numbers them from one sequence — the inbox's
 * mirrors are issues, and a pull request whose title happened to start `[repo#n]` would answer for
 * a run it has nothing to do with.
 */
export function inboxIssues(table: TargetTable, projections: readonly BridgeSource[]): readonly InboxIssue[] {
  const issues: InboxIssue[] = [];
  for (const projection of projections) {
    if (projection.repo !== table.inbox) continue;
    for (const item of projection.items) {
      if (item.kind !== "issue") continue;
      const ref = refOfInboxTitle(item.title);
      if (ref !== "") issues.push({ number: item.number, ref, open: item.state === "open" });
    }
  }
  return issues;
}

/** Epoch milliseconds, or `null` for anything `Date.parse` will not read. */
const msOf = (iso: string): number | null => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/** A Go duration in milliseconds, or `null` for anything Go would reject. */
const durationMs = (text: string): number | null => {
  const ns = parseGoDuration(text);
  return ns === null ? null : Math.round(ns / 1e6);
};

/** A duration that must resolve, because it is one of this module's own constants. */
const fixed = (text: string, fallback: string): number => durationMs(text) ?? durationMs(fallback) ?? 0;

/**
 * Decide every run against its deadline, and every inbox issue against its run.
 *
 * An unreadable `at` produces no verdicts rather than a table of wrong ones: every state here is
 * arithmetic against the clock, and a clock that did not parse cannot be substituted for. The
 * `clock-unreadable` refusal is what says so.
 */
export function planTeardown(table: TargetTable, input: TeardownInput): Teardown {
  const settleMs = fixed(input.settle ?? DEFAULT_SETTLE, DEFAULT_SETTLE);
  const stuckMs = fixed(input.stuck ?? DEFAULT_STUCK, DEFAULT_STUCK);
  const now = msOf(input.at);
  const frame = { inbox: table.inbox, at: input.at, settleMs, stuckMs };
  if (now === null) return { ...frame, verdicts: [], duplicates: [] };

  const defaultMs = fixed(input.defaultTimeout ?? DEFAULT_TIMEOUT, DEFAULT_TIMEOUT);

  // First entry wins, matching `admitSwarmComments` and `supervisePulls`: a ref listed twice is two
  // dumps concatenated, and choosing differently here would make the answer depend on file order.
  const issues = new Map<string, InboxIssue>();
  for (const issue of input.inbox) {
    if (issue.ref !== "" && !issues.has(issue.ref)) issues.set(issue.ref, issue);
  }

  const verdicts: TeardownVerdict[] = [];
  const duplicates: string[] = [];
  const decided = new Set<string>();
  for (const run of input.runs) {
    if (decided.has(run.ref)) {
      duplicates.push(run.ref);
      continue;
    }
    decided.add(run.ref);
    verdicts.push(teardownOne(run, issues.get(run.ref) ?? null, { now, settleMs, defaultMs }));
  }

  for (const issue of issues.values()) {
    if (issue.open && !decided.has(issue.ref)) verdicts.push(orphan(issue));
  }

  return { ...frame, verdicts, duplicates };
}

interface Clock {
  readonly now: number;
  readonly settleMs: number;
  readonly defaultMs: number;
}

function teardownOne(run: RunObservation, issue: InboxIssue | null, clock: Clock): TeardownVerdict {
  const named = run.timeout === "" ? null : durationMs(run.timeout);
  const started = msOf(run.startedAt);
  const deadlineMs = started === null ? null : started + (named ?? clock.defaultMs);
  const overdueMs = deadlineMs === null ? null : Math.max(0, clock.now - deadlineMs);

  const newest = newestArtefact(run.artefacts);
  const newestMs = newest === null ? null : msOf(newest.at);
  // Clamped at zero: an artefact stamped in the future is skew, not a file about to be written, and
  // reading it as negative quiet would make a live run look like a settled one.
  const quietMs = newestMs === null ? null : Math.max(0, clock.now - newestMs);

  const evidence: TeardownEvidence = quietMs !== null ? "artefact" : run.exited ? "claim" : "none";
  const state = stateOf({ quietMs, settleMs: clock.settleMs, open: issue?.open ?? false, run, overdueMs });
  const steps = STEPS[state].filter((step) => step !== "close" || issue !== null);

  return {
    ref: run.ref,
    harness: run.harness,
    inboxIssue: issue?.number ?? null,
    inboxOpen: issue?.open ?? false,
    state,
    evidence,
    startedAt: run.startedAt,
    deadline: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
    overdueMs,
    quietMs,
    timeout: run.timeout,
    defaulted: named === null,
    steps,
    newest,
    exited: run.exited,
  };
}

/**
 * The state ladder, in the order the questions are worth asking.
 *
 * Quiet is asked first and answers on its own, which is what makes the deadline advisory rather
 * than load-bearing: a run that finished early is `stopped` before its deadline, and a run that
 * blew through its deadline an hour ago is still not `stopped` while its transcript is moving.
 */
function stateOf(candidate: {
  quietMs: number | null;
  settleMs: number;
  open: boolean;
  run: RunObservation;
  overdueMs: number | null;
}): TeardownState {
  const { quietMs, settleMs, open, run, overdueMs } = candidate;
  if (quietMs !== null && quietMs >= settleMs) return open ? "stopped" : "closed";
  if (run.exited) return "settling";
  if (overdueMs !== null && overdueMs > 0) return "expired";
  return "running";
}

/** The newest artefact by readable timestamp. Unreadable ones are skipped — see {@link Artefact}. */
function newestArtefact(artefacts: readonly Artefact[]): Artefact | null {
  let best: Artefact | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const artefact of artefacts) {
    const ms = msOf(artefact.at);
    if (ms === null || ms < bestMs) continue;
    best = artefact;
    bestMs = ms;
  }
  return best;
}

function orphan(issue: InboxIssue): TeardownVerdict {
  return {
    ref: issue.ref,
    harness: "",
    inboxIssue: issue.number,
    inboxOpen: true,
    state: "orphaned",
    evidence: "none",
    startedAt: "",
    deadline: null,
    overdueMs: null,
    quietMs: null,
    timeout: "",
    defaulted: false,
    steps: [],
    newest: null,
    exited: false,
  };
}

export interface TeardownTally {
  readonly runs: number;
  readonly running: number;
  /** Past the deadline and owed a stop. */
  readonly expired: number;
  readonly settling: number;
  /** Verified down, and owed only the close. */
  readonly closable: number;
  readonly closed: number;
  readonly orphans: number;
  /** Runs whose state rests on something other than an artefact. The criterion, counted. */
  readonly unverified: number;
}

export function tallyTeardown(teardown: Teardown): TeardownTally {
  const by = (state: TeardownState): number => teardown.verdicts.filter((verdict) => verdict.state === state).length;
  return {
    runs: teardown.verdicts.filter((verdict) => verdict.state !== "orphaned").length,
    running: by("running"),
    expired: by("expired"),
    settling: by("settling"),
    closable: by("stopped"),
    closed: by("closed"),
    orphans: by("orphaned"),
    unverified: teardown.verdicts.filter(
      (verdict) => verdict.state !== "orphaned" && verdict.evidence !== "artefact",
    ).length,
  };
}

/**
 * Every way a teardown tick can be wrong, as a closed set.
 *
 * Nothing here fires for a run that is simply inside its deadline, or one already torn down and
 * closed. Those are the fleet working, and a check that goes red for the normal state is a check
 * somebody mutes — taking the real ones with it.
 */
export const TEARDOWN_REFUSALS = [
  /** It claimed to exit and an artefact kept moving. The failure #77 was opened for. */
  "exit-without-quiet",
  /** Nothing was observed, so teardown cannot be verified and nothing here will close the issue. */
  "unwitnessed-teardown",
  /** Well past its deadline and still writing: the timeout is not being enforced by anything. */
  "teardown-stuck",
  /** An open inbox issue with no run. Re-dispatched on the next poll — see the header. */
  "orphaned-inbox-issue",
  /** A run whose ref names no inbox issue, so teardown's last step has no target. */
  "run-without-inbox-issue",
  /** `timeout:` was given and is not a Go duration, so the run is on a deadline it does not name. */
  "timeout-not-a-duration",
  /** No enforceable deadline: `startedAt` did not parse, or it is after the tick's own clock. */
  "deadline-unreachable",
  /** The same ref twice in the run feed: two dumps concatenated, and the second dropped. */
  "duplicate-run",
  /** `at` did not parse, so nothing was decided at all. */
  "clock-unreadable",
] as const;

export type TeardownRefusal = (typeof TEARDOWN_REFUSALS)[number];

export interface TeardownProblem {
  readonly reason: TeardownRefusal;
  readonly message: string;
  /** The ref it is about, or `null` for a whole-tick problem. */
  readonly ref: string | null;
}

export function checkTeardown(teardown: Teardown): readonly TeardownProblem[] {
  const problems: TeardownProblem[] = [];
  const say = (reason: TeardownRefusal, ref: string | null, message: string): void => {
    problems.push({ reason, message, ref });
  };

  const now = msOf(teardown.at);
  if (now === null) {
    say(
      "clock-unreadable",
      null,
      `'${teardown.at}' is not a timestamp, so no run was decided — every state here is arithmetic ` +
        "against the clock and there is nothing to substitute for it",
    );
    return problems;
  }

  for (const verdict of teardown.verdicts) {
    // Exclusive by construction: `exit-without-quiet` is the measured case and
    // `unwitnessed-teardown` the unmeasured one. Both would print one wedged run as two unrelated
    // red lines, which is the confusion `automerge-on` avoids in the supervision tick.
    if (verdict.state === "settling" && verdict.evidence === "artefact") {
      const path = verdict.newest?.path ?? "an artefact";
      say(
        "exit-without-quiet",
        verdict.ref,
        `the harness reported it exited and ${path} changed ${span(verdict.quietMs)} ago — the run is ` +
          "still writing, so its inbox issue stays open",
      );
    } else if (verdict.state !== "running" && verdict.state !== "orphaned" && verdict.evidence !== "artefact") {
      say(
        "unwitnessed-teardown",
        verdict.ref,
        "no artefact was observed for this run, so its teardown cannot be verified — an exit code is " +
          "the run's own account of itself and this command does not close an issue on one",
      );
    }

    if (
      verdict.overdueMs !== null &&
      verdict.overdueMs >= teardown.stuckMs &&
      (verdict.state === "expired" || verdict.state === "settling")
    ) {
      say(
        "teardown-stuck",
        verdict.ref,
        `${span(verdict.overdueMs)} past its own deadline and not yet still — whatever should be ` +
          "enforcing the timeout is not",
      );
    }

    if (verdict.state === "orphaned") {
      say(
        "orphaned-inbox-issue",
        verdict.ref,
        `inbox issue #${String(verdict.inboxIssue ?? 0)} is open and no run claims it — the next poll ` +
          "re-dispatches it; close it or find the run, but this command will not guess which",
      );
    } else if (verdict.inboxIssue === null) {
      say(
        "run-without-inbox-issue",
        verdict.ref,
        "no inbox issue mirrors this ref, so teardown has nothing to close — the run was launched " +
          "outside the pipeline, or the inbox projection does not cover it",
      );
    }

    if (verdict.timeout !== "" && verdict.defaulted) {
      say(
        "timeout-not-a-duration",
        verdict.ref,
        `'timeout: ${verdict.timeout}' is not a Go duration, so it was discarded and the run is on ` +
          `the ${DEFAULT_TIMEOUT} default — the block does not say what it does`,
      );
    }

    // Two shapes, one meaning: this run's deadline never arrives. A start that did not parse gives
    // no deadline at all; a start after the tick's own clock gives one that recedes as fast as the
    // clock moves. Both are silent — the run simply stays `running` for as long as anyone looks.
    if (verdict.state !== "orphaned") {
      const startedMs = msOf(verdict.startedAt);
      if (verdict.overdueMs === null) {
        say(
          "deadline-unreachable",
          verdict.ref,
          `'${verdict.startedAt}' is not a timestamp, so this run has no deadline and will never ` +
            "expire on its own",
        );
      } else if (startedMs !== null && startedMs > now) {
        say(
          "deadline-unreachable",
          verdict.ref,
          `it starts ${span(startedMs - now)} from now — the clocks disagree, and a deadline in the ` +
            "future of the tick that checks it is one nothing ever reaches",
        );
      }
    }
  }

  for (const ref of teardown.duplicates) {
    say("duplicate-run", ref, "listed more than once in the run feed — the first won and the rest were dropped");
  }

  return problems;
}

const STATE_TEXT: Readonly<Record<TeardownState, string>> = {
  running: "inside its deadline",
  expired: "past its deadline and still writing — stop it",
  settling: "reported an exit; its artefacts have not stopped moving",
  stopped: "every artefact still for the settle window — close the inbox issue",
  closed: "still, and the inbox issue is closed — teardown is complete",
  orphaned: "an open inbox issue with no run behind it",
};

export const describeTeardownState = (state: TeardownState): string => STATE_TEXT[state];

const EVIDENCE_TEXT: Readonly<Record<TeardownEvidence, string>> = {
  artefact: "a file the run writes, measured",
  claim: "the run's own report that it exited, which decides nothing here",
  none: "nothing was observed",
};

export const describeTeardownEvidence = (evidence: TeardownEvidence): string => EVIDENCE_TEXT[evidence];

export const describeTeardownProblem = (problem: TeardownProblem): string =>
  problem.ref === null ? problem.message : `${problem.ref}: ${problem.message}`;

/**
 * A span, for reading rather than for arithmetic.
 *
 * Two units at most and never a bare millisecond count: the numbers here are hours and minutes, and
 * "13500000ms" is a figure a reader has to do long division on before it means anything.
 */
export function span(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${String(Math.floor(hours / 24))}d ${String(hours % 24).padStart(2, "0")}h`;
}
