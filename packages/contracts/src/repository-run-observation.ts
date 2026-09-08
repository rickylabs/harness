/** One selected, enrolled native source. No census, transport, authorization or liveness claim. */
import type { RepoRef } from "./snapshot.js";

export const REPOSITORY_RUN_OBSERVATION_SCHEMA = 1 as const;
export const RUN_OBSERVATION_INCOMPLETE_REASONS = ["malformed-record", "unknown-envelope", "source-changed", "binding-changed", "invalid-timestamp", "invalid-evidence"] as const;
export const RUN_OBSERVATION_UNAVAILABLE_REASONS = ["source-missing", "source-unreadable", "source-too-large", "scope-unverified", "scope-mismatch", "identity-missing", "identity-mismatch"] as const;
export interface RepositoryRunBinding {
  readonly namespace: string;
  readonly id: string;
  readonly revision: string;
  readonly sourceScopeId: string;
  readonly repo: RepoRef;
}
export type RunObservationCoverage =
  | { readonly status: "read"; readonly reason: null }
  | { readonly status: "incomplete"; readonly reason: typeof RUN_OBSERVATION_INCOMPLETE_REASONS[number] }
  | { readonly status: "unavailable"; readonly reason: typeof RUN_OBSERVATION_UNAVAILABLE_REASONS[number] };
export interface RunIdentityObservation { readonly value: string; readonly observedAt: string }
export interface RunTokenObservation {
  readonly observedAt: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
}
export interface ObservedRepositoryRun {
  readonly source: "codex";
  readonly nativeId: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly identity: {
    readonly provider: RunIdentityObservation | null;
    readonly model: RunIdentityObservation | null;
    readonly effort: RunIdentityObservation | null;
  };
  readonly usage: RunTokenObservation | null;
  readonly execution: { readonly status: "unknown"; readonly observedAt: null }
    | { readonly status: "source-reported-complete" | "source-reported-error"; readonly observedAt: string };
  readonly relationships: { readonly parent: "unavailable"; readonly agent: "unavailable"; readonly task: "unavailable"; readonly messages: "unavailable"; readonly certification: "unavailable" };
}
type ObservationBase = { readonly schema: 1; readonly protocol: 1; readonly binding: RepositoryRunBinding; readonly capturedAt: string };
export type RepositoryRunObservation = ObservationBase & (
  | { readonly coverage: { readonly status: "read"; readonly reason: null }; readonly verification: { readonly basis: "enrollment-and-local-worktree"; readonly verifiedAt: string }; readonly run: ObservedRepositoryRun }
  | { readonly coverage: Exclude<RunObservationCoverage, { status: "read" }>; readonly verification: null; readonly run: null }
);
export type RepositoryRunObservationReading =
  | { readonly ok: true; readonly observation: RepositoryRunObservation }
  | { readonly ok: false; readonly reason: "invalid" }
  | { readonly ok: false; readonly reason: "unsupported-schema"; readonly schema: number | null; readonly protocol: number | null };

const bad = (): never => { throw new Error("invalid observation"); };
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
function text(value: unknown, re: RegExp, cap: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > cap || !re.test(value)) return bad();
  return value;
}
const id = (value: unknown): string => text(value, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 128);
function time(value: unknown): string {
  const raw = text(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 24);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== raw) return bad();
  return raw;
}
function choice<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value !== "string" || !values.includes(value)) return bad();
  return value as T[number];
}
function binding(value: unknown): RepositoryRunBinding {
  const b = record(value, ["namespace", "id", "revision", "sourceScopeId", "repo"]);
  const r = record(b.repo, ["owner", "name"]);
  return { namespace: id(b.namespace), id: id(b.id), revision: id(b.revision), sourceScopeId: id(b.sourceScopeId), repo: {
    owner: text(r.owner, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, 39),
    name: text(r.name, /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/, 100),
  } };
}
function run(value: unknown): ObservedRepositoryRun {
  const r = record(value, ["source", "nativeId", "firstObservedAt", "lastObservedAt", "identity", "usage", "execution", "relationships"]);
  if (r.source !== "codex") return bad();
  const firstObservedAt = time(r.firstObservedAt), lastObservedAt = time(r.lastObservedAt);
  if (firstObservedAt > lastObservedAt) return bad();
  const within = (v: unknown): string => { const t = time(v); if (t < firstObservedAt || t > lastObservedAt) return bad(); return t; };
  const leaf = (v: unknown): RunIdentityObservation | null => {
    if (v === null) return null;
    const l = record(v, ["value", "observedAt"]);
    return { value: text(l.value, /^[A-Za-z0-9_./:-]+$/, 200), observedAt: within(l.observedAt) };
  };
  const i = record(r.identity, ["provider", "model", "effort"]);
  let usage: RunTokenObservation | null = null;
  if (r.usage !== null) {
    const fields = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens"] as const;
    const u = record(r.usage, ["observedAt"], fields);
    if (Object.keys(u).length < 2) return bad();
    const counts: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadTokens?: number } = {};
    for (const field of fields) if (Object.hasOwn(u, field)) {
      const n = u[field];
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return bad();
      counts[field] = n === 0 ? 0 : n;
    }
    usage = { observedAt: within(u.observedAt), ...counts };
  }
  const e = record(r.execution, ["status", "observedAt"]);
  let execution: ObservedRepositoryRun["execution"];
  if (e.status === "unknown") {
    if (e.observedAt !== null) return bad();
    execution = { status: "unknown", observedAt: null };
  } else execution = { status: choice(e.status, ["source-reported-complete", "source-reported-error"]), observedAt: within(e.observedAt) };
  const rel = record(r.relationships, ["parent", "agent", "task", "messages", "certification"]);
  if (Object.values(rel).some(v => v !== "unavailable")) return bad();
  return { source: "codex", nativeId: id(r.nativeId), firstObservedAt, lastObservedAt,
    identity: { provider: leaf(i.provider), model: leaf(i.model), effort: leaf(i.effort) }, usage, execution,
    relationships: { parent: "unavailable", agent: "unavailable", task: "unavailable", messages: "unavailable", certification: "unavailable" } };
}
/** Strict, bounded, owned normalization. Accessors are never called; throwing proxy traps are contained. */
export function readRepositoryRunObservation(value: unknown): RepositoryRunObservationReading {
  try {
    const r = record(value, ["schema", "protocol", "binding", "capturedAt", "coverage", "verification", "run"]);
    if (r.schema !== 1 || r.protocol !== 1) {
      const version = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
      return { ok: false, reason: "unsupported-schema", schema: version(r.schema), protocol: version(r.protocol) };
    }
    const base: ObservationBase = { schema: 1, protocol: 1, binding: binding(r.binding), capturedAt: time(r.capturedAt) };
    const c = record(r.coverage, ["status", "reason"]);
    if (c.status === "read") {
      if (c.reason !== null) return bad();
      const v = record(r.verification, ["basis", "verifiedAt"]);
      if (v.basis !== "enrollment-and-local-worktree") return bad();
      const verifiedAt = time(v.verifiedAt);
      if (verifiedAt > base.capturedAt) return bad();
      return { ok: true, observation: { ...base, coverage: { status: "read", reason: null }, verification: { basis: v.basis, verifiedAt }, run: run(r.run) } };
    }
    if (r.run !== null || r.verification !== null) return bad();
    let coverage: Exclude<RunObservationCoverage, { status: "read" }>;
    if (c.status === "incomplete") coverage = { status: c.status, reason: choice(c.reason, RUN_OBSERVATION_INCOMPLETE_REASONS) };
    else if (c.status === "unavailable") coverage = { status: c.status, reason: choice(c.reason, RUN_OBSERVATION_UNAVAILABLE_REASONS) };
    else return bad();
    return { ok: true, observation: { ...base, coverage, verification: null, run: null } };
  } catch { return { ok: false, reason: "invalid" }; }
}
