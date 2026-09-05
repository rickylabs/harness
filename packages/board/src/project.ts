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

import { closingKeywordTargets } from "./closing.js";
import { DEFAULT_LIFECYCLE, phaseOf, statusLabelsOf, unknownStatusLabels } from "./lifecycle.js";
import type { Lifecycle } from "./lifecycle.js";
import { labelValue, labelValues, sourceSaysDelivered } from "./model.js";
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

/** The slug an epic issue answers to: its explicit `epic:` label, else one derived from its title. */
export function epicSlugOf(item: BoardItem): string | null {
  return item.epic ?? slugOfEpicTitle(item.source.title);
}

/** Where the epic issues are, keyed by slug. A slug with several claimants keeps all of them. */
type EpicIndex = ReadonlyMap<string, readonly BoardItem[]>;

/**
 * The three lookups the item-level rules need, built once over the whole board.
 *
 * Bundled rather than passed as three parameters because every rule that needs one of them tends
 * to need another, and a signature that grows a parameter per rule is one nobody adds a rule to.
 */
interface Indexes {
  readonly epics: EpicIndex;
  /** Tasks grouped by the epic slug they claim — the children an umbrella is finished by. */
  readonly children: ReadonlyMap<string, readonly BoardItem[]>;
  /** Every item by number, so a closing keyword can be resolved to the thing it points at. */
  readonly byNumber: ReadonlyMap<number, BoardItem>;
}

function indexEpics(items: readonly BoardItem[]): EpicIndex {
  const index = new Map<string, BoardItem[]>();
  for (const item of items) {
    if (!item.isEpic) continue;
    const slug = epicSlugOf(item);
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

/**
 * Tasks under each epic slug, lowest issue number first.
 *
 * Epics are excluded from their own children, so an epic that carries `epic:e9` to declare its own
 * slug does not end up counted as a child of itself and hold itself open forever.
 */
function indexChildren(items: readonly BoardItem[]): ReadonlyMap<string, readonly BoardItem[]> {
  const index = new Map<string, BoardItem[]>();
  for (const item of items) {
    if (item.isEpic || item.epic === null) continue;
    const found = index.get(item.epic);
    if (found === undefined) index.set(item.epic, [item]);
    else found.push(item);
  }
  for (const children of index.values()) children.sort((a, b) => a.source.number - b.source.number);
  return index;
}

/**
 * The open child *issues* of a closed umbrella — empty for everything else.
 *
 * Issues only, deliberately. An open pull request under an epic is work in flight and its own
 * ending is to merge or to close; reopening the epic would not be the repair. An open *issue* is a
 * commitment nobody has discharged, and an umbrella that closed over one closed early.
 */
function openChildrenOf(item: BoardItem, children: Indexes["children"]): readonly BoardItem[] {
  if (!item.isEpic || item.source.state !== "closed") return [];
  const slug = epicSlugOf(item);
  if (slug === null) return [];
  return (children.get(slug) ?? []).filter(
    (child) => child.source.state === "open" && child.source.kind === "issue",
  );
}

/** At most ten issue numbers, then a count — a detail line, not a report. */
function listNumbers(items: readonly BoardItem[]): string {
  const shown = items.slice(0, 10).map((i) => `#${i.source.number}`).join(", ");
  return items.length > 10 ? `${shown}, +${items.length - 10} more` : shown;
}

function anomaliesFor(
  item: BoardItem,
  lifecycle: Lifecycle,
  idx: Indexes,
  lanePrefix: string,
  repo: string,
): readonly Anomaly[] {
  const found: Anomaly[] = [];
  const n = item.source.number;
  const epics = idx.epics;
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

  // The same hole on the other side of the close. `no-status` above asks for `state === "open"`,
  // which meant work that *finished* without a label was reported by nothing at all: on the board
  // this rule was written against, fourteen merged pull requests sat in no column and `check`
  // exited 0. The board's whole claim is that it shows what shipped, so shipped work it cannot see
  // is the most expensive thing it can be wrong about, and it stayed wrong quietly.
  //
  // Only the two endings that assert completion, and both are closable for good: label it once and
  // the row never returns. Abandonment — a pull request closed unmerged, an issue closed as
  // not-planned — is *prescribed* to carry no status label, so it stays unreported here for the
  // reason spelled out at `closed-unmerged` below: a rule that fires on the correct outcome grows
  // by one every time someone does the right thing, and a check that cannot reach zero is a check
  // nobody runs.
  if (statuses.length === 0 && sourceSaysDelivered(item.source)) {
    const how = item.source.kind === "pull-request" ? "merged" : "closed as completed";
    found.push({
      kind: "closed-without-status",
      item: n,
      detail: `${how}, but carries no status label; delivered work the board cannot see`,
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

  // An umbrella is a container. It is finished when its children are, and never because one of
  // them is — so a closed epic with an open child was closed by something other than being done.
  // In the incident this rule comes from, the something was a sub-task's PR naming the epic in its
  // closing keyword, and for two hours the board reported six unstarted children as delivered.
  //
  // Reported whatever column the epic sits in. A closed epic labelled `status:shipped` produces no
  // other anomaly at all, and that is the worst version of this: the board asserts delivery, every
  // other check agrees, and only the children know otherwise.
  const openChildren = openChildrenOf(item, idx.children);
  if (openChildren.length > 0) {
    found.push({
      kind: "epic-closed-by-child",
      item: n,
      detail:
        `is closed with ${openChildren.length} open ${openChildren.length === 1 ? "child" : "children"} ` +
        `(${listNumbers(openChildren)}); an umbrella closes when its last child does — reopen it, ` +
        "do not relabel it",
    });
  }

  // The keyword check, and the only rule here that fires before the damage: an open pull request
  // whose body will close an umbrella on merge. Open ones only. A merged PR's body still says what
  // it said, so reporting those would put a row in the check for every historical mistake, and a
  // check that cannot reach zero is a check nobody runs.
  if (item.source.kind === "pull-request" && item.source.state === "open") {
    for (const target of closingKeywordTargets(item.source.body, repo)) {
      const targeted = idx.byNumber.get(target);
      if (targeted === undefined || !targeted.isEpic) continue;
      found.push({
        kind: "closing-keyword-targets-epic",
        item: n,
        detail:
          `will close #${target} on merge, which is an umbrella — name the task this PR actually ` +
          "finishes and use `Part of #" + String(target) + "` for the epic",
      });
    }
  }

  // A closed item whose phase is not terminal, and a terminal item still open, are the two ways
  // the column and the issue state can contradict each other. Both are reported against the
  // issue, which is the side that wins.
  //
  // Except when the close itself was illegitimate. `epic-closed-by-child` has just said to reopen
  // this issue; saying in the same breath that its column is stale offers the reader a second,
  // contradictory repair — and the one they can do with a single label edit moves an epic with
  // unstarted children into a terminal column, which is worse than the state being reported.
  if (
    item.source.state === "closed" &&
    item.phase !== null &&
    !item.phase.terminal &&
    openChildren.length === 0
  ) {
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
  //
  // Only when the item *claims* to have shipped, though. Abandoning a pull request is a legitimate
  // ending, and the process prescribes exactly this shape for it: closed, unmerged, no `status:`
  // label at all. Reporting that as an anomaly flags the correct outcome, never stops flagging it,
  // and grows by one every time someone closes a pull request properly — which is how a check ends
  // up permanently red and therefore unread. There is nothing to contradict until a terminal phase
  // asserts delivery; `closed-but-unshipped` already covers a stale non-terminal column.
  if (
    item.source.kind === "pull-request" &&
    item.source.state === "closed" &&
    item.source.merged === false &&
    item.phase?.terminal === true
  ) {
    found.push({
      kind: "closed-unmerged",
      item: n,
      detail: `sits in ${item.phase.name} but was closed without merging; it did not ship`,
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
  const idx: Indexes = {
    epics,
    children: indexChildren(items),
    // Last write wins on a duplicate number, which cannot happen from a real fetch: `gh` returns
    // issues and pull requests from one numbering space and neither list repeats.
    byNumber: new Map(items.map((item) => [item.source.number, item])),
  };

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
    anomalies.push(...anomaliesFor(item, lifecycle, idx, lanePrefix, options.repo));
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
