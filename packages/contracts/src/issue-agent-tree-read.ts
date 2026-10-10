/** The public strict decoder for per-issue dispatch trees. */
import { readAgentObservations, MAX_AGENT_OBSERVATIONS, type AgentObservations } from "./agent-observations.js";
import { AGENT_EFFORTS, ISSUE_AGENT_TREE_ACCEPTED_FRESH_MS, ISSUE_LAUNCH_BLOCK_REASONS, ISSUE_LAUNCH_REFUSAL_REASONS,
  MAX_ISSUE_AGENT_TREE_BYTES, type IssueAgentTree, type IssueAgentTreeAgent, type IssueAgentTreeDispatch,
  type IssueAgentTreeReading, type IssueAgentTreeSnapshot, type IssueLaunchBlock, type IssueLaunchBlockReason,
  type IssueLaunchRefusal, type IssueLaunchRefusalReason } from "./issue-agent-tree.js";
import { Invalid, agent, array, bad, record, stamp } from "./issue-agent-tree-rows.js";

/** Strictly decode grouped ancestry before a cockpit stores or renders it. */
export function readIssueAgentTreeSnapshot(input: unknown): IssueAgentTreeReading {
  try {
    const row = record(input, ["schema", "protocol", "observedAt", "validUntil", "revision", "complete", "reason", "issues"]);
    if (row.schema !== 1 || row.protocol !== 1) return bad("unsupported-schema");
    const observedAt = stamp(row.observedAt);
    const validUntil = stamp(row.validUntil);
    if (!ISSUE_AGENT_TREE_ACCEPTED_FRESH_MS.some((ms) =>
      validUntil === new Date(Date.parse(observedAt) + ms).toISOString())) return bad();
    if (typeof row.revision !== "string" || !/^[a-f0-9]{64}$/.test(row.revision) || typeof row.complete !== "boolean") return bad();
    if (row.complete ? row.reason !== null : !["source_not_bound", "source_unavailable", "binding_unavailable", "scan_limit", "ancestry_unavailable"].includes(row.reason as string)) return bad();
    const issues: IssueAgentTree[] = [];
    let agentCount = 0;
    const agentIds = new Set<string>();
    const issueKeys = new Set<string>();
    const legacyPartials = new Set<number>();
    for (const rawIssue of array(row.issues, MAX_AGENT_OBSERVATIONS)) {
      const legacy = !Object.hasOwn(rawIssue as object, "complete") && !Object.hasOwn(rawIssue as object, "reason");
      const hasRefusal = Object.hasOwn(rawIssue as object, "launchRefusal");
      const hasBlock = Object.hasOwn(rawIssue as object, "launchBlock");
      const issue = record(rawIssue, legacy ? ["repo", "issueNumber", "dispatches"] :
        ["repo", "issueNumber", "complete", "reason", "dispatches", ...(hasRefusal ? ["launchRefusal"] : []),
          ...(hasBlock ? ["launchBlock"] : [])]);
      if ((legacy && (hasRefusal || hasBlock)) || (hasRefusal && hasBlock)) return bad();
      const legacyPartial = legacy && !row.complete && row.reason === "ancestry_unavailable";
      const issueComplete = legacy ? !legacyPartial : issue.complete;
      const issueReason = legacyPartial ? "ancestry_unavailable" : legacy ? null : issue.reason;
      if (typeof issueComplete !== "boolean" || (issueComplete ? issueReason !== null :
          !["source_not_bound", "source_unavailable", "binding_unavailable", "scan_limit", "ancestry_unavailable"].includes(issueReason as string))) return bad();
      const repo = record(issue.repo, ["owner", "name"]);
      if (typeof repo.owner !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(repo.owner) || repo.owner.length > 39 ||
          typeof repo.name !== "string" || !/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/.test(repo.name) || repo.name.length > 100 ||
          typeof issue.issueNumber !== "number" || !Number.isSafeInteger(issue.issueNumber) || issue.issueNumber < 1) return bad();
      const issueKey = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}#${issue.issueNumber}`;
      if (issueKeys.has(issueKey)) return bad("ambiguous-ancestry");
      issueKeys.add(issueKey);
      let launchRefusal: IssueLaunchRefusal | undefined;
      if (hasRefusal) {
        const refusal = record(issue.launchRefusal, ["state", "reason", "at", "dispatchId", "source"]);
        if (refusal.state !== "refused" || refusal.source !== "orchid" ||
            !ISSUE_LAUNCH_REFUSAL_REASONS.includes(refusal.reason as IssueLaunchRefusalReason) ||
            typeof refusal.dispatchId !== "string" || !/^assignment_[a-f0-9]{64}$/.test(refusal.dispatchId)) return bad();
        const at = stamp(refusal.at);
        if (at > observedAt) return bad();
        launchRefusal = { state: "refused", reason: refusal.reason as IssueLaunchRefusalReason,
          at, dispatchId: refusal.dispatchId, source: "orchid" };
      }
      let launchBlock: IssueLaunchBlock | undefined;
      if (hasBlock) {
        const block = record(issue.launchBlock, ["state", "reason", "at", "dispatchId", "source"]);
        if (block.state !== "blocked" || block.source !== "orchid" ||
            !ISSUE_LAUNCH_BLOCK_REASONS.includes(block.reason as IssueLaunchBlockReason) ||
            typeof block.dispatchId !== "string" || !/^assignment_[a-f0-9]{64}$/.test(block.dispatchId)) return bad();
        const at = stamp(block.at);
        if (at > observedAt) return bad();
        launchBlock = { state: "blocked", reason: block.reason as IssueLaunchBlockReason,
          at, dispatchId: block.dispatchId, source: "orchid" };
      }
      const dispatches: IssueAgentTreeDispatch[] = [];
      const dispatchIds = new Set<string>();
      for (const rawDispatch of array(issue.dispatches, MAX_AGENT_OBSERVATIONS)) {
        const dispatch = record(rawDispatch, ["dispatchId", "agents"]);
        if (typeof dispatch.dispatchId !== "string" || !/^assignment_[a-f0-9]{64}$/.test(dispatch.dispatchId) || dispatchIds.has(dispatch.dispatchId)) return bad("ambiguous-ancestry");
        dispatchIds.add(dispatch.dispatchId);
        const agents = array(dispatch.agents, MAX_AGENT_OBSERVATIONS).map(a => agent(a, observedAt, dispatch.dispatchId as string)) as IssueAgentTreeAgent[];
        if (agents.length === 0) return bad();
        for (const a of agents) {
          const observed = record(a.observation, ["agentId", "repo", "issueNumber", "assignment", "parentAgentId", "workspace", "tab", "pane", "terminal", "running", "route", "cost", "observedAt", "revision"].concat(
            Object.hasOwn(a.observation as object, "routeObservedReasons") ? ["routeObservedReasons"] : []));
          const assignment = record(observed.assignment, ["id", "dispatcher", "basis"]);
          const agentRepo = record(observed.repo, ["owner", "name"]);
          if (assignment.id !== dispatch.dispatchId || agentRepo.owner !== repo.owner || agentRepo.name !== repo.name || observed.issueNumber !== issue.issueNumber) return bad("ambiguous-ancestry");
          if (agentIds.has(a.observation.agentId)) return bad("ambiguous-ancestry");
          agentIds.add(a.observation.agentId);
          agentCount++;
        }
        dispatches.push({ dispatchId: dispatch.dispatchId, agents });
      }
      const bounded = !legacy && !issueComplete && issueReason === "scan_limit";
      if (legacyPartial ? dispatches.length === 0 : issueComplete ? dispatches.length === 0 && launchRefusal === undefined
        : dispatches.length !== 0 && !bounded) return bad();
      if (legacyPartial) legacyPartials.add(issues.length);
      issues.push({ repo: { owner: repo.owner, name: repo.name }, issueNumber: issue.issueNumber,
        complete: issueComplete, reason: issueReason as IssueAgentTree["reason"], dispatches,
        ...(launchRefusal === undefined ? {} : { launchRefusal }),
        ...(launchBlock === undefined ? {} : { launchBlock }) });
    }
    if (agentCount > MAX_AGENT_OBSERVATIONS) return bad("oversized");
    if (row.complete && issues.some(issue => !issue.complete)) return bad();
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      // A bounded issue's tree is checked as a closed tree, like a complete one.
      if (!issue.complete && !legacyPartials.has(i) && issue.dispatches.length === 0) continue;
      const all = issue.dispatches.flatMap(dispatch => dispatch.agents);
      const base: AgentObservations = { schema: 1, protocol: 1, observedAt, revision: row.revision,
        complete: !legacyPartials.has(i), reason: legacyPartials.has(i) ? "ancestry_unavailable" : null,
        agents: all.map(a => a.observation) };
      const read = readAgentObservations(base);
      if (!read.ok) return bad(read.reason === "oversized" ? "oversized" : read.reason === "ambiguous-ancestry" ? "ambiguous-ancestry" : "invalid");
      const safe = new Map(read.observation.agents.map(a => [a.agentId, a]));
      const publicAgents = new Map(all.map(a => [a.observation.agentId, a]));
      for (const dispatch of issue.dispatches) {
        const root = dispatch.agents.find(a => safe.get(a.observation.agentId)?.parentAgentId.state === "confirmed-root");
        for (const a of dispatch.agents) {
          for (const field of ["profileRevision", "matrixRevision"] as const) {
            const pin = a[field];
            if (pin?.value !== null && pin !== undefined && root?.[field]?.value !== pin.value) return bad();
          }
        }
      }
      for (const a of all) {
        const capacity = safe.get(a.observation.agentId)?.cost.localCapacity;
        if (capacity?.availability === "available" && (a.location.host.value === null ||
          capacity.measurement.host !== a.location.host.value || capacity.validUntil === null || capacity.validUntil < validUntil)) return bad();
        const running = safe.get(a.observation.agentId)?.running;
        if (a.liveness.state === "running" || a.liveness.state === "idle") {
          if (running?.value !== (a.liveness.state === "running") || running.observedAt !== a.liveness.observedAt ||
              running.validUntil === null || running.validUntil < validUntil) return bad();
        } else if (running?.value === true || running?.value === false) return bad();
        const parent = safe.get(a.observation.agentId)?.parentAgentId;
        if (a.parentAgentId !== undefined && a.parentAgentId !== (parent?.state === "known-parent" ? parent.value : null)) return bad();
        if (a.effort !== undefined) {
          const requested = parent?.state === "confirmed-root" ? safe.get(a.observation.agentId)?.route.requested.effort.value : null;
          const known = typeof requested === "string" && AGENT_EFFORTS.includes(requested as typeof AGENT_EFFORTS[number]);
          if (known ? a.effort.value !== requested || a.effort.source !== "dispatch"
            : a.effort.value !== null || a.effort.source !== "unavailable" ||
              a.effort.reason !== (requested === null ? "source_not_bound" : "binding_invalid")) return bad();
        }
        if (a.nativeDepth.value !== null && (parent?.state !== "known-parent" || a.harness.source !== "native")) return bad();
        if (parent?.state === "known-parent") {
          if (a.budget.tokenLimit !== null || a.provider.source === "dispatch" || a.model.source === "dispatch" ||
              a.harness.source === "dispatch" || a.routePolicy.value !== null) return bad();
          const parentRouter = publicAgents.get(parent.value)?.router;
          if (a.router.value !== null && (!parentRouter || parentRouter.value !== a.router.value || parentRouter.source !== "dispatch")) return bad();
        } else if (a.router.value !== null) {
          if (parent?.state !== "confirmed-root") return bad();
          if (a.harness.source !== "dispatch" || a.router.value !== "direct" ||
              (a.harness.value !== "codex" && a.harness.value !== "claude" && a.harness.value !== "agy" && a.harness.value !== "opencode")) return bad();
        }
        if (a.routePolicy.value !== null && parent?.state !== "confirmed-root") return bad();
      }
      issues[i] = legacyPartials.has(i) ? { ...issue, dispatches: [] } :
        { ...issue, dispatches: issue.dispatches.map(dispatch => ({ ...dispatch,
          agents: dispatch.agents.map(a => ({ ...a, observation: safe.get(a.observation.agentId)! })) })) };
    }
    const snapshot: IssueAgentTreeSnapshot = { schema: 1, protocol: 1, observedAt, validUntil, revision: row.revision,
      complete: row.complete, reason: row.reason as IssueAgentTreeSnapshot["reason"], issues };
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_ISSUE_AGENT_TREE_BYTES) return bad("oversized");
    return { ok: true, snapshot };
  } catch (error) { return { ok: false, reason: error instanceof Invalid ? error.reason : "invalid" }; }
}
