/**
 * The hierarchy view: milestone → epic → task.
 *
 * #36 models work as `Milestone → Epic → Task → Run`. The first three levels are all recoverable
 * from GitHub alone, which is what this module builds. The fourth — the runs under a task — lives
 * in the session stores and belongs to E9; the tree here leaves a documented seam for it rather
 * than pretending a run is an issue.
 *
 * Grouping is by label, not by issue body references, because a label is a fact the board can see
 * and a "depends on" line in prose is not.
 *
 * Every order in this module comes from `compareStrings`, never from `localeCompare`. A tree whose
 * shape depends on the host's `LANG` is not a deterministic projection, and the difference does
 * not show up on the machine that wrote the tests.
 */

import type { BoardItem, BoardSnapshot } from "./model.js";
import { isAbandoned, isDeliveryUnknown, isShipped } from "./model.js";
import { compareNullableStrings, compareStrings } from "./order.js";
import { slugOfEpicTitle } from "./project.js";

/**
 * Aggregate progress over a set of items.
 *
 * Every item lands in exactly one bucket and the buckets sum to `total`. That is an invariant, not
 * a coincidence: `inFlight` used to be computed as the remainder, which meant every state the
 * classifier had no bucket for was silently reported as work in progress. On the real board that
 * read `60 running` while two agents were running, because all 58 freshly triaged issues fell
 * through to the remainder. A counter that cannot say "waiting" or "unknown" will say "running"
 * instead, and "running" is the one word this projection exists to make trustworthy.
 */
export interface Progress {
  readonly total: number;
  readonly shipped: number;
  /** Work something could be acting on right now. */
  readonly inFlight: number;
  /** Filed, but nothing has started. See `Phase.queued`. */
  readonly queued: number;
  readonly blocked: number;
  /** Items with no status label: work the board cannot see. */
  readonly invisible: number;
  /** Pull requests closed without landing. Finished, but not delivered. */
  readonly abandoned: number;
  /** Terminal pull requests whose merge state nobody reported. Not a delivery, not a failure. */
  readonly unknown: number;
}

/** An epic and the tasks labelled into it. */
export interface EpicNode {
  readonly slug: string;
  /** The epic issue itself, when one exists. A slug can be referenced before it is created. */
  readonly issue: BoardItem | null;
  readonly title: string;
  readonly tasks: readonly BoardItem[];
  readonly progress: Progress;
  /**
   * The epic issue's own milestone, which is not always the milestone this node is drawn under.
   *
   * When a task is filed in a different milestone from its epic, the epic has to appear in both
   * places or the task loses its parent. Recording where the epic actually lives is what keeps
   * that from reading as two separate epics that happen to share a name.
   */
  readonly homeMilestone: string | null;
}

/** A milestone and the epics beneath it. */
export interface MilestoneNode {
  /** `null` is the real milestone for everything not assigned to one, not an error. */
  readonly name: string | null;
  readonly epics: readonly EpicNode[];
  /** Tasks in this milestone that claim no epic. */
  readonly looseTasks: readonly BoardItem[];
  readonly progress: Progress;
}

/** The whole tree. */
export interface Hierarchy {
  readonly repo: string;
  readonly generatedAt: string;
  readonly milestones: readonly MilestoneNode[];
  readonly progress: Progress;
}

/**
 * Phase names that mean "this is stuck", counted apart from work that is merely in flight.
 *
 * Matched by name across every lifecycle, not just the default one, so a repository with its own
 * columns still gets a truthful blocked count. `ci-fail` is the default taxonomy's stuck column;
 * `blocked` and `changes-requested` are here for the lifecycles that use those names instead.
 */
const BLOCKED_PHASES: ReadonlySet<string> = new Set(["ci-fail", "blocked", "changes-requested"]);

const ZERO: Progress = {
  total: 0,
  shipped: 0,
  inFlight: 0,
  queued: 0,
  blocked: 0,
  invisible: 0,
  abandoned: 0,
  unknown: 0,
};

/** The one bucket an item belongs in. Exhaustive by construction: there is no fall-through. */
type Bucket = "shipped" | "inFlight" | "queued" | "blocked" | "invisible" | "abandoned" | "unknown";

/**
 * Classify one item.
 *
 * Order matters and is the argument for each bucket over the ones below it:
 *
 * - A closed-unmerged pull request is decided first, because it is the one state that would
 *   otherwise be read off the terminal column alone and counted as delivered.
 * - No phase at all is `invisible` — the board cannot see the item, so it cannot claim anything
 *   else about it.
 * - A terminal item with no reported merge state is `unknown`, ahead of `shipped`, because the
 *   whole point of separating them is that the optimistic reading must not win by default.
 * - `blocked` before `queued` and `inFlight`: a stuck item is not merely unstarted or running.
 */
function bucketOf(item: BoardItem): Bucket {
  if (isAbandoned(item)) return "abandoned";
  if (item.phase === null) return "invisible";
  if (isDeliveryUnknown(item)) return "unknown";
  if (isShipped(item)) return "shipped";
  if (BLOCKED_PHASES.has(item.phase.name)) return "blocked";
  if (item.phase.queued) return "queued";
  return "inFlight";
}

function progressOf(items: readonly BoardItem[]): Progress {
  const counts: Record<Bucket, number> = {
    shipped: 0,
    inFlight: 0,
    queued: 0,
    blocked: 0,
    invisible: 0,
    abandoned: 0,
    unknown: 0,
  };
  for (const item of items) counts[bucketOf(item)] += 1;
  return { total: items.length, ...counts };
}

/** Merge several progress records, for rolling a milestone up from its epics. */
function sumProgress(parts: readonly Progress[]): Progress {
  return parts.reduce<Progress>(
    (acc, p) => ({
      total: acc.total + p.total,
      shipped: acc.shipped + p.shipped,
      inFlight: acc.inFlight + p.inFlight,
      queued: acc.queued + p.queued,
      blocked: acc.blocked + p.blocked,
      invisible: acc.invisible + p.invisible,
      abandoned: acc.abandoned + p.abandoned,
      unknown: acc.unknown + p.unknown,
    }),
    ZERO,
  );
}

/** The slug an epic issue answers to: its explicit `epic:` label, else one derived from its title. */
export function epicSlugOf(item: BoardItem): string | null {
  return item.epic ?? slugOfEpicTitle(item.source.title);
}

/**
 * The node key for an epic issue that lost its slug to a lower-numbered one.
 *
 * Qualified by issue number so the loser gets its own node instead of being merged into the
 * winner's or dropped. It reads as `e6#41`, which is the point: a reader sees immediately that
 * two issues are fighting over `e6`.
 */
const displacedKey = (item: BoardItem): string =>
  `${epicSlugOf(item) ?? ""}#${item.source.number}`;

/**
 * Build the milestone → epic → task tree from a snapshot.
 *
 * Every item appears exactly once. An item that is itself an epic is the `issue` of its own node
 * and is not also listed among that node's tasks — otherwise every epic would count itself in its
 * own progress and every board would look busier than it is.
 *
 * Where two epic issues claim one slug, the lowest-numbered one wins and the rest are drawn as
 * their own empty nodes rather than dropped. `projectBoard` raises `duplicate-epic-slug` for the
 * same input, so the tree stays readable and the conflict stays visible.
 */
export function buildHierarchy(snapshot: BoardSnapshot): Hierarchy {
  const epicIssues = new Map<string, BoardItem>();
  for (const item of snapshot.items) {
    if (!item.isEpic) continue;
    const slug = epicSlugOf(item);
    if (slug === null) continue;
    const held = epicIssues.get(slug);
    // Lowest issue number wins, whatever order the snapshot arrived in — the choice must not
    // depend on the fetch.
    if (held === undefined || item.source.number < held.source.number) epicIssues.set(slug, item);
  }

  // An epic issue that lost its slug still has to be drawn somewhere, or it silently disappears
  // from the board while remaining open on GitHub.
  const displaced: BoardItem[] = [];
  for (const item of snapshot.items) {
    if (!item.isEpic) continue;
    const slug = epicSlugOf(item);
    if (slug === null) continue;
    if (epicIssues.get(slug) !== item) displaced.push(item);
  }

  // Milestone -> epic slug -> tasks. `null` milestone and `null` epic are both real buckets.
  const byMilestone = new Map<string | null, Map<string | null, BoardItem[]>>();
  const bucket = (milestone: string | null): Map<string | null, BoardItem[]> => {
    let found = byMilestone.get(milestone);
    if (found === undefined) {
      found = new Map();
      byMilestone.set(milestone, found);
    }
    return found;
  };

  for (const item of snapshot.items) {
    if (item.isEpic) continue;
    const group = bucket(item.source.milestone);
    const key = item.epic;
    const list = group.get(key);
    if (list === undefined) group.set(key, [item]);
    else list.push(item);
  }

  // An epic issue anchors its own milestone bucket even when nothing is labelled into it yet,
  // so a freshly created epic is visible rather than absent.
  for (const [slug, issue] of epicIssues) {
    const group = bucket(issue.source.milestone);
    if (!group.has(slug)) group.set(slug, []);
  }
  for (const issue of displaced) {
    const group = bucket(issue.source.milestone);
    const key = displacedKey(issue);
    if (!group.has(key)) group.set(key, []);
  }
  const displacedBySlug = new Map<string, BoardItem>(
    displaced.map((issue) => [displacedKey(issue), issue]),
  );

  const milestones: MilestoneNode[] = [];
  const names = [...byMilestone.keys()].sort(compareNullableStrings);

  for (const name of names) {
    const group = byMilestone.get(name);
    if (group === undefined) continue;

    const epics: EpicNode[] = [];
    const slugs = [...group.keys()].filter((k): k is string => k !== null).sort(compareStrings);
    for (const slug of slugs) {
      const tasks = (group.get(slug) ?? []).slice().sort((a, b) => a.source.number - b.source.number);
      const issue = epicIssues.get(slug) ?? displacedBySlug.get(slug) ?? null;
      epics.push({
        slug,
        issue,
        title: issue?.source.title ?? slug,
        tasks,
        progress: progressOf(tasks),
        homeMilestone: issue?.source.milestone ?? null,
      });
    }

    const looseTasks = (group.get(null) ?? []).slice().sort((a, b) => a.source.number - b.source.number);
    milestones.push({
      name,
      epics,
      looseTasks,
      progress: sumProgress([...epics.map((e) => e.progress), progressOf(looseTasks)]),
    });
  }

  return {
    repo: snapshot.repo,
    generatedAt: snapshot.generatedAt,
    milestones,
    progress: sumProgress(milestones.map((m) => m.progress)),
  };
}
