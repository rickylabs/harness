/**
 * Terminal output for the supervision tick.
 *
 * Two rules shape it.
 *
 * **The transcript is not dumped.** `redact.ts` makes the pane tail safe to print, which is not the
 * same as making it worth printing: it is a screenful of terminal per pull, and burying five
 * steering lines under four hundred lines of agent output is how a reader stops reading. The one
 * exception is a *held* verdict, where the last pane line is printed — "held because the agent is
 * mid-turn" is the claim in this output a reader is most likely to want to check, and that line is
 * the evidence for it. Everything else stays in `--json`, redacted, where a reader has to have gone
 * looking for it.
 *
 * **Delivered and held are separated, not merged.** They differ in exactly one respect that does not
 * show in the lines themselves: a delivered note is marked and will not come back, a held one is
 * not and will. Printing them in one block would make the two indistinguishable at a glance, which
 * is the confusion the whole module is built to avoid.
 */

import {
  SUPERVISION_REASONS,
  describeSupervisionProblem,
  describeSupervisionReason,
  pullKey,
  tallySupervision,
} from "./steer.js";
import type { Supervision, SupervisionProblem, SupervisionReason, SupervisionVerdict } from "./steer.js";

const truncateInline = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const lastLine = (text: string): string => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const line = lines.length === 0 ? "" : lines[lines.length - 1];
  return (line ?? "").trim();
};

/** Reasons that mean "nothing was said", collapsed into counts rather than listed one by one. */
const COLLAPSED: readonly SupervisionReason[] = ["nothing-new", "quiet", "draft", "automerge-on"];

/** Everything the tick decided, with what was actually forwarded first. */
export function renderSupervision(
  supervision: Supervision,
  state: { path: string; found: boolean; pulls: number },
  problems: readonly SupervisionProblem[],
): string {
  const tally = tallySupervision(supervision);
  const lines: string[] = [
    `${supervision.inbox} ← ${String(tally.pulls)} pull(s) · ${String(tally.steering)} steering · ` +
      `${String(tally.notes)} note(s) · ${String(tally.held)} held · ${String(tally.quiet)} quiet`,
    state.found
      ? `state ${state.path} · ${String(state.pulls)} pull(s) already told something`
      : `no state at ${state.path} — this is a first tick, so everything open counts as new`,
    "",
  ];

  const steering = supervision.verdicts.filter((verdict) => verdict.reason === "steering");
  if (steering.length > 0) {
    lines.push(`steering (${String(steering.length)}) — forwarded, and marked so it does not come back`);
    for (const verdict of steering) lines.push(...renderVerdict(verdict, false));
    lines.push("");
  }

  const held = supervision.verdicts.filter((verdict) => verdict.reason === "held-mid-turn");
  if (held.length > 0) {
    lines.push(`held (${String(held.length)}) — the agent is mid-turn; nothing forwarded and nothing marked`);
    for (const verdict of held) lines.push(...renderVerdict(verdict, true));
    lines.push("");
  }

  const untargeted = supervision.verdicts.filter((verdict) => verdict.reason === "untargeted");
  if (untargeted.length > 0) {
    lines.push(`untargeted (${String(untargeted.length)}) — fetched, decided, and steering nobody`);
    for (const verdict of untargeted) lines.push(`  ${pullKey(verdict.repo, verdict.number)}  ${verdict.url}`);
    lines.push("");
  }

  const counts = countBy(supervision.verdicts);
  if (counts.length > 0) {
    lines.push("nothing to say");
    for (const [reason, count] of counts) {
      lines.push(`  ${String(count).padStart(4)}  ${reason} — ${describeSupervisionReason(reason)}`);
    }
    lines.push("");
  }

  if (tally.redactions > 0) {
    // Ahead of the problems as well as inside them: this is the line that decides whether somebody
    // has to rotate a credential tonight, and it should not need scrolling to.
    lines.push(`${String(tally.redactions)} credential(s) redacted out of pane output — see the refusals below`, "");
  }

  if (problems.length > 0) {
    lines.push(`${String(problems.length)} problem(s)`);
    for (const problem of problems) {
      lines.push(`  ${problem.reason}  ${truncateInline(describeSupervisionProblem(problem), 108)}`);
    }
  }

  return lines.join("\n").trimEnd();
}

/** Counts in `SUPERVISION_REASONS` order, so two runs print the same rows in the same places. */
function countBy(verdicts: readonly SupervisionVerdict[]): readonly (readonly [SupervisionReason, number])[] {
  const counts = new Map<SupervisionReason, number>();
  for (const verdict of verdicts) {
    if (!COLLAPSED.some((reason) => reason === verdict.reason)) continue;
    counts.set(verdict.reason, (counts.get(verdict.reason) ?? 0) + 1);
  }
  return SUPERVISION_REASONS.flatMap((reason) => {
    const count = counts.get(reason);
    return count === undefined ? [] : [[reason, count] as const];
  });
}

/** One pull: where it is, whose it is, and the lines the agent gets. */
function renderVerdict(verdict: SupervisionVerdict, withPane: boolean): readonly string[] {
  const agent = verdict.target?.agents[0] ?? "(no agent)";
  const lines = [`  ${pullKey(verdict.repo, verdict.number)}  ${agent}  ${verdict.url}`];
  for (const note of verdict.steering) lines.push(`      ${note.signal}  ${truncateInline(note.line, 100)}`);
  if (withPane) {
    const tail = lastLine(verdict.transcript);
    if (tail !== "") lines.push(`      pane  ${truncateInline(tail, 100)}`);
  }
  return lines;
}
