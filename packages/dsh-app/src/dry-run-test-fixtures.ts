import assert from "node:assert/strict";
import { evidenceName, MILESTONE_WORKFLOW, prerequisites, settle, type StepState } from "@rickylabs/coordinator";
import type { StoreResult } from "@rickylabs/harness-contracts";
import type { DryRunPlan } from "./dry-run.js";
export const SCOPE = { repository: "example/project", milestone: "synthetic" };
export const AT = "2000-01-01T00:00:00.000Z";
export const clock = (): string => AT;
export function value<T>(result: StoreResult<T>): T { assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) throw new Error("refused"); return result.value; }
export function fixture(): DryRunPlan {
  let states: readonly StepState[] = [];
  for (const id of prerequisites(MILESTONE_WORKFLOW, "dispatch-run")) {
    const step = MILESTONE_WORKFLOW.steps.find(s => s.id === id)!;
    const result = settle(MILESTONE_WORKFLOW, states, id, { outcome: "done",
      citations: Object.fromEntries(step.evidence.map(e => [evidenceName(e), "https://example.test/evidence"])) });
    assert.ok(result.settled);
    states = result.states;
  }
  return { scope: SCOPE, workflow: "milestone", states, lane: "complex_implementation", attempt: 1,
    source: { kind: "issue", state: "open", repository: SCOPE.repository, number: 7,
      url: "https://github.com/example/project/issues/7", title: "Synthetic issue", body: "Perform synthetic work.", updatedAt: AT, labels: ["task"] },
    dispatch: { harness: "codex", model: "gpt-6-astra", effort: "medium", prompt: "Perform synthetic work." }, cwd: "/synthetic/project",
    fake: { name: "fixture", provider: "synthetic", observation: { provider: "synthetic", model: "gpt-6-astra", effort: "medium", cwd: "/synthetic/project" }, result: { kind: "accepted" } },
  };
}
