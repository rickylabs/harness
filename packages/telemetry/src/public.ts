/**
 * What leaves this machine.
 *
 * `--json` output is piped into other tools, pasted into issues and consumed by the board
 * projection, so it is a published surface and not a debug dump. Two things follow.
 *
 * First, every field is listed by hand. `JSON.stringify(record)` publishes whatever the record
 * happens to carry, which means the next field someone adds to `RunRecord` is published the moment
 * it exists, by nobody's decision. `RunRecord.origin` is the standing example: it is a path naming
 * a person's home directory, its own doc comment says it "is excluded from every projection meant
 * to leave this machine", and until this module existed nothing excluded it. An allowlist makes
 * that claim true by construction — a new field is absent until someone adds it here.
 *
 * Second, the envelope says whether the answer is complete. A bare array of runs is shaped exactly
 * like complete evidence whether or not the scan that produced it was truncated (finding F-10 on
 * #105), and a machine consumer has no way to tell. `complete` is the same fact the exit status
 * carries, in the form a program reads.
 *
 * `why` is deliberately not projected through here: it is the local operator's command, and its
 * entire job is to hand back the path to open.
 */

import type {
  AttributedRun,
  BoardItemRef,
  EpicActivity,
  IssueLink,
  LaunchIdentity,
  QuotaReading,
  RunOutcome,
  RunRecord,
  RunSource,
  RunUsage,
  TelemetrySnapshot,
} from "./model.js";

/** A run as published: `RunRecord` minus `origin`. */
export interface PublicRun {
  readonly id: string;
  readonly source: RunSource;
  readonly parentId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly branch: string | null;
  readonly identity: LaunchIdentity;
  readonly usage: RunUsage;
  readonly outcome: RunOutcome;
  readonly linkedIssues: readonly IssueLink[];
  readonly quota: readonly QuotaReading[];
}

/**
 * The keys `publicRun` emits, sorted.
 *
 * Exported so the allowlist is checkable rather than merely intended: a test asserts this is
 * exactly what comes out, so adding a field to `RunRecord` without deciding whether it is publishable
 * fails a test instead of shipping.
 */
export const PUBLIC_RUN_KEYS = [
  "branch",
  "id",
  "identity",
  "linkedIssues",
  "outcome",
  "parentId",
  "quota",
  "source",
  "startedAt",
  "updatedAt",
  "usage",
] as const;

export interface PublicAttributedRun {
  readonly run: PublicRun;
  readonly item: BoardItemRef | null;
  readonly children: readonly PublicAttributedRun[];
}

export interface PublicEpic {
  readonly epic: string;
  readonly milestone: string | null;
  readonly runs: readonly PublicAttributedRun[];
}

/** A snapshot as published, with the completeness of the scan that produced it stated on it. */
export interface PublicSnapshot {
  readonly generatedAt: string;
  /** False when a store could not be read or a scan was truncated. See the CLI's exit status 3. */
  readonly complete: boolean;
  readonly epics: readonly PublicEpic[];
  readonly unattributed: readonly PublicAttributedRun[];
  readonly quota: readonly QuotaReading[];
  readonly notes: readonly string[];
}

/** What `runs --json` returns: the same envelope, flat. */
export interface PublicRuns {
  readonly generatedAt: string;
  readonly complete: boolean;
  readonly runs: readonly PublicRun[];
  readonly notes: readonly string[];
}

/** Project one run. Field by field, on purpose — see the module header. */
export function publicRun(run: RunRecord): PublicRun {
  return {
    id: run.id,
    source: run.source,
    parentId: run.parentId,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    branch: run.branch,
    identity: run.identity,
    usage: run.usage,
    outcome: run.outcome,
    linkedIssues: run.linkedIssues,
    quota: run.quota,
  };
}

function publicAttributed(attributed: AttributedRun): PublicAttributedRun {
  return {
    run: publicRun(attributed.run),
    item: attributed.item,
    children: attributed.children.map(publicAttributed),
  };
}

function publicEpic(epic: EpicActivity): PublicEpic {
  return { epic: epic.epic, milestone: epic.milestone, runs: epic.runs.map(publicAttributed) };
}

/** Project a whole snapshot, subagent trees included. */
export function publicSnapshot(snapshot: TelemetrySnapshot, complete: boolean): PublicSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    complete,
    epics: snapshot.epics.map(publicEpic),
    unattributed: snapshot.unattributed.map(publicAttributed),
    quota: snapshot.quota,
    notes: snapshot.notes,
  };
}

/** Project a flat run list into the same envelope. */
export function publicRuns(
  generatedAt: string,
  runs: readonly RunRecord[],
  notes: readonly string[],
  complete: boolean,
): PublicRuns {
  return { generatedAt, complete, runs: runs.map(publicRun), notes };
}
