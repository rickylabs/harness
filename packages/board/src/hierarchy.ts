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
 */

import type { BoardItem, BoardSnapshot } from "./model.js";
import { slugOfEpicTitle } from "./project.js";

/** Aggregate progress over a set of items. */
export interface Progress {
  readonly total: number;
  readonly shipped: number;
  readonly inFlight: number;
  readonly blocked: number;
  /** Items with no status label: work the board cannot see. */
  readonly invisible: number;
}

/** An epic and the tasks labelled into it. */
export interface EpicNode {
  readonly slug: string;
  /** The epic issue itself, when one exists. A slug can be referenced before it is created. */
  readonly issue: BoardItem | null;
  readonly title: string;
  readonly tasks: readonly BoardItem[];
  readonly progress: Progress;
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

const BLOCKED_PHASES: ReadonlySet<string> = new Set(["blocked", "changes-requested"]);

function progressOf(items: readonly BoardItem[]): Progress {
  let shipped = 0;
  let blocked = 0;
  let invisible = 0;
  for (const item of items) {
    if (item.phase === null) {
      invisible += 1;
      continue;
    }
    if (item.phase.terminal) shipped += 1;
    else if (BLOCKED_PHASES.has(item.phase.name)) blocked += 1;
  }
  return {
    total: items.length,
    shipped,
    blocked,
    invisible,
    inFlight: items.length - shipped - blocked - invisible,
  };
}

/** Merge several progress records, for rolling a milestone up from its epics. */
function sumProgress(parts: readonly Progress[]): Progress {
  return parts.reduce<Progress>(
    (acc, p) => ({
      total: acc.total + p.total,
      shipped: acc.shipped + p.shipped,
      inFlight: acc.inFlight + p.inFlight,
      blocked: acc.blocked + p.blocked,
      invisible: acc.invisible + p.invisible,
    }),
    { total: 0, shipped: 0, inFlight: 0, blocked: 0, invisible: 0 },
  );
}

/** The slug an epic issue answers to: its explicit `epic:` label, else one derived from its title. */
export function epicSlugOf(item: BoardItem): string | null {
  return item.epic ?? slugOfEpicTitle(item.source.title);
}

/**
 * Build the milestone → epic → task tree from a snapshot.
 *
 * Every item appears exactly once. An item that is itself an epic is the `issue` of its own node
 * and is not also listed among that node's tasks — otherwise every epic would count itself in its
 * own progress and every board would look busier than it is.
 */
export function buildHierarchy(snapshot: BoardSnapshot): Hierarchy {
  const epicIssues = new Map<string, BoardItem>();
  for (const item of snapshot.items) {
    if (!item.isEpic) continue;
    const slug = epicSlugOf(item);
    if (slug !== null && !epicIssues.has(slug)) epicIssues.set(slug, item);
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
    const milestone = item.source.milestone;
    const group = bucket(milestone);
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

  const milestones: MilestoneNode[] = [];
  const names = [...byMilestone.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return 1; // unassigned sorts last
    if (b === null) return -1;
    return a.localeCompare(b);
  });

  for (const name of names) {
    const group = byMilestone.get(name);
    if (group === undefined) continue;

    const epics: EpicNode[] = [];
    const slugs = [...group.keys()].filter((k): k is string => k !== null).sort();
    for (const slug of slugs) {
      const tasks = (group.get(slug) ?? []).slice().sort((a, b) => a.source.number - b.source.number);
      const issue = epicIssues.get(slug) ?? null;
      epics.push({
        slug,
        issue,
        title: issue?.source.title ?? slug,
        tasks,
        progress: progressOf(tasks),
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
