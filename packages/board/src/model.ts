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
  /**
   * Issues only: why it closed, when GitHub knows. `"completed"` and `"not-planned"` are the two
   * endings the taxonomy prescribes opposite labels for — shipped, or no status label at all — so
   * without this field a closed issue's correct shape cannot be told from a forgotten one.
   *
   * `null` where GitHub reported no reason, which is not the same as `"not-planned"`.
   */
  readonly closedBecause?: "completed" | "not-planned" | null;
  /**
   * Pull requests only: the description, because closing keywords live in it and nowhere else.
   *
   * Optional and absent for issues on purpose. Bodies are the largest field on the payload by a
   * wide margin, and no rule this board enforces reads the body of an issue — fetching them would
   * multiply the transfer for every projection to serve one check that does not use them.
   */
  readonly body?: string;
  /**
   * Pull requests only: the branch the changes are on.
   *
   * The board itself derives nothing from it. It is here because a dispatched delivery has no other
   * link back to the issue that ordered it once the two are in different repositories: GitHub's
   * closing keywords close nothing across a repository boundary, so a PR in a target repo cannot
   * reference the inbox issue that way, and the dispatcher's `orch/divybot-<n>` branch name is what
   * carries the number instead. `@rickylabs/forge` reads it; see `targets/reconcile.ts`.
   */
  readonly headRef?: string;
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
  /**
   * Work that finished and never reached a column: a merged pull request, or an issue closed as
   * completed, carrying no `status:` label at all.
   *
   * The counterpart to `no-status`, which only ever fired for open items — so on the board this
   * rule was written against, fourteen merged pull requests were invisible and `check` said the
   * board agreed with itself. Delivered work missing from the projection is the exact failure the
   * board exists to prevent, and it is the one an unmodified `no-status` could not see.
   *
   * Deliberately silent on the two endings that are *supposed* to carry no status label: a pull
   * request closed without merging, and an issue closed as not-planned. Reporting those would flag
   * the prescribed shape of abandoning work, never stop, and make the check permanently red.
   */
  | "closed-without-status"
  /** Two epic issues answer to one slug, so "which epic" has no single answer. */
  | "duplicate-epic-slug"
  /** A task sits in a different milestone from the epic that owns it. */
  | "epic-milestone-conflict"
  /**
   * An umbrella closed while its children are still open.
   *
   * Kept apart from `closed-but-unshipped` because the two prescribe opposite repairs. That one
   * says the column is stale and the label should catch up; this one says the *close* was
   * illegitimate and the issue must be reopened. Reported under one kind, a reader learns to
   * relabel — which here would move an epic with unstarted children into a terminal column and
   * make the board's worst claim permanent.
   */
  | "epic-closed-by-child"
  /**
   * An open pull request whose closing keyword names an umbrella rather than the task it did.
   *
   * The only anomaly in this list that fires *before* the damage: it names a merge that has not
   * happened yet, and the fix is a one-line edit to the body while it is still cheap.
   */
  | "closing-keyword-targets-epic"
  /** Two labels of one family on one item, so reading that family is a coin toss. */
  | "duplicate-label"
  /**
   * An item still asking for an owner decision after it finished.
   *
   * The flag exists to fill one short list — what is waiting on a person — and a short list is the
   * only reason anyone reads it. Nothing removes the label when the decision is finally made, so
   * without this rule the list accumulates settled questions until it is skipped, which is the
   * failure the flag was introduced to fix, one level up.
   *
   * Fires only on a close or a terminal column, so the repair is removing one label and it never
   * fires again. Work that is genuinely still waiting keeps the flag for as long as it waits, and
   * says nothing here.
   */
  | "stale-owner-decision"
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
  /**
   * `true` when the item carries the owner-decision flag: stopped, and stopped on a person.
   *
   * Separate from `phase` because it is a different axis. The phase says how far the work got; this
   * says who is next. Folding it into the column would have made the two mutually exclusive, and
   * the item would have lost whichever fact the column did not keep.
   */
  readonly waitingOnOwner: boolean;
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
  /**
   * Items with no status label at all.
   *
   * Not all of them are a problem: closing without shipping is *supposed* to leave no status
   * label. Use `sourceSaysDelivered` to tell those from the ones that are genuinely missing — the renderer
   * and `closed-without-status` both do.
   */
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
 * report work as delivered that nobody delivered.
 *
 * `merged` is three-valued and all three values mean different things. This function used to read
 * `merged !== false`, on the argument that an unknown merge state is not evidence of abandonment —
 * which is true, and is an argument for not calling it abandoned. It is not an argument for calling
 * it shipped. "We do not know whether this landed" and "this landed" are the two claims a delivery
 * report exists to keep apart, so shipped now requires positive evidence and the third case is
 * reported as itself by `isDeliveryUnknown`.
 *
 * The adapter in `github.ts` always resolves `merged` for a pull request, so on a board fetched
 * from GitHub the unknown case does not arise. It arises from any other producer of `SourceIssue`,
 * and the type has always permitted it.
 */
export function isShipped(item: BoardItem): boolean {
  if (item.phase?.terminal !== true) return false;
  if (item.source.kind !== "pull-request") return true;
  return item.source.merged === true;
}

/**
 * A terminal pull request whose merge state nobody reported.
 *
 * Neither shipped nor abandoned. Counted apart from both so that a gap in the input shows up as a
 * gap rather than as a delivery.
 */
export function isDeliveryUnknown(item: BoardItem): boolean {
  return (
    item.phase?.terminal === true &&
    item.source.kind === "pull-request" &&
    item.source.merged === undefined
  );
}

/**
 * Whether the *source* says this work finished — whatever the board says, or fails to say.
 *
 * The counterpart to `isShipped`, and deliberately not a variant of it. `isShipped` starts from a
 * terminal phase and asks whether to believe it; this starts from GitHub and asks what happened,
 * which is the only question available when there is no phase to start from. That case is exactly
 * the one worth catching: an item with no status label has no phase, so every predicate keyed on
 * one answers `false` for a merged pull request, and the board reports nothing wrong.
 *
 * It takes a `SourceIssue` rather than a `BoardItem` for the same reason — it has to be answerable
 * before the projection assigns a column, and it reads nothing the projection derives.
 *
 * A pull request must have merged; `undefined` is not merged, per `isDeliveryUnknown`. An issue
 * must have closed as completed, and `null` is not completion — so an item GitHub gave no reason
 * for is never accused of having lost its label.
 */
export function sourceSaysDelivered(source: SourceIssue): boolean {
  if (source.state !== "closed") return false;
  return source.kind === "pull-request"
    ? source.merged === true
    : source.closedBecause === "completed";
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
