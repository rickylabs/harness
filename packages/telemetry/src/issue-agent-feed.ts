import { validateWireFamily, type TelemetryWireFamily } from "./producer-names.js";
/** Pure per-issue projection of the existing dispatcher/native ancestry join. */
import { node, verifiedClaudeSidechain } from "./issue-agent-tree-node.js";
import { digest, opaque, publicLabel, time, event, orderedEvents } from "./issue-agent-tree-values.js";
import type { NativeRootObservation } from "./agent-observations.js";
import { readAgentObservations, readIssueAgentTreeSnapshot, MAX_AGENT_OBSERVATIONS,
  MAX_ISSUE_AGENT_TREE_BYTES, ISSUE_AGENT_TREE_FRESH_MS, ISSUE_PARTIAL_FOREST_REASONS, projectRouteIdentity, publicOpenCodeModel,
  type AgentObservation, type AgentObservations, type IssueLaunchBlock, type IssueLaunchRefusal, type IssueAgentTree,
  type IssueAgentTreeAgent, type IssueAgentTreeSnapshot, type IssuePartialForestReason } from "@rickylabs/harness-contracts";
import type { NativeRootResolver } from "./host-reads.js";
import type { HostCapacityReading } from "./host-capacity.js";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import { type RunRecord } from "./model.js";
import type { PublicActionReceipt } from "./action-receipt-cli.js";

function publicObservation(observation: AgentObservation, source: string | null): AgentObservation {
  const clean = (leaf: { readonly value: string | null; readonly source: string }, model = false, provider?: string | null) =>
    ({ ...leaf, value: (model && source === "opencode" ? publicOpenCodeModel(leaf.value, provider) : publicLabel(leaf.value)) ? leaf.value : null });
  const side = (name: "requested" | "observed") => ({
    provider: clean(observation.route[name].provider), model: clean(observation.route[name].model, true, observation.route[name].provider.value),
    effort: clean(observation.route[name].effort), cwd: clean(observation.route[name].cwd),
  });
  const route = projectRouteIdentity({ requested: side("requested"), observed: side("observed") });
  return { ...observation, route, revision: digest(JSON.stringify({ prior: observation.revision, route })) };
}
/** Invalid or partial ancestry is never repackaged as a complete tree. */
export function buildIssueAgentTreeSnapshot(input: {
  readonly wireFamily?: TelemetryWireFamily;
  readonly observations: AgentObservations;
  readonly dispatches: readonly DispatchEvidence[];
  readonly runs: readonly RunRecord[];
  readonly localCapacity?: HostCapacityReading;
  readonly actions?: readonly PublicActionReceipt[];
  readonly actionsComplete?: boolean;
  /**
   * The observed forest is closed, but descendants or unresolved launch attempts bound its extent: rows say
   * `scan_limit` and keep the agents read, never a complete claim. Contract 0.37 and later.
   */
  readonly bounded?: boolean;
  /**
   * The source cannot enumerate every active run on an issue, so the verified roots are not the
   * whole issue: rows say `binding_unavailable` and keep the agents read. Contract 0.42 and later.
   */
  readonly uncovered?: boolean;
  readonly nativeRoots?: ReadonlyMap<string, NativeRootObservation>;
  /** The dispatch host's private native-root join; without one, only an explicit dispatch reference binds. */
  readonly host?: NativeRootResolver;
}): IssueAgentTreeSnapshot {
  const wireFamily = validateWireFamily(input.wireFamily);
  const { dispatches, runs } = input;
  const dispatchById = new Map(dispatches.map(d => [opaque("assignment", d.runId), d]));
  const observations: AgentObservations = { ...input.observations,
    agents: input.observations.agents.map(raw => {
      const dispatch = dispatchById.get(raw.assignment.id);
      const publicRow = publicObservation(raw, dispatch?.source ?? null);
      const seat = raw.parentAgentId.state === "confirmed-root"
        ? time(dispatch?.stop?.seatObservedAt ?? undefined, input.observations.observedAt) : null;
      return seat === null ? publicRow : { ...publicRow,
        running: { value: null, reason: "source_stale", observedAt: null, validUntil: null, revision: null } as const,
        revision: digest(JSON.stringify({ prior: publicRow.revision, stopSeat: seat })) };
    }),
    revision: digest(JSON.stringify({ prior: input.observations.revision, publicRoute: true })) };
  const empty = (reason: IssueAgentTreeSnapshot["reason"]): IssueAgentTreeSnapshot => ({
    schema: 1, protocol: 1, observedAt: observations.observedAt,
    validUntil: new Date(Date.parse(observations.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ reason, observation: observations.revision })), complete: false, reason, issues: [],
  });
  const checked = readAgentObservations(observations);
  if (!checked.ok && observations.agents.length > 0) return empty("ancestry_unavailable");
  if (!observations.complete && observations.reason !== "ancestry_unavailable") return empty(observations.reason);
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
    const proof = input.nativeRoots?.get(dispatch.runId);
    const resolveRoot = () => proof !== undefined
      ? runs.find(r => r.source === dispatch.source && r.id === proof.id && r.parentId === null)
      : input.host?.resolveNativeRoot(dispatch, runs) ?? runs.find(r => r.source === dispatch.source && r.id === dispatch.external && r.parentId === null);
    const rootRun = observation.parentAgentId.state === "known-parent" ? undefined : resolveRoot();
    const run = observation.parentAgentId.state === "known-parent" ? nativeById.get(observation.agentId) : rootRun;
    const boundRoot = observation.parentAgentId.state === "known-parent"
      ? resolveRoot() : rootRun;
    const verifiedClaudeChild = verifiedClaudeSidechain(observation, dispatch, run, boundRoot, runs, observations.agents);
    // The notification lands in the child's direct parent session; ids are unique among Claude runs here.
    const parentRun = verifiedClaudeChild ? runs.find(candidate => candidate.source === "claude" && candidate.id === run!.parentId) : undefined;
    const childCompletion = parentRun?.childCompletions?.find(entry => entry.childId === run!.id) ?? null;
    agents.push(node(observation, dispatch, run, observations.observedAt, input.localCapacity,
      input.actions ?? [], input.actionsComplete ?? false, verifiedClaudeChild, childCompletion, wireFamily,
      observation.parentAgentId.state === "known-parent" ? undefined : input.nativeRoots?.get(dispatch.runId)));
  }
  const partialReason: IssuePartialForestReason | null = input.bounded === true ? "scan_limit"
    : input.uncovered === true ? "binding_unavailable" : null;
  const rows: IssueAgentTree[] = [...issues.values()].map(issue => ({ repo: issue.repo, issueNumber: issue.issueNumber,
    complete: partialReason === null, reason: partialReason,
    dispatches: [...issue.dispatches].map(([dispatchId, agents]) => {
      const root = agents.find(agent => agent.observation.parentAgentId.state === "confirmed-root");
      const childEvents = root === undefined ? [] : agents.filter(agent => agent.observation.parentAgentId.value === root.observation.agentId &&
        agent.startedAt !== null).map(agent => event(root.observation.agentId, "subagent-spawned", agent.startedAt!, "native", agent.observation.agentId));
      const decorated = root === undefined ? agents : agents.map(agent => agent === root ? { ...agent,
        timeline: { events: orderedEvents([...(agent.timeline?.events ?? []), ...childEvents]).slice(-32),
          truncated: (agent.timeline?.truncated ?? false) ||
            (agent.timeline?.events.length ?? 0) + childEvents.length > 32 } } : agent);
      return { dispatchId, agents: decorated.sort((a, b) => a.observation.agentId.localeCompare(b.observation.agentId)) };
    })
      .sort((a, b) => a.dispatchId.localeCompare(b.dispatchId)) }))
    .sort((a, b) => a.repo.owner.localeCompare(b.repo.owner) || a.repo.name.localeCompare(b.repo.name) || a.issueNumber - b.issueNumber);
  const snapshot: IssueAgentTreeSnapshot = { schema: 1, protocol: 1, observedAt: observations.observedAt,
    validUntil: new Date(Date.parse(observations.observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest(JSON.stringify({ observation: observations.revision, issues: rows })),
    complete: observations.complete && partialReason === null, reason: observations.reason ?? partialReason, issues: rows };
  const decoded = readIssueAgentTreeSnapshot(snapshot);
  return decoded.ok ? decoded.snapshot : empty(decoded.reason === "oversized" ? "scan_limit" : "ancestry_unavailable");
}

/** Preserve good issue trees when a different receipt cannot establish ancestry. */
export function combineIssueAgentTreeSnapshots(input: {
  readonly observedAt: string;
  readonly entries: readonly { readonly repo: IssueAgentTree["repo"]; readonly issueNumber: number;
    readonly snapshot: IssueAgentTreeSnapshot; readonly launchBlock?: IssueLaunchBlock;
    /** A verified refusal survives an issue whose agent coverage is incomplete, exactly like a block. */
    readonly launchRefusal?: IssueLaunchRefusal }[];
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
    const row = read.ok && read.snapshot.observedAt === input.observedAt &&
      read.snapshot.issues.length === 1 && read.snapshot.issues[0]?.repo.owner === entry.repo.owner &&
      read.snapshot.issues[0]?.repo.name === entry.repo.name && read.snapshot.issues[0]?.issueNumber === entry.issueNumber
      ? read.snapshot.issues[0]! : null;
    // A bounded or uncovered tree keeps the agents it read; any other incomplete snapshot keeps none.
    const issue = row !== null && read.ok && (read.snapshot.complete || (!row.complete && row.dispatches.length > 0 &&
      ISSUE_PARTIAL_FOREST_REASONS.some(reason => reason === row.reason && reason === read.snapshot.reason)))
      ? row : null;
    const ids = issue?.dispatches.flatMap(dispatch => dispatch.agents.map(agent => agent.observation.agentId)) ?? [];
    const unavailable: IssueAgentTree = { repo: entry.repo, issueNumber: entry.issueNumber, complete: false,
      reason: read.ok && !read.snapshot.complete ? read.snapshot.reason : "binding_unavailable", dispatches: [],
      ...(entry.launchBlock === undefined ? {} : { launchBlock: entry.launchBlock }),
      ...(entry.launchRefusal === undefined ? {} : { launchRefusal: entry.launchRefusal }) };
    const tree = issue !== null && ids.every(id => !agentIds.has(id)) ? issue : unavailable;
    // The receipt proves the block independently of native coverage. Count it in the byte cap.
    const candidate = entry.launchBlock === undefined ? tree : { ...tree, launchBlock: entry.launchBlock };
    if (fits(candidate)) {
      issues.push(candidate);
      if (tree === issue) ids.forEach(id => agentIds.add(id));
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
