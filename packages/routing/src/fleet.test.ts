/**
 * Version 2 over three kinds of document: the fleet-shaped fixture, a tailored project document
 * sharing no name with it, and adversarial malformed input.
 *
 * Every fleet fact asserted here is computed from the retained CLI export, never typed from memory:
 * a one-byte change to an exported value in the fixture fails the comparison rather than passing
 * against a literal this file happens to agree with.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describeLoadRefusal, loadRoutingConfiguration, parseRoutingDocument, type LoadOutcome } from "./load.js";
import { MAX_DEPTH, MAX_MEMBERS } from "./schema.js";
import {
  describeConsumerRefusal, fleetRouting, laneRouting, placementsOf, validateRoutingConfiguration,
  type RoutingDocument,
} from "./document.js";
import {
  EFFORT_SUPPORT_STATES, authorizedBy, capableOf, cellOf, checkFleetPolicy, coordinatorCandidates,
  coordinatorScopes, coordinatorsFor, effortEvidence, feasibleCandidate, feasibleEvaluator,
  feasibleLaunches, fleetFamilyOf, fleetLaneNames, fleetLaneOf, fleetModelKeys, fleetRoleNames,
  fleetTier, fleetTierNames, launchesOf, loopOf, overrideEvidenceOf, providerPrecedenceOf, roleOf,
  type Candidate, type FleetRoutingConfiguration,
} from "./fleet.js";
import { resolveRoute, resolveFallback, tierPlan } from "./resolve.js";
import { admitDispatch } from "./admit.js";
import { checkEvaluator } from "./family.js";
import * as fleetModule from "./fleet.js";

/* ── The two fixtures. X is the CLI evidence; F is the document under test. ─────────────────── */

const pathX = fileURLToPath(new URL("../test-fixtures/matrix-full.8ba53bc.json", import.meta.url));
const pathF = fileURLToPath(new URL("../test-fixtures/fleet-shaped.v2.json", import.meta.url));
const textX = await readFile(pathX, "utf8");
const textF = await readFile(pathF, "utf8");
interface CliCandidate { readonly model: string; readonly effort: string }
interface CliTier { readonly tier: string; readonly description: string; readonly planPolicy: Record<string, unknown>; readonly implementationPolicy: Record<string, unknown>; readonly documentationPolicy: Record<string, unknown>; readonly [role: string]: unknown }
const X = JSON.parse(textX) as {
  readonly tiers: readonly CliTier[];
  readonly coordinators: Readonly<Record<string, readonly CliCandidate[]>>;
  readonly transportPriority: readonly string[];
};
/** Exactly the keys of a CLI tier whose value is a cell. Derived, never listed. */
const cliRoles = (t: CliTier): readonly string[] => Object.keys(t).filter(k => Array.isArray(t[k]));
const cliPolicyKeys = [["planPolicy", "plan"], ["implementationPolicy", "implementation"], ["documentationPolicy", "documentation"]] as const;

function loaded(outcome: LoadOutcome) { assert.ok(outcome.ok, JSON.stringify(outcome).slice(0, 2000)); return outcome.loaded; }
function fleet(document: RoutingDocument): FleetRoutingConfiguration {
  const narrowed = fleetRouting(document);
  assert.ok(narrowed.ok, JSON.stringify(narrowed));
  return narrowed.configuration;
}
const loadedF = loaded(parseRoutingDocument(textF, "fixture-f"));
const F = fleet(loadedF.configuration);
/** A fresh mutable copy per case: no mutation of one row can reach another. */
function documentF(): any { return JSON.parse(textF); }

/** A tailored project document. Two roles, two families, two seams, nothing F names. */
function documentT(): any {
  return {
    schemaVersion: 2, name: "tailored-two-role",
    families: ["alpha", "beta"],
    efforts: { ordered: ["one", "two"], unordered: ["automatic"] },
    capabilities: [],
    providers: { cli: { description: "a vendor command line" }, local: {} },
    providerPrecedence: ["cli", "local"],
    profiles: [], presets: [],
    models: {
      "maker-a": { family: "alpha", launches: [
        { provider: "cli", seam: "subagents", id: "maker-wire", transport: "native", harness: "codex", effortSupport: { status: "unknown" } },
      ] },
      "checker-b": { family: "beta", launches: [
        { provider: "local", seam: "llm", id: "checker-wire", transport: "native", effortSupport: {
          status: "known", supported: ["one"], unsupported: ["two"], why: "synthetic tailored evidence" } },
      ] },
    },
    roles: { make: {}, check: { certifies: "any", evaluates: ["make"] } },
    tiers: [{ tier: "only",
      cells: { make: [{ model: "maker-a", effort: "one" }], check: [{ model: "checker-b", effort: "one" }] },
      loops: { make: { maxRounds: 0, reSteerSameSession: false } } }],
    coordinators: {},
    lanes: [{ lane: "assemble_only", tier: "only", role: "make" }],
    policy: { maxFallbackDepth: 1, ownerOverride: { evidence: ["worklog"] } },
    placements: { backends: ["local-runner"], entries: [{ model: "checker-wire", backend: "local-runner", verdict: "runs", why: "synthetic tailored evidence" }] },
  };
}

function validate(value: unknown): LoadOutcome {
  const result = validateRoutingConfiguration(value);
  return result.ok ? parseRoutingDocument(JSON.stringify(value), "fixture") : result;
}
function refused(outcome: LoadOutcome, kind: string, code?: string, path?: string) {
  assert.ok(!outcome.ok, `expected a refusal, got ${JSON.stringify(outcome).slice(0, 400)}`);
  assert.equal(outcome.refusal.kind, kind, JSON.stringify(outcome.refusal).slice(0, 600));
  if (code !== undefined) {
    assert.ok("problems" in outcome.refusal, JSON.stringify(outcome.refusal));
    assert.ok(outcome.refusal.problems.some(p => p.code === code && (path === undefined || ("path" in p ? p.path : p.lane) === path)),
      JSON.stringify(outcome.refusal.problems).slice(0, 1200));
  }
  return outcome.refusal;
}
/** Index helpers so no path in this file hardcodes a position the fixture could reorder. */
const mi = (v: any, model: string): number => Object.keys(v.models).indexOf(model);
const ri = (v: any, role: string): number => Object.keys(v.roles).indexOf(role);
const ti = (v: any, tier: string): number => v.tiers.findIndex((t: any) => t.tier === tier);
function frozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  assert.ok(Object.isFrozen(value));
  Object.values(value).forEach(frozen);
}

/* ── T-F1 the fixture loads, and the boundary answers both ways ─────────────────────────────── */

describe("the fleet-shaped document loads and narrows", () => {
  it("loads with its own identity, digest and byte count, frozen at every depth", () => {
    assert.equal(loadedF.source.schemaVersion, 2);
    assert.equal(loadedF.source.name, "fixture-fleet-shaped-8ba53bc");
    assert.equal(loadedF.source.bytes, Buffer.byteLength(textF, "utf8"));
    assert.equal(loadedF.source.digest, `sha256:${createHash("sha256").update(textF, "utf8").digest("hex")}`);
    frozen(F);
    assert.deepEqual(checkFleetPolicy(F), []);
  });
  it("loads identically from disk, and by version only", async () => {
    const fromDisk = loaded(await loadRoutingConfiguration({ path: pathF }));
    assert.deepEqual(fromDisk.configuration, F);
    assert.equal(fromDisk.source.digest, loadedF.source.digest);
  });
  it("gives a lane consumer a coded refusal and a fleet consumer the identical object", () => {
    const narrowed = fleetRouting(loadedF.configuration);
    assert.ok(narrowed.ok);
    assert.equal(narrowed.configuration, F);
    const lanes = laneRouting(loadedF.configuration);
    assert.ok(!lanes.ok);
    assert.deepEqual(lanes.refusal, { kind: "unsupported-by-consumer", schemaVersion: 2, requires: "lane-chains" });
    assert.equal(placementsOf(loadedF.configuration), F.placements);
  });
});

/* ── T-F2 every exported dimension equals the CLI file ──────────────────────────────────────── */

describe("the document equals the CLI export on every exported dimension", () => {
  it("keeps tier names, order and descriptions", () => {
    assert.deepEqual(fleetTierNames(F), X.tiers.map(t => t.tier));
    for (const t of X.tiers) assert.equal(fleetTier(F, t.tier)?.description, t.description);
  });
  it("keeps every cell's ordered candidates, per role, including empties and repeats", () => {
    let cells = 0;
    let candidates = 0;
    for (const t of X.tiers) for (const role of cliRoles(t)) {
      const cell = cellOf(F, t.tier, role);
      assert.deepEqual(cell, t[role], `${t.tier}/${role}`);
      cells += 1;
      candidates += (t[role] as readonly unknown[]).length;
    }
    // The export's own shape, asserted so a fixture that silently dropped a cell cannot pass.
    assert.equal(cells, 40);
    assert.equal(candidates, 76);
  });
  it("maps the three CLI policy keys onto loops, value for value and type for type", () => {
    for (const t of X.tiers) for (const [cliKey, role] of cliPolicyKeys) {
      const policy = loopOf(F, t.tier, role);
      assert.deepEqual(policy, t[cliKey], `${t.tier}/${role}`);
      for (const [key, value] of Object.entries(t[cliKey])) {
        assert.equal(typeof (policy as unknown as Record<string, unknown>)[key], typeof value, `${t.tier}/${role}/${key}`);
      }
    }
  });
  it("keeps coordinators by scope and provider precedence verbatim", () => {
    assert.deepEqual(coordinatorCandidates(F), X.coordinators);
    assert.deepEqual(providerPrecedenceOf(F), X.transportPriority);
    for (const scope of Object.keys(X.coordinators)) assert.deepEqual(coordinatorsFor(F, scope), X.coordinators[scope]);
    assert.equal(coordinatorsFor(F, "not-a-scope"), null);
  });
  it("references exactly the model keys the export references, and no others", () => {
    const exported = new Set<string>();
    for (const t of X.tiers) for (const role of cliRoles(t)) for (const c of t[role] as readonly CliCandidate[]) exported.add(c.model);
    for (const cell of Object.values(X.coordinators)) for (const c of cell) exported.add(c.model);
    const referenced = new Set<string>();
    for (const t of F.tiers) for (const cell of Object.values(t.cells)) for (const c of cell) referenced.add(c.model);
    for (const cell of Object.values(F.coordinators)) for (const c of cell) referenced.add(c.model);
    assert.deepEqual([...referenced].sort(), [...exported].sort());
    assert.deepEqual(fleetModelKeys(F).slice().sort(), [...exported].sort());
  });
});

/* ── T-F3 the non-numeric policy states survive as words ────────────────────────────────────── */

describe("nonnumeric policy states are preserved, not replaced by caps", () => {
  it("keeps every word the export printed as the same word, and every number as a number", () => {
    let words = 0;
    for (const t of X.tiers) for (const [cliKey, role] of cliPolicyKeys) {
      const policy = loopOf(F, t.tier, role) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(t[cliKey])) {
        assert.equal(policy[key], value);
        if (typeof value === "string") { words += 1; assert.equal(typeof policy[key], "string"); }
      }
    }
    // `none`, `unspecified_by_owner` and `immediate` in the fresh export. Nothing mapped to 0 or ∞.
    assert.equal(words, 3);
  });
  const rows: readonly [string, (v: any) => void, string, string][] = [
    ["a numeric cap as a string", v => { v.tiers[0].loops.documentation.maxRounds = "3"; }, "out-of-range", "tiers[0].loops[2].maxRounds"],
    ["an invented cap word", v => { v.tiers[0].loops.plan.maxRounds = "unlimited"; }, "out-of-range", "tiers[0].loops[0].maxRounds"],
    ["a round word in a repair field", v => { v.tiers[2].loops.plan.repairInFlightAt = "none"; }, "out-of-range", "tiers[2].loops[0].repairInFlightAt"],
    ["a repair word in a threshold field", v => { v.tiers[2].loops.plan.notifyOwnerAfter = "immediate"; }, "out-of-range", "tiers[2].loops[0].notifyOwnerAfter"],
    ["a negative cap", v => { v.tiers[0].loops.documentation.maxRounds = -1; }, "out-of-range", "tiers[0].loops[2].maxRounds"],
    ["a fractional cap", v => { v.tiers[0].loops.documentation.maxRounds = 1.5; }, "out-of-range", "tiers[0].loops[2].maxRounds"],
    ["an unsafe integer cap", v => { v.tiers[0].loops.documentation.maxRounds = 2 ** 53; }, "out-of-range", "tiers[0].loops[2].maxRounds"],
    ["a same-session flag as a string", v => { v.tiers[0].loops.plan.reSteerSameSession = "true"; }, "wrong-type", "tiers[0].loops[0].reSteerSameSession"],
    ["an unknown policy key", v => { v.tiers[0].loops.plan.maxRepairs = 2; }, "unknown-key", "tiers[0].loops[0][2]"],
    ["a policy for an evaluation role", v => { v.tiers[0].loops.plan_evaluation = { maxRounds: 1, reSteerSameSession: true }; }, "dangling-reference", "tiers[0].loops[3]"],
    ["a policy for an undeclared role", v => { v.tiers[0].loops.invented = { maxRounds: 1, reSteerSameSession: true }; }, "dangling-reference", "tiers[0].loops[3]"],
    ["a cap without a same-session rule", v => { delete v.tiers[0].loops.plan.reSteerSameSession; }, "missing-key", "tiers[0].loops[0].reSteerSameSession"],
  ];
  for (const [name, mutate, code, path] of rows) it(`refuses ${name}`, () => {
    const v = documentF(); mutate(v); refused(validate(v), "invalid", code, path);
  });
  it("accepts a policy for a role whose cell in that tier is empty", () => {
    // `simple.plan` is explicitly empty and `simple.planPolicy` exists with `maxRounds: "none"`.
    assert.deepEqual(cellOf(F, "simple", "plan"), []);
    assert.equal(loopOf(F, "simple", "plan")?.maxRounds, "none");
  });
  it("accepts a threshold above its own cap, because the export itself has one", () => {
    const architecture = loopOf(F, "architecture", "plan");
    assert.equal(architecture?.maxRounds, 1);
    assert.equal(architecture?.escalateToOwnerAt, 2);
  });
});

/* ── T-F4 empty cells and repeated candidates ───────────────────────────────────────────────── */

describe("explicitly empty cells and repeated candidates are preserved", () => {
  it("keeps both empty cells empty and frozen, and distinguishes them from an absent cell", () => {
    for (const role of ["plan", "plan_evaluation"]) {
      const cell = cellOf(F, "simple", role);
      assert.deepEqual(cell, []);
      assert.ok(Object.isFrozen(cell));
    }
    assert.equal(cellOf(F, "simple", "not-a-role"), null);
    assert.equal(cellOf(F, "not-a-tier", "plan"), null);
  });
  it("keeps the exact repeat the export prints, neither deduplicated nor refused", () => {
    const exported = X.tiers.find(t => t.tier === "complex")![("implementation_evaluation")] as readonly CliCandidate[];
    const cell = cellOf(F, "complex", "implementation_evaluation")!;
    assert.equal(cell.length, exported.length);
    assert.deepEqual(cell[0], cell[1]);
    assert.deepEqual(cell, exported);
  });
  it("accepts a tailored document whose every cell but two is empty", () => {
    const v = documentT();
    v.roles.extra = {};
    v.tiers[0].cells.extra = [];
    fleet(loaded(validate(v)).configuration);
  });
});

/* ── T-F5 the structural mutation inventory ─────────────────────────────────────────────────── */

describe("structural refusal inventory", () => {
  const rows: readonly [string, (v: any) => void, string, string | undefined][] = [
    // unknown keys, at every level, reported by index or schema-owned name — never by key value
    ["unknown root key", v => { v.extra = 1; }, "unknown-key", "$[17]"],
    ["unknown tier key", v => { v.tiers[0].extra = 1; }, "unknown-key", "tiers[0][4]"],
    ["unknown candidate key", v => { v.tiers[0].cells.implementation[0].when = []; }, "unknown-key", "tiers[0].cells[0][0].when"],
    ["unknown launch key", v => { v.models.astra.launches[0].extra = 1; }, "unknown-key", undefined],
    ["unknown role key", v => { v.roles.plan.extra = 1; }, "unknown-key", "roles[2][0]"],
    ["unknown selection key", v => { v.roles.ui_ux.selection.extra = 1; }, "unknown-key", "roles[1].selection[2]"],
    ["unknown authorization key", v => { v.tiers[3].authorization.extra = 1; }, "unknown-key", "tiers[3].authorization[1]"],
    ["unknown policy key", v => { v.policy.extra = 1; }, "unknown-key", "policy[2]"],
    ["unknown override key", v => { v.policy.ownerOverride.extra = 1; }, "unknown-key", "policy.ownerOverride[1]"],
    ["unknown provider key", v => { v.providers.claude.seam = "llm"; }, "unknown-key", "providers[0].seam"],
    ["a cell for an undeclared role", v => { v.tiers[0].cells.invented = []; }, "unknown-key", "tiers[0].cells[8]"],
    ["a harness on an llm-seam launch", v => { v.models.qwen_3_8_flash_next.launches[0].harness = "claude"; }, "unknown-key", undefined],
    ["a router on an llm-seam launch", v => { v.models.qwen_3_8_flash_next.launches[0].router = "openrouter"; }, "unknown-key", undefined],
    ["a profile on an llm-seam launch", v => { v.models.qwen_3_8_flash_next.launches[0].profile = "relay-profile"; }, "unknown-key", undefined],
    ["a preset on an llm-seam launch", v => { v.models.qwen_3_8_flash_next.launches[0].preset = "relay-preset"; }, "unknown-key", undefined],
    ["a supported list on an unknown launch", v => { v.models.astra.launches[0].effortSupport.supported = ["low"]; }, "unknown-key", undefined],
    ["an unsupported list on an unknown launch", v => { v.models.astra.launches[0].effortSupport.unsupported = ["low"]; }, "unknown-key", undefined],
    ["evaluates without certifies", v => { v.roles.plan.evaluates = ["implementation"]; }, "unknown-key", "roles[2].evaluates"],
    // missing required keys, once each, with no twin at the same path
    ["a missing root section", v => { delete v.roles; }, "missing-key", "roles"],
    ["a missing tier cell set", v => { delete v.tiers[0].cells; }, "missing-key", "tiers[0].cells"],
    ["a missing role cell", v => { delete v.tiers[0].cells.deep_research; }, "missing-key", "tiers[0].cells[7]"],
    ["a missing candidate effort", v => { delete v.tiers[0].cells.implementation[0].effort; }, "missing-key", "tiers[0].cells[0][0].effort"],
    ["a missing launch seam", v => { delete v.models.astra.launches[0].seam; }, "missing-key", undefined],
    ["a missing launch effort evidence", v => { delete v.models.astra.launches[0].effortSupport; }, "missing-key", undefined],
    ["a missing harness on a subagents-seam launch", v => { delete v.models.astra.launches[0].harness; }, "missing-key", undefined],
    ["a known launch without a supported list", v => { delete v.models.muse_spark_1_3.launches[1].effortSupport.supported; }, "missing-key", undefined],
    ["a known launch without a reason", v => { delete v.models.muse_spark_1_3.launches[1].effortSupport.why; }, "missing-key", undefined],
    ["a gate without an evaluates list", v => { delete v.roles.plan_evaluation.evaluates; }, "missing-key", "roles[3].evaluates"],
    ["a missing override evidence list", v => { delete v.policy.ownerOverride.evidence; }, "missing-key", "policy.ownerOverride.evidence"],
    ["a missing selection fallback", v => { delete v.roles.ui_ux.selection.otherwise; }, "missing-key", "roles[1].selection.otherwise"],
    // wrong types
    ["cells that are not an object", v => { v.tiers[0].cells = []; }, "wrong-type", "tiers[0].cells"],
    ["a cell that is not an array", v => { v.tiers[0].cells.plan = {}; }, "wrong-type", "tiers[0].cells[2]"],
    ["a candidate that is not an object", v => { v.tiers[0].cells.implementation[0] = "luna"; }, "wrong-type", "tiers[0].cells[0][0]"],
    ["providers that are not an object", v => { v.providers = []; }, "wrong-type", "providers"],
    ["a provider description that is not a string", v => { v.providers.claude.description = 1; }, "wrong-type", "providers[0].description"],
    ["a tier description that is not a string", v => { v.tiers[0].description = 1; }, "wrong-type", "tiers[0].description"],
    ["a relay approval that is not true", v => { v.models.muse_spark_1_3.approvedRelayEvaluator = false; }, "wrong-type", undefined],
    ["an effort status that is not a string", v => { v.models.astra.launches[0].effortSupport.status = 1; }, "wrong-type", undefined],
    // emptiness, always explicit, never inferred
    ["no families", v => { v.families = []; }, "empty", "families"],
    ["no providers", v => { v.providers = {}; }, "empty", "providers"],
    ["no models", v => { v.models = {}; }, "empty", "models"],
    ["no roles", v => { v.roles = {}; }, "empty", "roles"],
    ["no tiers", v => { v.tiers = []; }, "empty", "tiers"],
    ["no lanes", v => { v.lanes = []; }, "empty", "lanes"],
    ["no launches for a model", v => { v.models.astra.launches = []; }, "empty", undefined],
    ["no ordered efforts", v => { v.efforts.ordered = []; }, "empty", "efforts.ordered"],
    ["no selection authority", v => { v.roles.ui_ux.selection.by = []; }, "empty", "roles[1].selection.by"],
    ["no tier authorization authority", v => { v.tiers[3].authorization.by = []; }, "empty", "tiers[3].authorization.by"],
    ["no override evidence", v => { v.policy.ownerOverride.evidence = []; }, "empty", "policy.ownerOverride.evidence"],
    ["a blank candidate model", v => { v.tiers[0].cells.implementation[0].model = "  "; }, "empty", "tiers[0].cells[0][0].model"],
    ["a blank candidate effort", v => { v.tiers[0].cells.implementation[0].effort = ""; }, "empty", "tiers[0].cells[0][0].effort"],
    ["a blank provider description", v => { v.providers.claude.description = " "; }, "empty", "providers[0].description"],
    // duplicates
    ["a duplicate tier", v => { v.tiers.push(structuredClone(v.tiers[0])); }, "duplicate", "tiers[5].tier"],
    ["a duplicate lane", v => { v.lanes.push(structuredClone(v.lanes[0])); }, "duplicate", "lanes[9].lane"],
    ["a duplicate precedence entry", v => { v.providerPrecedence.push("claude"); }, "duplicate", "providerPrecedence[7]"],
    ["a duplicate evaluates entry", v => { v.roles.implementation_evaluation.evaluates.push("implementation"); }, "duplicate", "roles[4].evaluates[2]"],
    ["a duplicate requires entry", v => { v.roles.vision_evaluation.requires.push("vision"); }, "duplicate", "roles[5].requires[1]"],
    ["a duplicate capability", v => { v.capabilities.push("vision"); }, "duplicate", "capabilities[2]"],
    ["a duplicate selection authority", v => { v.roles.ui_ux.selection.by.push("owner"); }, "duplicate", "roles[1].selection.by[1]"],
    ["an effort in both effort lists", v => { v.efforts.unordered.push("max"); }, "duplicate", "efforts.unordered[1]"],
    ["the same launch identity twice in one model", v => { v.models.astra.launches.push(structuredClone(v.models.astra.launches[0])); }, "duplicate", undefined],
    ["the same launch identity in two models", v => { v.models.sol.launches[0].id = "synthetic-astra"; v.models.sol.launches[0].provider = "codex"; }, "duplicate", undefined],
    ["an effort both supported and unsupported", v => { v.models.muse_spark_1_3.launches[1].effortSupport.unsupported.push("low"); }, "duplicate", undefined],
    ["a duplicate placement pair", v => { v.placements.entries.push(structuredClone(v.placements.entries[0])); }, "duplicate", "placements.entries[1]"],
    // dangling references
    ["a candidate model nothing declares", v => { v.tiers[0].cells.implementation[0].model = "absent"; }, "dangling-reference", "tiers[0].cells[0][0].model"],
    ["a candidate effort nothing declares", v => { v.tiers[0].cells.implementation[0].effort = "absent"; }, "dangling-reference", "tiers[0].cells[0][0].effort"],
    ["a coordinator candidate nothing declares", v => { v.coordinators.milestone[0].model = "absent"; }, "dangling-reference", "coordinators[3][0].model"],
    ["a model family nothing declares", v => { v.models.astra.family = "absent"; }, "dangling-reference", undefined],
    ["a model capability nothing declares", v => { v.models.fable_5_1.capabilities = ["absent"]; }, "dangling-reference", undefined],
    ["a launch provider nothing declares", v => { v.models.astra.launches[0].provider = "absent"; }, "dangling-reference", undefined],
    ["a launch seam that is not a seam", v => { v.models.astra.launches[0].seam = "relay"; }, "dangling-reference", undefined],
    ["a launch harness nothing declares", v => { v.models.astra.launches[0].harness = "absent"; }, "dangling-reference", undefined],
    ["a launch profile nothing declares", v => { v.models.qwen_3_8_max.launches[0].profile = "absent"; }, "dangling-reference", undefined],
    ["a launch preset nothing declares", v => { v.models.qwen_3_8_max.launches[0].preset = "absent"; }, "dangling-reference", undefined],
    ["a launch subscription state nothing declares", v => { v.models.fable_5_1.launches[0].subscription = "absent"; }, "dangling-reference", undefined],
    ["a supported effort nothing declares", v => { v.models.muse_spark_1_3.launches[1].effortSupport.supported = ["absent"]; }, "dangling-reference", undefined],
    ["an effort support status nothing declares", v => { v.models.astra.launches[0].effortSupport.status = "maybe"; }, "dangling-reference", undefined],
    ["an evaluates entry nothing declares", v => { v.roles.plan_evaluation.evaluates = ["absent"]; }, "dangling-reference", "roles[3].evaluates[0]"],
    ["a requires entry nothing declares", v => { v.roles.vision_evaluation.requires = ["absent"]; }, "dangling-reference", "roles[5].requires[0]"],
    ["a restriction seam nothing declares", v => { v.roles.deep_research.restrictions.seams = ["cli"]; }, "dangling-reference", "roles[7].restrictions.seams[0]"],
    ["a restriction transport nothing declares", v => { v.roles.deep_research.restrictions.transports = ["absent"]; }, "dangling-reference", "roles[7].restrictions.transports[0]"],
    ["a restriction harness nothing declares", v => { v.roles.deep_research.restrictions.harnesses = ["absent"]; }, "dangling-reference", "roles[7].restrictions.harnesses[0]"],
    ["a restriction provider nothing declares", v => { v.roles.deep_research.restrictions.providers = ["absent"]; }, "dangling-reference", "roles[7].restrictions.providers[0]"],
    ["a restriction family nothing declares", v => { v.roles.deep_research.restrictions.families = ["absent"]; }, "dangling-reference", "roles[7].restrictions.families[0]"],
    ["a restriction model nothing declares", v => { v.roles.deep_research.restrictions.models = ["absent"]; }, "dangling-reference", "roles[7].restrictions.models[0]"],
    ["a selection authority nothing declares", v => { v.roles.ui_ux.selection.by = ["absent"]; }, "dangling-reference", "roles[1].selection.by[0]"],
    ["a selection fallback nothing declares", v => { v.roles.ui_ux.selection.otherwise = "absent"; }, "dangling-reference", "roles[1].selection.otherwise"],
    ["a tier authorization authority nothing declares", v => { v.tiers[3].authorization.by = ["absent"]; }, "dangling-reference", "tiers[3].authorization.by[0]"],
    ["a lane tier nothing declares", v => { v.lanes[0].tier = "absent"; }, "dangling-reference", "lanes[0].tier"],
    ["a lane role nothing declares", v => { v.lanes[0].role = "absent"; }, "dangling-reference", "lanes[0].role"],
    ["a precedence entry nothing declares", v => { v.providerPrecedence[0] = "absent"; }, "dangling-reference", "providerPrecedence[0]"],
    ["a declared provider absent from precedence", v => { v.providerPrecedence.shift(); }, "dangling-reference", "providerPrecedence"],
    ["a certifies naming a family instead of a keyword", v => { v.roles.plan_evaluation.certifies = "anthropic"; }, "dangling-reference", "roles[3].certifies"],
    ["a placement model that is not an llm-seam launch id", v => { v.placements.entries[0].model = "synthetic-astra"; }, "dangling-reference", "placements.entries[0].model"],
    ["a placement backend nothing declares", v => { v.placements.entries[0].backend = "absent"; }, "dangling-reference", "placements.entries[0].backend"],
    ["a placement that is not total over the declared backends", v => { v.placements.backends.push("second-backend"); }, "dangling-reference", "placements.entries"],
    ["an override evidence kind nothing interprets", v => { v.policy.ownerOverride.evidence = ["verbal"]; }, "dangling-reference", "policy.ownerOverride.evidence[0]"],
    // reserved names
    ["a family named for a certifies keyword", v => { v.families.push("any"); }, "reserved-name", "families[7]"],
    ["a family named none", v => { v.families.push("none"); }, "reserved-name", "families[7]"],
    ["a coordinator scope named for the owner authority", v => { v.coordinators.owner = []; }, "reserved-name", "coordinators[4]"],
    // out of range
    ["a document name with an underscore", v => { v.name = "fixture_fleet"; }, "out-of-range", "name"],
    ["a model key with a capital", v => { v.models.Astra = v.models.astra; delete v.models.astra; }, "out-of-range", undefined],
    ["a role name with a capital", v => { v.roles.Plan = v.roles.plan; delete v.roles.plan; }, "out-of-range", undefined],
    ["a tier name with a hyphen", v => { v.tiers[0].tier = "very-simple"; }, "out-of-range", "tiers[0].tier"],
    ["a lane name with a hyphen", v => { v.lanes[0].lane = "simple-implementation"; }, "out-of-range", "lanes[0].lane"],
    ["a coordinator scope with a hyphen", v => { v.coordinators["small-project"] = v.coordinators.small_project; delete v.coordinators.small_project; }, "out-of-range", undefined],
    ["a provider name with a hyphen", v => { v.providers["github-copilot"] = {}; delete v.providers.github_copilot; v.providerPrecedence[3] = "github-copilot"; }, "out-of-range", undefined],
    ["a launch id with whitespace", v => { v.models.astra.launches[0].id = "synthetic astra"; }, "out-of-range", undefined],
    ["a launch id over 256 characters", v => { v.models.astra.launches[0].id = "a".repeat(257); }, "out-of-range", undefined],
    ["a negative fallback depth", v => { v.policy.maxFallbackDepth = -1; }, "out-of-range", "policy.maxFallbackDepth"],
    ["a gate evaluating itself", v => { v.roles.plan_evaluation.evaluates = ["plan_evaluation"]; }, "out-of-range", "roles[3].evaluates[0]"],
    ["a gate evaluating another gate", v => { v.roles.plan_evaluation.evaluates = ["implementation_evaluation"]; }, "out-of-range", "roles[3].evaluates[0]"],
    ["a selection falling back to itself", v => { v.roles.ui_ux.selection.otherwise = "ui_ux"; }, "out-of-range", "roles[1].selection.otherwise"],
    ["a selection falling back to a gate", v => { v.roles.ui_ux.selection.otherwise = "plan_evaluation"; }, "out-of-range", "roles[1].selection.otherwise"],
    ["a selection falling back to another owner-selected role", v => {
      v.roles.documentation.selection = { by: ["owner"], otherwise: "implementation" };
      v.roles.ui_ux.selection.otherwise = "documentation";
    }, "out-of-range", "roles[1].selection.otherwise"],
    ["an empty reason on known effort evidence", v => { v.models.muse_spark_1_3.launches[1].effortSupport.why = ""; }, "empty", undefined],
  ];
  for (const [name, mutate, code, path] of rows) it(`refuses ${name}`, () => {
    const v = documentF(); mutate(v); refused(validate(v), "invalid", code, path);
  });
  it("covers every structural code a version-2 document can produce", () => {
    const produced = new Set(rows.map(([, , code]) => code));
    // The three excluded codes are bounds and plain-data refusals, proven in the hostile-input suite.
    for (const code of ["unknown-key", "missing-key", "wrong-type", "empty", "duplicate", "dangling-reference", "reserved-name", "out-of-range"]) {
      assert.ok(produced.has(code), code);
    }
  });
  it("has no dead row: the untouched fixture loads and every mutation changes the outcome", () => {
    assert.ok(validate(documentF()).ok);
    for (const [name, mutate] of rows) {
      const v = documentF(); mutate(v);
      assert.ok(!validate(v).ok, `row does not change the outcome: ${name}`);
    }
  });
  it("reports a launch defect at the launch's own structural path", () => {
    const v = documentF(); delete v.models.astra.launches[0].harness;
    refused(validate(v), "invalid", "missing-key", `models[${mi(v, "astra")}].launches[0].harness`);
  });
  it("reports an effort-evidence contradiction at the effort-evidence path", () => {
    const v = documentF(); v.models.astra.launches[0].effortSupport.supported = ["low"];
    refused(validate(v), "invalid", "unknown-key", `models[${mi(v, "astra")}].launches[0].effortSupport.supported`);
  });
});

/* ── T-F6 the invariant inventory ───────────────────────────────────────────────────────────── */

describe("static invariant inventory", () => {
  const rows: readonly [string, (v: any) => void, string][] = [
    ["a lane onto an explicitly empty cell", v => { v.lanes.push({ lane: "simple_plan", tier: "simple", role: "plan" }); }, "lane-unrouted"],
    ["a gate whose every candidate shares the generator's family", v => {
      // Rebind both architecture plan_evaluation candidates to the family of a plan candidate.
      v.models.muse_spark_1_3.family = "anthropic";
      v.models.grok_4_6.family = "anthropic";
      v.tiers[4].cells.plan = [{ model: "fable_5_1", effort: "xhigh" }];
    }, "no-independent-evaluator"],
    ["a non-empty generation cell whose gate cell is empty", v => { v.tiers[4].cells.plan_evaluation = []; }, "no-independent-evaluator"],
    ["an evaluator that is different-family but lacks the role's capability", v => {
      v.roles.plan_evaluation.requires = ["vision"];
    }, "no-independent-evaluator"],
    ["an evaluator whose only restriction-satisfying launch is an unapproved relay", v => {
      // The evaluator's model keeps an unrelated native launch; the role admits only the relay.
      v.roles.plan_evaluation.restrictions = { transports: ["openrouter"] };
      v.models.grok_4_6.launches.push({ provider: "openrouter", seam: "subagents", id: "synthetic/grok-relay", transport: "openrouter", harness: "claude", profile: "relay-profile", effortSupport: { status: "unknown" } });
      delete v.models.muse_spark_1_3.approvedRelayEvaluator;
    }, "relay-evaluator-unapproved"],
    ["a candidate whose model lacks a capability its role requires", v => { delete v.models.kimi_k3.capabilities; }, "capability-unsatisfied"],
    ["a candidate whose model has no launch satisfying its role", v => {
      v.roles.deep_research.restrictions.harnesses = ["opencode"];
    }, "constraint-violated"],
    ["an evaluation candidate reachable only over an unapproved relay", v => { delete v.models.muse_spark_1_3.approvedRelayEvaluator; }, "relay-evaluator-unapproved"],
    ["a candidate whose every role-feasible launch declares its effort unsupported", v => {
      // Muse is asked for `max` in four cells; declare `max` unsupported on both of its launches.
      v.models.muse_spark_1_3.launches[0].effortSupport = { status: "known", supported: ["xhigh"], unsupported: ["max"], why: "synthetic" };
    }, "effort-unsupported"],
    ["a coordinator candidate whose every launch declares its effort unsupported", v => {
      v.models.opus_5.launches[0].effortSupport = { status: "known", supported: ["medium"], unsupported: ["low"], why: "synthetic" };
    }, "effort-unsupported"],
    ["a candidate whose only approved launch declares its effort unsupported", v => {
      // Both launches satisfy the role (it declares no restrictions). The native one is approved and
      // refuses `max`; the relay one leaves `max` unknown but carries no approval. Judging approval
      // across launches instead of on the launch would read this document as routable.
      delete v.models.muse_spark_1_3.approvedRelayEvaluator;
      v.models.muse_spark_1_3.launches[1] = { provider: "claude", seam: "subagents", id: "synthetic-muse-native", transport: "native", harness: "claude",
        effortSupport: { status: "known", supported: ["xhigh"], unsupported: ["max"], why: "synthetic" } };
    }, "effort-unsupported"],
    ["an opencode launch with no router", v => { delete v.models.glm_5_3.launches[0].router; }, "opencode-without-router"],
    ["a router on a launch that is not opencode", v => { v.models.astra.launches[0].router = "openai"; }, "router-outside-opencode"],
    ["a subagents relay that is not opencode and names no profile", v => { delete v.models.qwen_3_8_max.launches[0].profile; }, "relay-without-profile"],
  ];
  for (const [name, mutate, code] of rows) it(`refuses ${name}`, () => {
    const v = documentF(); mutate(v);
    refused(validate(v), "invariant", code);
  });
  it("covers all three version-2 invariant codes and the six it reuses", () => {
    const produced = new Set(rows.map(([, , code]) => code));
    for (const code of ["no-independent-evaluator", "capability-unsatisfied", "effort-unsupported",
      "lane-unrouted", "constraint-violated", "relay-evaluator-unapproved",
      "opencode-without-router", "router-outside-opencode", "relay-without-profile"]) assert.ok(produced.has(code), code);
  });
  it("locates a refused candidate by its cell and its index in that cell", () => {
    const v = documentF(); delete v.models.kimi_k3.capabilities;
    const refusal = refused(validate(v), "invariant", "capability-unsatisfied");
    assert.ok("problems" in refusal);
    const problem = refusal.problems.find(p => p.code === "capability-unsatisfied");
    assert.ok(problem !== undefined && "lane" in problem);
    // `simple.vision_evaluation` does not seat kimi; `straightforward.vision_evaluation` seats it second.
    assert.equal(problem.lane, `tiers[${ti(v, "straightforward")}].cells[${ri(v, "vision_evaluation")}]`);
    assert.equal(problem.index, 1);
  });
  it("gives one candidate exactly one problem, in precedence order", () => {
    // Capability first: the same candidate also has no restriction-satisfying launch.
    const v = documentF();
    delete v.models.gemini_3_8_flash.capabilities;
    v.roles.deep_research.restrictions.harnesses = ["opencode"];
    const refusal = refused(validate(v), "invariant");
    assert.ok("problems" in refusal);
    const research = refusal.problems.filter(p => "lane" in p && p.lane.endsWith(`.cells[${ri(v, "deep_research")}]`) && p.index === 0);
    assert.deepEqual([...new Set(research.map(p => p.code))], ["capability-unsatisfied"]);
  });
  it("refuses the generator too when every different-family evaluator has no feasible launch", () => {
    // The evaluator counter-example: a candidate whose model keeps an unrelated native launch while
    // the role admits only an unapproved relay. Family inequality alone would read it as
    // independent, so the generator must be refused as well as the evaluator that cannot run.
    const v = documentF();
    v.roles.plan_evaluation.restrictions = { transports: ["openrouter"] };
    v.models.grok_4_6.launches.push({ provider: "openrouter", seam: "subagents", id: "synthetic/grok-relay", transport: "openrouter", harness: "claude", profile: "relay-profile", effortSupport: { status: "unknown" } });
    delete v.models.muse_spark_1_3.approvedRelayEvaluator;
    const refusal = refused(validate(v), "invariant");
    assert.ok("problems" in refusal);
    const gate = `cells[${ri(v, "plan_evaluation")}]`;
    const generator = `cells[${ri(v, "plan")}]`;
    const codes = (suffix: string) => new Set(refusal.problems.filter(p => "lane" in p && p.lane.endsWith(suffix)).map(p => p.code));
    assert.ok(codes(gate).has("relay-evaluator-unapproved"));
    // The gate's own candidates are refused in their own cells, by whichever clause fails first.
    for (const code of codes(gate)) assert.ok(["constraint-violated", "relay-evaluator-unapproved"].includes(code), code);
    assert.deepEqual([...codes(generator)], ["no-independent-evaluator"]);
    // One problem per refused candidate, in exactly the tiers whose gate cell has nobody feasible.
    // `feature` survives: its gate seats GLM 5.3, whose relay launch the document does approve.
    const refusedIn = (tier: string): number => refusal.problems.filter(p =>
      "lane" in p && p.lane === `tiers[${ti(v, tier)}].${generator}`).length;
    for (const tier of ["simple", "straightforward", "complex", "architecture"]) {
      assert.equal(refusedIn(tier), v.tiers[ti(v, tier)].cells.plan.length, tier);
    }
    assert.equal(refusedIn("feature"), 0);
    assert.equal(v.tiers[ti(v, "feature")].cells.plan.length, 2);
    // Restoring both the approval and the unrestricted role restores the whole document; restoring
    // only the approval does not, because the restriction alone strands other gate candidates.
    v.models.muse_spark_1_3.approvedRelayEvaluator = true;
    assert.ok(!validate(v).ok);
    delete v.roles.plan_evaluation.restrictions;
    assert.ok(validate(v).ok, JSON.stringify(validate(v)).slice(0, 800));
  });
  it("does not gate on a certifies:none role, whatever families its candidates share", () => {
    // Vision evaluation is supplementary evidence. Binding it to the ui_ux family is not a defect.
    const v = documentF();
    for (const key of ["kimi_k3", "minimax_m3", "gemini_3_8_flash", "deepseek_v4_flash_vision", "muse_spark_1_3", "fable_5_1"]) {
      v.models[key].family = "anthropic";
    }
    // Only the two `certifies: any` gates may refuse; prove the refusal never names vision.
    const outcome = validate(v);
    if (!outcome.ok && "problems" in outcome.refusal) {
      for (const problem of outcome.refusal.problems) {
        if ("lane" in problem) assert.ok(!problem.lane.endsWith(`.cells[${ri(v, "vision_evaluation")}]`), JSON.stringify(problem));
      }
    }
  });
  it("accepts a relay-only evaluator the document approves, and an llm relay with no profile", () => {
    assert.equal(F.models.muse_spark_1_3?.approvedRelayEvaluator, true);
    assert.deepEqual(launchesOf(F, "muse_spark_1_3").map(l => l.transport), ["openrouter", "openrouter"]);
    assert.equal(launchesOf(F, "muse_spark_1_3", { seam: "llm" })[0]?.profile, undefined);
    assert.deepEqual(checkFleetPolicy(F), []);
  });
  it("accepts a relay-only evaluator once a native launch exists instead of an approval", () => {
    const v = documentF();
    delete v.models.muse_spark_1_3.approvedRelayEvaluator;
    v.models.muse_spark_1_3.launches.push({ provider: "claude", seam: "subagents", id: "synthetic-muse-native", transport: "native", harness: "claude", effortSupport: { status: "unknown" } });
    assert.ok(validate(v).ok, JSON.stringify(validate(v)).slice(0, 800));
  });
  it("keeps a candidate admissible when one role-feasible launch leaves its effort unknown", () => {
    const v = documentF();
    v.models.muse_spark_1_3.launches[0].effortSupport = { status: "known", supported: ["xhigh"], unsupported: ["max"], why: "synthetic" };
    refused(validate(v), "invariant", "effort-unsupported");
    v.models.muse_spark_1_3.launches[0].effortSupport = { status: "unknown" };
    assert.ok(validate(v).ok);
  });
  it("ignores an unsupported declaration on a launch the role cannot use", () => {
    const v = documentF();
    // Gemini's relay launch is outside `deep_research`'s restrictions, so its refusal is irrelevant.
    v.models.gemini_3_8_flash.launches.push({ provider: "openrouter", seam: "llm", id: "synthetic/gemini-relay", transport: "openrouter", effortSupport: { status: "known", supported: [], unsupported: ["high", "medium", "low"], why: "synthetic" } });
    assert.ok(validate(v).ok, JSON.stringify(validate(v)).slice(0, 800));
  });
});

/* ── T-F15 effort evidence ──────────────────────────────────────────────────────────────────── */

describe("effort evidence is declared or unknown, and never converted", () => {
  it("answers supported, unsupported and unknown for the one known launch", () => {
    assert.equal(effortEvidence(F, "muse_spark_1_3", 1, "max"), "unsupported");
    assert.equal(effortEvidence(F, "muse_spark_1_3", 1, "xhigh"), "supported");
    assert.equal(effortEvidence(F, "muse_spark_1_3", 1, "provider_default"), "unknown");
    for (const effort of [...F.efforts.ordered, ...F.efforts.unordered ?? []]) {
      assert.equal(effortEvidence(F, "muse_spark_1_3", 0, effort), "unknown");
    }
  });
  it("leaves every effort a launch does not name unknown, across the whole document", () => {
    let known = 0;
    for (const model of fleetModelKeys(F)) {
      launchesOf(F, model).forEach((launch, index) => {
        for (const effort of [...F.efforts.ordered, ...F.efforts.unordered ?? []]) {
          const verdict = effortEvidence(F, model, index, effort);
          if (launch.effortSupport.status === "unknown") assert.equal(verdict, "unknown", `${model}[${index}]/${effort}`);
          else {
            known += 1;
            const named = launch.effortSupport.supported.includes(effort) || (launch.effortSupport.unsupported ?? []).includes(effort);
            assert.equal(verdict === "unknown", !named, `${model}[${index}]/${effort}`);
          }
        }
      });
    }
    // Exactly one launch in the fixture declares anything; every other is a genuine unknown.
    assert.equal(known, 6);
  });
  it("answers unknown for a launch or model the document does not carry", () => {
    assert.equal(effortEvidence(F, "absent", 0, "max"), "unknown");
    assert.equal(effortEvidence(F, "astra", 9, "max"), "unknown");
  });
  it("exports no conversion, downgrade or ladder, and only three verdicts", () => {
    for (const name of Object.keys(fleetModule)) {
      for (const forbidden of ["convert", "downgrade", "approximate", "nearest", "ladder", "coerce"]) {
        assert.ok(!name.toLowerCase().includes(forbidden), `${name} suggests ${forbidden}`);
      }
    }
    const verdicts = new Set<string>();
    for (const model of fleetModelKeys(F)) launchesOf(F, model).forEach((_, index) => {
      for (const effort of F.efforts.ordered) verdicts.add(effortEvidence(F, model, index, effort));
    });
    for (const verdict of verdicts) assert.ok(["supported", "unsupported", "unknown"].includes(verdict), verdict);
  });
  it("accepts a known launch that declares nothing supported", () => {
    const v = documentF();
    v.models.astra.launches[0].effortSupport = { status: "known", supported: [], why: "synthetic: nothing measured yet" };
    assert.ok(validate(v).ok, JSON.stringify(validate(v)).slice(0, 800));
    const loadedV = fleet(loaded(validate(v)).configuration);
    for (const effort of loadedV.efforts.ordered) assert.equal(effortEvidence(loadedV, "astra", 0, effort), "unknown");
  });
  it("keeps a cell effort a request, not proof of support", () => {
    // The export asks for `max` where the fixture's llm launch declares `max` unsupported.
    assert.ok(cellOf(F, "complex", "implementation_evaluation")!.every(c => c.effort === "max"));
    assert.equal(effortEvidence(F, "muse_spark_1_3", 1, "max"), "unsupported");
    assert.deepEqual(checkFleetPolicy(F), []);
  });
  it("names both words of the effort-evidence vocabulary and nothing else", () => {
    assert.deepEqual([...EFFORT_SUPPORT_STATES], ["unknown", "known"]);
  });
});

/* ── T-F16 one provider, both seams ─────────────────────────────────────────────────────────── */

describe("a provider is an identity, and the seam belongs to the launch", () => {
  it("carries one provider and one wire id on both dials, distinctly", () => {
    const both = launchesOf(F, "muse_spark_1_3");
    assert.equal(both.length, 2);
    assert.equal(both[0]?.provider, both[1]?.provider);
    assert.equal(both[0]?.id, both[1]?.id);
    assert.notEqual(both[0]?.seam, both[1]?.seam);
    assert.equal(launchesOf(F, "muse_spark_1_3", { seam: "llm" }).length, 1);
    assert.equal(launchesOf(F, "muse_spark_1_3", { seam: "subagents" }).length, 1);
  });
  it("declares no seam on any provider record", () => {
    for (const identity of Object.values(F.providers)) {
      assert.deepEqual(Object.keys(identity).filter(k => k !== "description"), []);
    }
  });
  it("refuses the same provider, seam and id twice", () => {
    const v = documentF();
    v.models.muse_spark_1_3.launches[1].seam = "subagents";
    v.models.muse_spark_1_3.launches[1].harness = "claude";
    v.models.muse_spark_1_3.launches[1].profile = "relay-profile";
    refused(validate(v), "invalid", "duplicate", `models[${mi(v, "muse_spark_1_3")}].launches[1]`);
  });
  it("judges relay approval on the launch, not across an unrelated approved one", () => {
    const gate = { certifies: "any" as const, evaluates: ["plan"] };
    // As shipped, muse is approved, so both of its relay launches count.
    assert.equal(feasibleLaunches(F, "muse_spark_1_3", "xhigh", gate).length, 2);
    const v = documentF();
    delete v.models.muse_spark_1_3.approvedRelayEvaluator;
    v.models.muse_spark_1_3.launches[1] = { provider: "claude", seam: "subagents", id: "synthetic-muse-native", transport: "native", harness: "claude", effortSupport: { status: "unknown" } };
    const unapproved = fleet(loaded(validate(v)).configuration);
    // One native launch is approved by not being a relay; the relay beside it stays out.
    assert.deepEqual(feasibleLaunches(unapproved, "muse_spark_1_3", "xhigh", gate).map(l => l.transport), ["native"]);
    // With no gate the same model has two lawful launches: approval is a rule of the role, not of the model.
    assert.equal(feasibleLaunches(unapproved, "muse_spark_1_3", "xhigh", null).length, 2);
  });
  it("counts only the launches a seam restriction admits", () => {
    const restricted = { certifies: "any" as const, evaluates: ["plan"], restrictions: { seams: ["llm" as const] } };
    const llmOnly = feasibleLaunches(F, "muse_spark_1_3", "max", restricted);
    assert.deepEqual(llmOnly, []);
    assert.equal(feasibleLaunches(F, "muse_spark_1_3", "xhigh", restricted).length, 1);
    assert.equal(feasibleLaunches(F, "muse_spark_1_3", "max", null).length, 1);
  });
  it("accepts a tailored document using one provider on both seams", () => {
    const v = documentT();
    v.models["maker-a"].launches.push({ provider: "cli", seam: "llm", id: "maker-wire", transport: "native", effortSupport: { status: "unknown" } });
    v.placements.entries.push({ model: "maker-wire", backend: "local-runner", verdict: "runs", why: "synthetic tailored evidence" });
    const T = fleet(loaded(validate(v)).configuration);
    assert.equal(launchesOf(T, "maker-a").length, 2);
    assert.equal(launchesOf(T, "maker-a", { seam: "llm" })[0]?.provider, "cli");
  });
  it("provides a declared provider no launch reaches, rather than hiding it", () => {
    const reached = new Set(fleetModelKeys(F).flatMap(m => launchesOf(F, m).map(l => l.provider)));
    assert.ok(providerPrecedenceOf(F).some(name => !reached.has(name)));
    assert.deepEqual(checkFleetPolicy(F), []);
  });
});

/* ── T-F7 wholesale replacement and project isolation ───────────────────────────────────────── */

describe("wholesale replacement between two version-2 documents", () => {
  const T = fleet(loaded(validate(documentT())).configuration);
  it("knows nothing of the other document's vocabulary, in either direction", () => {
    for (const [from, to] of [[F, T], [T, F]] as const) {
      for (const model of fleetModelKeys(from)) {
        assert.equal(fleetFamilyOf(to, model), null, model);
        assert.deepEqual(launchesOf(to, model), []);
      }
      for (const role of fleetRoleNames(from)) assert.equal(roleOf(to, role), null, role);
      for (const tier of fleetTierNames(from)) assert.equal(fleetTier(to, tier), null, tier);
      for (const scope of coordinatorScopes(from)) assert.equal(coordinatorsFor(to, scope), null, scope);
      for (const lane of fleetLaneNames(from)) assert.equal(fleetLaneOf(to, lane), null, lane);
      for (const family of from.families) assert.ok(!to.families.includes(family), family);
      for (const provider of providerPrecedenceOf(from)) assert.ok(!providerPrecedenceOf(to).includes(provider), provider);
    }
  });
  it("keeps placements disjoint", () => {
    const ids = new Set(placementsOf(T).entries.map(e => e.model));
    for (const entry of placementsOf(F).entries) assert.ok(!ids.has(entry.model));
  });
  it("gives the same answers whatever the load order, and is unaffected by a mutated clone", () => {
    const before = JSON.stringify(cellOf(F, "complex", "implementation"));
    fleet(loaded(validate(documentT())).configuration);
    const again = fleet(loaded(parseRoutingDocument(textF, "fixture-f-again")).configuration);
    assert.equal(JSON.stringify(cellOf(again, "complex", "implementation")), before);
    const clone = documentF();
    clone.tiers[3].cells.implementation = [];
    assert.equal(JSON.stringify(cellOf(F, "complex", "implementation")), before);
  });
});

/* ── T-F8 hostile input at version 2 ────────────────────────────────────────────────────────── */

describe("hostile version-2 input and safe diagnostics", () => {
  it("copies no canary, key, source id or parser text into any diagnostic", () => {
    const canaries = ["sk-or-v1-" + "a".repeat(48), "Bearer " + "b".repeat(40), "-----BEGIN PRIVATE KEY-----"];
    const source = "private-source-canary";
    for (const secret of canaries) {
      const changes: ((v: any) => void)[] = [
        v => { v[secret] = 1; },
        // A wire id is free text, so this document needs an independent defect to refuse at all.
        v => { v.models.astra.launches[0].id = secret; v.policy.maxFallbackDepth = -1; },
        v => { v.providers[secret] = {}; },
        v => { v.roles[secret] = {}; },
        v => { v.tiers[0].description = secret; v.policy.maxFallbackDepth = -1; },
        v => { v.lanes[0].note = secret; v.policy.ownerOverride.evidence = []; },
        v => { v.models.astra.launches[0].effortSupport.why = secret; v.models.astra.launches[0].effortSupport.supported = ["low"]; },
      ];
      const outcomes: LoadOutcome[] = [parseRoutingDocument('{"schemaVersion":2,"tail":' + secret, source)];
      for (const change of changes) { const v = documentF(); change(v); outcomes.push(parseRoutingDocument(JSON.stringify(v), source)); }
      for (const outcome of outcomes) {
        assert.ok(!outcome.ok, JSON.stringify(outcome).slice(0, 300));
        const diagnostic = JSON.stringify(outcome.refusal) + describeLoadRefusal(outcome.refusal);
        for (const forbidden of [...canaries, source, "SyntaxError", "ENOENT", "EISDIR"]) {
          assert.ok(!diagnostic.includes(forbidden), diagnostic.slice(0, 400));
        }
      }
    }
  });
  it("refuses a reserved role name before reading any value", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      refused(parseRoutingDocument(`{"schemaVersion":2,"roles":{"${key}":{}}}`, "source"), "invalid", "reserved-name");
    }
  });
  it("enforces collection bounds and depth before any structural check", () => {
    const wide = documentF();
    wide.tiers[0].cells.implementation = Array.from({ length: MAX_MEMBERS + 1 }, () => ({ model: "astra", effort: "low" }));
    refused(validate(wide), "invalid", "size-exceeded");
    let nested: unknown = "leaf";
    for (let i = 0; i < MAX_DEPTH + 2; i++) nested = { value: nested };
    const deep = documentF();
    deep.tiers[0].cells.implementation = [nested];
    refused(parseRoutingDocument(JSON.stringify(deep), "source"), "invalid", "depth-exceeded");
  });
  it("never invokes an accessor on a version-2 value", () => {
    let calls = 0;
    const v = documentF();
    Object.defineProperty(v.models.astra, "family", { get() { calls += 1; return "anthropic"; }, enumerable: true, configurable: true });
    refused(validateRoutingConfiguration(v) as unknown as LoadOutcome, "invalid", "not-plain-data");
    assert.equal(calls, 0);
  });
});

/* ── T-F9 the version gate ──────────────────────────────────────────────────────────────────── */

describe("the version gate", () => {
  for (const schemaVersion of [3, "2", -2, 1.5]) it(`refuses version ${String(schemaVersion)} as unsupported`, () => {
    const v = documentF(); v.schemaVersion = schemaVersion;
    const refusal = refused(validate(v), "unsupported-schema-version");
    assert.deepEqual(refusal, { kind: "unsupported-schema-version", seen: Number.isSafeInteger(schemaVersion) ? schemaVersion : null, supported: [1, 2] });
  });
  it("refuses an absent version", () => {
    const v = documentF(); delete v.schemaVersion;
    assert.deepEqual(refused(validate(v), "unsupported-schema-version"), { kind: "unsupported-schema-version", seen: null, supported: [1, 2] });
  });
  it("reads 2.0 in the JSON text as 2, because a JSON number has no fractional identity", () => {
    const outcome = parseRoutingDocument(textF.replace('"schemaVersion": 2', '"schemaVersion": 2.0'), "fixture-f");
    assert.ok(outcome.ok);
    assert.equal(outcome.loaded.source.schemaVersion, 2);
  });
  it("refuses a fleet shape claiming version 1, structurally rather than by version", () => {
    const v = documentF(); v.schemaVersion = 1;
    const refusal = refused(validate(v), "invalid");
    assert.ok("problems" in refusal);
    assert.ok(refusal.problems.some(p => p.code === "missing-key" && "path" in p && p.path === "purposes"));
  });
  it("renders the supported list without a document value", () => {
    assert.equal(describeLoadRefusal({ kind: "unsupported-schema-version", seen: 7, supported: [1, 2] }),
      "unsupported-schema-version: seen 7; supported 1, 2");
  });
});

/* ── T-F11 the narrowers, T-F13 no resolution over cells, T-F14 no waiver ───────────────────── */

describe("the consumer boundary", () => {
  it("returns the identical frozen object, never a copy", () => {
    const narrowed = fleetRouting(loadedF.configuration);
    assert.ok(narrowed.ok);
    assert.equal(narrowed.configuration, loadedF.configuration);
    assert.equal(placementsOf(loadedF.configuration), F.placements);
  });
  it("refuses the other version with a code and no document value", () => {
    const lanes = laneRouting(loadedF.configuration);
    assert.ok(!lanes.ok);
    assert.equal(describeConsumerRefusal(lanes.refusal), "unsupported-by-consumer: schemaVersion 2; requires lane-chains");
    for (const value of [F.name, ...fleetModelKeys(F), ...fleetTierNames(F)]) {
      assert.ok(!describeConsumerRefusal(lanes.refusal).includes(value));
    }
  });
  /** Compiles only while no version-1 resolver accepts a fleet configuration. Never called. */
  function typeBoundary(configuration: FleetRoutingConfiguration): void {
    // @ts-expect-error a fleet configuration has no lane chains to resolve
    resolveRoute(configuration, "complex_implementation");
    // @ts-expect-error a fleet configuration has no lane chains to fall back through
    resolveFallback(configuration, { lane: "complex_implementation", from: 0, trigger: "token-limit", turnBoundary: true });
    // @ts-expect-error a fleet configuration has no implement/review tier pairs
    tierPlan(configuration, "complex");
    // @ts-expect-error a fleet configuration cannot admit a lane dispatch
    admitDispatch(configuration, { harness: "claude", prompt: "synthetic" }, { lane: "complex_implementation" });
    // @ts-expect-error a fleet configuration is not the version-1 model binding table
    checkEvaluator(configuration, { author: { runId: "a", seam: "llm", model: "astra", transport: "native" }, evaluator: { runId: "b", seam: "llm", model: "fable_5_1", transport: "native" } });
  }
  it("exposes no resolution, admission or selection over cells", () => {
    assert.equal(typeof typeBoundary, "function");
    for (const name of Object.keys(fleetModule)) {
      for (const prefix of ["resolve", "admit", "select"]) assert.ok(!name.startsWith(prefix), name);
    }
  });
  it("has no field anywhere that could waive independence", () => {
    assert.ok(!textF.toLowerCase().includes("waive"));
    for (const mutate of [
      (v: any) => { v.policy.waivesIndependence = true; },
      (v: any) => { v.policy.ownerOverride.waivesIndependence = true; },
      (v: any) => { v.roles.implementation_evaluation.independence = "waived"; },
      (v: any) => { v.tiers[3].independence = "waived"; },
    ]) { const v = documentF(); mutate(v); refused(validate(v), "invalid", "unknown-key"); }
    const selfCertify = documentF();
    selfCertify.roles.implementation_evaluation.certifies = "self";
    refused(validate(selfCertify), "invalid", "dangling-reference", `roles[${ri(selfCertify, "implementation_evaluation")}].certifies`);
  });
});

/* ── Boxes 2 and 3: the declared rules a resolver will read ─────────────────────────────────── */

describe("the declared rules version 2 has to be able to state", () => {
  it("states which roles certify, and what each certifies", () => {
    assert.equal(roleOf(F, "plan_evaluation")?.certifies, "any");
    assert.deepEqual(roleOf(F, "plan_evaluation")?.evaluates, ["plan"]);
    assert.deepEqual(roleOf(F, "implementation_evaluation")?.evaluates, ["implementation", "ui_ux"]);
    assert.equal(roleOf(F, "vision_evaluation")?.certifies, "none");
    assert.equal(roleOf(F, "implementation")?.certifies, undefined);
  });
  it("restricts deep research to native subagents launches on the named harnesses", () => {
    const restrictions = roleOf(F, "deep_research")?.restrictions;
    assert.deepEqual(restrictions?.seams, ["subagents"]);
    assert.deepEqual(restrictions?.transports, ["native"]);
    assert.ok((restrictions?.harnesses ?? []).length > 0);
    for (const t of F.tiers) for (const candidate of t.cells.deep_research ?? []) {
      assert.ok(capableOf(F, candidate.model, roleOf(F, "deep_research")), candidate.model);
      const launches = feasibleLaunches(F, candidate.model, candidate.effort, roleOf(F, "deep_research"));
      assert.ok(launches.length > 0, candidate.model);
      for (const launch of launches) {
        assert.equal(launch.seam, "subagents");
        assert.equal(launch.transport, "native");
      }
    }
  });
  it("makes UI/UX owner-selected while incidental work stays implementation", () => {
    assert.deepEqual(roleOf(F, "ui_ux")?.selection?.by, ["owner"]);
    assert.equal(roleOf(F, "ui_ux")?.selection?.otherwise, "implementation");
    assert.equal(roleOf(F, "implementation")?.selection, undefined);
  });
  it("names the authorities of each privileged tier, and leaves ordinary tiers without one", () => {
    assert.deepEqual(authorizedBy(F, "complex"), ["owner", "milestone"]);
    assert.deepEqual(authorizedBy(F, "architecture"), ["owner", "milestone"]);
    for (const tier of ["simple", "straightforward", "feature"]) assert.equal(authorizedBy(F, tier), null);
    // Every authority is either the owner keyword or a declared coordinator scope.
    for (const tier of ["complex", "architecture"]) for (const authority of authorizedBy(F, tier)!) {
      assert.ok(authority === "owner" || coordinatorScopes(F).includes(authority), authority);
    }
  });
  it("requires worklog evidence for an owner override and cannot say none", () => {
    assert.deepEqual(overrideEvidenceOf(F), ["worklog"]);
    const v = documentF(); v.policy.ownerOverride.evidence = [];
    refused(validate(v), "invalid", "empty", "policy.ownerOverride.evidence");
  });
  it("maps every lane onto a tier, a role and a non-empty cell", () => {
    assert.ok(F.lanes.length > 0);
    for (const l of F.lanes) {
      assert.ok(fleetTierNames(F).includes(l.tier));
      assert.ok(fleetRoleNames(F).includes(l.role));
      assert.ok((cellOf(F, l.tier, l.role) ?? []).length > 0, l.lane);
    }
  });
  it("orders providers as a permutation of the declared identities", () => {
    assert.deepEqual([...providerPrecedenceOf(F)].sort(), Object.keys(F.providers).sort());
    assert.equal(new Set(providerPrecedenceOf(F)).size, providerPrecedenceOf(F).length);
  });
  it("answers feasibility without choosing anything", () => {
    const gate = roleOf(F, "implementation_evaluation");
    const generator: Candidate = { model: "astra", effort: "medium" };
    const evaluator: Candidate = { model: "muse_spark_1_3", effort: "max" };
    assert.equal(feasibleEvaluator(F, generator, evaluator, gate), true);
    assert.equal(feasibleEvaluator(F, generator, { model: "sol", effort: "medium" }, gate), false, "same family is never independent");
    assert.equal(feasibleCandidate(F, generator, roleOf(F, "implementation")), true);
    assert.equal(feasibleCandidate(F, { model: "absent", effort: "max" }, null), false);
  });
});

/* ── T-F12 no fleet identifier is a TypeScript constant ─────────────────────────────────────── */

it("keeps every fleet model, tier, role, scope, lane, family and effort out of routing runtime source", async () => {
  const { readdir, readFile: read } = await import("node:fs/promises");
  const source = new URL("../src/", import.meta.url);
  const forbidden = [
    ...fleetModelKeys(F), ...fleetTierNames(F), ...fleetRoleNames(F), ...coordinatorScopes(F),
    ...fleetLaneNames(F), ...F.families, ...F.efforts.ordered, ...F.efforts.unordered ?? [],
    ...F.capabilities,
  ];
  assert.ok(forbidden.length > 40, `the forbidden list is the point: ${forbidden.length}`);
  const files = (await readdir(source)).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.length >= 8, `scanned too few sources: ${files.length}`);
  for (const file of files) {
    const code = (await read(new URL(file, source), "utf8")).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    for (const value of forbidden) assert.ok(!code.includes(JSON.stringify(value)), `${file} compiles ${value}`);
  }
});
