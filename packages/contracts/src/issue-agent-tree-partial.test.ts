/** Incomplete issue rows: which reasons may keep a verified forest, and how it is validated. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { at, dispatchId, node, snapshot, read } from "./issue-agent-tree-fixture.test.js";

it("retains a complete issue beside a typed incomplete issue", () => {
  const s = snapshot();
  const partial = { ...s, complete: false, reason: "ancestry_unavailable" as const,
    issues: [...s.issues, { repo: { owner: "example", name: "project" }, issueNumber: 43,
      complete: false, reason: "ancestry_unavailable" as const, dispatches: [] }] };
  const result = read(partial);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.issues.length, 2);
    assert.equal(result.snapshot.issues[0]?.complete, true);
    assert.equal(result.snapshot.issues[0]?.dispatches[0]?.agents.length, 1);
    assert.deepEqual(result.snapshot.issues[1], partial.issues[1]);
  }
  assert.equal(read({ ...partial, complete: true, reason: null }).ok, false);
  assert.equal(read({ ...partial, issues: [s.issues[0], { ...partial.issues[1], dispatches: s.issues[0]?.dispatches }] }).ok, false);
});
it("decodes a bounded issue that keeps the closed tree it read (0.37)", () => {
  const s = snapshot();
  const bounded = { ...s, complete: false, reason: "scan_limit" as const,
    issues: [{ ...s.issues[0]!, complete: false, reason: "scan_limit" as const }] };
  const result = read(bounded);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.issues[0]?.complete, false);
    assert.equal(result.snapshot.issues[0]?.reason, "scan_limit");
    assert.equal(result.snapshot.issues[0]?.dispatches[0]?.agents.length, 1);
  }
  // Never a complete claim around a bounded issue.
  assert.equal(read({ ...bounded, complete: true, reason: null }).ok, false);
  // Only a partial-forest reason may carry agents: every failure reason still carries none.
  for (const reason of ["source_not_bound", "source_unavailable", "ancestry_unavailable"] as const) {
    assert.equal(read({ ...bounded, reason, issues: [{ ...bounded.issues[0], reason }] }).ok, false, reason);
  }
});
it("decodes an uncovered issue that keeps its verified roots without a complete claim (0.42)", () => {
  const s = snapshot();
  const uncovered = { ...s, complete: false, reason: "binding_unavailable" as const,
    issues: [{ ...s.issues[0]!, complete: false, reason: "binding_unavailable" as const }] };
  const result = read(uncovered);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.issues[0]?.complete, false);
    assert.equal(result.snapshot.issues[0]?.reason, "binding_unavailable");
    assert.equal(result.snapshot.issues[0]?.dispatches[0]?.agents.length, 1);
  }
  assert.equal(read({ ...uncovered, complete: true, reason: null }).ok, false, "never complete around an uncovered issue");
  const invalid = { ...node, liveness: { state: "running", evidence: "runtime-observation", observedAt: at, reason: null } };
  assert.equal(read({ ...uncovered, issues: [{ ...uncovered.issues[0], dispatches: [{ dispatchId, agents: [invalid] }] }] }).ok, false,
    "its forest is validated like a complete issue's");
});
it("still decodes an incomplete issue row with no dispatches", () => {
  const s = snapshot();
  for (const reason of ["scan_limit", "source_unavailable", "binding_unavailable", "ancestry_unavailable"] as const) {
    const old = { ...s, complete: false, reason, issues: [{ ...s.issues[0]!, complete: false, reason, dispatches: [] }] };
    const result = read(old);
    assert.equal(result.ok, true, reason);
    if (result.ok) assert.deepEqual(result.snapshot.issues[0]?.dispatches, []);
  }
});
it("validates a bounded issue's agents exactly like a complete issue's", () => {
  const s = snapshot();
  // Running liveness with no running observation: caught only by the tree-level checks.
  const invalid = { ...node, liveness: { state: "running", evidence: "runtime-observation", observedAt: at, reason: null } };
  const tree = (complete: boolean) => ({ ...s, complete, reason: complete ? null : "scan_limit",
    issues: [{ ...s.issues[0]!, complete, reason: complete ? null : "scan_limit", dispatches: [{ dispatchId, agents: [invalid] }] }] });
  assert.equal(read(tree(true)).ok, false, "control: the complete row refuses it");
  assert.equal(read(tree(false)).ok, false, "the bounded row refuses it too");
});
