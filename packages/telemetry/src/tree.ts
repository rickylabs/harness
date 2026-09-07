/**
 * Milestone → epic → task → subagent.
 *
 * #85 calls this "the view the whole repo exists to produce", and the reason is one sentence from
 * the owner: *"I'm constantly spamming `status ?` to my current orchestrator because I have zero
 * visibility across the board."* Every other command in this package answers a narrower question —
 * which runs happened, why one failed, how much quota is left. This one answers the whole one.
 *
 * The four levels come from two places, and keeping them straight is what makes the view honest:
 *
 * - The first three are board truth. `@rickylabs/board` builds the same three from GitHub alone,
 *   and its `hierarchy.ts` says so in its header: the fourth level "lives in the session stores and
 *   belongs to E9". This module is that fourth level, attached above the other three.
 * - The fourth is run truth, recovered from transcript stores with no agent awake. `parent_id` in
 *   opencode's database gives the subagent tree outright; Claude's store gives it by naming a file
 *   after the child and writing the parent's id on every line inside, which `backfill/claude.ts`
 *   reads as a pair. The attribution that hangs a run on an issue is `attributeTo` in `snapshot.ts`.
 *
 * Two properties this module has that the flat snapshot does not.
 *
 * **A task with no runs is visible.** `buildSnapshot` groups runs, so an item nobody has worked on
 * simply is not in its output — which reads as "no such task" rather than "nothing has started". On
 * a board whose largest column is `triage`, that is most of the board. Nodes here come from the
 * items feed, and runs attach to them; an empty node is a real answer.
 *
 * **Every node carries state and liveness.** State is the issue's or pull request's own — open,
 * closed, merged, which column. Liveness is `liveness.ts`, and it is deliberately not the same
 * question: a closed task can be the liveliest node on the board the hour its PR lands, and a task
 * marked `impl` can be the deadest.
 */

import {
  liveness,
  type Evidence,
  type LivenessVerdict,
  type LivenessWindows,
} from "./liveness.js";
import type { AttributedRun, BoardItemRef, QuotaReading, TelemetrySnapshot } from "./model.js";
import type { GovernanceView } from "./observations.js";
import { compareNullableStrings } from "./order.js";
import { flatten } from "./snapshot.js";

/**
 * How one item came to be linked to another.
 *
 * Ranked, and the ranking is the point. `closes` is a statement by the author of the pull request;
 * `path` is the dispatcher naming a branch after the issue it dispatched; `prose` is a number
 * somebody typed. The same ordering governs `attributeTo`, for the same reason.
 */
export type LinkOrigin = "closes" | "path" | "prose";

const ORIGIN_RANK: Record<LinkOrigin, number> = { closes: 0, path: 1, prose: 2 };

/** Another board item this node points at, resolved against the feed where possible. */
export interface LinkedRef {
  readonly number: number;
  readonly from: LinkOrigin;
  /**
   * The item that number resolves to, or `null` when the feed has never heard of it.
   *
   * A null here is worth printing rather than hiding: a run pointing at a number the board does not
   * contain is either a fetch that was capped or a reference to another repository, and both are
   * things an operator wants to know before trusting the screen.
   */
  readonly item: BoardItemRef | null;
}

/** One issue or pull request, the runs under it, and what it points at. */
export interface ItemNode {
  readonly item: BoardItemRef;
  /** Root runs attributed to this item. Subagents hang inside each one, not here. */
  readonly runs: readonly AttributedRun[];
  readonly links: readonly LinkedRef[];
  readonly liveness: LivenessVerdict;
}

export interface EpicNode {
  readonly epic: string | null;
  /** The issue that *is* this epic, when the feed carries it. */
  readonly item: BoardItemRef | null;
  readonly tasks: readonly ItemNode[];
  /**
   * Pull requests under this epic that no task claimed.
   *
   * A pull request lands here rather than under the task it delivers whenever the feed does not say
   * which task that is — see `BoardItemRef.closes`. It is the visible edge of a seam, not clutter:
   * the alternative is guessing from a branch name, and a wrong attachment is worse than an honest
   * list one level up.
   */
  readonly pulls: readonly ItemNode[];
  readonly liveness: LivenessVerdict;
}

export interface MilestoneNode {
  readonly milestone: string | null;
  readonly epics: readonly EpicNode[];
  readonly liveness: LivenessVerdict;
}

/** The whole picture, as data. Pure: same inputs, same tree, on any host. */
export interface ActivityTree {
  readonly generatedAt: string;
  /** The reference time ages are measured against, stated so the render is reproducible. */
  readonly now: string;
  readonly milestones: readonly MilestoneNode[];
  /** Runs that joined to no board item at all: real work the board cannot see. */
  readonly unattributed: readonly AttributedRun[];
  readonly quota: readonly QuotaReading[];
  readonly governance: GovernanceView;
  readonly notes: readonly string[];
}

export interface TreeInput {
  /** A snapshot built from the same items, so attribution has already been decided once. */
  readonly snapshot: TelemetrySnapshot;
  readonly items: readonly BoardItemRef[];
  /** Defaults to the snapshot's own `generatedAt`. */
  readonly now?: string;
  readonly windows?: LivenessWindows;
}

/** A turn is evidence. Every run in the tree contributes one, subagents included. */
function runEvidence(runs: readonly AttributedRun[]): Evidence[] {
  return flatten(runs).map((node) => ({
    at: node.run.updatedAt,
    kind: "turn" as const,
    // The only place a running claim enters the system. `liveness.ts` guarantees it can never
    // produce a green node on its own.
    claimsRunning: node.run.outcome === "running",
  }));
}

/** GitHub's own mtime for the item, when the feed carried it. Weaker evidence, and labelled so. */
function itemEvidence(item: BoardItemRef | null): Evidence[] {
  const at = item?.updatedAt;
  return at === undefined ? [] : [{ at, kind: "item", claimsRunning: false }];
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * Everything this node points at, strongest evidence per number, own number excluded.
 *
 * Deduplicated by number rather than by pair, so a task referenced by three subagents is one line.
 * When two origins claim the same number the stronger one is kept, because the weaker one adds
 * nothing: knowing a PR both closes #85 and mentions it does not change what a reader should do.
 */
function linksFor(
  item: BoardItemRef,
  runs: readonly AttributedRun[],
  byNumber: ReadonlyMap<number, BoardItemRef>,
  closedBy: ReadonlyMap<number, readonly number[]>,
): LinkedRef[] {
  const origins = new Map<number, LinkOrigin>();
  const consider = (number: number, from: LinkOrigin): void => {
    if (number === item.number) return;
    const held = origins.get(number);
    if (held === undefined || ORIGIN_RANK[from] < ORIGIN_RANK[held]) origins.set(number, from);
  };

  for (const pull of closedBy.get(item.number) ?? []) consider(pull, "closes");
  for (const node of flatten(runs)) {
    for (const link of node.run.linkedIssues) consider(link.number, link.from);
  }

  return [...origins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, from]) => ({ number, from, item: byNumber.get(number) ?? null }));
}

/** A pull request unless the feed says otherwise. An absent `kind` means issue, which is the norm. */
const isPull = (item: BoardItemRef): boolean => item.kind === "pull-request";

/**
 * Build the tree.
 *
 * `input.items` must be the same list the snapshot was built from. It is passed again rather than
 * read back off the snapshot because a snapshot only retains the items that runs attributed to,
 * and the whole point of this view is the tasks that no run has touched yet.
 */
export function buildTree(input: TreeInput): ActivityTree {
  const now = input.now ?? input.snapshot.generatedAt;
  const notes: string[] = [...input.snapshot.notes];
  const byNumber = new Map(input.items.map((item) => [item.number, item]));

  // A run whose item has no epic label sits in the snapshot's `unattributed` list, because that
  // list is grouped by epic. It does not belong there: the board can see that run perfectly well,
  // it simply has no epic to file it under. Here it lands under the null epic, and `unattributed`
  // recovers its literal meaning — no board item at all.
  const orphaned: AttributedRun[] = [];
  const runsByItem = new Map<number, AttributedRun[]>();
  const roots = [...input.snapshot.epics.flatMap((epic) => epic.runs), ...input.snapshot.unattributed];
  for (const run of roots) {
    if (run.item === null) orphaned.push(run);
    else pushInto(runsByItem, run.item.number, run);
  }

  // Which pull requests declare that they deliver which task. Absent for every item today: the
  // projection does not emit `closes` yet, and this module does not invent it.
  const closedBy = new Map<number, number[]>();
  const claimed = new Set<number>();
  for (const item of input.items) {
    for (const target of item.closes ?? []) {
      if (!byNumber.has(target)) continue;
      pushInto(closedBy, target, item.number);
      claimed.add(item.number);
    }
  }

  const nodeOf = (item: BoardItemRef): ItemNode => {
    const runs = runsByItem.get(item.number) ?? [];
    return {
      item,
      runs,
      links: linksFor(item, runs, byNumber, closedBy),
      liveness: liveness([...runEvidence(runs), ...itemEvidence(item)], now, input.windows),
    };
  };

  const byMilestone = new Map<string | null, Map<string | null, BoardItemRef[]>>();
  for (const item of input.items) {
    let epics = byMilestone.get(item.milestone);
    if (epics === undefined) {
      epics = new Map<string | null, BoardItemRef[]>();
      byMilestone.set(item.milestone, epics);
    }
    pushInto(epics, item.epic, item);
  }

  const nodeEvidence = (node: ItemNode): Evidence[] => [
    ...runEvidence(node.runs),
    ...itemEvidence(node.item),
  ];

  const milestones: MilestoneNode[] = [...byMilestone.entries()]
    .sort(([a], [b]) => compareNullableStrings(a, b))
    .map(([milestone, epicGroups]) => {
      const epics: EpicNode[] = [...epicGroups.entries()]
        .sort(([a], [b]) => compareNullableStrings(a, b))
        .map(([epic, members]) => {
          const epicItems = members.filter((item) => item.isEpic === true);
          const epicItem = epicItems[0] ?? null;
          if (epicItems.length > 1) {
            // Two issues claiming to be one epic is the board's own `duplicate-epic-slug` anomaly
            // arriving here. Reported rather than resolved: this view does not get to decide which
            // epic issue is the real one.
            notes.push(
              `epic:${epic ?? "none"} has ${epicItems.length} epic issues (${epicItems.map((i) => `#${i.number}`).join(", ")}) — used the first`,
            );
          }

          const rest = members.filter(
            (item) => item !== epicItem && !(isPull(item) && claimed.has(item.number)),
          );
          const tasks = rest.filter((item) => !isPull(item)).sort((a, b) => a.number - b.number).map(nodeOf);
          const pulls = rest.filter(isPull).sort((a, b) => a.number - b.number).map(nodeOf);

          const evidence = [
            ...tasks.flatMap(nodeEvidence),
            ...pulls.flatMap(nodeEvidence),
            ...itemEvidence(epicItem),
          ];
          return {
            epic,
            item: epicItem,
            tasks,
            pulls,
            liveness: liveness(evidence, now, input.windows),
          };
        });

      const evidence = epics.flatMap((node) => [
        ...node.tasks.flatMap(nodeEvidence),
        ...node.pulls.flatMap(nodeEvidence),
        ...itemEvidence(node.item),
      ]);
      return { milestone, epics, liveness: liveness(evidence, now, input.windows) };
    });

  return {
    generatedAt: input.snapshot.generatedAt,
    now,
    milestones,
    unattributed: orphaned,
    quota: input.snapshot.quota,
    governance: input.snapshot.governance,
    notes,
  };
}
