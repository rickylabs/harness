/** Public references and run facts for repo profiles and Cockpit-owned workflow revisions.
 * Markdown, prompts, trigger filters, writer paths and native IDs remain private. */
import { publicActivityText } from "./issue-agent-tree.js";

export const PROFILE_KINDS = ["leaf", "rfc", "milestone-coordinator"] as const;
export const PROFILE_ROLES = ["implementation", "ui_ux", "plan", "plan_evaluation",
  "implementation_evaluation", "vision_evaluation", "documentation", "deep_research", "coordinator"] as const;
export const WORKLOAD_TIERS = ["simple", "straightforward", "feature", "complex", "architecture"] as const;
export const COORDINATOR_TIERS = ["small_project", "project", "framework", "milestone"] as const;
export const WORKFLOW_BLOCK_KINDS = ["needs_input", "dependency", "capability", "transient"] as const;
export type ProfileKind = typeof PROFILE_KINDS[number];
export type ProfileRole = typeof PROFILE_ROLES[number];
export type ProfileTier = typeof WORKLOAD_TIERS[number] | typeof COORDINATOR_TIERS[number];
export type WorkflowBlockKind = typeof WORKFLOW_BLOCK_KINDS[number];
export type WorkflowOutcome = "succeeded" | "failed" | "cancelled";
export type WorkflowState = "pending" | "running" | "blocked" | "ended";
export type WorkflowUnavailableReason = "source_not_bound" | "source_unavailable" | "measurement_missing";
export type WorkflowRead<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly problems: readonly { readonly field: string; readonly code: string }[] };

export type ProfileBudget =
  | { readonly tokenLimit: number; readonly source: "route-default" | "issue-override"; readonly reason: null }
  | { readonly tokenLimit: null; readonly source: "unavailable"; readonly reason: WorkflowUnavailableReason };
/** A revision points to repo Markdown; no instruction text or chosen model is carried outward. */
export interface ProfileRef {
  readonly name: string;
  readonly title: string;
  readonly kind: ProfileKind;
  readonly role: ProfileRole;
  readonly tier: ProfileTier;
  /** Exact target-repository commit and digest of profiles/<name>.md. */
  readonly profileRevision: string;
  readonly profileDigest: string;
  /** Exact pinned NetScript matrix commit. */
  readonly matrixRevision: string;
  readonly guardrailDigest: string;
  readonly budget: ProfileBudget;
}
export type WorkflowVerifierRole = "plan_evaluation" | "implementation_evaluation" | "vision_evaluation";
export interface WorkflowPhase {
  readonly id: string;
  readonly profile: ProfileRef;
  readonly dependsOn: readonly string[];
  readonly parallelCount: number;
  /** Opaque ownership slots; the file/path rules live only in the private revision. */
  readonly writerScopeIds: readonly string[];
  readonly outputKind: "plan" | "rfc" | "pull_request" | "report";
  readonly outputSchemaDigest: string;
  readonly verifierRole: WorkflowVerifierRole | null;
  readonly maxRounds: number | "none" | "unspecified_by_owner";
}
/** Cockpit stores immutable revision content and a separate approval/rollback ledger. */
export interface WorkflowRevision {
  readonly schema: 1;
  readonly workflowId: string;
  readonly revision: string;
  readonly createdByRunId: string | null;
  readonly phases: readonly WorkflowPhase[];
}
export type RoutineTrigger =
  | { readonly kind: "schedule"; readonly cron: string; readonly timeZone: string }
  | { readonly kind: "label" | "pull_request" | "ci_red"; readonly filterDigest: string };
/** A wake-up creates or labels an issue; it cannot launch around Orchid. */
export interface RoutineRevision {
  readonly schema: 1;
  readonly routineId: string;
  readonly revision: string;
  readonly workflowId: string;
  readonly workflowRevision: string;
  readonly trigger: RoutineTrigger;
  readonly overlapPolicy: "coalesce" | "skip" | "enqueue";
  readonly missedRunPolicy: "skip" | "enqueue_one";
}
export type WorkflowCostRow<S extends string> =
  | { readonly value: number; readonly source: S; readonly observedAt: string; readonly reason: null }
  | { readonly value: null; readonly source: "unavailable"; readonly observedAt: null;
      readonly reason: WorkflowUnavailableReason };
export interface WorkflowAttempt {
  readonly id: string;
  readonly phaseId: string;
  readonly state: WorkflowState;
  readonly outcome: WorkflowOutcome | null;
  readonly blockKind: WorkflowBlockKind | null;
  readonly dispatchId: string | null;
  readonly agentId: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly cost: {
    readonly runTokens: WorkflowCostRow<"native-usage">;
    readonly meteredUsdMicros: WorkflowCostRow<"billing">;
  };
}
export interface WorkflowRun {
  readonly schema: 1;
  readonly id: string;
  readonly workflowId: string;
  readonly workflowRevision: string;
  readonly scope: { readonly kind: "home" | "project" | "milestone" | "issue"; readonly id: string };
  readonly state: WorkflowState;
  readonly outcome: WorkflowOutcome | null;
  readonly blockKind: WorkflowBlockKind | null;
  readonly attempts: readonly WorkflowAttempt[];
  readonly finalReportId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type Problem = { field: string; code: string };
/** Copy only bounded JSON data so a decoded contract never retains caller objects or runs getters. */
function safeData(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0, bytes = 0;
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > 4096 || depth > 20) throw new Error("input_limit");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("non_json_number");
      return input;
    }
    if (typeof input === "string") {
      bytes += input.length;
      if (bytes > 1_048_576) throw new Error("input_limit");
      return input;
    }
    if (typeof input !== "object" || seen.has(input)) throw new Error("non_json_value");
    seen.add(input);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Object.getOwnPropertySymbols(input).length > 0) throw new Error("symbol_key");
      if (Array.isArray(input)) {
        if (input.length > 128 || Object.keys(descriptors).length !== input.length + 1) throw new Error("array_invalid");
        const items: unknown[] = [];
        for (let i = 0; i < input.length; i++) {
          const descriptor = descriptors[String(i)];
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("array_invalid");
          items.push(copy(descriptor.value, depth + 1));
        }
        return items;
      }
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null || Object.keys(descriptors).length > 64) throw new Error("object_invalid");
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("object_invalid");
        bytes += key.length;
        if (bytes > 1_048_576) throw new Error("input_limit");
        output[key] = copy(descriptor.value, depth + 1);
      }
      return output;
    } finally {
      seen.delete(input);
    }
  };
  return copy(value, 0);
}
function safeRead<T>(value: unknown, path: string, validate: (copy: unknown, out: Problem[]) => void): WorkflowRead<T> {
  try {
    const copied = safeData(value);
    const out: Problem[] = [];
    validate(copied, out);
    return result(copied, out);
  } catch {
    return { ok: false, problems: [{ field: path, code: "unsafe_input" }] };
  }
}
const own = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key);
const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const member = (value: unknown, choices: readonly string[]) => typeof value === "string" && choices.includes(value);
const slug = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const phaseId = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const uuid = (value: unknown) => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const commit = (value: unknown) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const digest = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const opaqueAgent = (value: unknown) => typeof value === "string" && /^agent_[0-9a-f]{64}$/.test(value);
const opaqueDispatch = (value: unknown) => typeof value === "string" && /^assignment_[0-9a-f]{64}$/.test(value);
const opaqueWriter = (value: unknown) => typeof value === "string" && /^scope_[0-9a-f]{32,64}$/.test(value);
const nonnegative = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const time = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const problem = (out: Problem[], field: string, code: string) => out.push({ field, code });
function record(value: unknown, field: string, required: readonly string[], optional: readonly string[], out: Problem[]) {
  const found = obj(value);
  if (found === null) { problem(out, field, "object_required"); return null; }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(found)) if (!allowed.has(key)) problem(out, `${field}.${key}`, "unknown_field");
  for (const key of required) if (!own(found, key)) problem(out, `${field}.${key}`, "required");
  return found;
}
function field(out: Problem[], path: string, value: unknown, check: (value: unknown) => boolean) {
  if (!check(value)) problem(out, path, "invalid");
}
function result<T>(value: unknown, out: Problem[]): WorkflowRead<T> {
  return out.length ? { ok: false, problems: out } : { ok: true, value: value as T };
}
function validateBudget(value: unknown, path: string, out: Problem[]) {
  const v = record(value, path, ["tokenLimit", "source", "reason"], [], out);
  if (!v) return;
  if (v.source === "unavailable") {
    field(out, `${path}.tokenLimit`, v.tokenLimit, x => x === null);
    field(out, `${path}.reason`, v.reason, x => member(x, WORKFLOW_UNAVAILABLE_REASONS));
  } else {
    field(out, `${path}.source`, v.source, x => member(x, ["route-default", "issue-override"]));
    field(out, `${path}.tokenLimit`, v.tokenLimit, nonnegative);
    field(out, `${path}.reason`, v.reason, x => x === null);
  }
}
const WORKFLOW_UNAVAILABLE_REASONS = ["source_not_bound", "source_unavailable", "measurement_missing"] as const;
function validateProfile(value: unknown, path: string, out: Problem[]) {
  const v = record(value, path, ["name", "title", "kind", "role", "tier", "profileRevision",
    "profileDigest", "matrixRevision", "guardrailDigest", "budget"], [], out);
  if (!v) return;
  field(out, `${path}.name`, v.name, slug);
  field(out, `${path}.title`, v.title, x => publicActivityText(x) === x);
  field(out, `${path}.kind`, v.kind, x => member(x, PROFILE_KINDS));
  field(out, `${path}.role`, v.role, x => member(x, PROFILE_ROLES));
  const coordinator = v.role === "coordinator";
  field(out, `${path}.tier`, v.tier, x => member(x, coordinator ? COORDINATOR_TIERS : WORKLOAD_TIERS));
  if ((v.kind === "milestone-coordinator") !== coordinator) problem(out, `${path}.kind`, "role_mismatch");
  field(out, `${path}.profileRevision`, v.profileRevision, commit);
  field(out, `${path}.profileDigest`, v.profileDigest, digest);
  field(out, `${path}.matrixRevision`, v.matrixRevision, commit);
  field(out, `${path}.guardrailDigest`, v.guardrailDigest, digest);
  validateBudget(v.budget, `${path}.budget`, out);
}
export function readProfileRef(value: unknown): WorkflowRead<ProfileRef> {
  return safeRead(value, "profile", (copy, out) => validateProfile(copy, "profile", out));
}
function validatePhase(value: unknown, path: string, out: Problem[]) {
  const v = record(value, path, ["id", "profile", "dependsOn", "parallelCount", "writerScopeIds",
    "outputKind", "outputSchemaDigest", "verifierRole", "maxRounds"], [], out);
  if (!v) return;
  field(out, `${path}.id`, v.id, phaseId);
  validateProfile(v.profile, `${path}.profile`, out);
  if (!Array.isArray(v.dependsOn) || v.dependsOn.length > 16) problem(out, `${path}.dependsOn`, "invalid");
  else v.dependsOn.forEach((id, i) => field(out, `${path}.dependsOn[${i}]`, id, phaseId));
  field(out, `${path}.parallelCount`, v.parallelCount,
    x => typeof x === "number" && Number.isSafeInteger(x) && x >= 1 && x <= 3);
  if (!Array.isArray(v.writerScopeIds) || v.writerScopeIds.length !== v.parallelCount) {
    problem(out, `${path}.writerScopeIds`, "count_mismatch");
  } else {
    v.writerScopeIds.forEach((id, i) => field(out, `${path}.writerScopeIds[${i}]`, id, opaqueWriter));
    if (new Set(v.writerScopeIds).size !== v.writerScopeIds.length) problem(out, `${path}.writerScopeIds`, "duplicate");
  }
  field(out, `${path}.outputKind`, v.outputKind, x => member(x, ["plan", "rfc", "pull_request", "report"]));
  field(out, `${path}.outputSchemaDigest`, v.outputSchemaDigest, digest);
  field(out, `${path}.verifierRole`, v.verifierRole,
    x => x === null || member(x, ["plan_evaluation", "implementation_evaluation", "vision_evaluation"]));
  field(out, `${path}.maxRounds`, v.maxRounds,
    x => x === "none" || x === "unspecified_by_owner" || (typeof x === "number" && Number.isSafeInteger(x) && x >= 1 && x <= 10));
}
function validateWorkflowRevision(value: unknown, out: Problem[]) {
  const v = record(value, "workflow", ["schema", "workflowId", "revision", "createdByRunId", "phases"], [], out);
  if (!v) return;
  field(out, "workflow.schema", v.schema, x => x === 1);
  field(out, "workflow.workflowId", v.workflowId, uuid);
  field(out, "workflow.revision", v.revision, digest);
  field(out, "workflow.createdByRunId", v.createdByRunId, x => x === null || uuid(x));
  if (!Array.isArray(v.phases) || v.phases.length < 1 || v.phases.length > 16) {
    problem(out, "workflow.phases", "invalid");
  } else {
    v.phases.forEach((phase, i) => validatePhase(phase, `workflow.phases[${i}]`, out));
    const ids = v.phases.map(phase => obj(phase)?.id).filter(phaseId);
    if (new Set(ids).size !== ids.length) problem(out, "workflow.phases", "duplicate_id");
    const known = new Set(ids);
    const edges = new Map<string, readonly string[]>();
    v.phases.forEach((phase, i) => {
      const row = obj(phase);
      if (!row || !phaseId(row.id) || !Array.isArray(row.dependsOn)) return;
      const deps = row.dependsOn.filter(phaseId);
      if (new Set(deps).size !== deps.length) problem(out, `workflow.phases[${i}].dependsOn`, "duplicate");
      for (const dep of deps) if (!known.has(dep)) problem(out, `workflow.phases[${i}].dependsOn`, "unknown_phase");
      edges.set(row.id as string, deps);
    });
    const visited = new Set<string>(), visiting = new Set<string>();
    const cycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      if (edges.get(id)?.some(dep => cycle(dep))) return true;
      visiting.delete(id); visited.add(id); return false;
    };
    if ([...edges.keys()].some(cycle)) problem(out, "workflow.phases", "cycle");
  }
}
export function readWorkflowRevision(value: unknown): WorkflowRead<WorkflowRevision> {
  return safeRead(value, "workflow", validateWorkflowRevision);
}
function validateRoutineRevision(value: unknown, out: Problem[]) {
  const v = record(value, "routine", ["schema", "routineId", "revision", "workflowId",
    "workflowRevision", "trigger", "overlapPolicy", "missedRunPolicy"], [], out);
  if (!v) return;
  field(out, "routine.schema", v.schema, x => x === 1);
  for (const key of ["routineId", "workflowId"]) field(out, `routine.${key}`, v[key], uuid);
  for (const key of ["revision", "workflowRevision"]) field(out, `routine.${key}`, v[key], digest);
  field(out, "routine.overlapPolicy", v.overlapPolicy, x => member(x, ["coalesce", "skip", "enqueue"]));
  field(out, "routine.missedRunPolicy", v.missedRunPolicy, x => member(x, ["skip", "enqueue_one"]));
  const trigger = obj(v.trigger);
  if (trigger?.kind === "schedule") {
    const t = record(v.trigger, "routine.trigger", ["kind", "cron", "timeZone"], [], out);
    if (t) {
      field(out, "routine.trigger.cron", t.cron, x => typeof x === "string" && x.length <= 80 &&
        x.split(" ").length === 5 && /^[0-9*,/\- ]+$/.test(x));
      field(out, "routine.trigger.timeZone", t.timeZone, x => typeof x === "string" &&
        (x === "UTC" || /^[A-Za-z_]+(?:\/[A-Za-z_]+)+$/.test(x)));
    }
  } else if (trigger && member(trigger.kind, ["label", "pull_request", "ci_red"])) {
    const t = record(v.trigger, "routine.trigger", ["kind", "filterDigest"], [], out);
    if (t) field(out, "routine.trigger.filterDigest", t.filterDigest, digest);
  } else problem(out, "routine.trigger", "invalid");
}
export function readRoutineRevision(value: unknown): WorkflowRead<RoutineRevision> {
  return safeRead(value, "routine", validateRoutineRevision);
}
function validateCost(value: unknown, path: string, source: string, out: Problem[]) {
  const v = record(value, path, ["value", "source", "observedAt", "reason"], [], out);
  if (!v) return;
  if (v.source === "unavailable") {
    field(out, `${path}.value`, v.value, x => x === null);
    field(out, `${path}.observedAt`, v.observedAt, x => x === null);
    field(out, `${path}.reason`, v.reason, x => member(x, WORKFLOW_UNAVAILABLE_REASONS));
  } else {
    field(out, `${path}.source`, v.source, x => x === source);
    field(out, `${path}.value`, v.value, nonnegative);
    field(out, `${path}.observedAt`, v.observedAt, time);
    field(out, `${path}.reason`, v.reason, x => x === null);
  }
}
function validateState(v: Record<string, unknown>, path: string, out: Problem[]) {
  field(out, `${path}.state`, v.state, x => member(x, ["pending", "running", "blocked", "ended"]));
  field(out, `${path}.outcome`, v.outcome,
    x => v.state === "ended" ? member(x, ["succeeded", "failed", "cancelled"]) : x === null);
  field(out, `${path}.blockKind`, v.blockKind,
    x => v.state === "blocked" ? member(x, WORKFLOW_BLOCK_KINDS) : x === null);
}
function validateAttempt(value: unknown, path: string, out: Problem[]) {
  const v = record(value, path, ["id", "phaseId", "state", "outcome", "blockKind", "dispatchId",
    "agentId", "startedAt", "endedAt", "cost"], [], out);
  if (!v) return;
  field(out, `${path}.id`, v.id, uuid);
  field(out, `${path}.phaseId`, v.phaseId, phaseId);
  validateState(v, path, out);
  field(out, `${path}.dispatchId`, v.dispatchId, x => x === null || opaqueDispatch(x));
  field(out, `${path}.agentId`, v.agentId, x => x === null || opaqueAgent(x));
  field(out, `${path}.startedAt`, v.startedAt, x => x === null || time(x));
  field(out, `${path}.endedAt`, v.endedAt, x => v.state === "ended" ? time(x) : x === null);
  if ((v.state === "running" || v.state === "ended") && v.startedAt === null) problem(out, `${path}.startedAt`, "required_for_state");
  if (v.state === "pending" && v.startedAt !== null) problem(out, `${path}.startedAt`, "premature");
  if (v.agentId !== null && v.dispatchId === null) problem(out, `${path}.agentId`, "dispatch_required");
  if (time(v.startedAt) && time(v.endedAt) && Date.parse(v.endedAt as string) < Date.parse(v.startedAt as string))
    problem(out, `${path}.endedAt`, "before_start");
  const cost = record(v.cost, `${path}.cost`, ["runTokens", "meteredUsdMicros"], [], out);
  if (cost) {
    validateCost(cost.runTokens, `${path}.cost.runTokens`, "native-usage", out);
    validateCost(cost.meteredUsdMicros, `${path}.cost.meteredUsdMicros`, "billing", out);
  }
}
function validateWorkflowRun(value: unknown, out: Problem[]) {
  const v = record(value, "run", ["schema", "id", "workflowId", "workflowRevision", "scope", "state",
    "outcome", "blockKind", "attempts", "finalReportId", "createdAt", "updatedAt"], [], out);
  if (!v) return;
  field(out, "run.schema", v.schema, x => x === 1);
  for (const key of ["id", "workflowId"]) field(out, `run.${key}`, v[key], uuid);
  field(out, "run.workflowRevision", v.workflowRevision, digest);
  const scope = record(v.scope, "run.scope", ["kind", "id"], [], out);
  if (scope) {
    field(out, "run.scope.kind", scope.kind, x => member(x, ["home", "project", "milestone", "issue"]));
    field(out, "run.scope.id", scope.id, uuid);
  }
  validateState(v, "run", out);
  field(out, "run.finalReportId", v.finalReportId, x => x === null || uuid(x));
  if (v.state !== "ended" && v.finalReportId !== null) problem(out, "run.finalReportId", "premature");
  field(out, "run.createdAt", v.createdAt, time);
  field(out, "run.updatedAt", v.updatedAt, time);
  if (time(v.createdAt) && time(v.updatedAt) && Date.parse(v.updatedAt as string) < Date.parse(v.createdAt as string))
    problem(out, "run.updatedAt", "before_created");
  if (!Array.isArray(v.attempts) || v.attempts.length > 64) problem(out, "run.attempts", "invalid");
  else {
    v.attempts.forEach((attempt, i) => validateAttempt(attempt, `run.attempts[${i}]`, out));
    const ids = v.attempts.map(attempt => obj(attempt)?.id).filter(uuid);
    if (new Set(ids).size !== ids.length) problem(out, "run.attempts", "duplicate_id");
  }
}
export function readWorkflowRun(value: unknown): WorkflowRead<WorkflowRun> {
  return safeRead(value, "run", validateWorkflowRun);
}
