/** Project existing dispatch and native telemetry evidence. This module collects nothing. */
import { createHash } from "node:crypto";
import { MAX_AGENT_OBSERVATIONS, projectRouteIdentity, readAgentObservations, unavailableAgentCost,
  type AgentObservation, type AgentObservations, type AgentObservedValue } from "@rickylabs/harness-contracts";
import { resolveOrchidNativeRoot } from "./orchid-native-binding.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { RunRecord } from "./model.js";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (kind: "agent" | "assignment", value: string) => `${kind}_${digest(kind + "\0" + value)}`;
const missing = <T>(reason: "source_not_bound" | "identity_unavailable" | "observer-unavailable" = "source_not_bound"): AgentObservedValue<T> =>
  ({ value: null, reason, observedAt: null, validUntil: null, revision: null });
const nativeKey = (source: string, id: string) => `${source}\0${id}`;
export function buildAgentObservations(input: {
  readonly dispatches: readonly DispatchEvidence[];
  readonly runs: readonly RunRecord[];
  readonly observedAt: string;
  readonly sourceBound: boolean;
  readonly dispatchComplete: boolean;
  readonly nativeComplete: boolean;
}): AgentObservations {
  const agents: AgentObservation[] = [];
  let reason: AgentObservations["reason"] = !input.sourceBound ? "source_not_bound"
    : !input.dispatchComplete ? "binding_unavailable" : null;
  const finish = (): AgentObservations => {
    const result: AgentObservations = { schema: 1, protocol: 1, observedAt: input.observedAt,
      revision: digest(JSON.stringify({ agents, reason })), complete: reason === null, reason, agents };
    if (reason !== null && reason !== "ancestry_unavailable") return result;
    const checked = readAgentObservations(result);
    if (checked.ok) return checked.observation;
    return { ...result, complete: false, reason: checked.reason === "oversized" ? "scan_limit" : "ancestry_unavailable", agents: [] };
  };
  // A truncated source never supplies a displayed prefix as complete ancestry.
  if (reason !== null) return finish();
  const dispatches = input.dispatches.filter(d => d.linkageBasis === "dispatcher-confirmed");
  if (dispatches.length > MAX_AGENT_OBSERVATIONS) { reason = "scan_limit"; return finish(); }
  const native = new Map<string, RunRecord>();
  const duplicates = new Set<string>();
  for (const run of input.runs) {
    const key = nativeKey(run.source, run.id);
    if (native.has(key)) duplicates.add(key);
    native.set(key, run);
  }
  const roots = new Map<string, AgentObservation>();
  for (const d of dispatches) {
    if (!d.issue || d.parentRunId !== null || !d.observedAt || !d.revision) { reason = "binding_unavailable"; break; }
    const [owner, name] = d.issue.repo.split("/");
    if (!owner || !name) { reason = "binding_unavailable"; break; }
    const observedAt = d.observedAt;
    const external = resolveOrchidNativeRoot(d, input.runs)?.id ?? d.external;
    const revision = digest(JSON.stringify({ dispatch: d.revision, binding: external === null ? null : digest(external) }));
    const reference = (value: string | undefined): AgentObservedValue<string> => value === undefined ? missing()
      : { value, reason: null, observedAt, validUntil: null, revision };
    const root: AgentObservation = {
      agentId: opaque("agent", d.runId), repo: { owner, name }, issueNumber: d.issue.number,
      assignment: { id: opaque("assignment", d.runId), dispatcher: "divybot", basis: "dispatcher-confirmed" },
      parentAgentId: external === null
        ? { state: "unavailable", value: null, reason: "identity_unavailable" }
        : { state: "confirmed-root", value: null, reason: null },
      workspace: reference(d.location?.workspaceId), pane: reference(d.location?.paneId), tab: missing(), terminal: missing(), running: missing(external === null ? "observer-unavailable" : "identity_unavailable"),
      route: projectRouteIdentity(d.route), cost: unavailableAgentCost(), observedAt, revision,
    };
    agents.push(root);
    if (external === null || d.source === null) { reason = "ancestry_unavailable"; continue; }
    const key = nativeKey(d.source, external);
    if (roots.has(key) || duplicates.has(key) || !native.has(key) || native.get(key)?.parentId !== null) { reason = "ancestry_unavailable"; continue; }
    roots.set(key, root);
  }
  if (reason !== null) return finish();
  if (roots.size > 0 && !input.nativeComplete) { reason = "ancestry_unavailable"; return finish(); }
  // Children inherit only a confirmed assignment through an explicit same-source parent chain.
  const assigned = new Map(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, run] of native) {
      if (assigned.has(key) || run.parentId === null) continue;
      const parent = assigned.get(nativeKey(run.source, run.parentId));
      if (!parent) continue;
      if (duplicates.has(key)) { reason = "ancestry_unavailable"; return finish(); }
      if (agents.length === MAX_AGENT_OBSERVATIONS) { agents.length = 0; reason = "scan_limit"; return finish(); }
      const observedAt = run.updatedAt;
      const child: AgentObservation = { agentId: opaque("agent", key), repo: parent.repo, issueNumber: parent.issueNumber,
        assignment: parent.assignment, parentAgentId: { state: "known-parent", value: parent.agentId, reason: null },
        workspace: missing(), pane: missing(), tab: missing(), terminal: missing(), running: missing("identity_unavailable"),
        route: projectRouteIdentity(null), cost: unavailableAgentCost(), observedAt,
        revision: digest(JSON.stringify({ parent: parent.agentId, observedAt, outcome: run.outcome })),
      };
      agents.push(child); assigned.set(key, child); changed = true;
    }
  }
  agents.sort((a, b) => a.agentId.localeCompare(b.agentId));
  return finish();
}
