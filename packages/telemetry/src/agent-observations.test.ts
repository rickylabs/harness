/** All source identities are synthetic and must disappear at the public boundary. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { projectRouteIdentity, readAgentObservations } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { RunRecord } from "./model.js";
const at = "2026-01-01T00:00:00.000Z";
const dispatch: DispatchEvidence = { runId: "PRIVATE-DISPATCH-CANARY", external: "PRIVATE-NATIVE-ROOT", source: "codex",
  linkageBasis: "dispatcher-confirmed", issue: { repo: "example/project", number: 42 }, parentRunId: null,
  location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" }, dispatchState: "dispatched",
  observedAt: at, revision: "a".repeat(64), route: projectRouteIdentity(null) };
const run = (id: string, parentId: string | null): RunRecord => ({ id, parentId, source: "codex", startedAt: at, updatedAt: at,
  branch: null, identity: { model: null, effort: null, provider: null, profile: null }, usage: {}, outcome: "unknown", linkedIssues: [], origin: "PRIVATE-PATH-CANARY", quota: [] });
const defaults = { dispatches: [dispatch], runs: [run("PRIVATE-NATIVE-ROOT", null), run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT")], observedAt: at,
  sourceBound: true, dispatchComplete: true, nativeComplete: true };
it("projects dispatcher-confirmed issue ancestry with opaque ids and unavailable costs", () => {
  const result = buildAgentObservations(defaults);
  assert.equal(result.complete, true);
  assert.ok(readAgentObservations(result).ok);
  assert.equal(result.agents.length, 2);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
  const root = result.agents.find(a => a.parentAgentId.state === "confirmed-root");
  const child = result.agents.find(a => a.parentAgentId.state === "known-parent");
  assert.equal(child?.parentAgentId.value, root?.agentId);
  assert.equal(child?.issueNumber, 42);
  assert.equal(root?.pane.value, "fixture-pane");
  assert.equal(root?.running.value, null);
  assert.equal(root?.cost.runTokens.availability, "unavailable");
});
it("refuses to call ancestry complete without a native binding or on a partial scan", () => {
  for (const input of [
    { ...defaults, dispatches: [{ ...dispatch, external: null }] },
    { ...defaults, nativeComplete: false }, { ...defaults, dispatchComplete: false },
    { ...defaults, sourceBound: false },
    { ...defaults, runs: [...defaults.runs, run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT")] },
  ]) {
    const result = buildAgentObservations(input);
    assert.equal(result.complete, false);
    assert.equal(readAgentObservations(result).ok, false);
    assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
  }
});
it("does not infer assignment from transcript prose and never emits a truncated child tree", () => {
  const unrelated = { ...run("PRIVATE-UNRELATED", null), linkedIssues: [{ number: 42, from: "prose" as const }] };
  assert.equal(buildAgentObservations({ ...defaults, runs: [...defaults.runs, unrelated] }).agents.length, 2);
  const children = Array.from({ length: 256 }, (_, i) => run("PRIVATE-CHILD-" + i, "PRIVATE-NATIVE-ROOT"));
  const result = buildAgentObservations({ ...defaults, runs: [defaults.runs[0]!, ...children] });
  assert.equal(result.complete, false);
  assert.equal(result.reason, "scan_limit");
  assert.deepEqual(result.agents, []);
});
