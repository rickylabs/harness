/**
 * The workflow, as data — milestone down to subagent run.
 *
 * The reason this is a definition and not a procedure is Principle 7: deterministic work belongs in
 * the daemon. A workflow expressed as code that calls things is a workflow you can only inspect by
 * running it, and running it is exactly what you are not allowed to do before the gates pass. So the
 * shape is inert: steps, what each one needs, and what it must cite. Deciding what may run next is a
 * pure function over that shape and the current state (`plan.ts`); *doing* it is somebody else's job.
 *
 * Two words collide here and it is worth being plain about it. `stage` is one of the five phases the
 * owner named — decompose, dispatch, gate, review, land — and it is where a step sits in the story.
 * `kind` is what a step *is*: a `read` gathers evidence, an `effect` changes the world, a `gate` can
 * refuse. Most gates live in the `gate` stage; not all of them do, because a decomposition has to be
 * gated before anything is written down, and that gate belongs to decompose.
 *
 * The one structural rule is Principle 5, and it is checked rather than asserted: **every effect step
 * must have a gate somewhere in what it needs.** A workflow whose effects can be reached without
 * passing a gate is not a workflow with a governance problem, it is a workflow that does not encode
 * governance at all, and `checkWorkflow` refuses it by name.
 */

export type Stage = "decompose" | "dispatch" | "gate" | "review" | "land";

export type StepKind =
  /** Gathers evidence. Changes nothing, refuses nothing. */
  | "read"
  /** May refuse. Downstream effects do not run until it has passed. */
  | "gate"
  /** Changes the world outside this process: writes an issue, dispatches a run, merges a branch. */
  | "effect";

export interface Step {
  readonly id: string;
  readonly stage: Stage;
  readonly kind: StepKind;
  /** Step ids that must be done first. Declaration order is the plan's order. */
  readonly needs: readonly string[];
  /**
   * What this step must cite to be recorded as done — Principle 3, as a field.
   *
   * An empty list means the step makes no claim. Anything else, and `settle` refuses to mark it done
   * without citations, which is the difference between a workflow that says evidence is required and
   * one that requires it.
   */
  readonly evidence: readonly string[];
  readonly describe: string;
}

export interface Workflow {
  readonly name: string;
  readonly steps: readonly Step[];
}

export type ProblemRule =
  | "duplicate-id"
  | "unknown-need"
  | "self-need"
  | "cycle"
  | "ungated-effect"
  | "unreachable";

export interface Problem {
  readonly step: string;
  readonly rule: ProblemRule;
  readonly detail: string;
}

/** Every step id, in declaration order, that the given step transitively needs. */
export function prerequisites(workflow: Workflow, id: string): readonly string[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const found = new Set<string>();
  const walk = (current: string): void => {
    const step = byId.get(current);
    if (step === undefined) return;
    for (const need of step.needs) {
      if (found.has(need)) continue;
      found.add(need);
      walk(need);
    }
  };
  walk(id);
  return workflow.steps.filter((step) => found.has(step.id)).map((step) => step.id);
}

function cycleThrough(workflow: Workflow, id: string): boolean {
  return prerequisites(workflow, id).includes(id);
}

/**
 * Check a workflow definition against the rules it is supposed to encode.
 *
 * This runs on the built-in definition as a test and from `dsh-coordinator workflow`, so a workflow
 * that has quietly lost its gates fails somewhere a person looks rather than at the moment an
 * ungated effect runs.
 */
export function checkWorkflow(workflow: Workflow): readonly Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const ids = new Set(workflow.steps.map((step) => step.id));

  for (const step of workflow.steps) {
    if (seen.has(step.id)) {
      problems.push({ step: step.id, rule: "duplicate-id", detail: "two steps share this id" });
      continue;
    }
    seen.add(step.id);
  }

  for (const step of workflow.steps) {
    for (const need of step.needs) {
      if (need === step.id) {
        problems.push({ step: step.id, rule: "self-need", detail: "a step cannot need itself" });
      } else if (!ids.has(need)) {
        problems.push({ step: step.id, rule: "unknown-need", detail: `needs ${need}, which is not a step` });
      }
    }
    if (cycleThrough(workflow, step.id)) {
      problems.push({ step: step.id, rule: "cycle", detail: "this step is reachable from itself" });
    }
  }

  // Principle 5, checked. An effect with no gate upstream is the whole failure mode this system
  // exists to prevent, so it is named as its own rule rather than folded into a generic warning.
  for (const step of workflow.steps) {
    if (step.kind !== "effect") continue;
    if (cycleThrough(workflow, step.id)) continue;
    const gated = prerequisites(workflow, step.id).some(
      (id) => workflow.steps.find((s) => s.id === id)?.kind === "gate",
    );
    if (!gated) {
      problems.push({
        step: step.id,
        rule: "ungated-effect",
        detail: "an effect with no gate among its prerequisites — nothing may mutate before a gate",
      });
    }
  }

  // A step nothing needs and that needs nothing is not wired into the workflow at all. It is not
  // dangerous, but it is dead, and dead steps are where stale assumptions live.
  const needed = new Set(workflow.steps.flatMap((step) => step.needs));
  for (const step of workflow.steps) {
    if (step.needs.length === 0 && !needed.has(step.id) && workflow.steps.length > 1) {
      problems.push({ step: step.id, rule: "unreachable", detail: "nothing needs it and it needs nothing" });
    }
  }

  return problems;
}

/**
 * The milestone workflow this repository actually runs.
 *
 * It is written down because a workflow everybody carries in their head is a workflow that differs
 * per agent. Each gate here corresponds to something that exists or is being built: the decomposition
 * gate to coverage of a milestone's acceptance items, the admission gate to E5's regimes, the
 * evaluator gate to `independence.ts`, the review and land gates to the verdicts in
 * `doctrine/WORKFLOW.md`.
 */
export const MILESTONE_WORKFLOW: Workflow = {
  name: "milestone",
  steps: [
    {
      id: "read-milestone",
      stage: "decompose",
      kind: "read",
      needs: [],
      evidence: ["milestone"],
      describe: "read the milestone and its acceptance items",
    },
    {
      id: "propose-tasks",
      stage: "decompose",
      kind: "read",
      needs: ["read-milestone"],
      evidence: ["task-list"],
      describe: "propose the task breakdown, without writing anything",
    },
    {
      id: "gate-decomposition",
      stage: "decompose",
      kind: "gate",
      needs: ["propose-tasks"],
      evidence: ["coverage"],
      describe: "every acceptance item is covered by a task, or this refuses",
    },
    {
      id: "write-tasks",
      stage: "decompose",
      kind: "effect",
      needs: ["gate-decomposition"],
      evidence: ["issue-urls"],
      describe: "create the issues — the first thing that touches the world",
    },
    {
      id: "gate-admission",
      stage: "gate",
      kind: "gate",
      needs: ["write-tasks"],
      evidence: ["regime", "allowance"],
      describe: "the governing regime admits this run, or it does not",
    },
    {
      id: "select-evaluator",
      stage: "gate",
      kind: "gate",
      needs: ["write-tasks"],
      evidence: ["roster", "decision"],
      describe: "an independent evaluator exists for the work about to be authored",
    },
    {
      id: "dispatch-run",
      stage: "dispatch",
      kind: "effect",
      needs: ["gate-admission", "select-evaluator"],
      evidence: ["run-id", "payload"],
      describe: "dispatch the subagent run in the wire format",
    },
    {
      id: "collect-evidence",
      stage: "review",
      kind: "read",
      needs: ["dispatch-run"],
      evidence: ["transcript", "diff"],
      describe: "gather what the run produced",
    },
    {
      id: "gate-review",
      stage: "review",
      kind: "gate",
      needs: ["collect-evidence", "select-evaluator"],
      evidence: ["verdict", "evaluator"],
      describe: "the evaluator chosen before the work began returns a verdict",
    },
    {
      id: "gate-land",
      stage: "land",
      kind: "gate",
      needs: ["gate-review"],
      evidence: ["checks", "verdict"],
      describe: "checks are green and the verdict permits landing",
    },
    {
      id: "land",
      stage: "land",
      kind: "effect",
      needs: ["gate-land"],
      evidence: ["merge-commit"],
      describe: "land the change",
    },
  ],
};

export const WORKFLOWS: readonly Workflow[] = [MILESTONE_WORKFLOW];
