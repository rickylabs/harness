/** Per-issue dispatch trees. Every identity here is opaque; no native session key or path is public. */
import { readAgentObservations, MAX_AGENT_OBSERVATIONS, type AgentObservations } from "./agent-observations.js";
import { ISSUE_AGENT_TREE_ACCEPTED_FRESH_MS, MAX_ISSUE_AGENT_TREE_BYTES, MAX_AGENT_HISTORY, AGENT_EFFORTS,
  AGENT_HISTORY_KINDS, type AgentHistoryKind, type AgentBudget, type AgentQuotaRegime,
  type AgentTreeLiveness, type AgentActionState, type AgentTreeLocation, type AgentTerminalOutcome,
  type IssueAgentTreeAgent, type IssueAgentTreeDispatch, ISSUE_LAUNCH_REFUSAL_REASONS,
  type IssueLaunchRefusalReason, type IssueLaunchRefusal, ISSUE_LAUNCH_BLOCK_REASONS,
  type IssueLaunchBlockReason, type IssueLaunchBlock, ISSUE_PARTIAL_FOREST_REASONS, type IssueAgentTree,
  type IssueAgentTreeSnapshot, type IssueAgentTreeReading } from "./issue-agent-tree-shapes.js";
import { Invalid, bad, record, array, stamp, reason, valueRow, launchRevisionRow, depthRow, policyRow,
  placement, activityRow, tokenUsageRow, resourceHistoryRow, timelineRow } from "./issue-agent-tree-rows.js";
export * from "./issue-agent-tree-shapes.js";

function agent(value: unknown, capturedAt: string, dispatchId: string): Omit<IssueAgentTreeAgent, "observation"> & { readonly observation: unknown } {
  const keys = ["dispatchId", "observation", "harness", "provider", "router", "model", "location", "budget", "quotaRegime", "liveness", "terminalOutcome", "startedAt", "startedAtReason", "endedAt", "endedAtReason", "transcript", "history", "historyTruncated"];
  const row = record(value, [...keys,
    ...(Object.hasOwn(value as object, "routePolicy") ? ["routePolicy"] : []),
    ...(Object.hasOwn(value as object, "profileRevision") ? ["profileRevision"] : []),
    ...(Object.hasOwn(value as object, "matrixRevision") ? ["matrixRevision"] : []),
    ...(Object.hasOwn(value as object, "effort") ? ["effort"] : []),
    ...(Object.hasOwn(value as object, "parentAgentId") ? ["parentAgentId"] : []),
    ...(Object.hasOwn(value as object, "nativeDepth") ? ["nativeDepth"] : []),
    ...(Object.hasOwn(value as object, "actionState") ? ["actionState"] : []),
    ...(Object.hasOwn(value as object, "endedBy") ? ["endedBy"] : []),
    ...(Object.hasOwn(value as object, "activity") ? ["activity"] : []),
    ...(Object.hasOwn(value as object, "tokenUsage") ? ["tokenUsage"] : []),
    ...(Object.hasOwn(value as object, "resourceHistory") ? ["resourceHistory"] : []),
    ...(Object.hasOwn(value as object, "timeline") ? ["timeline"] : [])]);
  if (row.dispatchId !== dispatchId) return bad("ambiguous-ancestry");
  const budget = record(row.budget, ["tokenLimit", "source", "reason"]);
  let decodedBudget: AgentBudget;
  if (budget.tokenLimit === null && budget.source === "unavailable") decodedBudget = { tokenLimit: null, source: "unavailable", reason: reason(budget.reason) };
  else if ((budget.source === "issue-override" || budget.source === "route-default" || budget.source === "action-receipt") &&
    typeof budget.tokenLimit === "number" && Number.isSafeInteger(budget.tokenLimit) &&
    (budget.source === "action-receipt" ? budget.tokenLimit > 0 : budget.tokenLimit >= 0) && budget.reason === null) {
    decodedBudget = { tokenLimit: budget.tokenLimit, source: budget.source, reason: null };
  } else return bad();
  const quota = record(row.quotaRegime, ["value", "reason"]);
  let quotaRegime: AgentQuotaRegime;
  if (quota.value === null) quotaRegime = { value: null, reason: reason(quota.reason) };
  else if (["subscription", "metered", "local"].includes(quota.value as string) && quota.reason === null) {
    quotaRegime = { value: quota.value as "subscription" | "metered" | "local", reason: null };
  } else return bad();
  const locationRow = record(row.location, ["host", "container", "seat"]);
  const location: AgentTreeLocation = { host: placement(locationRow.host, capturedAt),
    container: placement(locationRow.container, capturedAt), seat: placement(locationRow.seat, capturedAt) };
  const live = record(row.liveness, ["state", "evidence", "observedAt", "reason"]);
  let liveness: AgentTreeLiveness;
  if (live.state === "unknown" && live.evidence === null && live.observedAt === null) liveness = { state: "unknown", evidence: null, observedAt: null, reason: reason(live.reason) };
  else if ((live.state === "running" || live.state === "idle") && live.evidence === "runtime-observation" && live.reason === null) liveness = { state: live.state, evidence: "runtime-observation", observedAt: stamp(live.observedAt), reason: null };
  else if (live.state === "ended" && (live.evidence === "native-outcome" || live.evidence === "stop-observation" || live.evidence === "teardown-observation") && live.reason === null) liveness = { state: "ended", evidence: live.evidence, observedAt: stamp(live.observedAt), reason: null };
  else return bad();
  if (liveness.observedAt !== null && liveness.observedAt > capturedAt) return bad();
  const actionRow = Object.hasOwn(row, "actionState") ? record(row.actionState, ["state", "observedAt", "reason"]) : null;
  let actionState: AgentActionState = { state: "unknown", observedAt: null, reason: "source_not_bound" };
  if (actionRow !== null) {
    if (actionRow.state === "unknown" && actionRow.observedAt === null) actionState = { state: "unknown", observedAt: null, reason: reason(actionRow.reason) };
    else if ((actionRow.state === "stopping" || actionRow.state === "stopped") && actionRow.reason === null) {
      actionState = { state: actionRow.state, observedAt: stamp(actionRow.observedAt), reason: null };
    } else return bad();
  }
  if (actionState.observedAt !== null && actionState.observedAt > capturedAt) return bad();
  const endedBy = Object.hasOwn(row, "endedBy") ? row.endedBy : null;
  if (endedBy !== null && endedBy !== "stop" && endedBy !== "timeout" && endedBy !== "teardown") return bad();
  if (actionState.state === "stopping" && liveness.state === "running") return bad();
  if (actionState.state === "stopped" && liveness.state === "running") return bad();
  if (liveness.state === "ended" && liveness.evidence === "stop-observation" && (actionState.state !== "stopped" || endedBy !== "stop")) return bad();
  if (endedBy === "stop" && (liveness.state !== "ended" || liveness.evidence !== "stop-observation")) return bad();
  if (liveness.state === "ended" && liveness.evidence === "teardown-observation" && endedBy !== "timeout" && endedBy !== "teardown") return bad();
  if ((endedBy === "timeout" || endedBy === "teardown") && (liveness.state !== "ended" || liveness.evidence !== "teardown-observation")) return bad();
  const terminal = record(row.terminalOutcome, ["value", "source", "observedAt", "reason"]);
  let terminalOutcome: AgentTerminalOutcome;
  if (terminal.value === null && terminal.source === "unavailable" && terminal.observedAt === null) {
    terminalOutcome = { value: null, source: "unavailable", observedAt: null, reason: reason(terminal.reason) };
  } else if (["succeeded", "failed", "cancelled"].includes(terminal.value as string) &&
    (terminal.source === "native-outcome" || ((terminal.source === "stop-observation" || terminal.source === "teardown-observation") && terminal.value === "cancelled")) && terminal.reason === null) {
    terminalOutcome = { value: terminal.value as "succeeded" | "failed" | "cancelled", source: terminal.source, observedAt: stamp(terminal.observedAt), reason: null };
  } else return bad();
  if (terminalOutcome.observedAt !== null && terminalOutcome.observedAt > capturedAt) return bad();
  if (liveness.state !== "ended" && terminalOutcome.value !== null) return bad();
  if (liveness.state === "ended" && liveness.evidence === "stop-observation" &&
    (terminalOutcome.value !== "cancelled" || terminalOutcome.source !== "stop-observation")) return bad();
  if (terminalOutcome.source === "stop-observation" && (liveness.state !== "ended" || liveness.evidence !== "stop-observation")) return bad();
  // A teardown ends the seat. The outcome is the teardown's cancellation, or (0.27.0) a native
  // success the agent completed at or before the teardown: it had finished and sat at its prompt.
  if (liveness.state === "ended" && liveness.evidence === "teardown-observation" &&
    !(terminalOutcome.value === "cancelled" && terminalOutcome.source === "teardown-observation") &&
    !(terminalOutcome.value === "succeeded" && terminalOutcome.source === "native-outcome" &&
      terminalOutcome.observedAt <= liveness.observedAt)) return bad();
  if (terminalOutcome.source === "teardown-observation" && (liveness.state !== "ended" || liveness.evidence !== "teardown-observation")) return bad();
  const startedAt = row.startedAt === null ? null : stamp(row.startedAt);
  const endedAt = row.endedAt === null ? null : stamp(row.endedAt);
  if ((startedAt !== null && startedAt > capturedAt) || (endedAt !== null && (startedAt === null || endedAt < startedAt || endedAt > capturedAt))) return bad();
  if (endedBy === "stop" && (endedAt === null || endedAt !== actionState.observedAt)) return bad();
  if ((endedBy === "timeout" || endedBy === "teardown") && (endedAt === null || endedAt !== liveness.observedAt)) return bad();
  const startedAtReason = startedAt === null ? reason(row.startedAtReason) : row.startedAtReason === null ? null : bad();
  const endedAtReason = endedAt === null ? reason(row.endedAtReason) : row.endedAtReason === null ? null : bad();
  const transcript = record(row.transcript, ["value", "reason"]);
  if (transcript.value !== null || transcript.reason !== "source_not_bound") return bad();
  const history = array(row.history, MAX_AGENT_HISTORY).map(event => {
    const h = record(event, ["dispatchId", "kind", "at"]);
    if (h.dispatchId !== dispatchId) return bad("ambiguous-ancestry");
    if (!AGENT_HISTORY_KINDS.includes(h.kind as AgentHistoryKind)) return bad();
    const at = stamp(h.at);
    if (at > capturedAt) return bad();
    return { dispatchId, kind: h.kind as AgentHistoryKind, at };
  });
  if (typeof row.historyTruncated !== "boolean" || (row.historyTruncated && history.length !== MAX_AGENT_HISTORY)) return bad();
  for (let i = 1; i < history.length; i++) {
    if (`${history[i - 1]!.at}\0${history[i - 1]!.kind}` >= `${history[i]!.at}\0${history[i]!.kind}`) return bad();
  }
  const router = valueRow(row.router);
  if (router.value !== null && router.source !== "dispatch") return bad();
  const routePolicy = Object.hasOwn(row, "routePolicy") ? policyRow(row.routePolicy)
    : { value: null, digest: null, source: "unavailable", reason: "source_not_bound" } as const;
  const hasProfileRevision = Object.hasOwn(row, "profileRevision");
  const hasMatrixRevision = Object.hasOwn(row, "matrixRevision");
  if (hasProfileRevision !== hasMatrixRevision) return bad();
  const profileRevision = hasProfileRevision ? launchRevisionRow(row.profileRevision) : undefined;
  const matrixRevision = hasMatrixRevision ? launchRevisionRow(row.matrixRevision) : undefined;
  const effort = Object.hasOwn(row, "effort") ? valueRow(row.effort) : undefined;
  if (effort?.value !== null && effort?.value !== undefined &&
      (effort.source !== "dispatch" || !AGENT_EFFORTS.includes(effort.value as typeof AGENT_EFFORTS[number]))) return bad();
  const parentAgentId = Object.hasOwn(row, "parentAgentId") ? row.parentAgentId : undefined;
  if (parentAgentId !== undefined && parentAgentId !== null &&
      (typeof parentAgentId !== "string" || !/^agent_[a-f0-9]{64}$/.test(parentAgentId))) return bad();
  const nativeDepth = Object.hasOwn(row, "nativeDepth") ? depthRow(row.nativeDepth)
    : { value: null, source: "unavailable", reason: "source_not_bound" } as const;
  const timeline = Object.hasOwn(row, "timeline") ? timelineRow(row.timeline, capturedAt) : undefined;
  for (const event of timeline?.events ?? []) {
    if (event.kind !== "ended" || event.reason === undefined) continue;
    const expected = endedBy ?? (terminalOutcome.value === "succeeded" ? "native-complete"
      : terminalOutcome.value === "failed" ? "native-error"
        : terminalOutcome.value === "cancelled" ? "native-cancelled" : null);
    if (event.reason !== expected || event.outcome !== terminalOutcome.value ||
        (endedBy === null && terminalOutcome.source !== "native-outcome")) return bad();
  }
  const tokenUsage = Object.hasOwn(row, "tokenUsage")
    ? tokenUsageRow(row.tokenUsage, capturedAt, decodedBudget.tokenLimit) : undefined;
  const resourceHistory = Object.hasOwn(row, "resourceHistory")
    ? resourceHistoryRow(row.resourceHistory, capturedAt, parentAgentId === null, decodedBudget, tokenUsage) : undefined;
  const harness = valueRow(row.harness), provider = valueRow(row.provider);
  return { dispatchId, observation: row.observation, harness, provider,
    router, routePolicy, model: valueRow(row.model, harness.value === "opencode" ? { provider: provider.value } : undefined),
    ...(profileRevision === undefined ? {} : { profileRevision, matrixRevision: matrixRevision! }),
    ...(effort === undefined ? {} : { effort }),
    ...(parentAgentId === undefined ? {} : { parentAgentId: parentAgentId as string | null }),
    location, budget: decodedBudget, nativeDepth,
    quotaRegime, liveness, actionState, endedBy, terminalOutcome, startedAt, startedAtReason, endedAt, endedAtReason,
    transcript: { value: null, reason: "source_not_bound" }, history, historyTruncated: row.historyTruncated,
    ...(Object.hasOwn(row, "activity") ? { activity: activityRow(row.activity, capturedAt) } : {}),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(resourceHistory === undefined ? {} : { resourceHistory }),
    ...(timeline === undefined ? {} : { timeline }) };
}

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
      const bounded = !legacy && !issueComplete && (ISSUE_PARTIAL_FOREST_REASONS as readonly unknown[]).includes(issueReason);
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
