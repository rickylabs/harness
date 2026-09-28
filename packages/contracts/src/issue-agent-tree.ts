/** Per-issue dispatch trees. Every identity here is opaque; no native session key or path is public. */
import { readAgentObservations, MAX_AGENT_OBSERVATIONS, AGENT_UNAVAILABLE_REASONS, type AgentObservation,
  type AgentObservations, type AgentUnavailableReason } from "./agent-observations.js";
import type { RepoRef } from "./snapshot.js";

export const ISSUE_AGENT_TREE_SCHEMA = 1 as const;
export const ISSUE_AGENT_TREE_FRESH_MS = 15_000;
export const MAX_ISSUE_AGENT_TREE_BYTES = 2_097_152;
export const MAX_AGENT_HISTORY = 16;
export const AGENT_HISTORY_KINDS = ["dispatch-observed", "run-started-observed", "run-activity-observed", "stop-seat-observed", "stop-process-observed"] as const;
export type AgentHistoryKind = typeof AGENT_HISTORY_KINDS[number];
export interface AgentHistoryEvent { readonly dispatchId: string; readonly kind: AgentHistoryKind; readonly at: string }
export type AgentTreeValueSource = "dispatch" | "native" | "unavailable";
export type AgentTreeValue =
  | { readonly value: string; readonly source: "dispatch" | "native"; readonly reason: null }
  | { readonly value: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentBudget =
  | { readonly tokenLimit: number; readonly source: "issue-override" | "route-default"; readonly reason: null }
  | { readonly tokenLimit: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentNativeDepth =
  | { readonly value: number; readonly source: "native"; readonly reason: null }
  | { readonly value: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentRoutePolicy =
  | { readonly value: "netscript-matrix"; readonly digest: string; readonly source: "dispatch"; readonly reason: null }
  | { readonly value: null; readonly digest: null; readonly source: "unavailable"; readonly reason: AgentUnavailableReason };
export type AgentQuotaRegime =
  | { readonly value: "subscription" | "metered" | "local"; readonly reason: null }
  | { readonly value: null; readonly reason: AgentUnavailableReason };
export type AgentTreeLiveness =
  | { readonly state: "unknown"; readonly evidence: null; readonly observedAt: null; readonly reason: AgentUnavailableReason }
  | { readonly state: "running"; readonly evidence: "runtime-observation"; readonly observedAt: string; readonly reason: null }
  | { readonly state: "ended"; readonly evidence: "native-outcome" | "stop-observation"; readonly observedAt: string; readonly reason: null };
export type AgentActionState =
  | { readonly state: "unknown"; readonly observedAt: null; readonly reason: AgentUnavailableReason }
  | { readonly state: "stopping" | "stopped"; readonly observedAt: string; readonly reason: null };
export type AgentPlacementValue =
  | { readonly value: string; readonly basis: "placement" | "runtime"; readonly observedAt: string; readonly reason: null }
  | { readonly value: null; readonly basis: "unavailable"; readonly observedAt: null; readonly reason: AgentUnavailableReason };
export interface AgentTreeLocation {
  readonly host: AgentPlacementValue;
  readonly container: AgentPlacementValue;
  readonly seat: AgentPlacementValue;
}
export type AgentTerminalOutcome =
  | { readonly value: "succeeded" | "failed" | "cancelled"; readonly source: "native-outcome" | "stop-observation"; readonly observedAt: string; readonly reason: null }
  | { readonly value: null; readonly source: "unavailable"; readonly observedAt: null; readonly reason: AgentUnavailableReason };

export interface IssueAgentTreeAgent {
  /** Equals both enclosing dispatchId and observation.assignment.id. */
  readonly dispatchId: string;
  /** Existing validated ancestry, location, route and separate cost rows. */
  readonly observation: AgentObservation;
  readonly harness: AgentTreeValue;
  readonly provider: AgentTreeValue;
  /** Actual request gateway, evidenced by the bound dispatch transport or inherited ancestry. */
  readonly router: AgentTreeValue;
  /** Matrix policy is separate from the gateway; its digest comes from a bound receipt. */
  readonly routePolicy: AgentRoutePolicy;
  readonly model: AgentTreeValue;
  readonly location: AgentTreeLocation;
  readonly budget: AgentBudget;
  /** A child's measured native spawn depth; roots and legacy frames remain unavailable. */
  readonly nativeDepth: AgentNativeDepth;
  readonly quotaRegime: AgentQuotaRegime;
  readonly liveness: AgentTreeLiveness;
  /** A stop remains separate from native liveness until both seat and process absence are verified. */
  readonly actionState: AgentActionState;
  readonly endedBy: "stop" | null;
  readonly terminalOutcome: AgentTerminalOutcome;
  readonly startedAt: string | null;
  readonly startedAtReason: AgentUnavailableReason | null;
  /** Last activity is never treated as an end timestamp. */
  readonly endedAt: string | null;
  readonly endedAtReason: AgentUnavailableReason | null;
  /** No sanitized excerpt source exists yet. */
  readonly transcript: { readonly value: null; readonly reason: "source_not_bound" };
  readonly history: readonly AgentHistoryEvent[];
  readonly historyTruncated: boolean;
}
export interface IssueAgentTreeDispatch {
  readonly dispatchId: string;
  readonly agents: readonly IssueAgentTreeAgent[];
}
export interface IssueAgentTree {
  readonly repo: RepoRef;
  readonly issueNumber: number;
  /** A failed issue is retained with a typed reason and no unverified tree prefix. */
  readonly complete: boolean;
  readonly reason: AgentObservations["reason"];
  readonly dispatches: readonly IssueAgentTreeDispatch[];
}
export interface IssueAgentTreeSnapshot {
  readonly schema: 1;
  readonly protocol: 1;
  readonly observedAt: string;
  /** A stopped 5-second producer is stale after 15 seconds. */
  readonly validUntil: string;
  readonly revision: string;
  /** Dispatch/native ancestry coverage, not a claim that every optional field is observed. */
  readonly complete: boolean;
  readonly reason: AgentObservations["reason"];
  readonly issues: readonly IssueAgentTree[];
}
/** A restarted producer chooses a new generation and begins at sequence zero with a full snapshot. */
export interface IssueAgentTreeFrame {
  readonly type: "snapshot";
  readonly generation: string;
  readonly sequence: number;
  readonly snapshot: IssueAgentTreeSnapshot;
}
export type IssueAgentTreeReading =
  | { readonly ok: true; readonly snapshot: IssueAgentTreeSnapshot }
  | { readonly ok: false; readonly reason: "invalid" | "oversized" | "ambiguous-ancestry" | "unsupported-schema" };

class Invalid extends Error { constructor(readonly reason: Exclude<IssueAgentTreeReading, { ok: true }>["reason"] = "invalid") { super(reason); } }
const bad = (reason?: Invalid["reason"]): never => { throw new Invalid(reason); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return bad();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !own.includes(key))) return bad();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc) || !desc.enumerable) return bad();
    out[key] = desc.value;
  }
  return out;
}
function array(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > cap) return bad(value instanceof Array && value.length > cap ? "oversized" : "invalid");
  if (Reflect.ownKeys(value).length !== value.length + 1) return bad();
  return Array.from({ length: value.length }, (_, i) => {
    const desc = Object.getOwnPropertyDescriptor(value, String(i));
    if (!desc || !("value" in desc) || !desc.enumerable) return bad();
    return desc.value;
  });
}
function stamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return bad();
  return value;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) return bad();
  return value;
}
function reason(value: unknown): AgentUnavailableReason {
  if (typeof value !== "string" || !AGENT_UNAVAILABLE_REASONS.includes(value as AgentUnavailableReason)) return bad();
  return value as AgentUnavailableReason;
}
function valueRow(value: unknown): AgentTreeValue {
  const row = record(value, ["value", "source", "reason"]);
  if (row.source === "unavailable" && row.value === null) return { value: null, source: "unavailable", reason: reason(row.reason) };
  if ((row.source !== "dispatch" && row.source !== "native") || row.reason !== null) return bad();
  return { value: label(row.value), source: row.source, reason: null };
}
function depthRow(value: unknown): AgentNativeDepth {
  const row = record(value, ["value", "source", "reason"]);
  if (row.value === null && row.source === "unavailable") {
    return { value: null, source: "unavailable", reason: reason(row.reason) };
  }
  if (row.source !== "native" || row.reason !== null || typeof row.value !== "number" ||
      !Number.isSafeInteger(row.value) || row.value < 1) return bad();
  return { value: row.value, source: "native", reason: null };
}
function policyRow(value: unknown): AgentRoutePolicy {
  const row = record(value, ["value", "digest", "source", "reason"]);
  if (row.value === null && row.digest === null && row.source === "unavailable") {
    return { value: null, digest: null, source: "unavailable", reason: reason(row.reason) };
  }
  if (row.value !== "netscript-matrix" || row.source !== "dispatch" || row.reason !== null ||
      typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)) return bad();
  return { value: "netscript-matrix", digest: row.digest, source: "dispatch", reason: null };
}
function placement(value: unknown, capturedAt: string): AgentPlacementValue {
  const row = record(value, ["value", "basis", "observedAt", "reason"]);
  if (row.value === null && row.basis === "unavailable" && row.observedAt === null) {
    return { value: null, basis: "unavailable", observedAt: null, reason: reason(row.reason) };
  }
  if ((row.basis !== "placement" && row.basis !== "runtime") || row.reason !== null) return bad();
  const observedAt = stamp(row.observedAt);
  if (observedAt > capturedAt) return bad();
  return { value: label(row.value), basis: row.basis, observedAt, reason: null };
}
function agent(value: unknown, capturedAt: string, dispatchId: string): Omit<IssueAgentTreeAgent, "observation"> & { readonly observation: unknown } {
  const keys = ["dispatchId", "observation", "harness", "provider", "router", "model", "location", "budget", "quotaRegime", "liveness", "terminalOutcome", "startedAt", "startedAtReason", "endedAt", "endedAtReason", "transcript", "history", "historyTruncated"];
  const row = record(value, [...keys,
    ...(Object.hasOwn(value as object, "routePolicy") ? ["routePolicy"] : []),
    ...(Object.hasOwn(value as object, "nativeDepth") ? ["nativeDepth"] : []),
    ...(Object.hasOwn(value as object, "actionState") ? ["actionState"] : []),
    ...(Object.hasOwn(value as object, "endedBy") ? ["endedBy"] : [])]);
  if (row.dispatchId !== dispatchId) return bad("ambiguous-ancestry");
  const budget = record(row.budget, ["tokenLimit", "source", "reason"]);
  let decodedBudget: AgentBudget;
  if (budget.tokenLimit === null && budget.source === "unavailable") decodedBudget = { tokenLimit: null, source: "unavailable", reason: reason(budget.reason) };
  else if ((budget.source === "issue-override" || budget.source === "route-default") &&
    typeof budget.tokenLimit === "number" && Number.isSafeInteger(budget.tokenLimit) && budget.tokenLimit >= 0 && budget.reason === null) {
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
  else if (live.state === "running" && live.evidence === "runtime-observation" && live.reason === null) liveness = { state: "running", evidence: "runtime-observation", observedAt: stamp(live.observedAt), reason: null };
  else if (live.state === "ended" && (live.evidence === "native-outcome" || live.evidence === "stop-observation") && live.reason === null) liveness = { state: "ended", evidence: live.evidence, observedAt: stamp(live.observedAt), reason: null };
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
  if (endedBy !== null && endedBy !== "stop") return bad();
  if (actionState.state === "stopping" && liveness.state === "running") return bad();
  if (actionState.state === "stopped" && liveness.state === "running") return bad();
  if (liveness.state === "ended" && liveness.evidence === "stop-observation" && (actionState.state !== "stopped" || endedBy !== "stop")) return bad();
  if (endedBy === "stop" && (liveness.state !== "ended" || liveness.evidence !== "stop-observation")) return bad();
  const terminal = record(row.terminalOutcome, ["value", "source", "observedAt", "reason"]);
  let terminalOutcome: AgentTerminalOutcome;
  if (terminal.value === null && terminal.source === "unavailable" && terminal.observedAt === null) {
    terminalOutcome = { value: null, source: "unavailable", observedAt: null, reason: reason(terminal.reason) };
  } else if (["succeeded", "failed", "cancelled"].includes(terminal.value as string) &&
    (terminal.source === "native-outcome" || (terminal.source === "stop-observation" && terminal.value === "cancelled")) && terminal.reason === null) {
    terminalOutcome = { value: terminal.value as "succeeded" | "failed" | "cancelled", source: terminal.source, observedAt: stamp(terminal.observedAt), reason: null };
  } else return bad();
  if (terminalOutcome.observedAt !== null && terminalOutcome.observedAt > capturedAt) return bad();
  if (liveness.state !== "ended" && terminalOutcome.value !== null) return bad();
  if (liveness.state === "ended" && liveness.evidence === "stop-observation" &&
    (terminalOutcome.value !== "cancelled" || terminalOutcome.source !== "stop-observation")) return bad();
  if (terminalOutcome.source === "stop-observation" && (liveness.state !== "ended" || liveness.evidence !== "stop-observation")) return bad();
  const startedAt = row.startedAt === null ? null : stamp(row.startedAt);
  const endedAt = row.endedAt === null ? null : stamp(row.endedAt);
  if ((startedAt !== null && startedAt > capturedAt) || (endedAt !== null && (startedAt === null || endedAt < startedAt || endedAt > capturedAt))) return bad();
  if (endedBy === "stop" && (endedAt === null || endedAt !== actionState.observedAt)) return bad();
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
  const nativeDepth = Object.hasOwn(row, "nativeDepth") ? depthRow(row.nativeDepth)
    : { value: null, source: "unavailable", reason: "source_not_bound" } as const;
  return { dispatchId, observation: row.observation, harness: valueRow(row.harness), provider: valueRow(row.provider),
    router, routePolicy, model: valueRow(row.model), location, budget: decodedBudget, nativeDepth,
    quotaRegime, liveness, actionState, endedBy, terminalOutcome, startedAt, startedAtReason, endedAt, endedAtReason,
    transcript: { value: null, reason: "source_not_bound" }, history, historyTruncated: row.historyTruncated };
}

/** Strictly decode grouped ancestry before a cockpit stores or renders it. */
export function readIssueAgentTreeSnapshot(input: unknown): IssueAgentTreeReading {
  try {
    const row = record(input, ["schema", "protocol", "observedAt", "validUntil", "revision", "complete", "reason", "issues"]);
    if (row.schema !== 1 || row.protocol !== 1) return bad("unsupported-schema");
    const observedAt = stamp(row.observedAt);
    const validUntil = stamp(row.validUntil);
    if (validUntil !== new Date(Date.parse(observedAt) + ISSUE_AGENT_TREE_FRESH_MS).toISOString()) return bad();
    if (typeof row.revision !== "string" || !/^[a-f0-9]{64}$/.test(row.revision) || typeof row.complete !== "boolean") return bad();
    if (row.complete ? row.reason !== null : !["source_not_bound", "source_unavailable", "binding_unavailable", "scan_limit", "ancestry_unavailable"].includes(row.reason as string)) return bad();
    const issues: IssueAgentTree[] = [];
    let agentCount = 0;
    const agentIds = new Set<string>();
    const issueKeys = new Set<string>();
    const legacyPartials = new Set<number>();
    for (const rawIssue of array(row.issues, MAX_AGENT_OBSERVATIONS)) {
      const legacy = !Object.hasOwn(rawIssue as object, "complete") && !Object.hasOwn(rawIssue as object, "reason");
      const issue = record(rawIssue, legacy ? ["repo", "issueNumber", "dispatches"] : ["repo", "issueNumber", "complete", "reason", "dispatches"]);
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
      if (legacyPartial ? dispatches.length === 0 : issueComplete ? dispatches.length === 0 : dispatches.length !== 0) return bad();
      if (legacyPartial) legacyPartials.add(issues.length);
      issues.push({ repo: { owner: repo.owner, name: repo.name }, issueNumber: issue.issueNumber,
        complete: issueComplete, reason: issueReason as IssueAgentTree["reason"], dispatches });
    }
    if (agentCount > MAX_AGENT_OBSERVATIONS) return bad("oversized");
    if (row.complete && issues.some(issue => !issue.complete)) return bad();
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      if (!issue.complete && !legacyPartials.has(i)) continue;
      const all = issue.dispatches.flatMap(dispatch => dispatch.agents);
      const base: AgentObservations = { schema: 1, protocol: 1, observedAt, revision: row.revision,
        complete: !legacyPartials.has(i), reason: legacyPartials.has(i) ? "ancestry_unavailable" : null,
        agents: all.map(a => a.observation) };
      const read = readAgentObservations(base);
      if (!read.ok) return bad(read.reason === "oversized" ? "oversized" : read.reason === "ambiguous-ancestry" ? "ambiguous-ancestry" : "invalid");
      const safe = new Map(read.observation.agents.map(a => [a.agentId, a]));
      const publicAgents = new Map(all.map(a => [a.observation.agentId, a]));
      for (const a of all) {
        const capacity = safe.get(a.observation.agentId)?.cost.localCapacity;
        if (capacity?.availability === "available" && (a.location.host.value === null ||
          capacity.measurement.host !== a.location.host.value || capacity.validUntil === null || capacity.validUntil < validUntil)) return bad();
        const running = safe.get(a.observation.agentId)?.running;
        if (a.liveness.state === "running") {
          if (running?.value !== true || running.observedAt !== a.liveness.observedAt ||
              running.validUntil === null || running.validUntil < validUntil) return bad();
        } else if (running?.value === true) return bad();
        const parent = safe.get(a.observation.agentId)?.parentAgentId;
        if (a.nativeDepth.value !== null && (parent?.state !== "known-parent" || a.harness.source !== "native")) return bad();
        if (parent?.state === "known-parent") {
          if (a.budget.tokenLimit !== null || a.provider.source === "dispatch" || a.model.source === "dispatch" ||
              a.harness.source === "dispatch" || a.routePolicy.value !== null) return bad();
          const parentRouter = publicAgents.get(parent.value)?.router;
          if (a.router.value !== null && (!parentRouter || parentRouter.value !== a.router.value || parentRouter.source !== "dispatch")) return bad();
        } else if (a.router.value !== null) {
          if (parent?.state !== "confirmed-root") return bad();
          if (a.harness.source !== "dispatch" || a.router.value !== "direct" ||
              (a.harness.value !== "codex" && a.harness.value !== "claude")) return bad();
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
