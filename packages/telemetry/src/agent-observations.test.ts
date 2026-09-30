/** All source identities are synthetic and must disappear at the public boundary. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { projectRouteIdentity, readAgentObservations } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEventKey, readClaudeChildStarts } from "./claude-child-events.js";
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

it("dispatch-only: emits one decodable unknown agent without a native binding", () => {
  const route = projectRouteIdentity({ requested: {
    provider: { value: "fixture-router", source: "request.modelProvider" },
    model: { value: "fixture-model", source: "request.model" },
    effort: { value: "high", source: "request.effort" },
  } });
  for (const nativeComplete of [true, false]) {
    const result = buildAgentObservations({ ...defaults, runs: [], nativeComplete,
      dispatches: [{ ...dispatch, external: null, route }] });
    const read = readAgentObservations(result);
    assert.ok(read.ok);
    assert.equal(read.observation.complete, false);
    assert.equal(read.observation.reason, "ancestry_unavailable");
    assert.equal(read.observation.agents.length, 1);
    const agent = read.observation.agents[0]!;
    assert.deepEqual(agent.parentAgentId, { state: "unavailable", value: null, reason: "identity_unavailable" });
    assert.deepEqual(agent.route, route);
    assert.ok(Object.values(agent.route.observed).every(field => field.value === null));
    assert.equal(agent.running.value, null);
    assert.equal(agent.running.reason, "observer-unavailable");
    assert.equal(agent.pane.value, dispatch.location?.paneId);
    assert.equal(agent.workspace.value, dispatch.location?.workspaceId);
    assert.deepEqual(Object.keys(agent.cost), ["subscriptionHeadroom", "meteredSpend", "runTokens", "localCapacity"]);
    for (const row of Object.values(agent.cost)) {
      assert.equal(row.availability, "unavailable");
      assert.equal(row.measurement, null);
      assert.equal(row.reason, "source_not_bound");
    }
    assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
  }
});
it("dispatch-only: cannot hide a partial runtime observation or a mixed collection", () => {
  for (const input of [
    { ...defaults, runs: [] },
    { ...defaults, nativeComplete: false },
    { ...defaults, dispatches: [dispatch, { ...dispatch, runId: "PRIVATE-OTHER-DISPATCH", external: null }] },
  ]) {
    const result = buildAgentObservations(input);
    assert.equal(result.complete, false);
    assert.equal(readAgentObservations(result).ok, false);
  }
});
it("dispatch-only: validates before emitting and never clears fabricated runtime evidence", () => {
  const route = projectRouteIdentity({ observed: {
    model: { value: "fabricated", source: "thread/start.result.model" },
  } });
  const result = buildAgentObservations({ ...defaults, runs: [], dispatches: [{ ...dispatch, external: null, route }] });
  assert.equal(result.complete, false);
  assert.equal(readAgentObservations(result).ok, false);
  assert.deepEqual(result.agents, []);
});

it("projects only a fresh Start for a child under the exact bound Claude root", () => {
  const observedAt = "2026-01-01T00:01:00.000Z";
  const rootId = "fixture-root", childId = "agent-fixture";
  const claudeDispatch = { ...dispatch, source: "claude" as const, external: rootId };
  const claudeRuns = [
    { ...run(rootId, null), source: "claude" as const },
    { ...run(childId, rootId), source: "claude" as const },
  ];
  const base = { ...defaults, dispatches: [claudeDispatch], runs: claudeRuns, observedAt };
  const childOf = (starts: ReadonlyMap<string, string>, childUpdatedAt?: string) => buildAgentObservations({ ...base,
    runs: childUpdatedAt === undefined ? claudeRuns : [claudeRuns[0]!, { ...claudeRuns[1]!, updatedAt: childUpdatedAt }], claudeChildStarts: starts })
    .agents.find(agent => agent.parentAgentId.state === "known-parent")!;
  const start = "2026-01-01T00:00:30.000Z";
  const matched = childOf(new Map([[childEventKey(rootId, childId), start]]));
  assert.equal(matched.running.value, true);
  assert.equal(matched.running.observedAt, start);
  assert.equal(childOf(new Map([[childEventKey("wrong-root", childId), start]])).running.value, null);
  assert.equal(childOf(new Map([[childEventKey(rootId, "internal-child"), start]])).running.value, null);
  // An old Start with no activity since: stale. (Activity after the Start extends it: see the RUN-5 test.)
  assert.equal(childOf(new Map([[childEventKey(rootId, childId), "2025-12-31T23:59:00.000Z"]]), "2025-12-31T23:59:00.000Z").running.value, null);
  assert.equal(childOf(new Map()).running.value, null); // Stop or missing signal never creates terminal evidence.
  assert.ok(!JSON.stringify(matched).includes(rootId));
  assert.ok(!JSON.stringify(matched).includes(childId));
});

it("RUN-5: a child that works past its Start window stays running on its own activity, and a Stop still clears it", async () => {
  // The RUN-5 hook sequence (2026-09-30, binding #515), with synthetic ids: the child's Start at 11:04:21.468, four
  // Stops for other Claude agents with no Start in this file, then the child's own Stop at 11:06:15.
  const session = "3f6c1e2a-7b9d-4c5e-8a1f-0d2b4e6c8a90", hookChild = "a0f1e2d3c4b5a6978", childId = `agent-${hookChild}`;
  const line = (event: string, agentId: string, observedAt: string) => JSON.stringify({ event, sessionId: session, agentId, observedAt });
  const live = [line("SubagentStart", hookChild, "2026-09-30T11:04:21.468Z"), line("SubagentStop", "a1111111111111111", "2026-09-30T11:04:56.639Z"),
    line("SubagentStop", "a2222222222222222", "2026-09-30T11:05:27.637Z"), line("SubagentStop", "a3333333333333333", "2026-09-30T11:05:28.149Z"),
    line("SubagentStop", "a4444444444444444", "2026-09-30T11:05:59.996Z")];
  const root = await mkdtemp(join(tmpdir(), "claude-child-events-"));
  await chmod(root, 0o700);
  const file = join(root, `${createHash("sha256").update(session).digest("hex")}.jsonl`);
  const put = async (lines: readonly string[]) => { await writeFile(file, lines.join("\n") + "\n", { mode: 0o600 }); await chmod(file, 0o600); };
  const claudeDispatch = { ...dispatch, source: "claude" as const, external: session, observedAt: "2026-09-30T11:04:00.000Z" };
  // The file as it stood at each capture (the reader stops at a line from after the capture, #523).
  let written: readonly string[] = [];
  const running = async (observedAt: string, childUpdatedAt: string) => {
    await put(written.filter(entry => (JSON.parse(entry) as { observedAt: string }).observedAt <= observedAt));
    const runs = [{ ...run(session, null), source: "claude" as const, startedAt: "2026-09-30T11:04:00.000Z", updatedAt: observedAt },
      { ...run(childId, session), source: "claude" as const, startedAt: "2026-09-30T11:04:21.420Z", updatedAt: childUpdatedAt }];
    const starts = await readClaudeChildStarts(root, session, [childId], observedAt);
    const child = buildAgentObservations({ ...defaults, dispatches: [claudeDispatch], runs, observedAt, claudeChildStarts: starts })
      .agents.find(agent => agent.parentAgentId.state === "known-parent")!;
    assert.ok(readAgentObservations(JSON.parse(JSON.stringify(buildAgentObservations({ ...defaults, dispatches: [claudeDispatch], runs, observedAt, claudeChildStarts: starts })))).ok);
    return child.running;
  };
  written = live;
  // The child first appeared in the tree at 11:05:33, 72 s after its Start, while it was working (last record 11:05:33).
  for (const [capture, activity] of [["2026-09-30T11:05:33.000Z", "2026-09-30T11:05:33.000Z"], ["2026-09-30T11:05:50.000Z", "2026-09-30T11:05:48.000Z"],
    ["2026-09-30T11:06:10.000Z", "2026-09-30T11:06:04.000Z"]] as const) {
    const observed = await running(capture, activity);
    assert.equal(observed.value, true, capture);
    assert.equal(observed.observedAt, activity);
  }
  // With no activity since its Start, the same Start alone is stale by then, as before.
  assert.equal((await running("2026-09-30T11:05:50.000Z", "2026-09-30T11:04:21.420Z")).value, null);
  // The child's own Stop clears running (unknown until its terminal evidence), whatever its activity.
  written = [...live, line("SubagentStop", hookChild, "2026-09-30T11:06:15.001Z")];
  assert.equal((await running("2026-09-30T11:06:16.000Z", "2026-09-30T11:06:14.953Z")).value, null);
});
