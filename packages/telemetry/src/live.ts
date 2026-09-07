/**
 * The observability log, read back.
 *
 * `record` has been writing this file since #83 and nothing has ever read it. That gap is not a
 * missing feature, it is the reason `status` cannot answer the question it exists for: the Claude
 * store and the opencode store write no completion marker at all, so their readers report
 * `outcome: "unknown"` for every run they recover, finished or wedged or dead. See the comment at
 * `backfill/claude.ts` — reporting `unknown` there is the honest reading of a transcript, and it is
 * also useless to an operator asking whether the fleet is still working.
 *
 * Something on the box does know. The wrapper that launched the run, the shell hook that saw it
 * exit, the dispatcher that timed it out — each of them can append one line, and each of them is
 * writing to this log already. So the fix is not a better transcript parser. It is to read the log
 * back and let a first-hand statement fill in what a transcript cannot say.
 *
 * Three rules keep that from turning into a second, worse source of truth:
 *
 * 1. The merge is keyed by run id, so it is idempotent by construction. Replaying the whole log
 *    over an already-merged set changes nothing, which is the property #86 asks for and the reason
 *    a crashed coordinator can simply re-read everything on the way back up.
 * 2. A live outcome fills in a transcript that could not say, and never overrules one that could.
 *    `complete` and `failed` on disk are vendor assertions about a file the vendor wrote; a hook's
 *    opinion does not outrank them.
 * 3. A live-only run with no stated seam is counted and named, never invented. `RunSource` carries
 *    governance meaning — two of its three values are subscription seams with a window that can be
 *    exhausted — so guessing at one would put a fabricated fact into a quota report.
 * 4. A dispatch is not yet a run. A `refused` verdict with no transcript behind it is counted and
 *    named like rule 3, not turned into a row: a refused dispatch launched nothing, and a board
 *    that shows it as an agent is inventing one. `accepted`, `unknown` and a dispatch that died
 *    before any verdict all still become rows — an agent may be running somewhere, and that is
 *    exactly what the pre-dispatch line exists to preserve.
 *
 * Nothing here reads a clock or an environment variable; `readLiveLog` takes the paths and the
 * reference time, the same way the backfill readers do.
 */

import { readFile } from "node:fs/promises";

import type {
  IssueEvidence,
  IssueLink,
  LaunchIdentity,
  RunOutcome,
  RunRecord,
  RunSource,
} from "./model.js";
import { linkedIssuesOf } from "./model.js";
import { EVENT_NOTE_CAP, parseEvents } from "./observability.js";
import { compareStrings } from "./order.js";
import type { TelemetryEvent } from "./sink.js";

/** One log file that was read, with the events it held, in the order they appeared. */
export interface LiveFile {
  readonly path: string;
  readonly events: readonly TelemetryEvent[];
}

export interface LiveLog {
  /** In the order the paths were given: `logPaths` hands over the live file, then older ones. */
  readonly files: readonly LiveFile[];
  readonly notes: readonly string[];
  /** True when the log no longer says exactly what was written to it. */
  readonly degraded: boolean;
}

/**
 * Read the live log and the generations behind it.
 *
 * A missing file is not an error and not a note: `logPaths` names every generation the policy
 * allows, and a box that has not filled one yet is the ordinary case. A file that exists and will
 * not open is degradation — that is telemetry this command was supposed to see and did not.
 */
export async function readLiveLog(paths: readonly string[], now: string): Promise<LiveLog> {
  const files: LiveFile[] = [];
  const parseNotes: string[] = [];
  const notes: string[] = [];
  let unreadable = 0;

  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      unreadable += 1;
      continue;
    }
    const parsed = parseEvents(text, now);
    files.push({ path, events: parsed.events });
    parseNotes.push(...parsed.notes);
  }

  if (unreadable > 0) {
    // No path in the note. It names a home directory, and notes are printed and published — the
    // same rule the transcript scan follows.
    notes.push(`live log: ${unreadable} file(s) exist but could not be read`);
  }
  // Line-level notes are capped the way `parseEvents` caps its own: naming five is diagnosis, and
  // naming five hundred is a second outage. Every one of them means a line was dropped or a
  // timestamp was substituted, and either way the log has stopped saying what was written to it.
  for (const note of parseNotes.slice(0, EVENT_NOTE_CAP)) notes.push(`live log: ${note}`);
  if (parseNotes.length > EVENT_NOTE_CAP) {
    notes.push(`live log: ${parseNotes.length - EVENT_NOTE_CAP} more line-level note(s)`);
  }

  return { files, notes, degraded: unreadable > 0 || parseNotes.length > 0 };
}

/**
 * What the log says about one run, folded out of its events.
 *
 * Every field is `null` until some event states it, and a run that states nothing beyond its own id
 * still folds — the count of events is itself a fact, and it is what lets the merge report a
 * live-only run it refused to synthesise.
 */
export interface LiveRun {
  readonly id: string;
  readonly source: RunSource | null;
  readonly parentId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly branch: string | null;
  readonly identity: LaunchIdentity;
  readonly outcome: RunOutcome | null;
  readonly linkedIssues: readonly IssueLink[];
  /**
   * What the last dispatch line said about whether this id became a run at all.
   *
   * `null` for a run nothing dispatched through an instrumented seam, which is most of them — a
   * transcript recovered off disk says nothing about a dispatch. Only a `subagent.dispatch` line can
   * set it; see `DISPATCH_KIND` for why a steer's verdict is not this one.
   */
  readonly verdict: LiveDispatchVerdict | null;
  /** The newest log file that carried a line for this run — the one to open. */
  readonly origin: string;
  readonly events: number;
}

/**
 * The three things a writer can say about a dispatch.
 *
 * A local mirror of `DispatchVerdict` in `@rickylabs/subagents`, spelled out here rather than
 * imported, because this package has no workspace dependencies and importing the provider contract
 * would make the observability log a subagent-only log. The union is validated the way `source` and
 * `outcome` are: a word this reader does not know is not read, so a fourth verdict appearing
 * upstream degrades to "said nothing" rather than to a wrong answer.
 */
export type LiveDispatchVerdict = "accepted" | "refused" | "unknown";

/**
 * The one event kind whose `verdict` is about whether a run exists.
 *
 * Four of the instrument's five verbs write a `verdict` detail, and three of those unions also spell
 * `refused` — `SteerVerdict` and `StopVerdict` both carry it. A steer the provider refused is a
 * statement about one message, not about the run: reading `verdict` off any kind would let a refused
 * steer erase a run that had been happily working for an hour, which is the same class of mistake
 * this rule exists to prevent, pointed the other way.
 *
 * A literal rather than an import, for the reason `LiveDispatchVerdict` is a local mirror. A kind is
 * a free string on the sink, so this name is a convention both sides have to keep; the fallback if
 * `dsh-app` ever renames it is that no verdict is read at all, and every dispatch becomes a row —
 * the behaviour before this rule, which is over- rather than under-reporting.
 */
const DISPATCH_KIND = "subagent.dispatch";

const SOURCES: ReadonlySet<string> = new Set<RunSource>(["claude", "codex", "opencode"]);
const VERDICTS: ReadonlySet<string> = new Set<LiveDispatchVerdict>([
  "accepted",
  "refused",
  "unknown",
]);
const OUTCOMES: ReadonlySet<string> = new Set<RunOutcome>([
  "running",
  "complete",
  "failed",
  "unknown",
]);

/**
 * The detail keys this module reads.
 *
 * The sink is a pipe, not a schema authority, so an event may carry anything; this is the subset
 * that means something here, and every other key is left alone. The names match `RunRecord`'s own
 * fields in the envelope's own camelCase, because a writer already spells `runId` that way and a
 * second spelling is a second thing to get wrong.
 */
const DETAIL_KEYS = [
  "source",
  "outcome",
  "verdict",
  "parentId",
  "branch",
  "model",
  "effort",
  "provider",
  "profile",
] as const;

function detailString(event: TelemetryEvent, key: (typeof DETAIL_KEYS)[number]): string | null {
  const value = event.detail?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

interface Stated<T> {
  readonly value: T;
  readonly order: number;
}

/** Last statement wins. A run's model can legitimately change mid-run — that is what fallback is. */
function state<T>(held: Stated<T> | null, value: T | null, order: number): Stated<T> | null {
  if (value === null) return held;
  return held === null || order >= held.order ? { value, order } : held;
}

const time = (stamp: string): number => Date.parse(stamp);

function earlier(a: string, b: string): string {
  const x = time(a);
  const y = time(b);
  if (!Number.isFinite(x)) return b;
  if (!Number.isFinite(y)) return a;
  return x <= y ? a : b;
}

function later(a: string, b: string): string {
  const x = time(a);
  const y = time(b);
  if (!Number.isFinite(x)) return b;
  if (!Number.isFinite(y)) return a;
  return x >= y ? a : b;
}

interface Fold {
  source: Stated<RunSource> | null;
  verdict: Stated<LiveDispatchVerdict> | null;
  parentId: Stated<string> | null;
  branch: Stated<string> | null;
  model: Stated<string> | null;
  effort: Stated<string> | null;
  provider: Stated<string> | null;
  profile: Stated<string> | null;
  outcome: Stated<RunOutcome> | null;
  startedAt: string;
  updatedAt: string;
  origin: string;
  events: number;
}

/**
 * Fold a log into one record per run id.
 *
 * Events are put in time order first, because a log is not sorted: the live file holds the newest
 * lines and the generations behind it hold older ones, and two writers appending concurrently
 * interleave within a single file. Ties on the timestamp are broken by position — an older
 * generation before a newer one, and an earlier line before a later one in the same file — so
 * "the last thing said about this run" is a total order and not a coin flip.
 */
export function foldLiveEvents(files: readonly LiveFile[]): readonly LiveRun[] {
  const ordered: { event: TelemetryEvent; path: string; ms: number; rank: number }[] = [];
  for (const [rank, file] of files.entries()) {
    for (const event of file.events) {
      const ms = time(event.at);
      // A stamp `parseEvents` could not read was already replaced with the reference time, so an
      // unparseable one here means the caller's own reference time is not a time. Those sort first:
      // a line that cannot say when it happened cannot be the last word about anything.
      ordered.push({ event, path: file.path, rank, ms: Number.isFinite(ms) ? ms : -Infinity });
    }
  }
  // `Array.prototype.sort` is stable, so lines within one file keep their order and only the
  // cross-file tie needs deciding: a higher index in `files` is an older generation.
  ordered.sort((a, b) => a.ms - b.ms || b.rank - a.rank);

  const folds = new Map<string, Fold>();
  for (const [order, { event, path }] of ordered.entries()) {
    const id = event.runId;
    const held = folds.get(id);
    const fold: Fold = held ?? {
      source: null,
      verdict: null,
      parentId: null,
      branch: null,
      model: null,
      effort: null,
      provider: null,
      profile: null,
      outcome: null,
      startedAt: event.at,
      updatedAt: event.at,
      origin: path,
      events: 0,
    };

    const rawSource = detailString(event, "source");
    const rawOutcome = detailString(event, "outcome");
    const rawVerdict = event.kind === DISPATCH_KIND ? detailString(event, "verdict") : null;
    fold.source = state(fold.source, SOURCES.has(rawSource ?? "") ? (rawSource as RunSource) : null, order);
    fold.outcome = state(
      fold.outcome,
      OUTCOMES.has(rawOutcome ?? "") ? (rawOutcome as RunOutcome) : null,
      order,
    );
    // Last statement wins, the same as every other field, but only among dispatch lines. A refused
    // dispatch retried under the same id is the case that needs it: the second line's `accepted` has
    // to overwrite the first line's `refused`, or a run that really launched stays invisible.
    fold.verdict = state(
      fold.verdict,
      VERDICTS.has(rawVerdict ?? "") ? (rawVerdict as LiveDispatchVerdict) : null,
      order,
    );
    fold.parentId = state(fold.parentId, detailString(event, "parentId"), order);
    fold.branch = state(fold.branch, detailString(event, "branch"), order);
    fold.model = state(fold.model, detailString(event, "model"), order);
    fold.effort = state(fold.effort, detailString(event, "effort"), order);
    fold.provider = state(fold.provider, detailString(event, "provider"), order);
    fold.profile = state(fold.profile, detailString(event, "profile"), order);
    fold.startedAt = earlier(fold.startedAt, event.at);
    fold.updatedAt = later(fold.updatedAt, event.at);
    // Ordered ascending, so the last file to mention this run is the newest one that did.
    fold.origin = path;
    fold.events += 1;
    folds.set(id, fold);
  }

  const runs: LiveRun[] = [];
  for (const [id, fold] of folds) {
    const branch = fold.branch?.value ?? null;
    runs.push({
      id,
      source: fold.source?.value ?? null,
      parentId: fold.parentId?.value ?? null,
      startedAt: fold.startedAt,
      updatedAt: fold.updatedAt,
      branch,
      identity: {
        model: fold.model?.value ?? null,
        effort: fold.effort?.value ?? null,
        provider: fold.provider?.value ?? null,
        profile: fold.profile?.value ?? null,
      },
      outcome: fold.outcome?.value ?? null,
      verdict: fold.verdict?.value ?? null,
      // The same rule the transcript readers use, and deliberately no second class of evidence: a
      // branch name is the dispatcher's own statement about what a run is for.
      linkedIssues: linkedIssuesOf(branch, null),
      origin: fold.origin,
      events: fold.events,
    });
  }
  runs.sort((a, b) => compareStrings(a.id, b.id));
  return runs;
}

export interface LiveMerge {
  readonly runs: readonly RunRecord[];
  readonly notes: readonly string[];
  readonly degraded: boolean;
}

/** An outcome the transcript itself asserted. A first-hand statement does not overrule these. */
const TERMINAL: ReadonlySet<RunOutcome> = new Set<RunOutcome>(["complete", "failed"]);

function unionIssues(
  a: readonly IssueLink[],
  b: readonly IssueLink[],
): readonly IssueLink[] {
  const found = new Map<number, IssueEvidence>();
  for (const link of [...a, ...b]) {
    const seen = found.get(link.number);
    // Path beats prose wherever the two disagree, exactly as `linkedIssuesOf` decides it within one
    // source. Collapsing that here would undo the distinction at the last place it is still known.
    if (seen === undefined || (seen === "prose" && link.from === "path")) {
      found.set(link.number, link.from);
    }
  }
  return [...found].map(([number, from]) => ({ number, from })).sort((x, y) => x.number - y.number);
}

function fill(disk: RunRecord, live: LiveRun): RunRecord {
  const identity: LaunchIdentity = {
    model: disk.identity.model ?? live.identity.model,
    effort: disk.identity.effort ?? live.identity.effort,
    provider: disk.identity.provider ?? live.identity.provider,
    profile: disk.identity.profile ?? live.identity.profile,
  };
  return {
    ...disk,
    startedAt: earlier(disk.startedAt, live.startedAt),
    updatedAt: later(disk.updatedAt, live.updatedAt),
    branch: disk.branch ?? live.branch,
    parentId: disk.parentId ?? live.parentId,
    identity,
    outcome:
      live.outcome !== null && !TERMINAL.has(disk.outcome) ? live.outcome : disk.outcome,
    linkedIssues: unionIssues(disk.linkedIssues, live.linkedIssues),
    // `origin` stays the transcript. `why` exists to hand an operator the file that explains the
    // run, and a transcript explains more than a line of JSON does.
  };
}

/**
 * Merge what the log says into what the transcripts say.
 *
 * Idempotent by construction: the result is a function of the two sets and not of how many times
 * either was applied, so re-reading the whole log over an already-merged view is a no-op. That is
 * the criterion #86 states, and it is also what makes recovery after a crash trivial — there is no
 * ingestion cursor to keep, and nothing to be lost by losing one.
 *
 * A run id can appear more than once on disk, because a run id is a vendor session id and two
 * transcript files can carry the same one. Every record sharing an id is merged, rather than the
 * first one found: the log's statement is about the session, and both records are that session.
 */
export function mergeLiveRuns(
  disk: readonly RunRecord[],
  live: readonly LiveRun[],
): LiveMerge {
  const positions = new Map<string, number[]>();
  disk.forEach((run, index) => {
    const seen = positions.get(run.id);
    if (seen === undefined) positions.set(run.id, [index]);
    else seen.push(index);
  });

  const runs = [...disk];
  const notes: string[] = [];
  // Runs, not records. One session read from several transcripts is several records, and one live
  // statement about it resolves all of them at once — counting the writes would report that single
  // statement as a dozen, which is the note claiming more knowledge than the log supplied.
  const resolved = new Set<string>();
  let added = 0;
  let anonymous = 0;
  let refused = 0;

  for (const run of live) {
    const at = positions.get(run.id);
    if (at !== undefined) {
      for (const index of at) {
        const before = runs[index] as RunRecord;
        const after = fill(before, run);
        if (before.outcome !== after.outcome) resolved.add(run.id);
        runs[index] = after;
      }
      continue;
    }
    // A dispatch the provider refused never became a run, and there is no transcript above to say
    // otherwise. Synthesising a row for it is the instrument's own stated gap — *"the fold has no
    // idea a dispatch is not yet a run"* — and it is a fabricated agent on the board, which is the
    // one thing this package must never produce. Counted rather than dropped: a refused dispatch is
    // a real event an operator may well be looking for, and it is not degradation.
    //
    // Checked ahead of the seam question deliberately. A refused dispatch that named no seam is not
    // an under-reported run, so counting it as one would raise `degraded` on a log that is fine.
    if (run.verdict === "refused") {
      refused += 1;
      continue;
    }
    if (run.source === null) {
      // Counted, named, and not invented. `RunSource` says which subscription window a run drew
      // from; a guess here becomes a wrong answer to "why is nothing running".
      anonymous += 1;
      continue;
    }
    added += 1;
    runs.push({
      id: run.id,
      source: run.source,
      parentId: run.parentId,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      branch: run.branch,
      identity: run.identity,
      // The log carries no accounting. An empty usage is "nothing was reported", which is true.
      usage: {},
      outcome: run.outcome ?? "unknown",
      linkedIssues: run.linkedIssues,
      origin: run.origin,
      quota: [],
    });
  }

  if (resolved.size > 0) {
    notes.push(
      `live log: outcome supplied for ${resolved.size} run(s) whose transcript could not say`,
    );
  }
  if (added > 0) {
    notes.push(`live log: ${added} run(s) known only to the log, with no transcript on this box`);
  }
  if (refused > 0) {
    notes.push(`live log: ${refused} dispatch(es) the provider refused — never became a run`);
  }
  if (anonymous > 0) {
    notes.push(
      `live log: ${anonymous} run(s) named no seam and were left out — add "source" to the event`,
    );
  }

  // The order the scan promises: newest activity first, ties broken by id so two runs updated in
  // the same millisecond do not swap places between snapshots.
  runs.sort((a, b) => compareStrings(b.updatedAt, a.updatedAt) || compareStrings(a.id, b.id));
  return { runs, notes, degraded: anonymous > 0 };
}
