/** 0.41.0 tool lifecycle on an activity step: each rejected row is valid except for the one rule it names. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { at, dispatchId, node, read, snapshot } from "./fixtures/issue-agent-tree.js";

const start = "2025-12-31T23:59:58.000Z", end = "2025-12-31T23:59:59.000Z", after = "2026-01-01T00:00:01.000Z";
const step = { id: "step_" + "d".repeat(64), at: start, kind: "command", toolName: "bash",
  commandHead: "git status", filePath: null, summary: null, source: "opencode-transcript", target: null };
const tree = (lifecycle: unknown) => {
  const s = snapshot();
  return { ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node,
    activity: { availability: "available", reason: null, observedAt: at, steps: [{ ...step, lifecycle }] } }] }] }] };
};
const decoded = (lifecycle: unknown) => {
  const result = read(tree(lifecycle));
  return result.ok ? result.snapshot.issues[0]!.dispatches[0]!.agents[0]!.activity?.steps[0]?.lifecycle : "rejected";
};

it("decodes each native state with exactly the clocks it reports", () => {
  for (const lifecycle of [null, { state: "pending", startedAt: null, endedAt: null },
    { state: "running", startedAt: start, endedAt: null }, { state: "completed", startedAt: start, endedAt: end },
    { state: "error", startedAt: start, endedAt: end }, { state: "completed", startedAt: start, endedAt: start }]) {
    assert.deepEqual(decoded(lifecycle), lifecycle);
  }
  // Absent stays absent: every 0.40 step decodes unchanged.
  const s = snapshot();
  const plain = read({ ...s, issues: [{ ...s.issues[0], dispatches: [{ dispatchId, agents: [{ ...node,
    activity: { availability: "available", reason: null, observedAt: at, steps: [step] } }] }] }] });
  assert.equal(plain.ok && Object.hasOwn(plain.snapshot.issues[0]!.dispatches[0]!.agents[0]!.activity!.steps[0]!, "lifecycle"), false);
});

it("rejects a state outside the native vocabulary", () => {
  assert.equal(decoded({ state: "paused", startedAt: start, endedAt: end }), "rejected");
});

it("rejects a pending call that carries a clock: a requested call has not run", () => {
  assert.equal(decoded({ state: "pending", startedAt: start, endedAt: null }), "rejected");
});

it("rejects a running call that carries an end", () => {
  assert.equal(decoded({ state: "running", startedAt: start, endedAt: end }), "rejected");
});

it("rejects a start after the activity was observed", () => {
  assert.equal(decoded({ state: "running", startedAt: after, endedAt: null }), "rejected");
});

it("rejects an end before its start", () => {
  assert.equal(decoded({ state: "completed", startedAt: end, endedAt: start }), "rejected");
});

it("rejects an end after the activity was observed", () => {
  assert.equal(decoded({ state: "error", startedAt: start, endedAt: after }), "rejected");
});

it("rejects a lifecycle with a field it does not define", () => {
  assert.equal(decoded({ state: "completed", startedAt: start, endedAt: end, exitCode: 0 }), "rejected");
});
