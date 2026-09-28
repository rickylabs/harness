/** Pure per-issue projection of the existing dispatcher/native ancestry join. */
import { createHash } from "node:crypto";
import { readAgentObservations, readIssueAgentTreeSnapshot, MAX_AGENT_HISTORY, MAX_AGENT_OBSERVATIONS,
  MAX_ISSUE_AGENT_TREE_BYTES, ISSUE_AGENT_TREE_FRESH_MS, unavailableAgentCost,
  projectRouteIdentity,
  type AgentHistoryEvent, type AgentObservation, type AgentObservations, type AgentTreeValue, type AgentRoutePolicy,
  type IssueAgentTree, type IssueAgentTreeAgent, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { resolveOrchidNativeRoot } from "./orchid-native-binding.js";
import type { HostCapacityReading } from "./host-capacity.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { RunRecord } from "./model.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (kind: "agent" | "assignment", value: string) => `${kind}_${digest(kind + "\0" + value)}`;
const unavailable: AgentTreeValue = { value: null, source: "unavailable", reason: "source_not_bound" };
const unavailablePolicy: AgentRoutePolicy = { value: null, digest: null, source: "unavailable", reason: "source_not_bound" };
const publicLabel = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");
const safe = (value: string | null | undefined, source: "dispatch" | "native"): AgentTreeValue =>
  publicLabel(value)
    ? { value, source, reason: null } : unavailable;
function publicObservation(observation: AgentObservation): AgentObservation {
  const clean = (leaf: { readonly value: string | null; readonly source: string }) =>
    ({ ...leaf, value: publicLabel(leaf.value) ? leaf.value : null });
  const side = (name: "requested" | "observed") => ({
    provider: clean(observation.route[name].provider), model: clean(observation.route[name].model),
    effort: clean(observation.route[name].effort), cwd: clean(observation.route[name].cwd),
  });
  const route = projectRouteIdentity({ requested: side("requested"), observed: side("observed") });
  return { ...observation, route, revision: digest(JSON.stringify({ prior: observation.revision, route })) };
}
const time = (value: string | undefined, latest: string): string | null =>
  value && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && value <= latest ? value : null;

function history(observation: AgentObservation, dispatch: DispatchEvidence, run: RunRecord | undefined, now: string): readonly AgentHistoryEvent[] {
  const rows: AgentHistoryEvent[] = [];
  const dispatchId = observation.assignment.id;
  if (observation.parentAgentId.state !== "known-parent" && time(dispatch.observedAt, now) !== null) {
    rows.push({ dispatchId, kind: "dispatch-observed", at: dispatch.observedAt! });
  }
  const started = time(run?.startedAt, now);
  const activity = time(run?.updatedAt, now);
  if (started !== null) rows.push({ dispatchId, kind: "run-started-observed", at: started });
  if (activity !== null && (started === null || activity > started)) rows.push({ dispatchId, kind: "run-activity-observed", at: activity });
  return rows.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind)).slice(0, MAX_AGENT_HISTORY);
}

function node(observation: AgentObservation, dispatch: DispatchEvidence, run: RunRecord | undefined, now: string,
  localCapacity: HostCapacityReading | undefined): IssueAgentTreeAgent {
  const root = observation.parentAgentId.state !== "known-parent";
  const provenAncestry = observation.parentAgentId.state === "confirmed-root" || observation.parentAgentId.state === "known-parent";
  const harness = root ? safe(dispatch.harness ?? dispatch.source, "dispatch") : safe(run?.source, "native");
  const provider = root ? safe(observation.route.requested.provider.value, "dispatch") : safe(run?.identity.provider, "native");
  const model = root ? safe(observation.route.requested.model.value, "dispatch") : safe(run?.identity.model, "native");
  const router = provenAncestry && dispatch.router?.value === "direct" && dispatch.router.source === "dispatch" &&
    (dispatch.source === "codex" || dispatch.source === "claude") ? dispatch.router : unavailable;
  const start = time(run?.startedAt, now);
  const outcomeAt = time(run?.updatedAt, now);
  const liveness: IssueAgentTreeAgent["liveness"] = (run?.outcome === "complete" || run?.outcome === "failed") && outcomeAt !== null
    ? { state: "ended", evidence: "native-outcome", observedAt: now, reason: null }
    : observation.running.value === true && observation.running.observedAt !== null
      ? { state: "running", evidence: "runtime-observation", observedAt: observation.running.observedAt, reason: null }
      : { state: "unknown", evidence: null, observedAt: null, reason: "measurement_missing" };
  const terminalOutcome: IssueAgentTreeAgent["terminalOutcome"] = liveness.state === "ended"
    ? run!.outcome === "complete"
      ? { value: "succeeded", source: "native-outcome", observedAt: now, reason: null }
      : run!.terminalCause === "error" || run!.terminalCause === "cancelled"
        ? { value: run!.terminalCause === "error" ? "failed" : "cancelled", source: "native-outcome", observedAt: now, reason: null }
        : { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" }
    : { value: null, source: "unavailable", observedAt: null, reason: "measurement_missing" };
  const unplaced = { value: null, basis: "unavailable", observedAt: null, reason: "source_not_bound" } as const;
  const host = provenAncestry && dispatch.host && /^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(dispatch.host) &&
    time(dispatch.observedAt, now) !== null
    ? { value: dispatch.host, basis: "placement", observedAt: dispatch.observedAt!, reason: null } as const : unplaced;
  const missingCapacity = (reason: "source_not_bound" | "observer-unavailable" | "binding_invalid" | "source_stale") =>
    unavailableAgentCost(reason).localCapacity;
  const capacity = host.value === null ? missingCapacity("source_not_bound")
    : localCapacity === undefined ? missingCapacity("observer-unavailable")
    : localCapacity.host === null && localCapacity.cost.reason === "host_identity_unset" ? localCapacity.cost
    : localCapacity.host !== host.value ? missingCapacity("binding_invalid")
    : localCapacity.cost.availability === "available" &&
      (localCapacity.cost.measurement.host !== host.value || localCapacity.cost.observedAt! > now)
      ? missingCapacity("binding_invalid")
    : localCapacity.cost.availability === "available" &&
      (localCapacity.cost.validUntil === null || Date.parse(localCapacity.cost.validUntil) < Date.parse(now) + ISSUE_AGENT_TREE_FRESH_MS)
      ? missingCapacity("source_stale")
    : localCapacity.cost;
  const placedObservation = { ...observation, cost: { ...observation.cost, localCapacity: capacity },
    revision: digest(JSON.stringify({ prior: observation.revision, host: host.value, capacity })) };
  const seam = run?.source ?? dispatch.source;
  return { dispatchId: observation.assignment.id, observation: placedObservation, harness, provider, router,
    routePolicy: observation.parentAgentId.state === "confirmed-root" ? dispatch.routePolicy ?? unavailablePolicy : unavailablePolicy, model,
    location: { host, container: unplaced, seat: unplaced },
    budget: root ? dispatch.budget ?? { tokenLimit: null, source: "unavailable", reason: "source_not_bound" }
      : { tokenLimit: null, source: "unavailable", reason: "source_not_bound" },
    quotaRegime: seam === "codex" || seam === "claude" ? { value: "subscription", reason: null }
      : { value: null, reason: "source_not_bound" },
    liveness, terminalOutcome, startedAt: start, startedAtReason: start === null ? "run_not_found" : null,
    endedAt: null, endedAtReason: "measurement_missing", transcript: { value: null, reason: "source_not_bound" },
    history: history(observation, dispatch, run, now), historyTruncated: false };
}

/** Invalid or partial ancestry is never repackaged as a complete tree. */
export function buildIssueAgentTreeSnapshot(input: {
  readonly observations: AgentObservations;
  readonly dispatches: readonly DispatchEvidence[];
  readonly runs: readonly RunRecord[];
  readonly localCapacity?: HostCapacityReading;
}): IssueAgentTreeSnapshot {
  const { dispatches, runs } = input;
  const observations: AgentObservations = { ...input.observations,
    agents: input.observations.agents.map(publicObservation),
    revision: digest(JSON.stringify({ prior: input.observations.revision, publicRoute: true })) };
  const empty = (reason: IssueAgentTreeSnapshot["reason"]): IssueAgentTreeSnapshot => ({
    schema: 1, protocol: 1, observedAt: observations.observedAt,
    validUntil: new Date(Date.parse(observations.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ reason, observation: observations.revision })), complete: false, reason, issues: [],
  });
  const checked = readAgentObservations(observations);
  if (!checked.ok && observations.agents.length > 0) return empty("ancestry_unavailable");
  if (!observations.complete && observations.reason !== "ancestry_unavailable") return empty(observations.reason);
  const dispatchById = new Map(dispatches.map(d => [opaque("assignment", d.runId), d]));
  const nativeById = new Map<string, RunRecord>();
  for (const run of runs) nativeById.set(opaque("agent", run.source + "\0" + run.id), run);
  const issues = new Map<string, { repo: IssueAgentTree["repo"]; issueNumber: number; dispatches: Map<string, IssueAgentTreeAgent[]> }>();
  for (const observation of observations.agents) {
    const dispatch = dispatchById.get(observation.assignment.id);
    if (!dispatch) return empty("binding_unavailable");
    const key = `${observation.repo.owner.toLowerCase()}/${observation.repo.name.toLowerCase()}#${observation.issueNumber}`;
    let issue = issues.get(key);
    if (!issue) { issue = { repo: observation.repo, issueNumber: observation.issueNumber, dispatches: new Map() }; issues.set(key, issue); }
    let agents = issue.dispatches.get(observation.assignment.id);
    if (!agents) { agents = []; issue.dispatches.set(observation.assignment.id, agents); }
    const rootRun = observation.parentAgentId.state === "known-parent" ? undefined :
      resolveOrchidNativeRoot(dispatch, runs) ?? runs.find(r => r.source === dispatch.source && r.id === dispatch.external && r.parentId === null);
    const run = observation.parentAgentId.state === "known-parent" ? nativeById.get(observation.agentId) : rootRun;
    agents.push(node(observation, dispatch, run, observations.observedAt, input.localCapacity));
  }
  const rows: IssueAgentTree[] = [...issues.values()].map(issue => ({ repo: issue.repo, issueNumber: issue.issueNumber,
    complete: true, reason: null,
    dispatches: [...issue.dispatches].map(([dispatchId, agents]) => ({ dispatchId,
      agents: agents.sort((a, b) => a.observation.agentId.localeCompare(b.observation.agentId)) }))
      .sort((a, b) => a.dispatchId.localeCompare(b.dispatchId)) }))
    .sort((a, b) => a.repo.owner.localeCompare(b.repo.owner) || a.repo.name.localeCompare(b.repo.name) || a.issueNumber - b.issueNumber);
  const snapshot: IssueAgentTreeSnapshot = { schema: 1, protocol: 1, observedAt: observations.observedAt,
    validUntil: new Date(Date.parse(observations.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ observation: observations.revision, issues: rows })),
    complete: observations.complete, reason: observations.reason, issues: rows };
  const decoded = readIssueAgentTreeSnapshot(snapshot);
  return decoded.ok ? decoded.snapshot : empty(decoded.reason === "oversized" ? "scan_limit" : "ancestry_unavailable");
}

/** Preserve good issue trees when a different receipt cannot establish ancestry. */
export function combineIssueAgentTreeSnapshots(input: {
  readonly observedAt: string;
  readonly entries: readonly { readonly repo: IssueAgentTree["repo"]; readonly issueNumber: number;
    readonly snapshot: IssueAgentTreeSnapshot }[];
  readonly globalReason?: IssueAgentTreeSnapshot["reason"];
}): IssueAgentTreeSnapshot {
  const issues: IssueAgentTree[] = [];
  const agentIds = new Set<string>();
  const issueKeys = new Set<string>();
  let overflow = false;
  const fits = (candidate: IssueAgentTree): boolean => issues.length < MAX_AGENT_OBSERVATIONS &&
    agentIds.size + candidate.dispatches.reduce((count, dispatch) => count + dispatch.agents.length, 0) <= MAX_AGENT_OBSERVATIONS &&
    Buffer.byteLength(JSON.stringify({ schema: 1, protocol: 1, observedAt: input.observedAt,
      validUntil: input.observedAt, revision: "a".repeat(64), complete: false,
      reason: "ancestry_unavailable", issues: [...issues, candidate] })) <= MAX_ISSUE_AGENT_TREE_BYTES;
  for (const entry of input.entries) {
    const key = `${entry.repo.owner.toLowerCase()}/${entry.repo.name.toLowerCase()}#${entry.issueNumber}`;
    if (issueKeys.has(key)) { overflow = true; continue; }
    issueKeys.add(key);
    const read = readIssueAgentTreeSnapshot(entry.snapshot);
    const issue = read.ok && read.snapshot.complete && read.snapshot.observedAt === input.observedAt &&
      read.snapshot.issues.length === 1 && read.snapshot.issues[0]?.repo.owner === entry.repo.owner &&
      read.snapshot.issues[0]?.repo.name === entry.repo.name && read.snapshot.issues[0]?.issueNumber === entry.issueNumber
      ? read.snapshot.issues[0] : null;
    const ids = issue?.dispatches.flatMap(dispatch => dispatch.agents.map(agent => agent.observation.agentId)) ?? [];
    const unavailable: IssueAgentTree = { repo: entry.repo, issueNumber: entry.issueNumber, complete: false,
      reason: read.ok && !read.snapshot.complete ? read.snapshot.reason : "binding_unavailable", dispatches: [] };
    const candidate = issue !== null && ids.every(id => !agentIds.has(id)) ? issue : unavailable;
    if (fits(candidate)) {
      issues.push(candidate);
      if (candidate.complete) ids.forEach(id => agentIds.add(id));
    } else if (fits({ ...unavailable, reason: "scan_limit" })) {
      issues.push({ ...unavailable, reason: "scan_limit" });
      overflow = true;
    } else overflow = true;
  }
  issues.sort((a, b) => a.repo.owner.localeCompare(b.repo.owner) || a.repo.name.localeCompare(b.repo.name) || a.issueNumber - b.issueNumber);
  const firstIncomplete = issues.find(issue => !issue.complete);
  const reason = input.globalReason ?? (overflow ? "scan_limit" : firstIncomplete?.reason ?? null);
  const complete = reason === null;
  const snapshot: IssueAgentTreeSnapshot = { schema: 1, protocol: 1, observedAt: input.observedAt,
    validUntil: new Date(Date.parse(input.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ issues, reason })), complete, reason, issues };
  const read = readIssueAgentTreeSnapshot(snapshot);
  return read.ok ? read.snapshot : { ...snapshot, complete: false, reason: "source_unavailable", issues: [] };
}
