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
import type { Plan } from "./plan.js";
import type { ReplayResult } from "./replay.js";
import { evidenceKind, evidenceName, type Problem, type Workflow } from "./workflow.js";
import type { Hazard, Judgement } from "./worktree.js";

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

/**
 * A plan as lines, without a trailing newline.
 *
 * This is the answer to "status ?", so it is written for somebody who is asking it for the fourth
 * time today: one line that says where the run stands, then the detail. Forks outrank everything
 * else on the page — a run waiting on an owner is not merely stalled, it is stalled on a person who
 * does not know it yet.
 */
export function renderPlan(plan: Plan): string {
  const total = plan.done.length + plan.forks.length + plan.blocked.length + plan.runnable.length + plan.waiting.length;
  const head = plan.complete
    ? [`plan: complete — all ${plan.done.length} step(s) done`]
    : plan.forks.length > 0
      ? [
          `FORKED — ${plan.forks.length} owner decision(s) waiting, ${plan.done.length} of ${total} step(s) done`,
          "",
          "  Owner forks are raised, not resolved. Nothing downstream of these runs until a human answers.",
        ]
      : plan.blocked.length > 0
        ? [`BLOCKED — ${plan.blocked.length} step(s) refused, ${plan.done.length} of ${total} step(s) done`]
        : plan.runnable.length > 0
          ? [`plan: ${plan.runnable.length} step(s) runnable — ${plan.done.length} of ${total} done`]
          : [
              `STALLED — nothing is runnable and nothing refused (${plan.done.length} of ${total} done)`,
              "",
              "  Every remaining step is waiting on something that is itself waiting. Read the list below.",
            ];

  const lines = [...head, "", `  workflow: ${plan.workflow}`];

  if (plan.forks.length > 0) {
    lines.push("", `  forks (${plan.forks.length}) — for the owner, not for the coordinator:`);
    for (const fork of plan.forks) lines.push(`    ${fork.id}  ${fork.note}`);
  }
  if (plan.blocked.length > 0) {
    lines.push("", `  blocked (${plan.blocked.length}):`);
    for (const halt of plan.blocked) lines.push(`    ${halt.id}  ${halt.note}`);
  }
  if (plan.runnable.length > 0) {
    lines.push("", `  runnable (${plan.runnable.length}):`);
    for (const id of plan.runnable) lines.push(`    ${id}`);
  }
  if (plan.waiting.length > 0) {
    const idWidth = Math.max(...plan.waiting.map((w) => w.id.length));
    const ruleWidth = Math.max(...plan.waiting.map((w) => w.rule.length));
    lines.push("", `  waiting (${plan.waiting.length}):`);
    // One fork halts everything downstream of it, so most of this block is the same sentence over
    // and over. Printing it once keeps the reason visible and the list scannable; a reader who wants
    // it per step asks `admit --step`, where the answer has to stand on its own.
    const said = new Set<string>();
    for (const w of plan.waiting) {
      const key = `${w.rule} ${w.detail}`;
      const detail = said.has(key) ? "(as above)" : w.detail;
      said.add(key);
      lines.push(`    ${pad(w.id, idWidth)}  ${pad(w.rule, ruleWidth)}  ${detail}`);
    }
  }
  if (plan.done.length > 0) lines.push("", `  done (${plan.done.length}): ${plan.done.join(", ")}`);
  return lines.join("\n");
}

/**
 * A workflow definition and the result of checking it, as lines, without a trailing newline.
 *
 * The gate column is not decoration. It answers the only question worth asking of a definition —
 * for each step that changes the world, which gate stands in front of it — and printing it means a
 * workflow that has quietly lost a gate is visible to a reader, not only to `checkWorkflow`.
 */
export function renderWorkflow(workflow: Workflow, problems: readonly Problem[]): string {
  const head =
    problems.length > 0
      ? [
          `INVALID — ${workflow.name} has ${problems.length} problem(s)`,
          "",
          ...problems.map((p) => `    ${p.step}  ${p.rule}  ${p.detail}`),
          "",
        ]
      : [`workflow: ${workflow.name} — ${workflow.steps.length} step(s), no problems`, ""];

  const idWidth = Math.max(...workflow.steps.map((s) => s.id.length));
  const stageWidth = Math.max(...workflow.steps.map((s) => s.stage.length));
  const kindWidth = Math.max(...workflow.steps.map((s) => s.kind.length));
  const rows = workflow.steps.map((step) => {
    const needs = step.needs.length === 0 ? "—" : step.needs.join(", ");
    return `  ${pad(step.id, idWidth)}  ${pad(step.stage, stageWidth)}  ${pad(step.kind, kindWidth)}  needs ${needs}`;
  });
  const cites = workflow.steps
    .filter((step) => step.evidence.length > 0)
    .map((step) => {
      // A pinned kind is shown, because this listing is what somebody reads to find out what a step
      // owes before they run it, and "merge-commit" and "merge-commit (sha)" are different promises.
      const owed = step.evidence.map((spec) => {
        const kind = evidenceKind(spec);
        return kind === null ? evidenceName(spec) : `${evidenceName(spec)} (${kind})`;
      });
      return `    ${pad(step.id, idWidth)}  ${owed.join(", ")}`;
    });

  return [...head, ...rows, "", `  must cite (${cites.length}):`, ...cites].join("\n");
}

/**
 * The worktree census and what is at risk in it, as lines, without a trailing newline.
 *
 * The hazards come before the table and the table is printed in full underneath. The counts are the
 * answer, but the reason this output exists at all is that somebody is about to trust it with a
 * decision to delete directories, and a reader who wants to check that judgement one row at a time
 * must be able to. A summary is the form in which "swept a live worktree" hides.
 */
export function renderWorktrees(judged: readonly Judgement[], found: readonly Hazard[]): string {
  const counted = (disposition: string): number => judged.filter((j) => j.disposition === disposition).length;
  const head =
    found.length > 0
      ? [
          `AT RISK — ${found.length} hazard(s) across ${judged.length} worktree(s)`,
          "",
          "  The archiver is on course to take something that is in use, or a protection exists here",
          "  and nowhere else. Neither resolves by waiting.",
          "",
          ...found.map((hazard) => `    ${hazard.rule}  ${hazard.subject}  ${hazard.detail}`),
        ]
      : [
          `worktrees: ${judged.length} judged — ${counted("protect")} protected, ` +
            `${counted("leave")} left, ${counted("sweep")} sweepable`,
        ];

  if (judged.length === 0) return head.join("\n");

  const pathWidth = Math.max(...judged.map((j) => j.path.length));
  const dispositionWidth = Math.max(...judged.map((j) => j.disposition.length));
  const ruleWidth = Math.max(...judged.map((j) => j.rule.length));
  return [
    ...head,
    "",
    ...judged.map(
      (j) =>
        `  ${pad(j.path, pathWidth)}  ${pad(j.disposition, dispositionWidth)}  ` +
        `${pad(j.rule, ruleWidth)}  ${j.detail}`,
    ),
  ].join("\n");
}
