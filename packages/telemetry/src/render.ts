/**
 * Render a snapshot as text.
 *
 * The output is the literal replacement for typing `status ?` at an orchestrator, so it is written
 * for someone reading a terminal at a glance, not for a parser. Three properties matter:
 *
 * - Governance comes first. "Why is nothing running" is a status question, and today it has no
 *   answer at all — so the quota line is above the work, not in a footer.
 * - Notes are never dropped. A snapshot that could not read a store must say so on the same screen
 *   as the work it did find, or it reads as a complete answer.
 * - No colour, no cursor control. This gets pasted into issues and read over ssh.
 */

import { sumUsage, type AttributedRun, type QuotaReading, type TelemetrySnapshot } from "./model.js";
import { flatten } from "./snapshot.js";

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

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
  if (snapshot.quota.length === 0) {
    // Said out loud. A missing governance section reads as "all clear", which is the one thing it
    // does not mean: no seam reported a window, so capacity is simply unknown.
    lines.push("governance: no seam reported a quota window in this scan");
  } else {
    lines.push("governance:");
    for (const reading of snapshot.quota) lines.push(renderQuota(reading, now));
  }

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
    for (const run of snapshot.unattributed) lines.push(...renderRun(run, now, 0));
  }

  if (snapshot.notes.length > 0) {
    lines.push("");
    lines.push("notes:");
    for (const note of snapshot.notes) lines.push(`  ${note}`);
  }

  return lines.join("\n");
}
