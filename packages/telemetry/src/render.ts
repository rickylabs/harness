/**
 * Render a snapshot as text.
 *
 * The output is the literal replacement for typing `status ?` at an orchestrator, so it is written
 * for someone reading a terminal at a glance, not for a parser. Three properties matter:
 *
 * - Governance comes first. "Why is nothing running" is a status question, and today it has no
 *   answer at all — so the quota line is above the work, not in a footer.
 * - Nothing is dropped in silence. A snapshot that could not read a store must say so on the same
 *   screen as the work it did find, or it reads as a complete answer. Where a list is too long to
 *   read it is capped and the remainder counted on the page, never quietly cut.
 * - No colour, no cursor control. This gets pasted into issues and read over ssh.
 */

import type { Liveness } from "./liveness.js";
import {
  sumUsage,
  type AttributedRun,
  type BoardItemRef,
  type QuotaReading,
  type TelemetrySnapshot,
} from "./model.js";
import { humanBytes } from "./observability.js";
import type { GovernanceView } from "./observations.js";
import { flatten } from "./snapshot.js";
import type { ActivityTree, EpicNode, ItemNode, LinkedRef, MilestoneNode } from "./tree.js";

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

/** Shorten to fit a column, marking that something was removed. Titles only, never numbers. */
const clip = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, width - 1)}…`;

/** Compact large token counts, because six significant digits is not what anyone reads for. */
export function humanTokens(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * A duration in whole units: `3h 12m`, `4m`, `under a minute`.
 *
 * Every caller puts the result in a slot that already supplies the direction — `updated … ago`,
 * `resets in …` — so this returns a length of time and never a moment. "just now" was a moment, and
 * against a live run it printed `updated just now ago`, which is both wrong English and ambiguous
 * about which end of the interval is being described.
 */
export function humanAge(fromIso: string, toIso: string): string {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "?";
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return "under a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** One quota line, with its own age, because a stale reading must not read as a fresh one. */
export function renderQuota(reading: QuotaReading, now: string): string {
  const used = reading.usedPercent === null ? "?" : `${reading.usedPercent}%`;
  const window =
    reading.windowMinutes === null ? "" : ` of a ${Math.round(reading.windowMinutes / 60)}h window`;
  const resets = reading.resetsAt === null ? "" : `, resets in ${humanAge(now, reading.resetsAt)}`;
  const plan = reading.planType === null ? "" : ` [${reading.planType}]`;
  const credits =
    reading.creditBalance === null ? "" : `, credits ${reading.creditBalance}`;
  return `  ${pad(reading.source, 9)} ${used} used${window}${resets}${plan}${credits}  (read ${humanAge(reading.observedAt, now)} ago)`;
}

function readingAge(observedAt: string | null, now: string): string {
  return observedAt === null ? "never read" : `read ${humanAge(observedAt, now)} ago`;
}

function headroom(used: number | null, total: number | null): string {
  if (used === null || total === null) return "used/total/headroom unknown";
  return `${humanBytes(used)} used / ${humanBytes(total)} total · ${humanBytes(total - used)} headroom`;
}

/** Render the same leading governance block for both status and tree. */
export function renderGovernance(
  governance: GovernanceView,
  legacyQuota: readonly QuotaReading[],
  now: string,
): string[] {
  if (governance.availability === "unavailable") {
    const lines = [`governance: UNKNOWN/UNAVAILABLE — ${governance.unavailableReason}`];
    if (legacyQuota.length > 0) {
      lines.push("  transcript quota (account unknown):");
      for (const reading of legacyQuota) lines.push(`  ${renderQuota(reading, now)}`);
    }
    return lines;
  }

  const marker = governance.availability === "stale" ? "STALE" : "FRESH";
  const lines = [
    `governance: ${marker} · ${governance.provenance} · observed ${humanAge(governance.observedAt, now)} ago`,
  ];
  for (const regime of governance.state.regimes) {
    lines.push(`  ${regime.regime} [${regime.state}]${regime.note === null ? "" : ` — ${regime.note}`}`);
    if (regime.regime === "subscription") {
      if (regime.accounts.length === 0) lines.push("    no accounts reported");
      for (const account of regime.accounts) {
        lines.push(
          `    ${account.seam}/${account.account} [${account.state}] · ${readingAge(account.observedAt, now)}`,
        );
        if (account.windows.length === 0) lines.push("      no windows reported");
        for (const window of account.windows) {
          const reset = window.resetsAt === null ? "reset unknown" : `resets in ${humanAge(now, window.resetsAt)}`;
          lines.push(
            `      ${window.binding ? "binding " : ""}${window.label}: ${window.usedPercent}% used · ${reset}`,
          );
        }
      }
    } else if (regime.regime === "metered") {
      if (regime.providers.length === 0) lines.push("    no providers reported");
      for (const provider of regime.providers) {
        const ceiling = provider.ceilingUsd === null ? "ceiling unknown" : `$${provider.ceilingUsd.toFixed(2)} ceiling`;
        lines.push(
          `    ${provider.provider}: $${provider.spentUsd.toFixed(2)} spent / ${ceiling} (${provider.windowLabel}) · ${readingAge(provider.observedAt, now)}`,
        );
      }
    } else {
      if (regime.hosts.length === 0) lines.push("    no hosts reported");
      for (const host of regime.hosts) {
        lines.push(`    ${host.host} · ${readingAge(host.observedAt, now)}`);
        lines.push(`      VRAM ${headroom(host.vramUsedBytes, host.vramTotalBytes)}`);
        lines.push(`      RAM  ${headroom(host.ramUsedBytes, host.ramTotalBytes)}`);
      }
    }
  }

  for (const admission of governance.admissions) {
    const freshness = admission.availability === "stale" ? "STALE " : "";
    lines.push(
      `  #${admission.item.number} ${freshness}${admission.state} [${admission.regime}] — ${admission.outcome.reason}: ${admission.outcome.detail} · ${admission.provenance} · read ${humanAge(admission.observedAt, now)} ago`,
    );
  }
  for (const approval of governance.state.pending) {
    lines.push(`  approval ${approval.id}${approval.item === null ? "" : ` for #${approval.item}`} — ${approval.summary}`);
  }
  for (const message of governance.state.notes) lines.push(`  note: ${message}`);
  return lines;
}

/** Distinct notes shown before the block is summarised, and runs shown in a flat list. */
export const RENDER_CAPS = { notes: 12, runs: 20 } as const;

/**
 * The notes block, collapsed.
 *
 * Notes are never dropped silently — that rule is why this function exists rather than a slice. But
 * "never dropped" was implemented as "all of them, in order", and on the real board one repeated
 * line printed 128 times and pushed every other note off the screen. Identical notes are the same
 * fact observed more than once, so they collapse to one line carrying the count, and what will not
 * fit is summarised rather than truncated in silence.
 */
export function renderNotes(notes: readonly string[]): string[] {
  if (notes.length === 0) return [];
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note, (counts.get(note) ?? 0) + 1);

  const lines = ["", "notes:"];
  const shown = [...counts.entries()].slice(0, RENDER_CAPS.notes);
  for (const [note, count] of shown) lines.push(`  ${note}${count > 1 ? ` (×${count})` : ""}`);
  const hidden = counts.size - shown.length;
  if (hidden > 0) lines.push(`  … ${hidden} further distinct note(s) — read them with --json`);
  return lines;
}

/**
 * A flat list of runs, capped.
 *
 * The caller has already printed the true count on the heading above, so this loses lines and never
 * loses the scale. Newest first, because a list an operator stops reading after ten entries should
 * spend those ten on the runs that are still moving.
 */
function renderRunList(runs: readonly AttributedRun[], now: string): string[] {
  const lines: string[] = [];
  for (const run of runs.slice(0, RENDER_CAPS.runs)) lines.push(...renderRun(run, now, 0));
  const hidden = runs.length - Math.min(runs.length, RENDER_CAPS.runs);
  if (hidden > 0) lines.push(`  … ${hidden} more — read them with --json`);
  return lines;
}

const OUTCOME_MARK: Record<string, string> = {
  running: "▶",
  complete: "✓",
  failed: "✗",
  unknown: "·",
};

function renderRun(node: AttributedRun, now: string, depth: number): string[] {
  const { run } = node;
  const indent = "  ".repeat(depth + 1);
  const mark = OUTCOME_MARK[run.outcome] ?? "·";
  const identity =
    run.identity.model === null
      ? "model unrecorded"
      : `${run.identity.model}${run.identity.effort === null ? "" : `/${run.identity.effort}`}`;
  const item = node.item === null ? "" : ` #${node.item.number} ${node.item.title}`;
  const tokens = `${humanTokens(run.usage.inputTokens)}in/${humanTokens(run.usage.outputTokens)}out`;
  // A run that joined to no item is named by its session id, not by its prompt. The id is what
  // `why` takes, so the line an operator is reading is also the line telling them what to type.
  const label = item === "" ? ` ${run.id.slice(0, 8)}` : item;

  const lines = [
    `${indent}${mark} ${pad(run.source, 9)}${label}`,
    `${indent}    ${identity} · ${tokens} · updated ${humanAge(run.updatedAt, now)} ago`,
  ];
  for (const child of node.children) lines.push(...renderRun(child, now, depth + 1));
  return lines;
}

/**
 * The whole snapshot, as the operator sees it.
 *
 * `now` is a parameter for the same reason `generatedAt` is: a rendered snapshot must be
 * reproducible, and "3h ago" is only meaningful against a stated reference point.
 */
export function renderSnapshot(snapshot: TelemetrySnapshot, now: string = snapshot.generatedAt): string {
  const lines: string[] = [];
  lines.push(`board activity as of ${snapshot.generatedAt}`);

  lines.push("");
  lines.push(...renderGovernance(snapshot.governance, snapshot.quota, now));

  const totals = [...snapshot.epics.flatMap((e) => e.runs), ...snapshot.unattributed];
  const all = flatten(totals);
  const usage = sumUsage(all.map((a) => a.run.usage));
  lines.push("");
  lines.push(
    `${all.length} run(s) across ${snapshot.epics.length} epic(s) · ${humanTokens(usage.inputTokens)}in/${humanTokens(usage.outputTokens)}out${usage.costUsd === undefined ? "" : ` · $${usage.costUsd.toFixed(2)}`}`,
  );

  for (const epic of snapshot.epics) {
    lines.push("");
    const milestone = epic.milestone === null ? "" : ` (${epic.milestone})`;
    lines.push(`epic:${epic.epic}${milestone}`);
    for (const run of epic.runs) lines.push(...renderRun(run, now, 0));
  }

  if (snapshot.unattributed.length > 0) {
    lines.push("");
    lines.push(`unattributed — ${snapshot.unattributed.length} run(s) the board cannot see`);
    lines.push(...renderRunList(snapshot.unattributed, now));
  }

  lines.push(...renderNotes(snapshot.notes));

  return lines.join("\n");
}

/**
 * A node's own state on GitHub, in the words the board uses.
 *
 * `closed, not merged` is spelled out rather than collapsed into `closed`, because a pull request
 * that was closed without landing is the board's `closed-unmerged` anomaly and reads as done to
 * anyone skimming. Where the feed did not say, this says so — an unstated state is not "open".
 */
export function renderItemState(item: BoardItemRef): string {
  const kind = item.kind === "pull-request" ? "pull" : item.kind === "issue" ? "issue" : "item";
  const state =
    item.state === undefined
      ? "state unknown"
      : item.state === "open"
        ? "open"
        : item.merged === true
          ? "merged"
          : item.merged === false
            ? "closed, not merged"
            : "closed";
  return `${kind} ${state} · ${item.phase ?? "no column"}`;
}

/**
 * A node's liveness, with the evidence named.
 *
 * The evidence is printed, not just the verdict, because the two kinds are not equally strong and a
 * reader who cannot tell them apart cannot weigh the answer: `live (turn, 2m ago)` is an agent
 * working, `live (item, 2m ago)` may be nothing but a label somebody just changed.
 */
export function renderLiveness(state: Liveness, now: string): string {
  if (state.at === null) return `${state.state} (nothing recorded)`;
  return `${state.state} (${state.evidence}, ${humanAge(state.at, now)} ago)`;
}

/** One linked item: what it is and where it stands, or an honest blank when the board lacks it. */
function renderLink(link: LinkedRef): string {
  const target = link.item;
  if (target === null) return `#${link.number} (${link.from}, not on this board)`;
  return `#${link.number} ${renderItemState(target)} (${link.from})`;
}

const TITLE_WIDTH = 44;

/**
 * One item node.
 *
 * A node nobody has run anything against collapses to a single line, and a node with work under it
 * expands. That is not a display trick: on this board the largest column is `triage`, so most nodes
 * are quiet, and a view that spends four lines on each of them is a view nobody scrolls to the end
 * of. The compact line still carries number, title, state and liveness — everything except the runs
 * it does not have.
 */
function renderItemNode(node: ItemNode, now: string, indent: string): string[] {
  const head = `${indent}#${node.item.number} `;
  if (node.runs.length === 0 && node.links.length === 0) {
    return [
      `${head}${pad(clip(node.item.title, TITLE_WIDTH), TITLE_WIDTH)}  ${pad(renderItemState(node.item), 30)} ${renderLiveness(node.liveness, now)}`,
    ];
  }

  const inner = `${indent}    `;
  const lines = [
    `${head}${node.item.title}`,
    `${inner}${renderItemState(node.item)} · ${renderLiveness(node.liveness, now)}`,
  ];
  for (const run of node.runs) lines.push(...renderRun(run, now, indent.length / 2 + 1));
  if (node.links.length > 0) {
    lines.push(`${inner}links: ${node.links.map(renderLink).join(" · ")}`);
  }
  return lines;
}

function renderEpicNode(node: EpicNode, now: string): string[] {
  const title = node.item === null ? "" : ` ${node.item.title}`;
  const runs = flatten([...node.tasks, ...node.pulls].flatMap((task) => task.runs)).length;
  const lines = [
    `  epic:${node.epic ?? "none"}${title}`,
    `    ${node.tasks.length} task(s) · ${runs} run(s) · ${renderLiveness(node.liveness, now)}`,
  ];
  for (const task of node.tasks) lines.push(...renderItemNode(task, now, "    "));
  if (node.pulls.length > 0) {
    // Named for what it is. These are not loose pull requests; they are pull requests whose task
    // nobody stated, and the fix is upstream in the projection rather than on this screen.
    lines.push(`    pull requests naming no task:`);
    for (const pull of node.pulls) lines.push(...renderItemNode(pull, now, "      "));
  }
  return lines;
}

function renderMilestoneNode(node: MilestoneNode, now: string): string[] {
  const lines = [
    "",
    `${node.milestone ?? "no milestone"}  ${renderLiveness(node.liveness, now)}`,
  ];
  for (const epic of node.epics) {
    lines.push("");
    lines.push(...renderEpicNode(epic, now));
  }
  return lines;
}

/**
 * The whole tree, as the operator reads it.
 *
 * The order of the screen is the order of the questions. Governance first — "why is nothing
 * running" is answered by a quota window, not by the work. Then anything stalled, because that is
 * the only category that needs a person. Then the board itself, top down. Notes last, but never
 * dropped: a tree built from stores that could not all be read must say so on the same screen.
 */
export function renderTree(tree: ActivityTree, now: string = tree.now): string {
  const lines: string[] = [`board activity as of ${tree.generatedAt}`];

  lines.push("");
  lines.push(...renderGovernance(tree.governance, tree.quota, now));

  const nodes = tree.milestones.flatMap((m) => m.epics.flatMap((e) => [...e.tasks, ...e.pulls]));
  const runs = flatten([...nodes.flatMap((n) => n.runs), ...tree.unattributed]);
  const stalled = nodes.filter((n) => n.liveness.state === "stalled");
  const epics = tree.milestones.reduce((total, m) => total + m.epics.length, 0);

  lines.push("");
  lines.push(
    `${nodes.length} node(s) across ${epics} epic(s) in ${tree.milestones.length} milestone(s) · ${runs.length} run(s)`,
  );
  if (stalled.length > 0) {
    // Put where it cannot be scrolled past. A stalled node is the one state on this screen that
    // means something is wrong right now rather than merely unfinished.
    lines.push("");
    lines.push(`${stalled.length} stalled — a run says it is working and nothing has grown:`);
    for (const node of stalled) {
      lines.push(`  #${node.item.number} ${clip(node.item.title, 60)} — ${renderLiveness(node.liveness, now)}`);
    }
  }

  for (const milestone of tree.milestones) lines.push(...renderMilestoneNode(milestone, now));

  if (tree.unattributed.length > 0) {
    lines.push("");
    lines.push(`unattributed — ${tree.unattributed.length} run(s) that joined to no board item`);
    lines.push(...renderRunList(tree.unattributed, now));
  }

  lines.push(...renderNotes(tree.notes));

  return lines.join("\n");
}
