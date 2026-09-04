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
  | "shipped-but-open";

/** One thing wrong with the board, tied to the item that is wrong. */
export interface Anomaly {
  readonly kind: AnomalyKind;
  readonly item: number;
  readonly detail: string;
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
}

/** Read the value of a `family:value` label, e.g. `epic:e6` under family `epic` gives `e6`. */
export function labelValue(labels: readonly string[], family: string): string | null {
  const marker = `${family}:`;
  for (const label of labels) {
    if (label.startsWith(marker)) {
      const value = label.slice(marker.length);
      if (value.length > 0) return value;
    }
  }
  return null;
}
