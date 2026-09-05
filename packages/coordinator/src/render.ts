/**
 * The decision, for a person.
 *
 * Principle 10: the conclusion first, then how it got there. So the evaluator's name is on line one
 * and the rejections are underneath — a reader deciding whether to trust the gate needs the verdict
 * in one glance and the working only if they doubt it.
 *
 * The rejections are printed in full rather than summarised. They are short, they are the evidence,
 * and a summary of them ("3 candidates rejected") is precisely the form in which a wrong rule hides.
 */

import { DIFF_PATH_CAP } from "./canonical.js";
import type { Actor, EvaluatorDecision, Rejection } from "./independence.js";
import type { JournalComparison } from "./journal.js";
import type { ReplayResult } from "./replay.js";

function describe(actor: Actor): string {
  const effort = actor.effort === null ? "" : ` · ${actor.effort}`;
  return `${actor.id}  (${actor.family} · ${actor.seam} · ${actor.model}${effort})`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function rejections(rejected: readonly Rejection[]): readonly string[] {
  if (rejected.length === 0) return [];
  const idWidth = Math.max(...rejected.map((r) => r.candidate.length));
  const ruleWidth = Math.max(...rejected.map((r) => r.rule.length));
  return [
    "",
    `  not chosen (${rejected.length}):`,
    ...rejected.map((r) => `    ${pad(r.candidate, idWidth)}  ${pad(r.rule, ruleWidth)}  ${r.detail}`),
  ];
}

/** A decision as lines, without a trailing newline. */
export function renderDecision(decision: EvaluatorDecision): string {
  const head =
    decision.kind === "selected"
      ? [`evaluator: ${describe(decision.evaluator)}`]
      : [
          "BLOCKED — no independent evaluator",
          "",
          decision.transient
            ? "  every legal evaluator is busy: this clears on its own when a quota window resets."
            : "  waiting will not help: no candidate on this roster can ever be legal under this policy.",
        ];

  return [
    ...head,
    "",
    `  policy:  ${decision.policy}`,
    `  author:  ${describe(decision.author)}`,
    `  because: ${decision.because}`,
    ...rejections(decision.rejected),
  ].join("\n");
}

/** Named paths, with an honest word when the list was capped rather than complete. */
function paths(where: readonly string[]): string {
  const capped = where.length >= DIFF_PATH_CAP ? ` (first ${DIFF_PATH_CAP})` : "";
  return `${where.join(", ")}${capped}`;
}

/** A replay result as lines, without a trailing newline. */
export function renderReplay(result: ReplayResult): string {
  const head =
    result.verdict === "divergent"
      ? [
          `DIVERGENT — ${result.divergent.length} of ${result.checked} re-ran decision(s) came back different`,
          "",
          "  The inputs are identical and the output is not. That is not a plan change, it is",
          "  nondeterminism: something in the decider is reading state that is not in the journal.",
        ]
      : result.verdict === "unchecked"
        ? [
            `UNCHECKED — nothing in this journal could be re-run (${result.total} entr${result.total === 1 ? "y" : "ies"} read)`,
            "",
            "  This is a broken check, not a passing one. Do not cite it as evidence of determinism.",
          ]
        : [`replay: identical — ${result.checked} of ${result.total} decision(s) re-ran to the same answer`];

  const lines = [...head];
  if (result.divergent.length > 0) {
    lines.push("", `  divergent (${result.divergent.length}):`);
    for (const d of result.divergent) lines.push(`    ${d.id}  [${d.kind}]  differs at ${paths(d.at)}`);
  }
  if (result.unreplayable.length > 0) {
    lines.push("", `  not re-run (${result.unreplayable.length}):`);
    for (const u of result.unreplayable) lines.push(`    ${u.id}  [${u.kind}]  ${u.why}`);
  }
  return lines.join("\n");
}

/** A journal comparison as lines, without a trailing newline. */
export function renderComparison(comparison: JournalComparison): string {
  const explained = comparison.changes.filter((c) => c.kind === "explained");
  const unexplained = comparison.changes.filter((c) => c.kind === "unexplained");
  const structural = comparison.changes.filter(
    (c) => c.kind === "added" || c.kind === "removed" || c.kind === "moved",
  );

  const lines: string[] = comparison.identical
    ? [`plan: unchanged — ${comparison.planBefore}`]
    : [
        `plan: changed — ${comparison.changes.length} difference(s), ${comparison.unexplained} unexplained`,
        "",
        `  before: ${comparison.planBefore}`,
        `  after:  ${comparison.planAfter}`,
      ];

  if (unexplained.length > 0) {
    // Loudest thing on the page, because it is the only finding here that means the code is wrong
    // rather than that the world moved on.
    lines.push("", `  UNEXPLAINED (${unexplained.length}) — the output changed and no input did:`);
    for (const c of unexplained) {
      if (c.kind !== "unexplained") continue;
      lines.push(`    ${c.id}  output differs at ${paths(c.output)}`);
    }
  }
  if (explained.length > 0) {
    lines.push("", `  explained (${explained.length}):`);
    for (const c of explained) {
      if (c.kind !== "explained") continue;
      lines.push(`    ${c.id}  ${c.outputChanged ? "output changed" : "output unchanged"}, because ${paths(c.inputs)}`);
    }
  }
  if (structural.length > 0) {
    lines.push("", `  structure (${structural.length}):`);
    for (const c of structural) {
      if (c.kind === "moved") lines.push(`    ${c.id}  moved from position ${c.from} to ${c.to}`);
      else if (c.kind === "added" || c.kind === "removed") lines.push(`    ${c.id}  ${c.kind} [${c.decisionKind}]`);
    }
  }
  return lines.join("\n");
}
