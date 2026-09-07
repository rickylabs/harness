/**
 * Build the answer that `status ?` used to ask an agent for.
 *
 * Everything here is a pure function of the runs and the board items handed in. No clock, no
 * filesystem, no network: the same inputs produce the same snapshot, which is the determinism
 * commitment the board projection makes and the only way two people looking at the board can be
 * sure they are looking at the same thing.
 *
 * "The same inputs" includes the environment. Every order below comes from `compareStrings`, never
 * from `localeCompare`, because the host's default collation is an input nobody passed: the same
 * two epic keys sorted `["ä", "z"]` under `en_US` and `["z", "ä"]` under `sv_SE`, which changed the
 * snapshot's bytes without changing an argument. See `order.ts`.
 */

import {
  type AttributedRun,
  type BoardItemRef,
  type EpicActivity,
  type QuotaReading,
  type RunRecord,
  type TelemetrySnapshot,
} from "./model.js";
import { compareStrings } from "./order.js";
import { unavailableGovernance, type GovernanceView } from "./observations.js";

/** Runs keyed by parent, so a tree can be built in one pass rather than by repeated scanning. */
function childrenByParent(runs: readonly RunRecord[]): Map<string, RunRecord[]> {
  const map = new Map<string, RunRecord[]>();
  for (const run of runs) {
    if (run.parentId === null) continue;
    const list = map.get(run.parentId);
    if (list === undefined) map.set(run.parentId, [run]);
    else list.push(run);
  }
  return map;
}

/**
 * Attach the subagent tree under each root run.
 *
 * Two different failures used to arrive here as one. A cycle in `parent_id` would hang the walk, and
 * a store written by a live process is not a place to assume acyclicity — so the walk needs a guard.
 * But the guard was a single set of every id ever reached, which also fires when two *records* carry
 * one id, and that is not a cycle at all: it is one session read from several transcripts, which is
 * what a resumed or compacted Claude session looks like on disk. On the real board that misreading
 * printed 128 copies of "appears under itself" and threw away the item attribution of every run
 * after the first — evidence discarded on the strength of a diagnosis that was not true.
 *
 * So there are two sets. `onPath` is the cycle guard and holds only the ancestors of the run being
 * attributed. `visited` is the reached set, which still decides what is stranded and now also
 * distinguishes a repeated id from a loop: such a run keeps its attribution and is simply not
 * expanded a second time, because its children were already placed under the first occurrence.
 */
function attribute(
  run: RunRecord,
  children: Map<string, RunRecord[]>,
  items: Map<number, BoardItemRef>,
  visited: Set<string>,
  onPath: Set<string>,
  repeated: Map<string, number>,
  notes: string[],
): AttributedRun {
  if (onPath.has(run.id)) {
    notes.push(`run ${run.id} appears under itself — subagent tree truncated at this point`);
    return { run, item: null, children: [] };
  }

  const chosen = attributeTo(run, items);
  if (chosen.note !== null) notes.push(chosen.note);

  if (visited.has(run.id)) {
    // Counted rather than announced: one note per repeat is how 128 identical lines buried every
    // other note in the scan. The summary is emitted once, by the caller.
    repeated.set(run.id, (repeated.get(run.id) ?? 1) + 1);
    return { run, item: chosen.item, children: [] };
  }
  visited.add(run.id);
  onPath.add(run.id);

  const kids = (children.get(run.id) ?? [])
    .slice()
    .sort((a, b) => compareStrings(a.startedAt, b.startedAt) || compareStrings(a.id, b.id))
    .map((child) => attribute(child, children, items, visited, onPath, repeated, notes));

  onPath.delete(run.id);
  return { run, item: chosen.item, children: kids };
}

/**
 * Choose the board item a run belongs to, or refuse and say why.
 *
 * The contract, in order:
 *
 * 1. Only numbers resolving to an item in this scan are candidates. A `#105` the board has never
 *    heard of is not evidence about the board.
 * 2. Path evidence beats prose evidence outright, and completely. The dispatcher named the branch
 *    after the issue it dispatched; a number in a prompt is something a person typed.
 * 3. If the winning class still holds more than one item, the run stays unattributed and says so.
 *
 * Rule 3 is the change. This used to take the first number that resolved, so a run whose prose
 * named both #39 and #105 landed under #39's epic with nothing on screen to say a choice had been
 * made — a guess wearing the clothes of a fact (finding F-8 on #105). An operator who sees the run
 * in `unattributed` with a note can fix the branch name; an operator who sees it under the wrong
 * epic sees nothing at all.
 */
export function attributeTo(
  run: RunRecord,
  items: Map<number, BoardItemRef>,
): { readonly item: BoardItemRef | null; readonly note: string | null } {
  const resolved = run.linkedIssues.filter((link) => items.has(link.number));
  const byPath = resolved.filter((link) => link.from === "path");
  const pool = byPath.length > 0 ? byPath : resolved;

  const only = pool.length === 1 ? pool[0] : undefined;
  if (only !== undefined) return { item: items.get(only.number) ?? null, note: null };
  if (pool.length === 0) return { item: null, note: null };

  const numbers = pool.map((link) => `#${link.number}`).join(", ");
  const where = byPath.length > 0 ? "was launched against" : "mentions";
  return {
    item: null,
    note: `run ${run.id} ${where} ${numbers} — left unattributed, because nothing says which one it is`,
  };
}

/**
 * The most recent reading per seam.
 *
 * An old quota reading is worse than none: it is the shape of an answer, so nobody checks it. Only
 * the latest per source survives into the snapshot, and it carries `observedAt` so its age is
 * visible rather than implied.
 */
export function latestQuota(runs: readonly RunRecord[]): readonly QuotaReading[] {
  const latest = new Map<string, QuotaReading>();
  for (const run of runs) {
    for (const reading of run.quota) {
      const key = `${reading.source}:${reading.limitId ?? ""}`;
      const held = latest.get(key);
      if (held === undefined || reading.observedAt > held.observedAt) latest.set(key, reading);
    }
  }
  return [...latest.values()].sort((a, b) => compareStrings(a.source, b.source));
}

export interface SnapshotInput {
  readonly generatedAt: string;
  readonly runs: readonly RunRecord[];
  /** Board items to join against. An empty list produces an entirely unattributed snapshot. */
  readonly items: readonly BoardItemRef[];
  /** Notes carried in from backfill, so one snapshot reports every reason it is incomplete. */
  readonly notes?: readonly string[];
  /** Point-in-time governance input. Omission remains explicit in the resulting snapshot. */
  readonly governance?: GovernanceView;
}

/** Group attributed runs under the epic of the item they joined to. */
export function buildSnapshot(input: SnapshotInput): TelemetrySnapshot {
  const notes: string[] = [...(input.notes ?? [])];
  const items = new Map(input.items.map((item) => [item.number, item]));
  const children = childrenByParent(input.runs);

  // A run whose parent is not in this scan is a root as far as this snapshot can tell. Saying so
  // beats hiding it: an orphaned subagent is exactly the thing an operator is looking for.
  const present = new Set(input.runs.map((r) => r.id));
  const roots = input.runs.filter((r) => r.parentId === null || !present.has(r.parentId));
  for (const run of roots) {
    if (run.parentId !== null) {
      notes.push(`run ${run.id} names parent ${run.parentId}, which is not in this scan`);
    }
  }

  const byRecency = (a: RunRecord, b: RunRecord): number =>
    compareStrings(b.updatedAt, a.updatedAt) || compareStrings(a.id, b.id);

  const visited = new Set<string>();
  const onPath = new Set<string>();
  const repeated = new Map<string, number>();
  const attributed = roots
    .slice()
    .sort(byRecency)
    .map((run) => attribute(run, children, items, visited, onPath, repeated, notes));

  // A cycle with no member outside it has no root at all, so the walk above never reaches it. Left
  // here, those runs would vanish from the snapshot entirely — the one outcome this package must
  // never produce, because a run that is missing looks exactly like a run that never happened.
  const stranded = input.runs.filter((run) => !visited.has(run.id)).sort(byRecency);
  for (const run of stranded) {
    if (visited.has(run.id)) continue; // Adopted as a child while attributing an earlier stranded run.
    notes.push(`run ${run.id} is in a parent cycle with no root — shown as a root here`);
    attributed.push(attribute(run, children, items, visited, onPath, repeated, notes));
  }

  if (repeated.size > 0) {
    // One line for the whole scan, naming the worst offenders. A run id is a session id, and a
    // session that was resumed or compacted is written to more than one transcript — so the same id
    // legitimately arrives several times, each carrying a different slice of the work. Nothing is
    // dropped and nothing is merged; the operator is told that `why <id>` will be ambiguous.
    //
    // That is the legitimate cause, and it used to be the minority one: most of what this note
    // reported was `backfill/claude.ts` filing every subagent under the id of the session that
    // spawned it. Fixing that upstream is why the counts here are now small enough to read.
    const worst = [...repeated.entries()]
      .sort(([aId, a], [bId, b]) => b - a || compareStrings(aId, bId))
      .slice(0, 3)
      .map(([id, count]) => `${id} ×${count}`)
      .join(", ");
    notes.push(
      `${repeated.size} run id(s) name more than one record in this scan — a session read from several transcripts arrives once per transcript: ${worst}`,
    );
  }

  const byEpic = new Map<string, AttributedRun[]>();
  const unattributed: AttributedRun[] = [];
  for (const run of attributed) {
    const epic = run.item?.epic ?? null;
    if (epic === null) {
      unattributed.push(run);
      continue;
    }
    const list = byEpic.get(epic);
    if (list === undefined) byEpic.set(epic, [run]);
    else list.push(run);
  }

  const epics: EpicActivity[] = [...byEpic.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([epic, runs]) => ({
      epic,
      milestone: runs[0]?.item?.milestone ?? null,
      runs,
    }));

  return {
    generatedAt: input.generatedAt,
    epics,
    unattributed,
    quota: latestQuota(input.runs),
    governance: input.governance ?? unavailableGovernance("no --observations supplied"),
    notes: notes.sort(compareStrings),
  };
}

/** Count every run in a tree, so a summary line does not undercount subagents. */
export function countRuns(runs: readonly AttributedRun[]): number {
  return runs.reduce((total, run) => total + 1 + countRuns(run.children), 0);
}

/** Flatten a tree depth-first, parents before children, for rendering and for totals. */
export function flatten(runs: readonly AttributedRun[]): readonly AttributedRun[] {
  const out: AttributedRun[] = [];
  const walk = (list: readonly AttributedRun[]): void => {
    for (const run of list) {
      out.push(run);
      walk(run.children);
    }
  };
  walk(runs);
  return out;
}
