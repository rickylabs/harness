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

import type { Actor, EvaluatorDecision, Rejection } from "./independence.js";

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
