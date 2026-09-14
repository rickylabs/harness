/** Public per-issue agents. Native session identities never belong to this contract. */
import type { RepoRef } from "./snapshot.js";
import type { RunUsage } from "./runs.js";
import { projectRouteIdentity, ROUTE_FIELDS, type RouteIdentityEvidence } from "./route.js";

export const AGENT_OBSERVATIONS_SCHEMA = 1 as const;
export const MAX_AGENT_OBSERVATIONS = 256;
export const MAX_AGENT_OBSERVATION_BYTES = 1_048_576;
export const AGENT_UNAVAILABLE_REASONS = ["source_not_bound", "source_unavailable", "source_incomplete", "source_stale", "binding_invalid", "identity_unavailable", "measurement_missing", "run_not_found"] as const;
export type AgentUnavailableReason = typeof AGENT_UNAVAILABLE_REASONS[number];
export type AgentParent =
  | { readonly state: "confirmed-root"; readonly value: null; readonly reason: null }
  | { readonly state: "known-parent"; readonly value: string; readonly reason: null }
  | { readonly state: "unavailable"; readonly value: null; readonly reason: AgentUnavailableReason };
export type AgentObservedValue<T> = {
  readonly observedAt: string | null;
  readonly validUntil: string | null;
  readonly revision: string | null;
} & (
  | { readonly value: T; readonly reason: null }
  | { readonly value: null; readonly reason: AgentUnavailableReason }
);
type CostRow<K, U, S, Scope, M> = {
  readonly kind: K; readonly unit: U; readonly source: S; readonly scope: Scope;
  readonly observedAt: string | null; readonly validUntil: string | null; readonly revision: string | null;
} & (
  | { readonly availability: "unavailable"; readonly measurement: null; readonly reason: AgentUnavailableReason }
  | { readonly availability: "available"; readonly measurement: M; readonly reason: null }
);
export interface AgentCost {
  readonly subscriptionHeadroom: CostRow<"subscription_headroom", "percent_remaining", "dsh-telemetry.governance.usage", "subscription_account", {
    readonly remainingPercent: number; readonly windowMinutes: number; readonly resetsAt: string | null;
  }>;
  readonly meteredSpend: CostRow<"metered_spend", "currency", "dsh-telemetry.runs", "run", {
    readonly amount: number; readonly currency: "USD"; readonly accounting: "reported";
  }>;
  /** These components overlap. There is deliberately no invented total. */
  readonly runTokens: CostRow<"run_tokens", "tokens", "dsh-telemetry.runs", "run", Omit<RunUsage, "costUsd">>;
}
export interface AgentObservation {
  readonly agentId: string;
  readonly repo: RepoRef;
  readonly issueNumber: number;
  readonly assignment: { readonly id: string; readonly dispatcher: "divybot"; readonly basis: "dispatcher-confirmed" };
  readonly parentAgentId: AgentParent;
  readonly workspace: AgentObservedValue<string>;
  readonly tab: AgentObservedValue<string>;
  readonly pane: AgentObservedValue<string>;
  readonly terminal: AgentObservedValue<string>;
  readonly running: AgentObservedValue<boolean>;
  readonly route: RouteIdentityEvidence;
  readonly cost: AgentCost;
  readonly observedAt: string;
  readonly revision: string;
}
export const AGENT_COLLECTION_REASONS = ["source_not_bound", "source_unavailable", "binding_unavailable", "scan_limit", "ancestry_unavailable"] as const;
export interface AgentObservations {
  readonly schema: 1; readonly protocol: 1;
  readonly observedAt: string; readonly revision: string;
  readonly complete: boolean;
  readonly reason: typeof AGENT_COLLECTION_REASONS[number] | null;
  readonly agents: readonly AgentObservation[];
}
export type AgentObservationsReading =
  | { readonly ok: true; readonly observation: AgentObservations }
  | { readonly ok: false; readonly reason: "invalid" | "unsupported-schema" | "oversized" | "incomplete" | "ambiguous-ancestry" };

export function unavailableAgentCost(reason: AgentUnavailableReason = "source_not_bound"): AgentCost {
  const absent = { availability: "unavailable", measurement: null, reason, observedAt: null, validUntil: null, revision: null } as const;
  return {
    subscriptionHeadroom: { kind: "subscription_headroom", unit: "percent_remaining", source: "dsh-telemetry.governance.usage", scope: "subscription_account", ...absent },
    meteredSpend: { kind: "metered_spend", unit: "currency", source: "dsh-telemetry.runs", scope: "run", ...absent },
    runTokens: { kind: "run_tokens", unit: "tokens", source: "dsh-telemetry.runs", scope: "run", ...absent },
  };
}

class Invalid extends Error {
  constructor(readonly reason: Exclude<AgentObservationsReading, { ok: true }>["reason"] = "invalid") { super(reason); }
}
const bad = (reason?: Invalid["reason"]): never => { throw new Invalid(reason); };
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return bad();
  const keys = Reflect.ownKeys(value);
  if (keys.length > required.length + optional.length || required.some(k => !keys.includes(k))) return bad();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) return bad();
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable) return bad();
    out[key] = d.value;
  }
  return out;
}
function array(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return bad();
  if (value.length > cap) return bad("oversized");
  if (Reflect.ownKeys(value).length !== value.length + 1) return bad();
  return Array.from({ length: value.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) return bad();
    return d.value;
  });
}
function text(value: unknown, pattern: RegExp, cap = 128): string {
  if (typeof value !== "string" || value.length > cap || !pattern.test(value)) return bad();
  return value;
}
const id = (v: unknown) => text(v, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const agentId = (v: unknown) => text(v, /^agent_[a-f0-9]{64}$/);
const revision = (v: unknown) => text(v, /^[a-f0-9]{64}$/);
function time(v: unknown): string {
  const s = text(v, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 24);
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) return bad();
  return s;
}
function choice<const T extends readonly string[]>(v: unknown, choices: T): T[number] {
  if (typeof v !== "string" || !choices.includes(v)) return bad();
  return v as T[number];
}
function number(v: unknown, max = Number.MAX_SAFE_INTEGER, integer = true): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max || (integer && !Number.isSafeInteger(v))) return bad();
  return v;
}
function metadata(r: Record<string, unknown>, capturedAt: string, available: boolean) {
  const observedAt = r.observedAt === null ? null : time(r.observedAt);
  const validUntil = r.validUntil === null ? null : time(r.validUntil);
  const rev = r.revision === null ? null : revision(r.revision);
  if (available && (observedAt === null || rev === null)) return bad();
  if (observedAt !== null && observedAt > capturedAt) return bad();
  if (validUntil !== null && (observedAt === null || validUntil < observedAt || (available && validUntil < capturedAt))) return bad();
  return { observedAt, validUntil, revision: rev };
}
function observed<T>(value: unknown, at: string, read: (v: unknown) => T): AgentObservedValue<T> {
  const r = record(value, ["value", "reason", "observedAt", "validUntil", "revision"]);
  const m = metadata(r, at, r.value !== null);
  if (r.value === null) return { ...m, value: null, reason: choice(r.reason, AGENT_UNAVAILABLE_REASONS) };
  if (r.reason !== null) return bad();
  return { ...m, value: read(r.value), reason: null };
}
function parent(value: unknown): AgentParent {
  const r = record(value, ["state", "value", "reason"]);
  if (r.state === "confirmed-root" && r.value === null && r.reason === null) return { state: r.state, value: null, reason: null };
  if (r.state === "known-parent" && r.reason === null) return { state: r.state, value: agentId(r.value), reason: null };
  if (r.state === "unavailable" && r.value === null) return { state: r.state, value: null, reason: choice(r.reason, AGENT_UNAVAILABLE_REASONS) };
  return bad();
}
function route(value: unknown): RouteIdentityEvidence {
  const r = record(value, ["status", "requested", "observed", "mismatches", "invalid", "detail"]);
  const empty = projectRouteIdentity(null);
  const sides = {} as { requested: RouteIdentityEvidence["requested"]; observed: RouteIdentityEvidence["observed"] };
  for (const side of ["requested", "observed"] as const) {
    const fields = record(r[side], ROUTE_FIELDS);
    const target = {} as Record<typeof ROUTE_FIELDS[number], { value: string | null; source: typeof empty.requested.provider.source }>;
    for (const field of ROUTE_FIELDS) {
      const leaf = record(fields[field], ["value", "source"]);
      if (leaf.source !== empty[side][field].source || (field === "cwd" && leaf.value !== null)) return bad();
      const v = leaf.value === null ? null : text(leaf.value, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
      if (v?.includes("..")) return bad();
      target[field] = { value: v, source: empty[side][field].source };
    }
    sides[side] = target;
  }
  const expected = projectRouteIdentity(sides);
  const mismatches = array(r.mismatches, 4).map(v => choice(v, ROUTE_FIELDS));
  const invalid = array(r.invalid, 8).map(v => {
    const f = record(v, ["side", "field"]);
    return { side: choice(f.side, ["requested", "observed"]), field: choice(f.field, ROUTE_FIELDS) };
  });
  if (r.status !== expected.status || r.detail !== expected.detail || JSON.stringify(mismatches) !== JSON.stringify(expected.mismatches) || JSON.stringify(invalid) !== JSON.stringify(expected.invalid)) return bad();
  return expected;
}
function cost(value: unknown, at: string): AgentCost {
  const r = record(value, ["subscriptionHeadroom", "meteredSpend", "runTokens"]);
  const expected = unavailableAgentCost();
  const result = {} as AgentCost;
  for (const key of ["subscriptionHeadroom", "meteredSpend", "runTokens"] as const) {
    const row = record(r[key], ["kind", "unit", "source", "scope", "availability", "measurement", "reason", "observedAt", "validUntil", "revision"]);
    for (const f of ["kind", "unit", "source", "scope"] as const) if (row[f] !== expected[key][f]) return bad();
    const available = row.availability === "available";
    const m = metadata(row, at, available);
    let decoded: unknown;
    if (!available) {
      if (row.availability !== "unavailable" || row.measurement !== null) return bad();
      decoded = { ...expected[key], ...m, reason: choice(row.reason, AGENT_UNAVAILABLE_REASONS) };
    } else {
      if (row.reason !== null || (key === "subscriptionHeadroom" && m.validUntil === null)) return bad();
      let measurement: unknown;
      if (key === "subscriptionHeadroom") {
        const x = record(row.measurement, ["remainingPercent", "windowMinutes", "resetsAt"]);
        const minutes = number(x.windowMinutes);
        if (minutes === 0) return bad();
        measurement = { remainingPercent: number(x.remainingPercent, 100, false), windowMinutes: minutes, resetsAt: x.resetsAt === null ? null : time(x.resetsAt) };
      } else if (key === "meteredSpend") {
        const x = record(row.measurement, ["amount", "currency", "accounting"]);
        if (x.currency !== "USD" || x.accounting !== "reported") return bad();
        measurement = { amount: number(x.amount, Number.MAX_VALUE, false), currency: "USD", accounting: "reported" };
      } else {
        const keys = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"];
        const x = record(row.measurement, [], keys);
        if (Object.keys(x).length === 0) return bad();
        measurement = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, number(v)]));
      }
      decoded = { ...expected[key], ...m, availability: "available", measurement, reason: null };
    }
    Object.assign(result, { [key]: decoded });
  }
  return result;
}
function agent(value: unknown, capturedAt: string): AgentObservation {
  const r = record(value, ["agentId", "repo", "issueNumber", "assignment", "parentAgentId", "workspace", "tab", "pane", "terminal", "running", "route", "cost", "observedAt", "revision"]);
  const repo = record(r.repo, ["owner", "name"]);
  const a = record(r.assignment, ["id", "dispatcher", "basis"]);
  if (a.dispatcher !== "divybot" || a.basis !== "dispatcher-confirmed") return bad();
  const issueNumber = number(r.issueNumber);
  const observedAt = time(r.observedAt);
  if (issueNumber === 0 || observedAt > capturedAt) return bad();
  return { agentId: agentId(r.agentId), repo: {
    owner: text(repo.owner, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, 39),
    name: text(repo.name, /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/, 100),
  }, issueNumber, assignment: { id: text(a.id, /^assignment_[a-f0-9]{64}$/), dispatcher: a.dispatcher, basis: a.basis },
    parentAgentId: parent(r.parentAgentId), workspace: observed(r.workspace, capturedAt, id), tab: observed(r.tab, capturedAt, id),
    pane: observed(r.pane, capturedAt, id), terminal: observed(r.terminal, capturedAt, id),
    running: observed(r.running, capturedAt, v => typeof v === "boolean" ? v : bad()), route: route(r.route), cost: cost(r.cost, capturedAt), observedAt, revision: revision(r.revision) };
}
/** Whole-collection refusal. No failure returns agents, even if some rows validated successfully. */
export function readAgentObservations(value: unknown): AgentObservationsReading {
  try {
    const r = record(value, ["schema", "protocol", "observedAt", "revision", "complete", "reason", "agents"]);
    if (r.schema !== 1 || r.protocol !== 1) return bad("unsupported-schema");
    const raw = array(r.agents, MAX_AGENT_OBSERVATIONS);
    const observedAt = time(r.observedAt), rev = revision(r.revision);
    if (typeof r.complete !== "boolean") return bad();
    if (!r.complete) { choice(r.reason, AGENT_COLLECTION_REASONS); return bad("incomplete"); }
    if (r.reason !== null) return bad();
    const agents = raw.map(v => agent(v, observedAt));
    const byId = new Map<string, AgentObservation>();
    const roots = new Set<string>();
    const issueKey = (a: AgentObservation) => `${a.repo.owner.toLowerCase()}/${a.repo.name.toLowerCase()}#${a.issueNumber}`;
    for (const a of agents) {
      if (byId.has(a.agentId)) return bad("ambiguous-ancestry");
      byId.set(a.agentId, a);
      if (a.parentAgentId.state === "unavailable") return bad("ambiguous-ancestry");
      if (a.parentAgentId.state === "confirmed-root") {
        if (roots.has(a.assignment.id)) return bad("ambiguous-ancestry");
        roots.add(a.assignment.id);
      }
    }
    for (const a of agents) {
      const seen = new Set<string>([a.agentId]);
      let p = a.parentAgentId;
      while (p.state === "known-parent") {
        const parent = byId.get(p.value);
        if (!parent || seen.has(p.value) || parent.assignment.id !== a.assignment.id || issueKey(parent) !== issueKey(a)) return bad("ambiguous-ancestry");
        seen.add(p.value);
        p = parent.parentAgentId;
      }
    }
    const observation: AgentObservations = { schema: 1, protocol: 1, observedAt, revision: rev, complete: true, reason: null, agents };
    if (new TextEncoder().encode(JSON.stringify(observation)).byteLength > MAX_AGENT_OBSERVATION_BYTES) return bad("oversized");
    return { ok: true, observation };
  } catch (error) { return { ok: false, reason: error instanceof Invalid ? error.reason : "invalid" }; }
}
