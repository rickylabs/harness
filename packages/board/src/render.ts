/**
 * Text renderings of the projection.
 *
 * These are plain strings with no ANSI and no terminal probing, for three reasons: they are
 * testable by equality, they paste into an issue comment unchanged, and they are readable in a log
 * file at 3am — which is exactly when someone is asking where everything got to.
 */

import type { Hierarchy, MilestoneNode, Progress } from "./hierarchy.js";
import type { BoardItem, BoardSnapshot, Completeness } from "./model.js";
import { compareStrings } from "./order.js";

const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + " ".repeat(width - value.length);

/** `#98 feat(forge): portable label taxonomy` — the one-line identity of an item. */
function label(item: BoardItem): string {
  const mark = item.source.kind === "pull-request" ? "PR" : "#";
  const id = item.source.kind === "pull-request" ? `${mark}${item.source.number}` : `#${item.source.number}`;
  const flags: string[] = [];
  if (item.source.draft === true) flags.push("draft");
  if (item.priority !== null) flags.push(item.priority);
  const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
  return `${id} ${item.source.title}${suffix}`;
}

/** `7/13 done · 3 running · 1 blocked · 1 abandoned · 2 invisible` */
export function renderProgress(progress: Progress): string {
  const parts = [`${progress.shipped}/${progress.total} done`];
  if (progress.inFlight > 0) parts.push(`${progress.inFlight} running`);
  if (progress.blocked > 0) parts.push(`${progress.blocked} blocked`);
  // Named separately from "done" and from "running" because it is neither: the work stopped and
  // nothing came of it. Folding it into either loses the only fact worth acting on.
  if (progress.abandoned > 0) parts.push(`${progress.abandoned} abandoned`);
  if (progress.invisible > 0) parts.push(`${progress.invisible} invisible`);
  return parts.join(" · ");
}

/**
 * The warning that this board is only part of the board, or `null` when there is nothing to warn
 * about.
 *
 * A banner rather than one anomaly among many, because it is not a statement about an item — it is
 * a statement about whether the rest of the output can be read at all. An item missing from a
 * truncated board looks exactly like an item that does not exist.
 */
export function renderCompleteness(completeness: Completeness | null): string | null {
  if (completeness === null || completeness.capped.length === 0) return null;
  const kinds = completeness.capped.map((k) => (k === "issue" ? "issues" : "pull requests"));
  return (
    `!! INCOMPLETE — ${kinds.join(" and ")} came back at the --limit of ${completeness.limit}. ` +
    "Anything absent below may simply not have been fetched."
  );
}

/** A fixed-width progress bar. Deterministic, and never rounds an incomplete epic up to full. */
export function renderBar(progress: Progress, width = 20): string {
  if (progress.total === 0) return `[${" ".repeat(width)}]`;
  const ratio = progress.shipped / progress.total;
  let filled = Math.floor(ratio * width);
  // Only a genuinely complete set gets a full bar; 19/20 must not render as done.
  if (filled === width && progress.shipped < progress.total) filled = width - 1;
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

/** The kanban view: one section per column, in lifecycle order. */
export function renderColumns(snapshot: BoardSnapshot): string {
  const lines: string[] = [`# board — ${snapshot.repo}`, `generated ${snapshot.generatedAt}`, ""];

  for (const column of snapshot.columns) {
    if (column.items.length === 0) continue;
    lines.push(`## ${column.phase.name} (${column.items.length})`);
    for (const item of column.items) lines.push(`  ${label(item)}`);
    lines.push("");
  }

  if (snapshot.unphased.length > 0) {
    lines.push(`## no status label (${snapshot.unphased.length})`);
    lines.push("  These are in no column. The board cannot see them.");
    for (const item of snapshot.unphased) lines.push(`  ${label(item)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderMilestone(milestone: MilestoneNode): readonly string[] {
  const lines: string[] = [];
  const name = milestone.name ?? "(no milestone)";
  lines.push(`## ${name}  ${renderBar(milestone.progress)}  ${renderProgress(milestone.progress)}`);

  for (const epic of milestone.epics) {
    const number = epic.issue === null ? "" : ` #${epic.issue.source.number}`;
    const phase = epic.issue?.phase?.name ?? "no status";
    // An epic drawn under a milestone that is not its own is a borrowed appearance, put here so a
    // task filed across the boundary keeps its parent. Saying where it really lives is what stops
    // the same epic in two milestones from reading as two different epics.
    const home =
      epic.issue !== null && epic.homeMilestone !== milestone.name
        ? `  (epic is in ${epic.homeMilestone ?? "no milestone"})`
        : "";
    lines.push("");
    lines.push(`  ${epic.title}${number}  [${phase}]${home}`);
    lines.push(`    ${renderBar(epic.progress, 16)} ${renderProgress(epic.progress)}`);
    if (epic.issue === null) {
      lines.push(`    (no epic issue claims the slug ${epic.slug})`);
    }
    for (const task of epic.tasks) {
      const taskPhase = task.phase?.name ?? "no status";
      lines.push(`    ${pad(taskPhase, 20)} ${label(task)}`);
    }
  }

  if (milestone.looseTasks.length > 0) {
    lines.push("");
    lines.push(`  (no epic)`);
    for (const task of milestone.looseTasks) {
      const taskPhase = task.phase?.name ?? "no status";
      lines.push(`    ${pad(taskPhase, 20)} ${label(task)}`);
    }
  }

  return lines;
}

/**
 * The hierarchy view. This is the answer to "status ?" — the whole tree, with progress rolled up,
 * readable without asking any agent anything.
 */
export function renderHierarchy(hierarchy: Hierarchy): string {
  const lines: string[] = [
    `# ${hierarchy.repo}  ${renderBar(hierarchy.progress)}  ${renderProgress(hierarchy.progress)}`,
    `generated ${hierarchy.generatedAt}`,
  ];
  for (const milestone of hierarchy.milestones) {
    lines.push("");
    lines.push(...renderMilestone(milestone));
  }
  return lines.join("\n");
}

/**
 * Anomalies, grouped by kind.
 *
 * Rendered separately from the board rather than inline, because an anomaly is a statement about
 * the board being wrong and burying it next to the thing it contradicts is how it gets ignored.
 */
export function renderAnomalies(snapshot: BoardSnapshot): string {
  if (snapshot.anomalies.length === 0) return "no anomalies — every item has exactly one status label";

  const byKind = new Map<string, string[]>();
  for (const anomaly of snapshot.anomalies) {
    const list = byKind.get(anomaly.kind);
    // A board-level anomaly has no item to hang off. Attributing it to one would make it look like
    // a problem with that issue, which is a different — and false — claim.
    const line =
      anomaly.item === null ? `  ${anomaly.detail}` : `  #${anomaly.item}: ${anomaly.detail}`;
    if (list === undefined) byKind.set(anomaly.kind, [line]);
    else list.push(line);
  }

  const lines: string[] = [`${snapshot.anomalies.length} anomalies`];
  for (const kind of [...byKind.keys()].sort(compareStrings)) {
    lines.push("");
    lines.push(`## ${kind}`);
    lines.push(...(byKind.get(kind) ?? []));
  }
  return lines.join("\n");
}
