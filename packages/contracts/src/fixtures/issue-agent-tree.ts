/** A minimal valid issue-agent tree (one confirmed-root agent) for the decoder tests. Test support only. */
import { projectRouteIdentity } from "../route.js";
import type { IssueAgentTreeSnapshot } from "../issue-agent-tree.js";
import { readIssueAgentTreeSnapshot } from "../issue-agent-tree-read.js";
import { unavailableAgentCost, type AgentObservation } from "../agent-observations.js";

export const at = "2026-01-01T00:00:00.000Z", rev = "a".repeat(64), dispatchId = "assignment_" + "b".repeat(64);
export const absent = () => ({ value: null, reason: "source_not_bound", observedAt: null, validUntil: null, revision: null } as const);
export const observation: AgentObservation = { agentId: "agent_" + "c".repeat(64), repo: { owner: "example", name: "project" }, issueNumber: 42,
  assignment: { id: dispatchId, dispatcher: "divybot", basis: "dispatcher-confirmed" },
  parentAgentId: { state: "confirmed-root", value: null, reason: null }, workspace: absent(), pane: absent(), tab: absent(), terminal: absent(),
  running: absent(), route: projectRouteIdentity(null), cost: unavailableAgentCost(), observedAt: at, revision: rev };
export const unknown = { value: null, source: "unavailable", reason: "source_not_bound" } as const;
export const unplaced = { value: null, basis: "unavailable", observedAt: null, reason: "source_not_bound" } as const;
export const node = { dispatchId, observation, harness: { value: "codex", source: "dispatch", reason: null }, provider: unknown,
  router: unknown, routePolicy: { value: null, digest: null, source: "unavailable", reason: "source_not_bound" },
  model: unknown, location: { host: unplaced, container: unplaced, seat: unplaced },
  nativeDepth: unknown,
  budget: { tokenLimit: null, source: "unavailable", reason: "source_not_bound" }, quotaRegime: { value: "subscription", reason: null },
  liveness: { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" },
  actionState: { state: "unknown", observedAt: null, reason: "source_not_bound" }, endedBy: null,
  terminalOutcome: { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" },
  startedAt: null, startedAtReason: "run_not_found", endedAt: null, endedAtReason: "measurement_missing",
  transcript: { value: null, reason: "source_not_bound" },
  history: [{ dispatchId, kind: "dispatch-observed", at }], historyTruncated: false } as const;
export const snapshot = (): IssueAgentTreeSnapshot => ({ schema: 1, protocol: 1, observedAt: at,
  validUntil: "2026-01-01T00:00:15.000Z", revision: rev, complete: true, reason: null,
  issues: [{ repo: observation.repo, issueNumber: 42, complete: true, reason: null,
    dispatches: [{ dispatchId, agents: [node] }] }] });
export const read = (value: unknown) => readIssueAgentTreeSnapshot(value);
