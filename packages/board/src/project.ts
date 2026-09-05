/**
 * The projection itself: GitHub issues in, board snapshot out, no I/O and no clock.
 *
 * Decision 3 of #30 says GitHub is the truth and dsh projects the live view — "if the projection
 * and the issue disagree, the issue wins". That is not a slogan here, it is the reason this
 * function has no writes in it. Every disagreement it finds becomes an `Anomaly` describing what
 * the issue says; nothing is repaired, reordered into plausibility, or hidden.
 *
 * The same rule governs identity. Where two issues make incompatible claims — two epics answering
 * to one slug, two labels of one family on one item — the projection picks the one it will act on
 * *and reports that it had to pick*. A conflict resolved in silence is indistinguishable from no
 * conflict, which makes the board confidently wrong rather than visibly unsure.
 */

import { DEFAULT_LIFECYCLE, phaseOf, statusLabelsOf, unknownStatusLabels } from "./lifecycle.js";
import type { Lifecycle } from "./lifecycle.js";
import { labelValue, labelValues } from "./model.js";
import { compareStrings } from "./order.js";
import type {
  Anomaly,
  BoardColumn,
  BoardItem,
  BoardSnapshot,
  Completeness,
  SourceIssue,
} from "./model.js";

/** Label families the projector reads. Prefixes are configurable because repos differ. */
export interface ProjectOptions {
  readonly repo: string;
  /** Timestamp recorded on the snapshot. Passed in so the projection stays deterministic. */
  readonly generatedAt: string;
  readonly lifecycle?: Lifecycle;
  /** Prefix for the lane family — `dsh-forge` detects `orchestrator`, `topic`, or `lane`. */
  readonly lanePrefix?: string;
  /** Priority order, most urgent first. Items sort by this within a column. */
  readonly priorityOrder?: readonly string[];
  /**
   * What the caller knows about how much of the board it fetched.
   *
   * Omitted means "no claim made", which is the honest answer for a projection built from a
   * hand-assembled list. It never means complete.
   */
  readonly completeness?: Completeness;
}

/** The default urgency ordering; unlisted priorities sort after all listed ones. */
export const DEFAULT_PRIORITY_ORDER = ["p0", "p1", "p2", "p3"] as const;

/** Label families where a second value on one item is a contradiction, not extra information. */
const SINGLE_VALUE_FAMILIES = ["epic", "priority", "type"] as const;

/** An item is an epic when it carries the `epic` type label or an `epic` bare label. */
const detectIsEpic = (labels: readonly string[]): boolean =>
  labels.includes("epic") || labels.includes("type:epic");

function toItem(source: SourceIssue, lifecycle: Lifecycle, lanePrefix: string): BoardItem {
  return {
    source,
    phase: phaseOf(source.labels, lifecycle),
    epic: labelValue(source.labels, "epic"),
    lane: labelValue(source.labels, lanePrefix),
    priority: labelValue(source.labels, "priority"),
    type: labelValue(source.labels, "type"),
    isEpic: detectIsEpic(source.labels),
  };
}

/** Where the epic issues are, keyed by slug. A slug with several claimants keeps all of them. */
type EpicIndex = ReadonlyMap<string, readonly BoardItem[]>;

function indexEpics(items: readonly BoardItem[]): EpicIndex {
  const index = new Map<string, BoardItem[]>();
  for (const item of items) {
    if (!item.isEpic) continue;
    const slug = item.epic ?? slugOfEpicTitle(item.source.title);
    if (slug === null) continue;
    const found = index.get(slug);
    if (found === undefined) index.set(slug, [item]);
    else found.push(item);
  }
  // Lowest issue number first, so "which epic wins" is a property of the issues rather than of the
  // order the fetch returned them in — and so this agrees with `buildHierarchy`, which makes the
  // same choice.
  for (const claimants of index.values()) claimants.sort((a, b) => a.source.number - b.source.number);
  return index;
}

function anomaliesFor(item: BoardItem, lifecycle: Lifecycle, epics: EpicIndex, lanePrefix: string): readonly Anomaly[] {
  const found: Anomaly[] = [];
  const n = item.source.number;
  const statuses = statusLabelsOf(item.source.labels, lifecycle);

  if (statuses.length > 1) {
    found.push({
      kind: "multiple-status",
      item: n,
      detail: `carries ${statuses.length} status labels (${statuses.join(", ")}); exactly one is allowed`,
    });
  }

  for (const unknown of unknownStatusLabels(item.source.labels, lifecycle)) {
    found.push({
      kind: "unknown-status",
      item: n,
      detail: `status label ${unknown} is not part of this lifecycle`,
    });
  }

  if (statuses.length === 0 && item.source.state === "open") {
    found.push({
      kind: "no-status",
      item: n,
      detail: "open item has no status label, so it appears in no column",
    });
  }

  // Two labels of one family: the projection reads the first, which means the value it acts on
  // depends on the order GitHub happened to return the labels in.
  for (const family of new Set([...SINGLE_VALUE_FAMILIES, lanePrefix])) {
    const values = labelValues(item.source.labels, family);
    if (values.length > 1) {
      found.push({
        kind: "duplicate-label",
        item: n,
        detail:
          `carries ${values.length} ${family}: labels (${values.map((v) => `${family}:${v}`).join(", ")}); ` +
          `the projection reads ${family}:${values[0] ?? ""} and the rest are ignored`,
      });
    }
  }

  if (item.epic !== null && !epics.has(item.epic)) {
    found.push({
      kind: "epic-not-found",
      item: n,
      detail: `labelled epic:${item.epic}, but no open epic issue claims that slug`,
    });
  }

  // A task filed under a different milestone from its own epic. The tree has to put it somewhere,
  // and either choice contradicts one of the two labels, so the disagreement is reported instead.
  const owners = item.epic === null ? [] : (epics.get(item.epic) ?? []);
  const owner = owners[0];
  if (!item.isEpic && owner !== undefined && owner.source.milestone !== item.source.milestone) {
    found.push({
      kind: "epic-milestone-conflict",
      item: n,
      detail:
        `is in milestone ${describeMilestone(item.source.milestone)} but its epic ` +
        `#${owner.source.number} is in ${describeMilestone(owner.source.milestone)}; ` +
        "the epic appears under both",
    });
  }

  // A closed item whose phase is not terminal, and a terminal item still open, are the two ways
  // the column and the issue state can contradict each other. Both are reported against the
  // issue, which is the side that wins.
  if (item.source.state === "closed" && item.phase !== null && !item.phase.terminal) {
    found.push({
      kind: "closed-but-unshipped",
      item: n,
      detail: `closed on GitHub but sits in ${item.phase.name}; the issue wins, the column is stale`,
    });
  }

  if (item.source.state === "open" && item.phase?.terminal === true) {
    found.push({
      kind: "shipped-but-open",
      item: n,
      detail: `sits in ${item.phase.name} but is still open; the issue wins, the column is stale`,
    });
  }

  // Closed is not merged. A pull request that was abandoned reads exactly like one that landed if
  // nobody looks at `mergedAt`, and "shipped" is the single word this whole board exists to get
  // right.
  if (
    item.source.kind === "pull-request" &&
    item.source.state === "closed" &&
    item.source.merged === false
  ) {
    found.push({
      kind: "closed-unmerged",
      item: n,
      detail:
        item.phase?.terminal === true
          ? `sits in ${item.phase.name} but was closed without merging; it did not ship`
          : "was closed without merging; it did not ship",
    });
  }

  return found;
}

const describeMilestone = (name: string | null): string => name ?? "(none)";

/**
 * Project a set of source issues into a board snapshot.
 *
 * Ordering is total and derived only from the inputs: phase order, then priority, then issue
 * number. Two runs over the same issues produce byte-identical snapshots, which is what makes a
 * diff of two snapshots meaningful and what #36 means by persisting decisions rather than
 * outcomes.
 */
export function projectBoard(
  issues: readonly SourceIssue[],
  options: ProjectOptions,
): BoardSnapshot {
  const lifecycle = options.lifecycle ?? DEFAULT_LIFECYCLE;
  const lanePrefix = options.lanePrefix ?? "lane";
  const priorityOrder = options.priorityOrder ?? DEFAULT_PRIORITY_ORDER;

  const items = issues.map((issue) => toItem(issue, lifecycle, lanePrefix));
  const epics = indexEpics(items);

  const rank = (item: BoardItem): number => {
    const index = item.priority === null ? -1 : priorityOrder.indexOf(item.priority);
    return index === -1 ? priorityOrder.length : index;
  };
  const ordered = [...items].sort(
    (a, b) => rank(a) - rank(b) || a.source.number - b.source.number,
  );

  const columns: BoardColumn[] = lifecycle.phases.map((phase) => ({
    phase,
    items: ordered.filter((item) => item.phase?.label === phase.label),
  }));

  const anomalies: Anomaly[] = [];

  // Board-level anomalies first: they are about whether the rest of the report can be trusted at
  // all, and belong above the item-level detail rather than sorted in among it.
  const completeness = options.completeness ?? null;
  if (completeness !== null && completeness.capped.length > 0) {
    anomalies.push({
      kind: "incomplete-fetch",
      item: null,
      detail:
        `the fetch was capped at ${completeness.limit} per kind and ` +
        `${completeness.capped.join(" and ")} came back exactly at the cap, so this board is a ` +
        "prefix of the real one — raise --limit before trusting anything absent from it",
    });
  }

  for (const [slug, claimants] of [...epics].sort(([a], [b]) => compareStrings(a, b))) {
    const winner = claimants[0];
    if (claimants.length < 2 || winner === undefined) continue;
    const others = claimants.slice(1).map((c) => `#${c.source.number}`).join(", ");
    anomalies.push({
      kind: "duplicate-epic-slug",
      item: winner.source.number,
      detail:
        `${claimants.length} epic issues claim the slug ${slug}; tasks labelled epic:${slug} are ` +
        `all grouped under #${winner.source.number} and ${others} are drawn with no tasks of ` +
        "their own, whatever they were opened to hold",
    });
  }

  for (const item of ordered) {
    anomalies.push(...anomaliesFor(item, lifecycle, epics, lanePrefix));
  }

  return {
    repo: options.repo,
    generatedAt: options.generatedAt,
    columns,
    unphased: ordered.filter((item) => item.phase === null),
    anomalies,
    items: ordered,
    completeness,
  };
}

/**
 * Best-effort epic slug from a title like `E6 — Coordinator: ...`, matching the identifier rule
 * `dsh-forge` uses so the two agree on what an epic is called.
 */
export function slugOfEpicTitle(title: string): string | null {
  const cleaned = title.replace(/^\s*(epic|umbrella)\s*[:—–-]\s*/i, "").trim();
  const id = /^([A-Za-z]{1,4}[-_]?\d+)(?![\w-])/.exec(cleaned)?.[1];
  return id === undefined ? null : id.toLowerCase().replace(/[_\s]+/g, "-");
}
