/**
 * The board domain: what comes in from GitHub, and what the projection makes of it.
 *
 * `SourceIssue` is deliberately a plain data shape rather than an Octokit type. Everything in
 * this package that does real work takes `SourceIssue[]` and returns a value, which is what makes
 * the projection testable without a network and reproducible across runs. The adapter in
 * `github.ts` is the only thing that knows how GitHub actually spells any of this.
 */

import type { Phase } from "./lifecycle.js";

/** Whether an item is an issue or a pull request. GitHub calls both "issues" in some APIs. */
export type ItemKind = "issue" | "pull-request";

/** An item exactly as the source of truth reports it, with nothing derived. */
export interface SourceIssue {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly url: string;
  readonly assignees: readonly string[];
  readonly milestone: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly kind: ItemKind;
  /** Pull requests only: whether it is a draft. */
  readonly draft?: boolean;
  /** Pull requests only: whether it landed. A closed-unmerged PR is not a shipped one. */
  readonly merged?: boolean;
}

/** Why an item could not be projected cleanly. Anomalies are surfaced, never silently repaired. */
export type AnomalyKind =
  | "multiple-status"
  | "unknown-status"
  | "no-status"
  | "epic-not-found"
  | "closed-but-unshipped"
  | "shipped-but-open"
  /** A pull request closed without landing. Closed is not the same as done. */
  | "closed-unmerged"
  /** Two epic issues answer to one slug, so "which epic" has no single answer. */
  | "duplicate-epic-slug"
  /** A task sits in a different milestone from the epic that owns it. */
  | "epic-milestone-conflict"
  /** Two labels of one family on one item, so reading that family is a coin toss. */
  | "duplicate-label"
  /** The fetch was capped, so the board on screen is a prefix of the real one. */
  | "incomplete-fetch";

/**
 * One thing wrong with the board.
 *
 * `item` is `null` for an anomaly about the projection itself rather than about any one issue —
 * a truncated fetch is the case that exists today. A board-level problem reported against an
 * arbitrary issue number would be worse than one reported against none.
 */
export interface Anomaly {
  readonly kind: AnomalyKind;
  readonly item: number | null;
  readonly detail: string;
}

/**
 * How much of the board the fetch actually saw.
 *
 * Carried on the snapshot rather than logged, because "103 items" and "the first 30 of 103 items"
 * render identically otherwise, and a board that silently shows a prefix is worse than one that
 * fails: the reader has no way to tell that the thing they are looking for was cut off.
 */
export interface Completeness {
  /** Per-kind cap that was applied to the fetch. */
  readonly limit: number;
  /** Kinds that came back exactly at the cap, and so may have more behind them. */
  readonly capped: readonly ItemKind[];
}

/** A projected item: the source data plus everything the taxonomy lets us derive from it. */
export interface BoardItem {
  readonly source: SourceIssue;
  /** The column this item is drawn in, or `null` when it carries no status label. */
  readonly phase: Phase | null;
  /** Slug from the `epic:` label, if any. The parent in the hierarchy. */
  readonly epic: string | null;
  /** Slug from the `lane:` (or repo-local equivalent) label, if any. */
  readonly lane: string | null;
  /** Slug from the `priority:` label, if any. */
  readonly priority: string | null;
  /** Slug from the `type:` label, if any. */
  readonly type: string | null;
  /** `true` when the item is an epic in its own right rather than a task under one. */
  readonly isEpic: boolean;
}

/** One column of the projection. */
export interface BoardColumn {
  readonly phase: Phase;
  readonly items: readonly BoardItem[];
}

/**
 * A complete projection of the board at a point in time.
 *
 * `generatedAt` is passed in rather than read from the clock, so that projecting the same inputs
 * twice produces the same snapshot — the determinism commitment in #36. Anything that needs the
 * real time reads it at the edge and hands it down.
 */
export interface BoardSnapshot {
  readonly repo: string;
  readonly generatedAt: string;
  readonly columns: readonly BoardColumn[];
  /** Items with no status label at all: real work that the board cannot see. */
  readonly unphased: readonly BoardItem[];
  readonly anomalies: readonly Anomaly[];
  /** Every projected item, phased or not, in deterministic order. */
  readonly items: readonly BoardItem[];
  /**
   * How much of the board this snapshot covers.
   *
   * `null` when the caller did not say — a projection built from a hand-assembled list of issues
   * makes no claim either way. It is not a stand-in for "complete".
   */
  readonly completeness: Completeness | null;
}

/**
 * Whether an item actually landed.
 *
 * A terminal phase is necessary but not sufficient. A pull request closed without merging is
 * terminal on the board and abandoned in fact, and counting it as shipped is how a board comes to
 * report work as delivered that nobody delivered. Only a positive `merged: false` demotes an item
 * — an unknown merge state is not evidence of abandonment.
 */
export function isShipped(item: BoardItem): boolean {
  if (item.phase?.terminal !== true) return false;
  if (item.source.kind !== "pull-request") return true;
  return item.source.merged !== false;
}

/** A pull request that reached a terminal column, or closed, without ever landing. */
export function isAbandoned(item: BoardItem): boolean {
  return (
    item.source.kind === "pull-request" &&
    item.source.state === "closed" &&
    item.source.merged === false
  );
}

/**
 * Read every value of a `family:value` label, e.g. `epic:e6` under family `epic` gives `["e6"]`.
 *
 * Plural because the taxonomy's own rule — one label per family — is a rule the board can break,
 * and a reader that returns the first match cannot tell a compliant item from a contradictory one.
 * The projector reports the contradiction; `labelValue` is the convenience for everywhere that
 * only needs the value it will act on.
 */
export function labelValues(labels: readonly string[], family: string): readonly string[] {
  const marker = `${family}:`;
  const found: string[] = [];
  for (const label of labels) {
    if (label.startsWith(marker)) {
      const value = label.slice(marker.length);
      if (value.length > 0) found.push(value);
    }
  }
  return found;
}

/** The value of a `family:value` label — the first one, when an item wrongly carries several. */
export function labelValue(labels: readonly string[], family: string): string | null {
  return labelValues(labels, family)[0] ?? null;
}
