/**
 * Terminal output for the table and the bridge.
 *
 * The audience is an operator asking "why did nothing spawn on #142?" at a prompt, so the shape is
 * the one `formatPlan` uses: grouped, one row per line, the interesting rows first and never buried
 * behind a wall of the ordinary ones. Nothing here decides anything — every value printed was
 * computed in `model.ts` or `reconcile.ts`, and this file only chooses what to leave out.
 */

import type { Target, TargetTable } from "./model.js";
import { describeProblem } from "./model.js";
import type { BridgeItem, BridgeSnapshot } from "./reconcile.js";
import { tallyBridge } from "./reconcile.js";

const pad = (text: string, width: number): string => (text.length >= width ? text : text.padEnd(width));

/**
 * The table itself: one row per target, in the order resolution walks them.
 *
 * Config order is the whole point — it is what decides which of two rows claiming a label wins — so
 * the rows are never sorted, and the index is printed to make the ordering legible rather than
 * implied by position on a screen.
 */
export function renderTable(table: TargetTable): string {
  const lines: string[] = [
    `inbox    ${table.inbox}`,
    `bot      ${table.botLogin || "(unset)"}`,
    `branches ${table.branchPrefix || "(unset)"}<issue>`,
    `poll     ${table.pollInterval}`,
    "",
  ];

  if (table.targets.length === 0) lines.push("no targets");
  else {
    const width = Math.max(...table.targets.map((target) => target.label.length), 5);
    lines.push(`${pad("label", width)}  repo`);
    table.targets.forEach((target, index) => {
      lines.push(`${pad(target.label, width)}  ${target.repo}${suffix(target)}`);
      const notes = notesFor(target, index);
      for (const note of notes) lines.push(`${pad("", width)}  ${note}`);
    });
  }

  lines.push("", renderMemory(table));
  return lines.join("\n").trimEnd();
}

function suffix(target: Target): string {
  const agents = target.agents.join(" → ");
  return `  ${agents}${target.disabled ? "  [paused]" : ""}`;
}

/**
 * The per-row detail worth a second line, and nothing else.
 *
 * `priority`, `need_cap` and `prompt_hint` are printed only when set. A column of zeroes and empty
 * strings is how a table stops being read.
 */
function notesFor(target: Target, index: number): readonly string[] {
  const notes: string[] = [`#${String(index)} in resolution order`];
  if (target.priority !== 0) notes.push(`priority ${String(target.priority)}`);
  if (target.needCap !== undefined) notes.push(`needs ${target.needCap}`);
  if (target.automerge) notes.push("automerge ON");
  if (target.promptHint !== undefined) notes.push(`hint: ${target.promptHint}`);
  return notes.length === 1 ? [] : [notes.join(" · ")];
}

function renderMemory(table: TargetTable): string {
  if (!table.memory.enabled) return "memory   off";
  const { repo, branch, dir, interval } = table.memory;
  return `memory   ${repo} ${branch}:${dir}/ every ${interval}`;
}

/** Every problem with the table, or a line saying there are none. */
export function renderProblems(snapshot: BridgeSnapshot): string {
  if (snapshot.problems.length === 0) return "table: no problems";
  const lines = [`table: ${String(snapshot.problems.length)} problem(s)`];
  for (const problem of snapshot.problems) lines.push(`  ${describeProblem(problem)}`);
  return lines.join("\n");
}

/**
 * The bridge, grouped by disposition.
 *
 * `ignored` items are counted and not listed. On a busy inbox they are almost everything — every
 * issue the dispatcher was never meant to touch — and printing them would bury the four or five
 * rows the operator opened this for.
 */
export function renderBridge(snapshot: BridgeSnapshot): string {
  const tally = tallyBridge(snapshot);
  const lines: string[] = [
    `${snapshot.inbox} — ${String(tally.claimed)} claimed · ${String(tally.held)} held · ` +
      `${String(tally.settled)} settled · ${String(tally.ignored)} ignored`,
    `${String(tally.inFlight)} in flight · ${String(tally.landed)} landed`,
    "",
  ];

  if (!snapshot.coverage.inboxSeen) {
    lines.push(
      `no projection for the inbox ${snapshot.inbox} — nothing below is computable from what was supplied`,
      "",
    );
  }
  if (snapshot.coverage.missing.length > 0) {
    // Stated before the items, not after, because it changes how every "no deliveries" row below
    // should be read: unknown, not zero.
    lines.push(
      `no projection for ${snapshot.coverage.missing.join(", ")} — ` +
        `deliveries in those repositories are unknown, not absent`,
      "",
    );
  }

  const group = (disposition: BridgeItem["disposition"], heading: string): void => {
    const rows = snapshot.items.filter((item) => item.disposition === disposition);
    if (rows.length === 0) return;
    lines.push(`${heading} (${String(rows.length)})`);
    for (const row of rows) lines.push(...renderItem(row));
    lines.push("");
  };

  group("claimed", "claimed — a live target, dispatched on the next tick");
  group("held", "held — the target is paused, no new spawn");
  group("settled", "settled — closed");

  for (const item of snapshot.items) {
    if (item.shadowed.length === 0) continue;
    lines.push(
      `#${String(item.issue)} also matches ${item.shadowed.map((t) => t.repo).join(", ")} — ` +
        `unreachable, resolution stops at the first match`,
    );
  }

  if (snapshot.orphans.length > 0) {
    lines.push(`orphan deliveries (${String(snapshot.orphans.length)}) — no such issue in the projection`);
    for (const orphan of snapshot.orphans) {
      lines.push(`  ${orphan.repo}#${String(orphan.number)} → #${String(orphan.issue)}  ${orphan.title}`);
    }
    lines.push("");
  }

  lines.push(renderProblems(snapshot));
  return lines.join("\n").trimEnd();
}

function renderItem(item: BridgeItem): readonly string[] {
  const target = item.target === null ? "—" : item.target.repo;
  const head = `  #${String(item.issue).padEnd(5)} ${pad(target, 26)} ${item.title}`;
  if (item.deliveries.length === 0) return [head];
  const lines = [head];
  for (const delivery of item.deliveries) {
    const status = delivery.merged
      ? "merged"
      : delivery.state === "closed"
        ? "closed"
        : delivery.draft
          ? "draft"
          : "open";
    lines.push(`          ${delivery.repo}#${String(delivery.number)}  ${status}  via ${delivery.link}`);
  }
  return lines;
}
