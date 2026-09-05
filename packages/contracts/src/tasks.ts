/**
 * A task on the wire, and the vocabulary a client reads off it.
 *
 * ## The server classifies, the client counts
 *
 * Every derived judgement a client would otherwise have to make itself is carried on the task: the
 * `phase` it sits in, and the `bucket` it counts as. Both are computed by the projection, which is
 * pure and deterministic and already has to get them right.
 *
 * The alternative — ship the raw labels and let each cockpit derive — puts two independent
 * reimplementations of the projector in front of the same board, and they will disagree. That is
 * not hypothetical: the projector's own counter once computed "work in progress" as the remainder
 * after the buckets it knew about, and reported `60 running` on a board with two agents running.
 * A rule that subtle, reimplemented twice by hand in two UI codebases, is wrong twice.
 *
 * What is left for the client is arithmetic and grouping. Counting a field that is already decided
 * cannot drift, and — the reason it matters on the wire — it stays correct under deltas: a task that
 * carries its own bucket updates the count correctly when it is replaced on its own, with no
 * recount of anything else and no round trip.
 *
 * ## What this file does not define
 *
 * The phase *list*. `Lifecycle` is a shape, and the phases travel on the snapshot as data, so a
 * cockpit draws the columns the server actually has rather than the columns it was compiled with.
 *
 * That is deliberate to the point of being the whole point. The board's default lifecycle and the
 * labels `dsh-forge` stamps are two lists that must agree, they drifted once, and the drift was
 * silent: every correctly labelled item read as "no status" and a freshly filled board reported
 * itself empty. `scripts/check-lifecycle.mjs` exists to compare exactly those two. A third copy
 * here — published, versioned, and compiled into two clients on their own release cadence — would
 * be the one copy nothing can check and the hardest one to correct once shipped.
 */

/** Whether an item is an issue or a pull request. The same numbering space holds both. */
export const ITEM_KINDS = ["issue", "pull-request"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Open or closed, as GitHub reports it. Closed is not the same as delivered — see `bucket`. */
export const TASK_STATES = ["open", "closed"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/**
 * One column of the board, and the label that puts an item in it.
 *
 * `terminal` and `queued` are the two facts a renderer needs beyond the name: the first says the
 * work is finished and should stop drawing attention, the second says nothing has started. They are
 * properties of the phase rather than a list of names held by the client, so a repository whose
 * first column is called `inbox` renders truthfully without being recognised by name anywhere.
 */
export interface Phase {
  /** The label that assigns this phase, e.g. `status:impl`. */
  readonly label: string;
  /** Short human name for the column header, e.g. `impl`. */
  readonly name: string;
  readonly terminal: boolean;
  readonly queued: boolean;
}

/** An ordered lifecycle. Order is column order, left to right. */
export interface Lifecycle {
  readonly prefix: string;
  readonly phases: readonly Phase[];
}

/**
 * The bucket a task counts as.
 *
 * Closed rather than open, unlike most vocabularies on this wire, because the rule that decides
 * which vocabularies close is what an unknown value would do to the reader: an unrecognised
 * anomaly kind is a new name to display, while an unrecognised bucket is a count that is quietly
 * wrong. Every value here changes a number on screen.
 *
 * The seven are exhaustive by construction — every task lands in exactly one and they sum to the
 * total. `invisible` is a task the board cannot see at all (no status label), `abandoned` a pull
 * request closed without landing, and `unknown` a terminal pull request whose merge state nobody
 * reported. Those last two are kept apart from `shipped` because "we do not know whether this
 * landed" and "this landed" are the two claims a delivery report exists to keep apart.
 */
export const PROGRESS_BUCKETS = [
  "shipped",
  "inFlight",
  "queued",
  "blocked",
  "invisible",
  "abandoned",
  "unknown",
] as const;
export type ProgressBucket = (typeof PROGRESS_BUCKETS)[number];

/** Membership test for `progressOf`. A `Set`, so a nonsense bucket cannot find a prototype method. */
const KNOWN_BUCKETS: ReadonlySet<string> = new Set(PROGRESS_BUCKETS);

/**
 * Aggregate progress over a set of tasks.
 *
 * The buckets sum to `total`. That is an invariant rather than a coincidence, and it is the reason
 * this tiny function is in the contract instead of in each client: a counter that cannot say
 * "waiting" or "unknown" says "running" instead, and "running" is the one word the whole projection
 * exists to make trustworthy.
 */
export interface Progress {
  readonly total: number;
  readonly shipped: number;
  /** Work something could be acting on right now. */
  readonly inFlight: number;
  /** Filed, but nothing has started. */
  readonly queued: number;
  readonly blocked: number;
  /** Tasks with no status label: real work the board cannot see. */
  readonly invisible: number;
  /** Pull requests closed without landing. Finished, but not delivered. */
  readonly abandoned: number;
  /** Terminal pull requests whose merge state nobody reported. Not a delivery, not a failure. */
  readonly unknown: number;
}

/**
 * Count a set of tasks by the bucket each one carries.
 *
 * A bucket this version does not recognise is counted as `unknown` rather than dropped. Dropping it
 * would break the sum, which is the one property this function promises, and an unrecognised
 * classification is honestly `unknown` — a client built against an older contract than the server
 * should under-claim, never mis-count.
 */
export function progressOf(tasks: readonly TaskView[]): Progress {
  const counts: Record<ProgressBucket, number> = {
    shipped: 0,
    inFlight: 0,
    queued: 0,
    blocked: 0,
    invisible: 0,
    abandoned: 0,
    unknown: 0,
  };
  for (const task of tasks) {
    const bucket: ProgressBucket = KNOWN_BUCKETS.has(task.bucket) ? task.bucket : "unknown";
    counts[bucket] += 1;
  }
  return { total: tasks.length, ...counts };
}

/**
 * A task as published.
 *
 * Deliberately flat. The projection nests the GitHub fields under a `source` object and carries the
 * phase as a lookup; that is its internal shape, and a client that had to know it would be coupled
 * to a private package it cannot import. Flattening here is the adapter's job, once, on the server.
 *
 * `epic` is the node this task is drawn under, already resolved — including the case where two epic
 * issues claim one slug and the loser is drawn under a qualified name of its own. Grouping on the
 * wire is therefore a plain `group by`, and the rule that decides the contested slug stays in the
 * projector where it is tested.
 */
export interface TaskView {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly kind: ItemKind;
  readonly state: TaskState;
  /** The column this task sits in, or `null` when it carries no status label. */
  readonly phase: Phase | null;
  /** The server's classification. See `progressOf`. */
  readonly bucket: ProgressBucket;
  readonly milestone: string | null;
  /** The epic node this task belongs under, or `null` for a task claiming none. */
  readonly epic: string | null;
  readonly lane: string | null;
  readonly priority: string | null;
  readonly type: string | null;
  readonly assignees: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** True for the issue that *is* an epic, so a client does not file it as a task under itself. */
  readonly isEpic: boolean;
  /** Pull requests only: whether it is a draft. */
  readonly draft?: boolean;
  /** Pull requests only: whether it landed. Absent means nobody reported it, never "no". */
  readonly merged?: boolean;
  /** Pull requests only: the issues this one closes, when the projection could resolve them. */
  readonly closes?: readonly number[];
}

/**
 * One thing wrong with the board.
 *
 * `kind` is a plain string, and that is the deliberate half of this type. The vocabulary belongs to
 * the projector, which grows it as it learns to detect more; a published contract that closed it
 * would turn every new detection into a parse failure in a deployed Expo build that cannot be
 * updated in step. A client renders an unrecognised kind by its `detail`, which is written to be
 * read.
 *
 * `item` is `null` for an anomaly about the projection itself rather than about any one task — a
 * truncated fetch is the case that exists today.
 */
export interface BoardAnomaly {
  readonly kind: string;
  readonly item: number | null;
  readonly detail: string;
}
