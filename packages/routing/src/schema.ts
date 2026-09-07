/** Version 1 structural schema. All model and policy selections are document data. */
import { HARNESSES, ROUTERS, type Harness, type Router } from "@rickylabs/subagents";
import { types } from "node:util";
import { checkPolicy } from "./resolve.js";
import type { LoadRefusal } from "./load.js";

export const SCHEMA_VERSION = 1;
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_DEPTH = 16;
export const MAX_MEMBERS = 4096;
export const TRANSPORTS = ["native", "openrouter"] as const;
export const FALLBACK_TRIGGERS = ["token-limit", "no-claude-surface", "third-opinion", "native-quota-limit", "openrouter-limit", "model-unavailable"] as const;
export const SUBSCRIPTION_STATES = ["included", "outside_plan"] as const;
export const CERTIFIES_KEYWORDS = ["any", "none"] as const;
export const EVALUATION_PURPOSE = "evaluation";
export type Transport = (typeof TRANSPORTS)[number];
export type FallbackTrigger = (typeof FALLBACK_TRIGGERS)[number];
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];
export type ModelFamily = string;
export type Effort = string;
export type Lane = string;
export type Tier = string;
export type Purpose = string;
/** A concrete place to send a run. */
export interface Route {
  readonly harness: Harness;
  readonly transport: Transport;
  readonly model: string;
  readonly effort: Effort;
  /** opencode only: the provider prefix. `validateDispatch` refuses an opencode run without it. */
  readonly router?: Router;
  /** Provider profile id, where the transport needs one to know which credential to bind. */
  readonly profile?: string;
  /** OpenRouter preset id, where the route is one of the validated presets. */
  readonly preset?: string;
}

/**
 * What an evaluation step is allowed to certify.
 *
 * A family binds the seat to that author family. `any` permits any opposite family;
 * it never overrides same-family refusal. `none` is supplementary evidence, not a gate.
 */
export type Certifies = ModelFamily | "any" | "none";

/** A named effort change the launcher may make on the same route. Never changes the model. */
export interface EffortEscalation {
  readonly condition: string;
  readonly effort: Effort;
}

/** One position in a lane's chain. */
export interface RouteStep {
  readonly route: Route;
  /** Triggers that reach this step. Empty on a primary — a primary is reached by default. */
  readonly when: readonly FallbackTrigger[];
  /** Present exactly on the steps of `evaluation` lanes. */
  readonly certifies?: Certifies;
  readonly subscription?: SubscriptionState;
  /** Declared effort discretion. An undeclared escalation is refused, never inferred. */
  readonly effortEscalations?: readonly EffortEscalation[];
  /** The fleet's own condition string, kept so a reader can diff this table against the matrix. */
  readonly note?: string;
}

/** A lane and its ordered chain. */
export interface LanePolicy {
  readonly lane: Lane;
  readonly purpose: Purpose;
  /** Ordered. `chain[0]` is the primary; later steps are reached only by their triggers. */
  readonly chain: readonly RouteStep[];
}


export interface LaneConstraint {
  readonly transports?: readonly Transport[];
  readonly harnesses?: readonly Harness[];
  readonly families?: readonly ModelFamily[];
  readonly models?: readonly string[];
  readonly why: string;
}

/** Opaque backend values are interpreted by llm-local, never by routing. */
export interface PlacementRecord {
  readonly model: string;
  readonly backend: string;
  readonly verdict: string;
  readonly why: string;
  readonly reason?: string;
  readonly requires?: {
    readonly env?: Readonly<Record<string, string>>;
    readonly args?: readonly string[];
  };
}
export interface PlacementConfiguration {
  readonly backends: readonly string[];
  readonly entries: readonly PlacementRecord[];
}
export interface RoutingConfiguration {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly provenance?: { readonly description: string };
  readonly families: readonly string[];
  readonly efforts: { readonly ordered: readonly string[]; readonly unordered?: readonly string[] };
  readonly purposes: readonly string[];
  readonly models: Readonly<Record<string, { readonly family: string; readonly approvedRelayEvaluator?: true }>>;
  readonly profiles: readonly string[];
  readonly presets: readonly string[];
  readonly lanes: readonly LanePolicy[];
  readonly tiers: readonly { readonly tier: string; readonly implement: string; readonly review: string }[];
  readonly constraints: Readonly<Record<string, LaneConstraint>>;
  readonly deepResearchLanes: readonly string[];
  readonly policy: { readonly maxFallbackDepth: number };
  readonly placements: PlacementConfiguration;
}
export type InvalidCode = "unknown-key" | "missing-key" | "wrong-type" | "empty" | "duplicate" |
  "dangling-reference" | "reserved-name" | "out-of-range" | "depth-exceeded" | "size-exceeded" | "not-plain-data";
export interface InvalidProblem { readonly code: InvalidCode; readonly path: string }
export type ValidationOutcome = { readonly ok: true; readonly configuration: RoutingConfiguration } |
  { readonly ok: false; readonly refusal: LoadRefusal };

/** Field paths contain schema-owned names and indices only, never dynamic keys. */
const STRUCTURAL_FIELDS = new Set([
  "schemaVersion", "name", "provenance", "description", "families", "efforts", "ordered", "unordered",
  "purposes", "models", "family", "approvedRelayEvaluator", "profiles", "presets", "lanes", "lane", "purpose",
  "chain", "route", "harness", "transport", "model", "effort", "router", "profile", "preset", "when",
  "certifies", "subscription", "effortEscalations", "condition", "note", "tiers", "tier", "implement", "review",
  "constraints", "transports", "harnesses", "why", "deepResearchLanes", "policy", "maxFallbackDepth",
  "placements", "backends", "entries", "backend", "verdict", "reason", "requires", "env", "args",
]);
export function fieldPath(parent: string, key: string, index: number): string {
  return STRUCTURAL_FIELDS.has(key) ? (parent === "$" ? key : `${parent}.${key}`) : `${parent}[${index}]`;
}

/** Validate descriptors before reading values, including rejecting proxies without invoking traps. */
export function plainDataProblem(value: unknown): InvalidProblem | null {
  const active = new Set<object>();
  let bytes = 0;
  function walk(v: unknown, path: string, depth: number): InvalidProblem | null {
    const problem = (code: InvalidCode): InvalidProblem => ({ code, path });
    if (depth > MAX_DEPTH) return problem("depth-exceeded");
    bytes += typeof v === "string" ? Buffer.byteLength(v, "utf8") + 2 : 8;
    if (bytes > MAX_DOCUMENT_BYTES) return problem("size-exceeded");
    if (v === null || typeof v === "boolean" || typeof v === "string") return null;
    if (typeof v === "number") return Number.isFinite(v) ? null : problem("not-plain-data");
    if (typeof v !== "object" || types.isProxy(v) || active.has(v)) return problem("not-plain-data");
    const array = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return problem("not-plain-data");
    const keys = Reflect.ownKeys(v);
    if (keys.length - (array ? 1 : 0) > MAX_MEMBERS || (array && v.length > MAX_MEMBERS)) return problem("size-exceeded");
    active.add(v);
    let i = 0;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") return problem("not-plain-data");
      if (["__proto__", "constructor", "prototype"].includes(key)) return problem("reserved-name");
      if (array && key !== String(i)) return problem("not-plain-data");
      bytes += Buffer.byteLength(key, "utf8") + 3;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !("value" in d) || !d.enumerable) return problem("not-plain-data");
      const child = walk(d.value, array ? `${path}[${i}]` : fieldPath(path, key, i), depth + 1);
      if (child) return child;
      i++;
    }
    if (array && i !== v.length) return problem("not-plain-data");
    active.delete(v);
    return bytes > MAX_DOCUMENT_BYTES ? problem("size-exceeded") : null;
  }
  return walk(value, "$", 0);
}
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Strict whole-document validation; no absent field is filled or bad record discarded. */
export function validateRoutingConfiguration(value: unknown): ValidationOutcome {
  const unsafe = plainDataProblem(value);
  if (unsafe) return { ok: false, refusal: { kind: "invalid", problems: [unsafe] } };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, refusal: { kind: "malformed", code: "root-not-object" } };
  }
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== SCHEMA_VERSION) return { ok: false, refusal: {
    kind: "unsupported-schema-version", seen: Number.isSafeInteger(root.schemaVersion) ? root.schemaVersion as number : null, supported: [SCHEMA_VERSION],
  } };
  const problems: InvalidProblem[] = [];
  const add = (code: InvalidCode, path: string) => { problems.push({ code, path }); };
  function obj(v: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) { add("wrong-type", path); return {}; }
    const o = v as Record<string, unknown>;
    for (const key of required) if (!Object.hasOwn(o, key)) add("missing-key", fieldPath(path, key, 0));
    for (const key of Object.keys(o)) if (![...required, ...optional].includes(key)) add("unknown-key", path);
    return o;
  }
  function str(v: unknown, path: string, pattern?: RegExp, nonempty = true): v is string {
    if (typeof v !== "string") { add("wrong-type", path); return false; }
    if (nonempty && !v.trim()) { add("empty", path); return false; }
    if (v.length > 4096 || (pattern && !pattern.test(v))) { add("out-of-range", path); return false; }
    return true;
  }
  function arr(v: unknown, path: string, nonempty = false): unknown[] {
    if (!Array.isArray(v)) { add("wrong-type", path); return []; }
    if (nonempty && !v.length) add("empty", path);
    return v;
  }
  function strings(v: unknown, path: string, nonempty = false, vocabulary?: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    arr(v, path, nonempty).forEach((s, i) => {
      const at = `${path}[${i}]`;
      if (!str(s, at)) return;
      if (seen.has(s)) add("duplicate", at);
      seen.add(s);
      if (vocabulary && !vocabulary.includes(s)) add("dangling-reference", at);
      result.push(s);
    });
    return result;
  }
  function ref(v: unknown, path: string, vocabulary: readonly string[]): void {
    if (str(v, path) && !vocabulary.includes(v)) add("dangling-reference", path);
  }
  function records(v: unknown, path: string): Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) { add("wrong-type", path); return {}; }
    return v as Record<string, unknown>;
  }
  obj(root, "$", ["schemaVersion", "name", "families", "efforts", "purposes", "models", "profiles", "presets", "lanes", "tiers", "constraints", "deepResearchLanes", "policy", "placements"], ["provenance"]);
  str(root.name, "name", /^[a-z0-9][a-z0-9-]*$/);
  if (root.provenance !== undefined) str(obj(root.provenance, "provenance", ["description"]).description, "provenance.description");
  const families = strings(root.families, "families", true);
  families.forEach((f, i) => { if ((CERTIFIES_KEYWORDS as readonly string[]).includes(f)) add("reserved-name", `families[${i}]`); });
  const effort = obj(root.efforts, "efforts", ["ordered"], ["unordered"]);
  const ordered = strings(effort.ordered, "efforts.ordered", true);
  const unordered = effort.unordered === undefined ? [] : strings(effort.unordered, "efforts.unordered");
  unordered.forEach((e, i) => { if (ordered.includes(e)) add("duplicate", `efforts.unordered[${i}]`); });
  const efforts = [...ordered, ...unordered];
  const purposes = strings(root.purposes, "purposes");
  if (!purposes.includes(EVALUATION_PURPOSE)) add("dangling-reference", "purposes");
  const profiles = strings(root.profiles, "profiles");
  const presets = strings(root.presets, "presets");
  const models = records(root.models, "models");
  const modelNames = Object.keys(models);
  if (!modelNames.length) add("empty", "models");
  Object.entries(models).forEach(([key, v], i) => {
    const at = `models[${i}]`;
    str(key, at);
    const m = obj(v, at, ["family"], ["approvedRelayEvaluator"]);
    ref(m.family, `${at}.family`, families);
    if (m.approvedRelayEvaluator !== undefined && m.approvedRelayEvaluator !== true) add("wrong-type", `${at}.approvedRelayEvaluator`);
  });
  const laneNames: string[] = [];
  arr(root.lanes, "lanes", true).forEach((v, i) => {
    const at = `lanes[${i}]`;
    const l = obj(v, at, ["lane", "purpose", "chain"]);
    if (str(l.lane, `${at}.lane`, /^[a-z][a-z0-9_]*$/)) {
      if (laneNames.includes(l.lane)) add("duplicate", `${at}.lane`);
      laneNames.push(l.lane);
    }
    ref(l.purpose, `${at}.purpose`, purposes);
    arr(l.chain, `${at}.chain`, true).forEach((v, j) => {
      const stepAt = `${at}.chain[${j}]`;
      const s = obj(v, stepAt, ["route", "when"], ["certifies", "subscription", "effortEscalations", "note"]);
      const r = obj(s.route, `${stepAt}.route`, ["harness", "transport", "model", "effort"], ["router", "profile", "preset"]);
      for (const [key, vocabulary] of [["harness", HARNESSES], ["transport", TRANSPORTS], ["model", modelNames], ["effort", efforts]] as const) ref(r[key], `${stepAt}.route.${key}`, vocabulary);
      for (const [key, vocabulary] of [["router", ROUTERS], ["profile", profiles], ["preset", presets]] as const) if (r[key] !== undefined) ref(r[key], `${stepAt}.route.${key}`, vocabulary);
      strings(s.when, `${stepAt}.when`, false, FALLBACK_TRIGGERS);
      if (s.certifies !== undefined) ref(s.certifies, `${stepAt}.certifies`, [...families, ...CERTIFIES_KEYWORDS]);
      if (s.subscription !== undefined) ref(s.subscription, `${stepAt}.subscription`, SUBSCRIPTION_STATES);
      if (s.note !== undefined) str(s.note, `${stepAt}.note`, undefined, false);
      if (s.effortEscalations !== undefined) arr(s.effortEscalations, `${stepAt}.effortEscalations`).forEach((e, k) => {
        const ep = `${stepAt}.effortEscalations[${k}]`;
        const escalation = obj(e, ep, ["condition", "effort"]);
        str(escalation.condition, `${ep}.condition`);
        ref(escalation.effort, `${ep}.effort`, efforts);
      });
    });
  });
  const tierNames = new Set<string>();
  arr(root.tiers, "tiers").forEach((v, i) => {
    const at = `tiers[${i}]`;
    const t = obj(v, at, ["tier", "implement", "review"]);
    if (str(t.tier, `${at}.tier`)) { if (tierNames.has(t.tier)) add("duplicate", `${at}.tier`); tierNames.add(t.tier); }
    ref(t.implement, `${at}.implement`, laneNames);
    ref(t.review, `${at}.review`, laneNames);
  });
  const constraints = records(root.constraints, "constraints");
  Object.entries(constraints).forEach(([key, v], i) => {
    const at = `constraints[${i}]`;
    ref(key, at, laneNames);
    const c = obj(v, at, ["why"], ["transports", "harnesses", "families", "models"]);
    str(c.why, `${at}.why`);
    for (const [key, vocabulary] of [["transports", TRANSPORTS], ["harnesses", HARNESSES], ["families", families], ["models", modelNames]] as const) if (c[key] !== undefined) strings(c[key], `${at}.${key}`, false, vocabulary);
  });
  strings(root.deepResearchLanes, "deepResearchLanes", false, laneNames).forEach((lane, i) => {
    const c = Object.hasOwn(constraints, lane) ? constraints[lane] : undefined;
    const transports = typeof c === "object" && c !== null ? (c as Record<string, unknown>).transports : undefined;
    if (!Array.isArray(transports) || transports.length !== 1 || transports[0] !== "native") add("dangling-reference", `deepResearchLanes[${i}]`);
  });
  const policy = obj(root.policy, "policy", ["maxFallbackDepth"]);
  if (!Number.isSafeInteger(policy.maxFallbackDepth) || (policy.maxFallbackDepth as number) < 0) add("out-of-range", "policy.maxFallbackDepth");
  const placements = obj(root.placements, "placements", ["backends", "entries"]);
  const backends = strings(placements.backends, "placements.backends");
  backends.forEach((b, i) => str(b, `placements.backends[${i}]`, /^[a-z][a-z0-9-]{0,31}$/));
  const pairs = new Set<string>();
  const placed = new Set<string>();
  arr(placements.entries, "placements.entries").forEach((v, i) => {
    const at = `placements.entries[${i}]`;
    const p = obj(v, at, ["model", "backend", "verdict", "why"], ["reason", "requires"]);
    ref(p.model, `${at}.model`, modelNames);
    ref(p.backend, `${at}.backend`, backends);
    str(p.verdict, `${at}.verdict`); str(p.why, `${at}.why`);
    if (p.reason !== undefined) str(p.reason, `${at}.reason`);
    if (typeof p.model === "string" && typeof p.backend === "string") {
      const pair = JSON.stringify([p.model, p.backend]);
      if (pairs.has(pair)) add("duplicate", at);
      pairs.add(pair); placed.add(p.model);
    }
    if (p.requires !== undefined) {
      const r = obj(p.requires, `${at}.requires`, [], ["env", "args"]);
      if (r.env !== undefined) Object.entries(records(r.env, `${at}.requires.env`)).forEach(([key, val], j) => {
        str(key, `${at}.requires.env[${j}]`); str(val, `${at}.requires.env[${j}]`, undefined, false);
      });
      if (r.args !== undefined) arr(r.args, `${at}.requires.args`).forEach((val, j) => str(val, `${at}.requires.args[${j}]`));
    }
  });
  for (const model of placed) for (const backend of backends) if (!pairs.has(JSON.stringify([model, backend]))) add("dangling-reference", "placements.entries");
  if (problems.length) return { ok: false, refusal: { kind: "invalid", problems } };
  const configuration = deepFreeze(structuredClone(value)) as RoutingConfiguration;
  const invariants = checkPolicy(configuration);
  return invariants.length ? { ok: false, refusal: { kind: "invariant", problems: invariants } } : { ok: true, configuration };
}
