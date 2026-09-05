import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkWorkflow,
  prerequisites,
  MILESTONE_WORKFLOW,
  WORKFLOWS,
  type Step,
  type Workflow,
} from "./workflow.js";

function step(id: string, kind: Step["kind"], needs: readonly string[], evidence: readonly string[] = []): Step {
  return { id, stage: "dispatch", kind, needs, evidence, describe: id };
}

function workflow(...steps: readonly Step[]): Workflow {
  return { name: "test", steps };
}

describe("prerequisites", () => {
  it("walks transitively, not just the direct needs", () => {
    const w = workflow(step("a", "read", []), step("b", "read", ["a"]), step("c", "read", ["b"]));
    assert.deepEqual(prerequisites(w, "c"), ["a", "b"]);
  });

  it("returns them in declaration order, whatever order they were reached in", () => {
    // The plan's output is compared byte for byte by the journal, so "which order did the walk
    // happen to visit these in" must never be able to leak into it.
    const w = workflow(step("a", "read", []), step("b", "read", ["a"]), step("c", "read", ["b", "a"]));
    assert.deepEqual(prerequisites(w, "c"), ["a", "b"]);
  });

  it("terminates on a cycle instead of recursing forever", () => {
    const w = workflow(step("a", "read", ["b"]), step("b", "read", ["a"]));
    assert.deepEqual(prerequisites(w, "a"), ["a", "b"]);
  });

  it("is empty for a step nothing precedes", () => {
    assert.deepEqual(prerequisites(MILESTONE_WORKFLOW, "read-milestone"), []);
  });

  it("is empty for a step that does not exist", () => {
    assert.deepEqual(prerequisites(MILESTONE_WORKFLOW, "no-such-step"), []);
  });
});

describe("checkWorkflow", () => {
  it("rejects an effect with no gate among its prerequisites", () => {
    // The rule this whole file exists for. An effect reachable without passing a gate is not a
    // workflow with a governance defect, it is a workflow that does not encode governance.
    const w = workflow(step("look", "read", []), step("write", "effect", ["look"]));
    const problems = checkWorkflow(w);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.rule, "ungated-effect");
    assert.equal(problems[0]?.step, "write");
  });

  it("accepts an effect gated indirectly, not only by a direct need", () => {
    const w = workflow(
      step("look", "read", []),
      step("gate", "gate", ["look"]),
      step("prepare", "read", ["gate"]),
      step("write", "effect", ["prepare"]),
    );
    assert.deepEqual(checkWorkflow(w), []);
  });

  it("names a step that needs itself", () => {
    const w = workflow(step("a", "read", []), step("b", "read", ["b"]));
    const rules = checkWorkflow(w).map((p) => p.rule);
    assert.ok(rules.includes("self-need"));
  });

  it("names a need that is not a step", () => {
    const w = workflow(step("a", "read", []), step("b", "read", ["a", "ghost"]));
    const problem = checkWorkflow(w).find((p) => p.rule === "unknown-need");
    assert.equal(problem?.detail, "needs ghost, which is not a step");
  });

  it("names a cycle", () => {
    const w = workflow(step("a", "read", ["b"]), step("b", "read", ["a"]));
    const cycles = checkWorkflow(w).filter((p) => p.rule === "cycle");
    assert.equal(cycles.length, 2);
  });

  it("does not also report a cycled effect as ungated", () => {
    // One defect, one finding. A cycle already means the prerequisites are meaningless, and a
    // second problem derived from them is noise that buries the first.
    const w = workflow(step("a", "gate", ["b"]), step("b", "effect", ["a"]));
    const rules = checkWorkflow(w).map((p) => p.rule);
    assert.equal(rules.filter((r) => r === "ungated-effect").length, 0);
  });

  it("names a duplicate id once, on the second occurrence", () => {
    const w = workflow(step("a", "read", []), step("a", "read", []), step("b", "read", ["a"]));
    const duplicates = checkWorkflow(w).filter((p) => p.rule === "duplicate-id");
    assert.equal(duplicates.length, 1);
  });

  it("names a step nothing needs and that needs nothing", () => {
    const w = workflow(step("a", "read", []), step("b", "read", ["a"]), step("orphan", "read", []));
    const problem = checkWorkflow(w).find((p) => p.rule === "unreachable");
    assert.equal(problem?.step, "orphan");
  });

  it("does not call a lone step unreachable", () => {
    assert.deepEqual(checkWorkflow(workflow(step("only", "read", []))), []);
  });
});

describe("MILESTONE_WORKFLOW", () => {
  it("passes its own check", () => {
    // The definition this repository actually runs is held to the rule it exists to encode. A
    // built-in workflow that fails checkWorkflow would make the check decorative.
    assert.deepEqual(checkWorkflow(MILESTONE_WORKFLOW), []);
  });

  it("covers all five stages the owner named", () => {
    const stages = new Set(MILESTONE_WORKFLOW.steps.map((s) => s.stage));
    assert.deepEqual([...stages].sort(), ["decompose", "dispatch", "gate", "land", "review"]);
  });

  it("gates every effect, and there is at least one effect to gate", () => {
    const effects = MILESTONE_WORKFLOW.steps.filter((s) => s.kind === "effect");
    assert.ok(effects.length > 0);
    for (const effect of effects) {
      const upstream = prerequisites(MILESTONE_WORKFLOW, effect.id);
      const gated = upstream.some((id) => MILESTONE_WORKFLOW.steps.find((s) => s.id === id)?.kind === "gate");
      assert.ok(gated, `${effect.id} has no gate upstream`);
    }
  });

  it("makes every gate cite something", () => {
    // A gate that records no evidence is a gate whose verdict cannot be checked afterwards, which
    // is the same thing as an agent asserting it passed.
    for (const gate of MILESTONE_WORKFLOW.steps.filter((s) => s.kind === "gate")) {
      assert.ok(gate.evidence.length > 0, `${gate.id} cites nothing`);
    }
  });

  it("puts the review gate downstream of the evaluator choice", () => {
    // Generator is not evaluator, and the evaluator is chosen before the work exists. If the review
    // gate could run without select-evaluator upstream, the reviewer could be picked to suit the
    // diff — which is the failure the independence gate exists to prevent.
    assert.ok(prerequisites(MILESTONE_WORKFLOW, "gate-review").includes("select-evaluator"));
  });

  it("is registered, so --workflow can find it by name", () => {
    assert.ok(WORKFLOWS.includes(MILESTONE_WORKFLOW));
  });

  it("has unique step ids", () => {
    const ids = MILESTONE_WORKFLOW.steps.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
