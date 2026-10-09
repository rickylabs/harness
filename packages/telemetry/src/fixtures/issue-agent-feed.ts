/** Shared synthetic fixtures for the issue-agent-feed read-model tests. Test support only. */
import { projectRouteIdentity } from "@rickylabs/harness-contracts";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "../agent-observations.js";
import { buildIssueAgentTreeSnapshot } from "../issue-agent-feed.js";
import type { HostCapacityReading } from "../host-capacity.js";
import type { RunRecord } from "../model.js";

export const at = "2026-01-01T00:00:00.000Z", later = "2026-01-01T00:00:01.000Z";
export const route = projectRouteIdentity({ requested: {
  provider: { value: "fixture-provider", source: "request.modelProvider" },
  model: { value: "fixture-model", source: "request.model" },
  effort: { value: "high", source: "request.effort" },
} });
export const dispatch: DispatchEvidence = { runId: "PRIVATE-DISPATCH-CANARY", external: "PRIVATE-NATIVE-ROOT", source: "codex", harness: "codex",
  linkageBasis: "dispatcher-confirmed", issue: { repo: "example/project", number: 42 }, parentRunId: null,
  location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" }, dispatchState: "dispatched",
  budget: { tokenLimit: 1000, source: "issue-override", reason: null },
  router: { value: "direct", source: "dispatch", reason: null },
  routePolicy: { value: "netscript-matrix", digest: "b".repeat(64), source: "dispatch", reason: null },
  observedAt: at, revision: "a".repeat(64), route };
export const run = (id: string, parentId: string | null, outcome: RunRecord["outcome"] = "unknown"): RunRecord => ({
  id, parentId, source: "codex", startedAt: at, updatedAt: later, branch: null,
  identity: { provider: "native-provider", model: "native-model", effort: null, profile: null },
  usage: {}, outcome, linkedIssues: [], origin: "PRIVATE-PATH-CANARY", quota: [] });
export const runs = [run("PRIVATE-NATIVE-ROOT", null, "complete"),
  { ...run("PRIVATE-NATIVE-CHILD", "PRIVATE-NATIVE-ROOT"), nativeDepth: 1 }];
export const build = (d: DispatchEvidence = dispatch, native: readonly RunRecord[] = runs, capturedAt = later,
  localCapacity?: HostCapacityReading) => {
  const observations = buildAgentObservations({ dispatches: [d], runs: native, observedAt: capturedAt,
    sourceBound: true, dispatchComplete: true, nativeComplete: true });
  return buildIssueAgentTreeSnapshot({ observations, dispatches: [d], runs: native,
    ...(localCapacity === undefined ? {} : { localCapacity }) });
};
