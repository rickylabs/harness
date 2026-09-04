/**
 * The projection itself: GitHub issues in, board snapshot out, no I/O and no clock.
 *
 * Decision 3 of #30 says GitHub is the truth and dsh projects the live view — "if the projection
 * and the issue disagree, the issue wins". That is not a slogan here, it is the reason this
 * function has no writes in it. Every disagreement it finds becomes an `Anomaly` describing what
 * the issue says; nothing is repaired, reordered into plausibility, or hidden.
 */

import { DEFAULT_LIFECYCLE, phaseOf, statusLabelsOf, unknownStatusLabels } from "./lifecycle.js";
import type { Lifecycle } from "./lifecycle.js";
import { labelValue } from "./model.js";
import type { Anomaly, BoardColumn, BoardItem, BoardSnapshot, SourceIssue } from "./model.js";

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
}

/** The default urgency ordering; unlisted priorities sort after all listed ones. */
export const DEFAULT_PRIORITY_ORDER = ["p0", "p1", "p2", "p3"] as const;

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

function anomaliesFor(
  item: BoardItem,
  lifecycle: Lifecycle,
  knownEpics: ReadonlySet<string>,
): readonly Anomaly[] {
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

  if (item.epic !== null && !knownEpics.has(item.epic)) {
    found.push({
      kind: "epic-not-found",
      item: n,
      detail: `labelled epic:${item.epic}, but no open epic issue claims that slug`,
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

  return found;
}

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

  // Epic slugs that actually exist, so a dangling `epic:` label is reported rather than assumed.
  const knownEpics = new Set<string>();
  for (const item of items) {
    if (!item.isEpic) continue;
    const slug = item.epic ?? slugOfEpicTitle(item.source.title);
    if (slug !== null) knownEpics.add(slug);
  }

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

  const anomalies = ordered.flatMap((item) => anomaliesFor(item, lifecycle, knownEpics));

  return {
    repo: options.repo,
    generatedAt: options.generatedAt,
    columns,
    unphased: ordered.filter((item) => item.phase === null),
    anomalies,
    items: ordered,
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
