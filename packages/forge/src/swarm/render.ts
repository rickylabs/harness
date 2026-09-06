/**
 * Terminal output for the comment trigger.
 *
 * Two rules shape this file, and both are about a public repository being the input.
 *
 * **The free-text prompt is never printed.** `SwarmVerdict.parsed` carries it, because refusing to
 * decode a refused comment would mean refusing to say what it was trying to do. But a refused
 * `/swarm` is by definition text a stranger wrote, and this output is read in a terminal, pasted
 * into issues and quoted back into agent context. The prompt is arbitrary prose whose whole purpose
 * is to be followed by an agent, so it stays in `--json`, where a reader has to have gone looking
 * for it. The settings line is printed, because it is what makes a refusal worth reading — one
 * value per key, each held to a line by the grammar and cut short here.
 *
 * **Refused comments are the point, not the noise.** `renderBridge` counts `ignored` and prints
 * nothing, because those are issues the dispatcher was never meant to touch. Here the refusals are
 * the reason to run the command, so the authority refusals lead — with the author's login attached
 * — and only the ones decided before the `/swarm` test are collapsed into counts.
 */

import { SKIPPED_REFUSALS, describeRefusal, isSkippedRefusal, tallySwarm } from "./trigger.js";
import type { SwarmAdmission, SwarmRefusal, SwarmVerdict } from "./trigger.js";

const truncateInline = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Everything the admission decided, refusals first. */
export function renderTriggers(admission: SwarmAdmission): string {
  const tally = tallySwarm(admission);
  const lines: string[] = [
    `${admission.inbox} ← ${String(tally.examined)} comment(s) · ${String(tally.triggers)} /swarm · ` +
      `${String(tally.honoured)} honoured · ${String(tally.unauthorised)} unauthorised`,
    `bot ${admission.botLogin || "(unset) — the comment trigger is off entirely"}`,
    "",
  ];

  if (admission.unfetched.length > 0) {
    // Before the verdicts, not after, because it changes how "0 honoured" should be read.
    lines.push(
      `no comment feed for ${admission.unfetched.join(", ")} — triggers there are unknown, not absent`,
      "",
    );
  }
  if (admission.unwatched.length > 0) {
    lines.push(
      `feed supplied for ${admission.unwatched.join(", ")}, which no target names — every comment refused`,
      "",
    );
  }

  const unauthorised = admission.verdicts.filter((v) => v.refusal === "not-bot-login");
  if (unauthorised.length > 0) {
    lines.push(`unauthorised (${String(unauthorised.length)}) — a /swarm from somebody who is not the bot`);
    for (const verdict of unauthorised) lines.push(...renderVerdict(verdict));
    lines.push("");
  }

  const honoured = admission.verdicts.filter((v) => v.honoured);
  if (honoured.length > 0) {
    lines.push(`honoured (${String(honoured.length)}) — mirrored into the inbox and dispatched`);
    for (const verdict of honoured) lines.push(...renderVerdict(verdict));
    lines.push("");
  }

  const other = admission.verdicts.filter(
    (v) => !v.honoured && v.refusal !== null && v.refusal !== "not-bot-login" && !isSkippedRefusal(v.refusal),
  );
  if (other.length > 0) {
    lines.push(`refused (${String(other.length)}) — a /swarm the dispatcher did not act on`);
    for (const verdict of other) lines.push(...renderVerdict(verdict));
    lines.push("");
  }

  const skipped = countBy(admission.verdicts.filter((v) => v.refusal !== null && isSkippedRefusal(v.refusal)));
  if (skipped.length > 0) {
    lines.push("not considered");
    for (const [refusal, count] of skipped) {
      lines.push(`  ${String(count).padStart(4)}  ${refusal} — ${describeRefusal(refusal)}`);
    }
    lines.push("");
  }

  const trailers = admission.verdicts.filter((v) => v.trailers.length > 0);
  if (trailers.length > 0) {
    lines.push(
      `attribution trailers (${String(trailers.length)}) — these lines reach the agent's goal preamble ` +
        `and end up in its commits`,
    );
    for (const verdict of trailers) {
      for (const trailer of verdict.trailers) {
        lines.push(`  ${verdict.repo}#c${String(verdict.commentId)}  ${truncateInline(trailer, 72)}`);
      }
    }
  }

  return lines.join("\n").trimEnd();
}

/** Refusal counts in the order `SKIPPED_REFUSALS` declares them, so the output is stable. */
function countBy(verdicts: readonly SwarmVerdict[]): readonly (readonly [SwarmRefusal, number])[] {
  const counts = new Map<SwarmRefusal, number>();
  for (const verdict of verdicts) {
    if (verdict.refusal === null) continue;
    counts.set(verdict.refusal, (counts.get(verdict.refusal) ?? 0) + 1);
  }
  return SKIPPED_REFUSALS.flatMap((refusal) => {
    const count = counts.get(refusal);
    return count === undefined ? [] : [[refusal, count] as const];
  });
}

/**
 * One verdict: who wrote it, where, and what it asked for.
 *
 * The author leads, because on every line in this output that is the field the reader is checking.
 */
function renderVerdict(verdict: SwarmVerdict): readonly string[] {
  const where = verdict.ref ?? verdict.repo;
  const head = `  @${verdict.author || "(deleted)"}  ${where}  ${verdict.url}`;
  const lines = [head];
  if (verdict.refusal !== null) lines.push(`      ${describeRefusal(verdict.refusal)}`);
  const asked = describeRun(verdict);
  if (asked !== null) lines.push(`      would run ${asked}`);
  for (const warning of verdict.warnings) {
    lines.push(`      warning ${warning.kind}: ${truncateInline(warning.detail, 68)}`);
  }
  return lines;
}

/**
 * The run a block asked for, from the settings line only.
 *
 * `profile` and `prompt` are left out, and the rest are cut short. Only `executes` is a closed
 * vocabulary — a `Harness` the grammar resolved. `model`, `router`, `effort` and `max-tokens` are
 * whatever the comment's author typed: the kv regex holds each to a single line, so none of them can
 * smuggle in a paragraph, but "a single line" is still enough room for a sentence addressed to
 * whoever reads this output. Thirty-two characters is longer than every real model id and shorter
 * than an instruction, and the cut is visible.
 */
function describeRun(verdict: SwarmVerdict): string | null {
  if (verdict.parsed === null) return null;
  const { executes, overrides, truncated } = verdict.parsed;
  const parts: string[] = [executes];
  const setting = (name: string, value: string): void => {
    if (value !== "") parts.push(`${name} ${truncateInline(value, 32)}`);
  };
  setting("model", overrides.model);
  setting("router", overrides.router);
  setting("effort", overrides.effort);
  setting("max-tokens", overrides.maxTokens);
  if (overrides.timeoutNs > 0) parts.push(`timeout ${String(overrides.timeoutNs / 1e9)}s`);
  if (truncated) parts.push("(a code fence cut the block short)");
  return parts.join(" · ");
}

/** The mirrored issue, as a heredoc-free preview of what `gh issue create` would be handed. */
export function renderMirrorPreview(mirror: { title: string; body: string; label: string }): string {
  return [`label  ${mirror.label}`, `title  ${mirror.title}`, "", mirror.body].join("\n");
}
