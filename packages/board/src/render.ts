/**
 * Text renderings of the projection.
 *
 * These are plain strings with no ANSI and no terminal probing, for three reasons: they are
 * testable by equality, they paste into an issue comment unchanged, and they are readable in a log
 * file at 3am — which is exactly when someone is asking where everything got to.
 */

import type { Hierarchy, MilestoneNode, Progress } from "./hierarchy.js";
import { sourceSaysDelivered } from "./model.js";
import type { Anomaly, BoardItem, BoardSnapshot, Completeness } from "./model.js";
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
  // Last, and spelled out rather than abbreviated like the two above. It is the only one of the
  // three that names something for the reader to do, and in the column views it is the only place
  // the fact appears at all — those group by phase, and this is deliberately not a phase.
  if (item.waitingOnOwner) flags.push("waiting on owner");
  const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
  return `${id} ${item.source.title}${suffix}`;
}

/**
 * `7/13 done · 3 running · 12 queued · 1 blocked · 1 abandoned · 2 invisible`
 *
 * Every bucket gets its own word. This line is the answer to "status ?", so a count that has to be
 * inferred from the others is a count the reader will infer wrongly: `queued` in particular used to
 * be reported as `running`, which turned "nobody has looked at 58 issues" into "58 agents are on
 * it". Zeroes are omitted, so the line stays short on a board where the distinction is moot.
 */
export function renderProgress(progress: Progress): string {
  const parts = [`${progress.shipped}/${progress.total} done`];
  if (progress.inFlight > 0) parts.push(`${progress.inFlight} running`);
  // Between "done" and "running": filed and untouched. The largest column on a young board.
  if (progress.queued > 0) parts.push(`${progress.queued} queued`);
  if (progress.blocked > 0) parts.push(`${progress.blocked} blocked`);
  // Named separately from "done" and from "running" because it is neither: the work stopped and
  // nothing came of it. Folding it into either loses the only fact worth acting on.
  if (progress.abandoned > 0) parts.push(`${progress.abandoned} abandoned`);
  // A gap in the input rather than a state of the work. Reported so it can be chased, never
  // rounded into "done".
  if (progress.unknown > 0) parts.push(`${progress.unknown} merge state unknown`);
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

/** `1 anomaly`, `2 anomalies`. One place, so no view has to remember the plural. */
const countAnomalies = (n: number): string => `${n} ${n === 1 ? "anomaly" : "anomalies"}`;

/**
 * The item numbers named in at least one anomaly.
 *
 * Board-level anomalies carry no item and are deliberately absent from this set. A truncated fetch
 * is a statement about the projection, and hanging its mark on whichever row happened to be first
 * would blame an issue for something that is not about it. Those are counted by the banner, which
 * is the only surface that can carry them honestly.
 */
export function anomalousItems(anomalies: readonly Anomaly[]): ReadonlySet<number> {
  const numbers = new Set<number>();
  for (const anomaly of anomalies) if (anomaly.item !== null) numbers.add(anomaly.item);
  return numbers;
}

/**
 * The warning that this board disagrees with itself, or `null` when it does not.
 *
 * Every human-facing view prints this, and the rule behind it generalises to the next one written:
 * a projection that renders `phase` while dropping `anomalies` is claiming a consistency it never
 * checked. On an item carrying two `status:` labels the phase resolves to whichever label came
 * first, so the column is printed with the confidence of a settled fact and nothing on screen says
 * one of two answers was picked. `check` is not the answer to that — it is a separate command, and
 * the reader who is looking at a column is by definition not looking at `check`.
 */
export function renderAnomalyBanner(anomalies: readonly Anomaly[]): string | null {
  if (anomalies.length === 0) return null;
  // Only promise a mark when there is one to find. On a board whose only anomaly is board-level,
  // telling the reader to look for `!` sends them hunting for something that is not there.
  const marked = anomalousItems(anomalies).size > 0 ? " ! marks an affected item." : "";
  return (
    `!! ANOMALIES (${anomalies.length}) — this board contradicts itself.${marked}` +
    ` Run "dsh-board check" for the detail.`
  );
}

/**
 * The two-character gutter before an item.
 *
 * Always two characters, marked or not, so flagging a row never shifts the text beside it and two
 * renders of the same board still diff cleanly.
 */
const mark = (item: BoardItem, flagged: ReadonlySet<number>): string =>
  flagged.has(item.source.number) ? "! " : "  ";

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
  const lines: string[] = [`# board — ${snapshot.repo}`, `generated ${snapshot.generatedAt}`];
  // Above the columns, because it is the sentence that decides whether they can be believed.
  const warning = renderAnomalyBanner(snapshot.anomalies);
  if (warning !== null) lines.push(warning);
  lines.push("");

  const flagged = anomalousItems(snapshot.anomalies);
  for (const column of snapshot.columns) {
    if (column.items.length === 0) continue;
    lines.push(`## ${column.phase.name} (${column.items.length})`);
    for (const item of column.items) lines.push(`${mark(item, flagged)}${label(item)}`);
    lines.push("");
  }

  // Two very different things end up unphased, and one blanket caption used to call both of them
  // lost. Work that was abandoned is *supposed* to sit here with no label; work that was delivered
  // and never labelled is a hole in the board. Printing them under one heading that reads "the
  // board cannot see them" trains the reader to skim the whole section, which is how the fourteen
  // merged pull requests in it went unnoticed.
  // An unphased item is only *correct* when it was closed without shipping. Open work still needs
  // triage, and delivered work still needs its label — different repairs, but both are the board
  // failing to show something real, so they share a heading.
  const isDropped = (i: BoardItem): boolean =>
    i.source.state === "closed" && !sourceSaysDelivered(i.source);
  const invisible = snapshot.unphased.filter((i) => !isDropped(i));
  const dropped = snapshot.unphased.filter(isDropped);

  // Every row here is named in an anomaly, so the whole section marks. That reads as redundant
  // next to a heading that already says as much, and it is still worth printing: the banner states
  // a count, and a reader who can only find two of five marks upstairs has to be able to find the
  // other three. A section that opted out of the gutter would make the count look wrong.
  if (invisible.length > 0) {
    lines.push(`## in no column (${invisible.length})`);
    lines.push("  Real work the board cannot see: open and untriaged, or delivered and unlabelled.");
    for (const item of invisible) lines.push(`${mark(item, flagged)}${label(item)}`);
    lines.push("");
  }

  // Conversely, almost nothing here marks: the anomalies about a close all require either an open
  // item or a phase, and these have neither. A mark that does appear is the exception the caption
  // is generalising over — an unknown `status:` label on an abandoned item, say — and saying so is
  // better than a caption that quietly covers for it.
  if (dropped.length > 0) {
    lines.push(`## closed without shipping (${dropped.length})`);
    lines.push("  No status label is the correct shape for these. Nothing to do.");
    for (const item of dropped) lines.push(`${mark(item, flagged)}${label(item)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderMilestone(milestone: MilestoneNode, flagged: ReadonlySet<number>): readonly string[] {
  const lines: string[] = [];
  const name = milestone.name ?? "(no milestone)";
  lines.push(`## ${name}  ${renderBar(milestone.progress)}  ${renderProgress(milestone.progress)}`);

  // A task line is `<indent><phase><label>`, and the phase is the claim an anomaly contradicts —
  // so the mark goes in the indent, immediately left of it, rather than trailing the title where
  // it would read as part of the item's name.
  const taskLine = (task: BoardItem): string =>
    `  ${mark(task, flagged)}${pad(task.phase?.name ?? "no status", 20)} ${label(task)}`;

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
    const epicMark = epic.issue === null ? "  " : mark(epic.issue, flagged);
    lines.push("");
    lines.push(`${epicMark}${epic.title}${number}  [${phase}]${home}`);
    lines.push(`    ${renderBar(epic.progress, 16)} ${renderProgress(epic.progress)}`);
    if (epic.issue === null) {
      lines.push(`    (no epic issue claims the slug ${epic.slug})`);
    }
    for (const task of epic.tasks) lines.push(taskLine(task));
  }

  if (milestone.looseTasks.length > 0) {
    lines.push("");
    lines.push(`  (no epic)`);
    for (const task of milestone.looseTasks) lines.push(taskLine(task));
  }

  return lines;
}

/** Knobs on the hierarchy view. Everything defaults to what the terminal has always printed. */
export interface HierarchyRenderOptions {
  /**
   * Whether to print the `generated <iso>` line.
   *
   * On by default, and the only caller that turns it off is one whose output is committed: a stamp
   * that moves on every render makes every scheduled run a change, which buries the runs where the
   * board actually moved. See `digest.ts`, which states the board's own latest activity instead.
   */
  readonly stamp?: boolean;
  /**
   * Whether to warn that the board contradicts itself, and mark the rows it contradicts.
   *
   * On by default, so a view has to opt *out* of reporting anomalies rather than remember to opt
   * in — the direction matters, because forgetting is exactly what produced the defect this
   * option exists to fix. The one caller that turns it off is `digest.ts`, which gives every
   * anomaly its own section, with the detail and the repair, above the tree.
   */
  readonly anomalies?: boolean;
}

/**
 * The hierarchy view. This is the answer to "status ?" — the whole tree, with progress rolled up,
 * readable without asking any agent anything.
 */
export function renderHierarchy(
  hierarchy: Hierarchy,
  options: HierarchyRenderOptions = {},
): string {
  const lines: string[] = [
    `# ${hierarchy.repo}  ${renderBar(hierarchy.progress)}  ${renderProgress(hierarchy.progress)}`,
  ];
  if (options.stamp !== false) lines.push(`generated ${hierarchy.generatedAt}`);

  const reporting = options.anomalies !== false;
  const warning = reporting ? renderAnomalyBanner(hierarchy.anomalies) : null;
  if (warning !== null) lines.push(warning);
  const flagged = reporting ? anomalousItems(hierarchy.anomalies) : new Set<number>();

  for (const milestone of hierarchy.milestones) {
    lines.push("");
    lines.push(...renderMilestone(milestone, flagged));
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

  const lines: string[] = [countAnomalies(snapshot.anomalies.length)];
  for (const kind of [...byKind.keys()].sort(compareStrings)) {
    lines.push("");
    lines.push(`## ${kind}`);
    lines.push(...(byKind.get(kind) ?? []));
  }
  return lines.join("\n");
}
