import assert from "node:assert/strict";
import { test } from "node:test";
import { admissibleDispatch } from "./dispatch-admission.js";
import { settle, type StepState } from "./plan.js";
import { evidenceName, MILESTONE_WORKFLOW, prerequisites } from "./workflow.js";
function states(): readonly StepState[] {
  let result: readonly StepState[] = [];
  for (const id of prerequisites(MILESTONE_WORKFLOW, "dispatch-run")) {
    const step = MILESTONE_WORKFLOW.steps.find(s => s.id === id)!;
    const next = settle(MILESTONE_WORKFLOW, result, id, { outcome: "done", citations: Object.fromEntries(step.evidence.map(e => [evidenceName(e), "https://example.test/evidence"])) });
    assert.ok(next.settled); result = next.states;
  }
  return result;
}
function changed(id: string, fields: Partial<StepState>): readonly StepState[] { return states().map(s => s.id === id ? { ...s, ...fields } : s); }
function rule(input: readonly StepState[], expected: string) {
  const result = admissibleDispatch(input); assert.equal(result.ok, false);
  if (!result.ok) assert.equal("rule" in result.failure ? result.failure.rule : result.failure.kind, expected);
}
test("replay validates canonical prerequisites and permits downstream pending states", () => {
  const input = states(); const result = admissibleDispatch(input); assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.states, input.filter(s => s.outcome === "done"));
});
for (const [id, fields, expected] of [
  ["read-milestone", { citations: {} }, "uncited"],
  ["read-milestone", { citations: { milestone: "trust my prose" } }, "unreferenced"],
  ["write-tasks", { citations: { "issue-urls": "abcdef0" } }, "miscited"],
  ["dispatch-run", { outcome: "done" }, "already-settled"],
  ["gate-admission", { outcome: "forked", note: "owner answer required" }, "upstream-forked"],
  ["gate-admission", { outcome: "blocked", note: "refused" }, "upstream-blocked"],
  ["gate-admission", { outcome: "pending" }, "ungated-effect"],
  ["read-milestone", { outcome: "pending" }, "needs-unmet"],
  ["collect-evidence", { outcome: "done" }, "state-malformed"],
] as const) test(`reconstruction refuses ${expected} at ${id}`, () => rule(changed(id, fields), expected));
test("terminal notes survive pass one", () => {
  const result = admissibleDispatch(changed("gate-admission", { outcome: "forked", note: "owner answer required" }));
  assert.ok(!result.ok && "detail" in result.failure && result.failure.detail.includes("owner answer required"));
});
for (const input of [null, {}, [null], [...states(), states()[0]], [...states(), { id: "unknown", outcome: "pending", citations: {}, note: null }], changed("read-milestone", { outcome: "invalid" as StepState["outcome"] }), changed("read-milestone", { citations: null as unknown as StepState["citations"] })]) {
  test("malformed caller state refuses by name", () => rule(input as readonly StepState[], "state-malformed"));
}
