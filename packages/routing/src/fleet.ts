/**
 * Version 2: the fleet shape as a document.
 *
 * Tiers by role, each cell an ordered candidate list; loop policies whose non-numeric states stay
 * words; coordinator scopes; provider precedence; per-launch seam, wire identity and effort
 * evidence; role declarations for what certifies what, what a role requires and what restricts it.
 *
 * ## What this module is not
 *
 * It resolves nothing. There is no function here that picks a candidate, a launch, an effort or an
 * evaluator, and no name beginning `resolve`, `admit` or `select`. The accessors return the
 * document's own data in the document's own order, and the feasibility predicates return sets.
 * Selecting from those sets — including generator-relative independence after a fallback — is the
 * resolver's work, and the resolver is a separate step (#273).
 *
 * ## Three rules the schema exists to make unsayable
 *
 * - **No effort conversion.** Nothing here maps one effort onto another, walks a ladder, downgrades
 *   or approximates. A cell asking for one effort is a request, never proof that a launch accepts it.
 * - **No support from silence.** A launch that does not mention an effort has not refused it.
 *   `unknown` is a lawful first-class state and the only state a document may leave by omission.
 * - **No independence waiver.** There is no field in this schema that mentions independence, so
 *   no document can ask for it to be set aside.
 */
import { HARNESSES, ROUTERS, type Harness, type Router } from "@rickylabs/subagents";
import { SEAMS, type Seam } from "./family.js";
import {
  CERTIFIES_KEYWORDS, SUBSCRIPTION_STATES, TRANSPORTS, deepFreeze, fieldPath, validator,
  type PlacementConfiguration, type SubscriptionState, type Transport, type ValidationOutcome,
} from "./schema.js";
import type { PolicyCode, PolicyProblem } from "./resolve.js";

/** The two words a loop enforcer must interpret where a round cap is not a number. */
export const LOOP_ROUND_STATES = ["none", "unspecified_by_owner"] as const;
/** The one word a repair enforcer must interpret where a repair point is not a number. */
export const LOOP_REPAIR_STATES = ["immediate"] as const;
/** The one authority that is not a coordinator scope. Scopes themselves are document data. */
export const AUTHORITY_KEYWORDS = ["owner"] as const;
/** The evidence kinds an owner override may cite. A document declares which it requires. */
export const OVERRIDE_EVIDENCE = ["worklog"] as const;
/** Declared, or unknown. There is no third state and no implicit "all supported". */
export const EFFORT_SUPPORT_STATES = ["unknown", "known"] as const;

export type LoopRoundState = (typeof LOOP_ROUND_STATES)[number];
export type LoopRepairState = (typeof LOOP_REPAIR_STATES)[number];
export type EffortSupportState = (typeof EFFORT_SUPPORT_STATES)[number];
/** What `effortEvidence` answers about one launch and one effort. Exactly three answers. */
export type EffortVerdict = "supported" | "unsupported" | "unknown";

/**
 * A tier's loop policy for one generation role.
 *
 * `maxRounds` and `repairInFlightAt` hold either an integer or one of their words. No word is
 * mapped onto a number and no cross-field rule relates a threshold to a cap: the fleet's own
 * export carries a cap of 1 with an escalation at 2, and a cap of 0.
 */
export interface LoopPolicy {
  readonly maxRounds: number | LoopRoundState;
  readonly reSteerSameSession: boolean;
  readonly notifyOwnerAfter?: number;
  readonly escalateToOwnerAt?: number;
  readonly repairInFlightAt?: number | LoopRepairState;
}

/** One ordered cell entry: index 0 is the default, later indices are fallbacks in order. */
export interface Candidate {
  readonly model: string;
  readonly effort: string;
}

/**
 * What a launch declares about the efforts it can carry.
 *
 * `known` lists what it supports and, optionally, what it refuses. Every effort named in neither
 * list is unknown on that launch. `unknown` may not list anything: a launch whose support is
 * unknown cannot simultaneously enumerate it.
 */
export type EffortSupport =
  | { readonly status: "unknown"; readonly why?: string }
  | {
      readonly status: "known";
      readonly supported: readonly string[];
      readonly unsupported?: readonly string[];
      readonly why: string;
    };

/**
 * One lawful way to reach a model: a provider identity, a seam, and the wire id on that pair.
 *
 * The seam is a property of the launch, not of the provider. One provider can be reached as a
 * vendor-CLI relay and as an API backend, and those are different dials with different metering;
 * a provider that carried the seam could not name both without a second provider name.
 */
export interface Launch {
  readonly provider: string;
  readonly seam: Seam;
  readonly id: string;
  readonly transport: Transport;
  readonly harness?: Harness;
  readonly router?: Router;
  readonly profile?: string;
  readonly preset?: string;
  readonly subscription?: SubscriptionState;
  readonly effortSupport: EffortSupport;
}

export interface FleetModel {
  readonly family: string;
  readonly capabilities?: readonly string[];
  readonly approvedRelayEvaluator?: true;
  readonly launches: readonly Launch[];
}

/** A provider identity. Accounts, subscriptions and client versions are a later step (#274). */
export interface ProviderIdentity {
  readonly description?: string;
}

export interface Restrictions {
  readonly seams?: readonly Seam[];
  readonly transports?: readonly Transport[];
  readonly harnesses?: readonly Harness[];
  readonly providers?: readonly string[];
  readonly families?: readonly string[];
  readonly models?: readonly string[];
}

/**
 * A declared role.
 *
 * A role carrying `certifies` is an evaluation role. `any` is a gate and must name what it
 * evaluates; `none` is supplementary evidence and never a gate. A role with no `certifies` is a
 * generation role and is the only kind a loop policy or an owner selection may name.
 */
export interface Role {
  readonly certifies?: "any" | "none";
  readonly evaluates?: readonly string[];
  readonly requires?: readonly string[];
  readonly restrictions?: Restrictions;
  /** Owner-or-scope selection, with the role incidental work falls back to when unselected. */
  readonly selection?: { readonly by: readonly string[]; readonly otherwise: string };
}

export interface FleetTier {
  readonly tier: string;
  readonly description?: string;
  readonly cells: Readonly<Record<string, readonly Candidate[]>>;
  readonly loops?: Readonly<Record<string, LoopPolicy>>;
  /** Present exactly on a privileged tier. Its absence is what makes a tier ordinary. */
  readonly authorization?: { readonly by: readonly string[] };
}

export interface FleetRoutingConfiguration {
  readonly schemaVersion: 2;
  readonly name: string;
  readonly provenance?: { readonly description: string };
  readonly families: readonly string[];
  readonly efforts: { readonly ordered: readonly string[]; readonly unordered?: readonly string[] };
  readonly capabilities: readonly string[];
  readonly providers: Readonly<Record<string, ProviderIdentity>>;
  readonly providerPrecedence: readonly string[];
  readonly profiles: readonly string[];
  readonly presets: readonly string[];
  readonly models: Readonly<Record<string, FleetModel>>;
  readonly roles: Readonly<Record<string, Role>>;
  readonly tiers: readonly FleetTier[];
  readonly coordinators: Readonly<Record<string, readonly Candidate[]>>;
  readonly lanes: readonly { readonly lane: string; readonly tier: string; readonly role: string; readonly note?: string }[];
  readonly policy: {
    readonly maxFallbackDepth: number;
    readonly ownerOverride: { readonly evidence: readonly string[] };
  };
  readonly placements: PlacementConfiguration;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MODEL_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const DOCUMENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const LAUNCH_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,256}$/;
const OPENCODE_HARNESSES: readonly string[] = ["opencode", "opencode-run"];
const RELAY_TRANSPORT = TRANSPORTS[1];
const LAUNCH_OPTIONAL = ["harness", "router", "profile", "preset", "subscription"] as const;
/** Keys an llm-seam launch may not carry: it is addressed by backend, never by a CLI. */
const SUBAGENTS_ONLY_KEYS = ["harness", "router", "profile", "preset"] as const;

/** Version 2: strict whole-document validation. Nothing is filled, coerced or discarded. */
export function validateFleetConfiguration(value: unknown): ValidationOutcome<FleetRoutingConfiguration> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, refusal: { kind: "malformed", code: "root-not-object" } };
  }
  const root = value as Record<string, unknown>;
  const { problems, add, obj, str, arr, strings, ref, records, bounded, bool } = validator();

  obj(root, "$", [
    "schemaVersion", "name", "families", "efforts", "capabilities", "providers", "providerPrecedence",
    "profiles", "presets", "models", "roles", "tiers", "coordinators", "lanes", "policy", "placements",
  ], ["provenance"]);
  str(root.name, "name", DOCUMENT_NAME_PATTERN);
  if (root.provenance !== undefined) str(obj(root.provenance, "provenance", ["description"]).description, "provenance.description");

  const families = strings(root.families, "families", true);
  families.forEach((f, i) => { if ((CERTIFIES_KEYWORDS as readonly string[]).includes(f)) add("reserved-name", `families[${i}]`); });
  const effortLists = obj(root.efforts, "efforts", ["ordered"], ["unordered"]);
  const ordered = strings(effortLists.ordered, "efforts.ordered", true);
  const unordered = effortLists.unordered === undefined ? [] : strings(effortLists.unordered, "efforts.unordered");
  unordered.forEach((e, i) => { if (ordered.includes(e)) add("duplicate", `efforts.unordered[${i}]`); });
  const efforts = [...ordered, ...unordered];
  const capabilities = strings(root.capabilities, "capabilities");
  const profiles = strings(root.profiles, "profiles");
  const presets = strings(root.presets, "presets");

  const providers = records(root.providers, "providers", true);
  const providerNames = Object.keys(providers);
  Object.entries(providers).forEach(([key, v], i) => {
    const at = `providers[${i}]`;
    if (!NAME_PATTERN.test(key)) add("out-of-range", at);
    const identity = obj(v, at, [], ["description"]);
    if (identity.description !== undefined) str(identity.description, `${at}.description`);
  });
  const precedence = strings(root.providerPrecedence, "providerPrecedence", false, providerNames);
  // A declared provider absent from precedence would be unreachable by silence, not by decision.
  if (root.providerPrecedence !== undefined) {
    for (const name of providerNames) if (!precedence.includes(name)) add("dangling-reference", "providerPrecedence");
  }

  // Launch identity is (provider, seam, id): one provider and one wire id may appear once per
  // seam, which is how a dual-seam provider is expressed without inventing a second name.
  const launchKeys = new Set<string>();
  const llmLaunchIds = new Set<string>();
  const models = records(root.models, "models", true);
  const modelKeys = Object.keys(models);
  Object.entries(models).forEach(([key, v], i) => {
    const at = `models[${i}]`;
    if (!MODEL_KEY_PATTERN.test(key)) add("out-of-range", at);
    const m = obj(v, at, ["family", "launches"], ["capabilities", "approvedRelayEvaluator"]);
    ref(m.family, `${at}.family`, families);
    if (m.capabilities !== undefined) strings(m.capabilities, `${at}.capabilities`, false, capabilities);
    if (m.approvedRelayEvaluator !== undefined && m.approvedRelayEvaluator !== true) add("wrong-type", `${at}.approvedRelayEvaluator`);
    arr(m.launches, `${at}.launches`, true).forEach((l, j) => {
      const lp = `${at}.launches[${j}]`;
      const launch = obj(l, lp, ["provider", "seam", "id", "transport", "effortSupport"], [...LAUNCH_OPTIONAL]);
      ref(launch.provider, `${lp}.provider`, providerNames);
      ref(launch.seam, `${lp}.seam`, SEAMS);
      str(launch.id, `${lp}.id`, LAUNCH_ID_PATTERN);
      ref(launch.transport, `${lp}.transport`, TRANSPORTS);
      if (launch.subscription !== undefined) ref(launch.subscription, `${lp}.subscription`, SUBSCRIPTION_STATES);
      if (launch.seam === SEAMS[0]) {
        if (!Object.hasOwn(launch, "harness")) add("missing-key", `${lp}.harness`);
        else ref(launch.harness, `${lp}.harness`, HARNESSES);
        if (launch.router !== undefined) ref(launch.router, `${lp}.router`, ROUTERS);
        if (launch.profile !== undefined) ref(launch.profile, `${lp}.profile`, profiles);
        if (launch.preset !== undefined) ref(launch.preset, `${lp}.preset`, presets);
      } else if (launch.seam === SEAMS[1]) {
        const own = Object.keys(launch);
        for (const forbidden of SUBAGENTS_ONLY_KEYS) {
          if (launch[forbidden] !== undefined) add("unknown-key", fieldPath(lp, forbidden, own.indexOf(forbidden)));
        }
      }
      effortSupport(launch.effortSupport, `${lp}.effortSupport`);
      if (typeof launch.provider === "string" && typeof launch.seam === "string" && typeof launch.id === "string") {
        const identity = JSON.stringify([launch.provider, launch.seam, launch.id]);
        if (launchKeys.has(identity)) add("duplicate", lp);
        launchKeys.add(identity);
        if (launch.seam === SEAMS[1]) llmLaunchIds.add(launch.id);
      }
    });
  });
  function effortSupport(v: unknown, path: string): void {
    const support = obj(v, path, ["status"], ["supported", "unsupported", "why"]);
    ref(support.status, `${path}.status`, EFFORT_SUPPORT_STATES);
    const own = Object.keys(support);
    if (support.status === EFFORT_SUPPORT_STATES[0]) {
      for (const forbidden of ["supported", "unsupported"] as const) {
        if (support[forbidden] !== undefined) add("unknown-key", fieldPath(path, forbidden, own.indexOf(forbidden)));
      }
      if (support.why !== undefined) str(support.why, `${path}.why`);
      return;
    }
    if (support.status !== EFFORT_SUPPORT_STATES[1]) return;
    if (!Object.hasOwn(support, "supported")) add("missing-key", `${path}.supported`);
    const yes = strings(support.supported, `${path}.supported`, false, efforts);
    const no = support.unsupported === undefined ? [] : strings(support.unsupported, `${path}.unsupported`, false, efforts);
    no.forEach((e, k) => { if (yes.includes(e)) add("duplicate", `${path}.unsupported[${k}]`); });
    if (!Object.hasOwn(support, "why")) add("missing-key", `${path}.why`);
    else str(support.why, `${path}.why`);
  }

  const coordinators = records(root.coordinators, "coordinators");
  const scopes = Object.keys(coordinators);

  const roles = records(root.roles, "roles", true);
  const roleNames = Object.keys(roles);
  // Which roles certify is needed before any cell, loop or selection can be checked against it,
  // and the answer must come from the raw document rather than from a validated value.
  const evaluationRoles = new Set(roleNames.filter(name => {
    const r = roles[name];
    return typeof r === "object" && r !== null && !Array.isArray(r) && (r as Record<string, unknown>).certifies !== undefined;
  }));
  const selectedRoles = new Set(roleNames.filter(name => {
    const r = roles[name];
    return typeof r === "object" && r !== null && !Array.isArray(r) && (r as Record<string, unknown>).selection !== undefined;
  }));
  const authorities = [...AUTHORITY_KEYWORDS, ...scopes];
  function by(v: unknown, path: string): void {
    strings(obj(v, path, ["by"]).by, `${path}.by`, true, authorities);
  }
  Object.entries(roles).forEach(([key, v], i) => {
    const at = `roles[${i}]`;
    if (!NAME_PATTERN.test(key)) add("out-of-range", at);
    const r = obj(v, at, [], ["certifies", "evaluates", "requires", "restrictions", "selection"]);
    const own = Object.keys(r);
    if (r.certifies !== undefined) ref(r.certifies, `${at}.certifies`, CERTIFIES_KEYWORDS);
    else if (r.evaluates !== undefined) add("unknown-key", fieldPath(at, "evaluates", own.indexOf("evaluates")));
    if (r.certifies === CERTIFIES_KEYWORDS[0] && !Object.hasOwn(r, "evaluates")) add("missing-key", `${at}.evaluates`);
    if (r.evaluates !== undefined && r.certifies !== undefined) {
      strings(r.evaluates, `${at}.evaluates`, r.certifies === CERTIFIES_KEYWORDS[0], roleNames).forEach((name, k) => {
        if (name === key || evaluationRoles.has(name)) add("out-of-range", `${at}.evaluates[${k}]`);
      });
    }
    if (r.requires !== undefined) strings(r.requires, `${at}.requires`, false, capabilities);
    if (r.restrictions !== undefined) {
      const restrict = obj(r.restrictions, `${at}.restrictions`, [], ["seams", "transports", "harnesses", "providers", "families", "models"]);
      for (const [field, vocabulary] of [
        ["seams", SEAMS], ["transports", TRANSPORTS], ["harnesses", HARNESSES],
        ["providers", providerNames], ["families", families], ["models", modelKeys],
      ] as const) if (restrict[field] !== undefined) strings(restrict[field], `${at}.restrictions.${field}`, false, vocabulary);
    }
    if (r.selection !== undefined) {
      const selection = obj(r.selection, `${at}.selection`, ["by", "otherwise"]);
      strings(selection.by, `${at}.selection.by`, true, authorities);
      if (str(selection.otherwise, `${at}.selection.otherwise`)) {
        if (!roleNames.includes(selection.otherwise)) add("dangling-reference", `${at}.selection.otherwise`);
        else if (selection.otherwise === key || evaluationRoles.has(selection.otherwise) || selectedRoles.has(selection.otherwise)) {
          add("out-of-range", `${at}.selection.otherwise`);
        }
      }
    }
  });

  function candidates(v: unknown, path: string): void {
    arr(v, path).forEach((c, k) => {
      const at = `${path}[${k}]`;
      const candidate = obj(c, at, ["model", "effort"]);
      ref(candidate.model, `${at}.model`, modelKeys);
      ref(candidate.effort, `${at}.effort`, efforts);
    });
  }

  const tierNames: string[] = [];
  arr(root.tiers, "tiers", true).forEach((v, i) => {
    const at = `tiers[${i}]`;
    const t = obj(v, at, ["tier", "cells"], ["description", "loops", "authorization"]);
    if (str(t.tier, `${at}.tier`, NAME_PATTERN)) {
      if (tierNames.includes(t.tier)) add("duplicate", `${at}.tier`);
      tierNames.push(t.tier);
    }
    if (t.description !== undefined) str(t.description, `${at}.description`);
    // Cell keys are dynamic, so a missing role prints as its index in `roles` and an extra key
    // prints as its own index. Neither ever renders a role name from the document.
    const cells = t.cells === undefined ? {} : records(t.cells, `${at}.cells`);
    if (t.cells !== undefined) roleNames.forEach((name, k) => { if (!Object.hasOwn(cells, name)) add("missing-key", `${at}.cells[${k}]`); });
    Object.entries(cells).forEach(([key, cell], k) => {
      const cellAt = `${at}.cells[${k}]`;
      if (!roleNames.includes(key)) { add("unknown-key", cellAt); return; }
      candidates(cell, cellAt);
    });
    if (t.loops !== undefined) Object.entries(records(t.loops, `${at}.loops`)).forEach(([key, loop], k) => {
      const lp = `${at}.loops[${k}]`;
      if (!roleNames.includes(key) || evaluationRoles.has(key)) add("dangling-reference", lp);
      const policy = obj(loop, lp, ["maxRounds", "reSteerSameSession"], ["notifyOwnerAfter", "escalateToOwnerAt", "repairInFlightAt"]);
      bounded(policy.maxRounds, `${lp}.maxRounds`, LOOP_ROUND_STATES);
      bool(policy.reSteerSameSession, `${lp}.reSteerSameSession`);
      if (policy.notifyOwnerAfter !== undefined) bounded(policy.notifyOwnerAfter, `${lp}.notifyOwnerAfter`);
      if (policy.escalateToOwnerAt !== undefined) bounded(policy.escalateToOwnerAt, `${lp}.escalateToOwnerAt`);
      if (policy.repairInFlightAt !== undefined) bounded(policy.repairInFlightAt, `${lp}.repairInFlightAt`, LOOP_REPAIR_STATES);
    });
    if (t.authorization !== undefined) by(t.authorization, `${at}.authorization`);
  });

  Object.entries(coordinators).forEach(([key, cell], i) => {
    const at = `coordinators[${i}]`;
    if (!NAME_PATTERN.test(key)) add("out-of-range", at);
    if ((AUTHORITY_KEYWORDS as readonly string[]).includes(key)) add("reserved-name", at);
    candidates(cell, at);
  });

  const laneNames: string[] = [];
  arr(root.lanes, "lanes", true).forEach((v, i) => {
    const at = `lanes[${i}]`;
    const l = obj(v, at, ["lane", "tier", "role"], ["note"]);
    if (str(l.lane, `${at}.lane`, NAME_PATTERN)) {
      if (laneNames.includes(l.lane)) add("duplicate", `${at}.lane`);
      laneNames.push(l.lane);
    }
    ref(l.tier, `${at}.tier`, tierNames);
    ref(l.role, `${at}.role`, roleNames);
    if (l.note !== undefined) str(l.note, `${at}.note`, undefined, false);
  });

  const policy = obj(root.policy, "policy", ["maxFallbackDepth", "ownerOverride"]);
  bounded(policy.maxFallbackDepth, "policy.maxFallbackDepth");
  const override = obj(policy.ownerOverride, "policy.ownerOverride", ["evidence"]);
  strings(override.evidence, "policy.ownerOverride.evidence", true, OVERRIDE_EVIDENCE);

  // Placements stay in wire-id space, on the llm seam: they are matched by the generate-time model
  // string, so a subagents-only id here would name nothing the adapter can serve.
  const placements = obj(root.placements, "placements", ["backends", "entries"]);
  const backends = strings(placements.backends, "placements.backends");
  backends.forEach((b, i) => str(b, `placements.backends[${i}]`, /^[a-z][a-z0-9-]{0,31}$/));
  const pairs = new Set<string>();
  const placed = new Set<string>();
  arr(placements.entries, "placements.entries").forEach((v, i) => {
    const at = `placements.entries[${i}]`;
    const p = obj(v, at, ["model", "backend", "verdict", "why"], ["reason", "requires"]);
    ref(p.model, `${at}.model`, [...llmLaunchIds]);
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
  for (const id of placed) for (const backend of backends) if (!pairs.has(JSON.stringify([id, backend]))) add("dangling-reference", "placements.entries");

  if (problems.length) return { ok: false, refusal: { kind: "invalid", problems } };
  const configuration = deepFreeze(structuredClone(value)) as FleetRoutingConfiguration;
  const invariants = checkFleetPolicy(configuration);
  return invariants.length ? { ok: false, refusal: { kind: "invariant", problems: invariants } } : { ok: true, configuration };
}

/* ── Pure accessors. Each returns the document's own data, or null. None chooses. ─────────── */

export function fleetTier(configuration: FleetRoutingConfiguration, tier: string): FleetTier | null {
  return configuration.tiers.find(t => t.tier === tier) ?? null;
}
export function fleetTierNames(configuration: FleetRoutingConfiguration): readonly string[] {
  return configuration.tiers.map(t => t.tier);
}
export function roleOf(configuration: FleetRoutingConfiguration, role: string): Role | null {
  return Object.hasOwn(configuration.roles, role) ? configuration.roles[role]! : null;
}
export function fleetRoleNames(configuration: FleetRoutingConfiguration): readonly string[] {
  return Object.keys(configuration.roles);
}
/** The ordered candidates of one cell, including an explicitly empty one. `null` means no cell. */
export function cellOf(configuration: FleetRoutingConfiguration, tier: string, role: string): readonly Candidate[] | null {
  const found = fleetTier(configuration, tier);
  if (found === null || !Object.hasOwn(found.cells, role)) return null;
  return found.cells[role]!;
}
export function loopOf(configuration: FleetRoutingConfiguration, tier: string, role: string): LoopPolicy | null {
  const found = fleetTier(configuration, tier);
  if (found?.loops === undefined || !Object.hasOwn(found.loops, role)) return null;
  return found.loops[role]!;
}
export function coordinatorCandidates(configuration: FleetRoutingConfiguration): Readonly<Record<string, readonly Candidate[]>> {
  return configuration.coordinators;
}
export function coordinatorsFor(configuration: FleetRoutingConfiguration, scope: string): readonly Candidate[] | null {
  return Object.hasOwn(configuration.coordinators, scope) ? configuration.coordinators[scope]! : null;
}
export function coordinatorScopes(configuration: FleetRoutingConfiguration): readonly string[] {
  return Object.keys(configuration.coordinators);
}
export function providerPrecedenceOf(configuration: FleetRoutingConfiguration): readonly string[] {
  return configuration.providerPrecedence;
}
export function fleetModelOf(configuration: FleetRoutingConfiguration, model: string): FleetModel | null {
  return Object.hasOwn(configuration.models, model) ? configuration.models[model]! : null;
}
export function fleetFamilyOf(configuration: FleetRoutingConfiguration, model: string): string | null {
  return fleetModelOf(configuration, model)?.family ?? null;
}
export function fleetModelKeys(configuration: FleetRoutingConfiguration): readonly string[] {
  return Object.keys(configuration.models);
}
export function fleetLaneNames(configuration: FleetRoutingConfiguration): readonly string[] {
  return configuration.lanes.map(l => l.lane);
}
export function fleetLaneOf(configuration: FleetRoutingConfiguration, lane: string) {
  return configuration.lanes.find(l => l.lane === lane) ?? null;
}
/** A model's launches in document order, optionally filtered by seam. Never reordered. */
export function launchesOf(
  configuration: FleetRoutingConfiguration,
  model: string,
  filter?: { readonly seam?: Seam },
): readonly Launch[] {
  const launches = fleetModelOf(configuration, model)?.launches ?? [];
  return filter?.seam === undefined ? launches : launches.filter(l => l.seam === filter.seam);
}
/** Whether a tier is privileged: it declares who may authorize a dispatch into it. */
export function authorizedBy(configuration: FleetRoutingConfiguration, tier: string): readonly string[] | null {
  return fleetTier(configuration, tier)?.authorization?.by ?? null;
}
export function overrideEvidenceOf(configuration: FleetRoutingConfiguration): readonly string[] {
  return configuration.policy.ownerOverride.evidence;
}

/**
 * What one launch declares about one effort: supported, unsupported, or unknown.
 *
 * Unknown is the answer for every effort a `known` launch did not name, and for every effort on an
 * `unknown` launch. It is never upgraded to supported and never read as a refusal.
 */
export function effortEvidence(
  configuration: FleetRoutingConfiguration,
  model: string,
  launchIndex: number,
  effort: string,
): EffortVerdict {
  const launch = fleetModelOf(configuration, model)?.launches[launchIndex];
  if (launch === undefined) return "unknown";
  return verdictOf(launch, effort);
}
function verdictOf(launch: Launch, effort: string): EffortVerdict {
  const support = launch.effortSupport;
  if (support.status !== EFFORT_SUPPORT_STATES[1]) return "unknown";
  if (support.unsupported?.includes(effort) === true) return "unsupported";
  return support.supported.includes(effort) ? "supported" : "unknown";
}

/* ── Feasibility. Returns sets in document order; selecting from them is the resolver's. ──── */

/** Clause c1: whether one launch satisfies every restriction a role declares. */
function satisfies(configuration: FleetRoutingConfiguration, launch: Launch, model: string, role: Role | null): boolean {
  const restrict = role?.restrictions;
  if (restrict === undefined) return true;
  const family = fleetFamilyOf(configuration, model);
  return (restrict.seams === undefined || restrict.seams.includes(launch.seam))
    && (restrict.transports === undefined || restrict.transports.includes(launch.transport))
    && (restrict.harnesses === undefined || (launch.harness !== undefined && restrict.harnesses.includes(launch.harness)))
    && (restrict.providers === undefined || restrict.providers.includes(launch.provider))
    && (restrict.families === undefined || (family !== null && restrict.families.includes(family)))
    && (restrict.models === undefined || restrict.models.includes(model));
}
/** Clause c2: relay approval, judged on this launch, not on an unrelated native one. */
function approved(configuration: FleetRoutingConfiguration, launch: Launch, model: string, role: Role | null): boolean {
  if (role?.certifies === undefined || role.certifies === CERTIFIES_KEYWORDS[1]) return true;
  if (launch.transport !== RELAY_TRANSPORT) return true;
  return fleetModelOf(configuration, model)?.approvedRelayEvaluator === true;
}
/** Whether a model carries every capability a role requires. */
export function capableOf(configuration: FleetRoutingConfiguration, model: string, role: Role | null): boolean {
  const required = role?.requires;
  if (required === undefined || required.length === 0) return true;
  const held = fleetModelOf(configuration, model)?.capabilities ?? [];
  return required.every(capability => held.includes(capability));
}
/**
 * The launches of `model` that could serve `role` at `effort`, in document order.
 *
 * All three clauses are asked of the same launch. A model whose native launch satisfies the
 * restrictions while its relay launch carries the approval has no feasible launch — that is a pair
 * of unrelated facts, not a route.
 */
export function feasibleLaunches(
  configuration: FleetRoutingConfiguration,
  model: string,
  effort: string,
  role: Role | null,
): readonly Launch[] {
  return launchesOf(configuration, model).filter(launch =>
    satisfies(configuration, launch, model, role)
    && approved(configuration, launch, model, role)
    && verdictOf(launch, effort) !== "unsupported");
}
export function feasibleCandidate(
  configuration: FleetRoutingConfiguration,
  candidate: Candidate,
  role: Role | null,
): boolean {
  return capableOf(configuration, candidate.model, role)
    && feasibleLaunches(configuration, candidate.model, candidate.effort, role).length > 0;
}
/**
 * Whether `evaluator` could independently certify `generator` under the evaluating role.
 *
 * Independence is family inequality, and family is an opaque token compared for equality. The
 * evaluator must also be feasible in its own right at its own cell effort: a different-family row
 * that cannot run is not an evaluator.
 */
export function feasibleEvaluator(
  configuration: FleetRoutingConfiguration,
  generator: Candidate,
  evaluator: Candidate,
  evaluatorRole: Role | null,
): boolean {
  const authorFamily = fleetFamilyOf(configuration, generator.model);
  const evaluatorFamily = fleetFamilyOf(configuration, evaluator.model);
  if (authorFamily === null || evaluatorFamily === null || authorFamily === evaluatorFamily) return false;
  return feasibleCandidate(configuration, evaluator, evaluatorRole);
}

/**
 * Static invariants over the document's own cells.
 *
 * Per candidate the clauses are evaluated in a fixed order and the first failure is that
 * candidate's single problem, so one defect never reports as several. Cross-tier fallback,
 * generator fallback order and the actually selected generator are all the resolver's (#273);
 * what a load can prove is that the document does not promise an evaluator it cannot supply.
 */
export function checkFleetPolicy(configuration: FleetRoutingConfiguration): readonly PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  const add = (code: PolicyCode, location: string, index?: number): void => {
    problems.push({ code, lane: location, ...(index === undefined ? {} : { index }) });
  };
  const roleNames = Object.keys(configuration.roles);
  const generationRoles = roleNames.filter(name => configuration.roles[name]!.certifies === undefined);
  const gates = roleNames.filter(name => configuration.roles[name]!.certifies === CERTIFIES_KEYWORDS[0]);

  configuration.lanes.forEach((l, i) => {
    const cell = cellOf(configuration, l.tier, l.role);
    if (cell === null || cell.length === 0) add("lane-unrouted", `lanes[${i}]`);
  });

  configuration.tiers.forEach((t, tierIndex) => {
    roleNames.forEach((name, roleIndex) => {
      const role = configuration.roles[name]!;
      const location = `tiers[${tierIndex}].cells[${roleIndex}]`;
      const cell = t.cells[name] ?? [];
      cell.forEach((candidate, index) => {
        const code = candidateProblem(configuration, candidate, role);
        if (code !== null) { add(code, location, index); return; }
        if (!generationRoles.includes(name)) return;
        // Order 5: a generator with no feasible, independent evaluator in the gate that reviews it.
        const unreviewed = gates.some(gate => {
          const gateRole = configuration.roles[gate]!;
          if (gateRole.evaluates?.includes(name) !== true) return false;
          return !(t.cells[gate] ?? []).some(d => feasibleEvaluator(configuration, candidate, d, gateRole));
        });
        if (unreviewed) add("no-independent-evaluator", location, index);
      });
    });
  });

  // A coordinator candidate has no role, so only the effort clause can refuse it.
  Object.keys(configuration.coordinators).forEach((scope, scopeIndex) => {
    configuration.coordinators[scope]!.forEach((candidate, index) => {
      const code = candidateProblem(configuration, candidate, null);
      if (code !== null) add(code, `coordinators[${scopeIndex}]`, index);
    });
  });

  Object.keys(configuration.models).forEach((model, modelIndex) => {
    const location = `models[${modelIndex}].launches`;
    configuration.models[model]!.launches.forEach((launch, index) => {
      if (launch.seam !== SEAMS[0]) return;
      const opencode = launch.harness !== undefined && OPENCODE_HARNESSES.includes(launch.harness);
      if (opencode && launch.router === undefined) add("opencode-without-router", location, index);
      if (!opencode && launch.router !== undefined) add("router-outside-opencode", location, index);
      if (launch.transport === RELAY_TRANSPORT && !opencode && launch.profile === undefined) add("relay-without-profile", location, index);
    });
  });
  return problems;
}
/** Orders 1 to 4 of the invariant table, first failure wins. `null` means the candidate stands. */
function candidateProblem(
  configuration: FleetRoutingConfiguration,
  candidate: Candidate,
  role: Role | null,
): PolicyCode | null {
  if (!capableOf(configuration, candidate.model, role)) return "capability-unsatisfied";
  const launches = launchesOf(configuration, candidate.model);
  const restricted = launches.filter(l => satisfies(configuration, l, candidate.model, role));
  if (restricted.length === 0) return "constraint-violated";
  const allowed = restricted.filter(l => approved(configuration, l, candidate.model, role));
  if (allowed.length === 0) return "relay-evaluator-unapproved";
  // Declared unsupported on every launch that could serve the role is a refusal the document
  // itself states. `unknown` is not support and is not infeasibility.
  if (allowed.every(l => verdictOf(l, candidate.effort) === "unsupported")) return "effort-unsupported";
  return null;
}
