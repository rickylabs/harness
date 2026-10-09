import assert from "node:assert/strict";
import { it } from "node:test";
import { AGENT_ACTIVITY_GAPS, type AgentActivity } from "./agent-activity.js";
import { readAgentActivity } from "./issue-agent-tree.js";

const at = "2026-10-09T10:00:00.000Z";
const step = (n: number, over: Record<string, unknown> = {}) => ({ id: `step_${String(n).repeat(64).slice(0, 64)}`, at,
  kind: "tool", toolName: null, commandHead: null, filePath: null, summary: null, target: null, source: "agy-transcript", ...over });
const activity = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  ({ availability: "available", reason: null, observedAt: at, steps, ...extra });
const read = (value: unknown) => readAgentActivity(value, at);
const coverage = (value: AgentActivity) => value.availability === "available" ? value.coverage : undefined;

it("decodes an older activity without state or coverage unchanged", () => {
  const decoded = read(activity([step(1)]));
  assert.equal(decoded.availability, "available");
  assert.equal(Object.hasOwn(decoded, "coverage"), false);
  assert.equal(Object.hasOwn(decoded.steps[0]!, "state"), false);
});

it("accepts a closed state on tool, command and file steps", () => {
  const steps = [step(1, { state: "completed" }), step(2, { kind: "command", commandHead: "git", state: "failed" }),
    step(3, { kind: "file", filePath: "src/a.ts", state: "cancelled" }), step(4, { state: "unknown" })];
  assert.deepEqual(read(activity(steps)).steps.map(s => s.state), ["completed", "failed", "cancelled", "unknown"]);
});

it("rejects state on a message step, a removed or unknown value, and a null", () => {
  for (const bad of [step(1, { kind: "message", summary: "Done here", state: "completed" }), step(1, { state: "pending" }),
    step(1, { state: "succeeded" }), step(1, { state: "running" }), step(1, { state: null })]) {
    assert.throws(() => read(activity([bad])));
  }
});

it("accepts coverage with canonical unique gaps, and empty gaps as full coverage", () => {
  assert.deepEqual(coverage(read(activity([], { coverage: { gaps: [] } }))), { gaps: [] });
  const all = [...AGENT_ACTIVITY_GAPS];
  assert.deepEqual(coverage(read(activity([], { coverage: { gaps: all } }))), { gaps: all });
});

it("rejects coverage on unavailable activity, unknown, duplicate or reordered gaps, and extra keys", () => {
  assert.throws(() => read({ availability: "unavailable", reason: "source_not_bound", observedAt: null, steps: [], coverage: { gaps: [] } }));
  for (const value of [{ gaps: ["tool-names-missing"] }, { gaps: ["call-lifecycle-unproven", "call-lifecycle-unproven"] },
    { gaps: ["call-lifecycle-unproven", "tool-names-source-missing"] }, { gaps: [], note: "x" }, { gaps: "call-lifecycle-unproven" }, null]) {
    assert.throws(() => read(activity([], { coverage: value })), JSON.stringify(value));
  }
});
