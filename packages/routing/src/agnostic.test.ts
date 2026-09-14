import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { HARNESSES, ROUTERS, parseSwarm, renderSwarm, toDispatchRequest } from "@rickylabs/subagents";
import { parseRoutingDocument } from "./load.js";
import { validateRoutingConfiguration, FALLBACK_TRIGGERS, TRANSPORTS, type RoutingConfiguration } from "./schema.js";
import { canonicalLane, familyOf, lanePolicy, laneConstraint, tierRoleLane } from "./configuration.js";
import { checkPolicy, resolveRoute, resolveTierRole, resolveFallback, tierPlan, toDispatch, unreviewedSteps } from "./resolve.js";
import { admitDispatch } from "./admit.js";
import { routingEditorCatalog } from "./catalog.js";

const fixtureText = await readFile(new URL("../test-fixtures/owner-matrix.json", import.meta.url), "utf8");
const compatibilityText = await readFile(new URL("../test-fixtures/compatibility.json", import.meta.url), "utf8");
const fixture = () => JSON.parse(fixtureText);
function accepted(value: unknown): RoutingConfiguration {
  const result = validateRoutingConfiguration(value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.configuration;
}
const C = accepted(fixture());

/** Each guard is exercised as valid -> broken/refused -> restored/valid, with no I/O waits. */
const mutations: readonly (readonly [string, (v: any) => void, string])[] = [
  ["unregistered family", v => { v.models["writer-next"].family = "absent"; }, "dangling-reference"],
  ["unregistered model", v => { v.lanes[0].chain[0].route.model = "absent"; }, "dangling-reference"],
  ["unregistered trigger", v => { v.lanes[0].chain[1].when = ["absent"]; }, "dangling-reference"],
  ["unregistered router", v => { v.lanes[0].chain[0].route.router = "absent"; }, "dangling-reference"],
  ["unregistered purpose", v => { v.lanes[3].purpose = "absent"; }, "dangling-reference"],
  ["unregistered custom role lane", v => { v.tiers[0].accessibility_audit = "absent"; }, "dangling-reference"],
  ["alias collision", v => { v.laneAliases.feature_plan = "feature_evaluation"; }, "duplicate"],
  ["alias chain", v => { v.laneAliases.old_writer = "old_critic"; }, "dangling-reference"],
  ["alias as document reference", v => { v.tiers[0].implementation = "old_writer"; }, "dangling-reference"],
  ["invalid alias name", v => { v.laneAliases["bad alias"] = "feature_evaluation"; }, "out-of-range"],
  ["invalid custom role name", v => { v.tiers[0]["bad role"] = "feature_evaluation"; }, "out-of-range"],
  ["missing implementation", v => { delete v.tiers[0].implementation; }, "missing-key"],
  ["missing implementation evaluator", v => { delete v.tiers[0].implementation_evaluation; }, "missing-key"],
  ["ambiguous implementation spelling", v => { v.tiers[0].implement = "feature_plan"; }, "duplicate"],
  ["self-certifying named family", v => { v.lanes[1].chain[0].certifies = "south"; }, "self-certifies"],
  ["same-family any coverage", v => { v.lanes[1].chain.forEach((s: any) => { s.route.model = "writer-next"; }); }, "unreviewed-step"],
  ["supplementary coverage", v => { v.lanes[1].chain.forEach((s: any) => { s.certifies = "none"; }); }, "unreviewed-step"],
  ["uncovered implementation fallback", v => { v.lanes[1].chain.forEach((s: any) => { s.certifies = "north"; s.route.model = "critic-next"; }); }, "unreviewed-step"],
  ["orphan implementation", v => { v.lanes.push({ ...v.lanes[0], lane: "unbound" }); }, "unreviewed-step"],
  ["evaluation role purpose", v => { v.tiers[0].implementation_evaluation = "feature_accessibility"; }, "tier-role-purpose"],
  ["implementation role purpose", v => { v.tiers[0].implementation = "feature_plan"; }, "tier-role-purpose"],
  ["plan evaluator without plan", v => { delete v.tiers[0].plan; }, "evaluation-without-generator"],
  ["unreviewed plan", v => { v.lanes[2].chain[0].route.model = "critic-next"; v.lanes[1].chain.splice(1); }, "unreviewed-step"],
  ["duplicate primary certifies", v => { v.lanes[1].chain[1].when = []; }, "duplicate-primary"],
  ["empty model label", v => { v.models["writer-next"].label = " "; }, "empty"],
  ["non-string model description", v => { v.models["writer-next"].description = 4; }, "wrong-type"],
  ["oversized model label", v => { v.models["writer-next"].label = "a".repeat(4097); }, "out-of-range"],
  ...["with space", "with/slash", "UPPER", "with;command"].map(router =>
    [`invalid router ${router}`, (v: any) => { v.routers.push(router); }, "out-of-range"] as const),
];

describe("owner-controlled routing: mutation controls", { timeout: 5000 }, () => {
  for (const [name, mutate, code] of mutations) it(name, () => {
    const original = fixture(); accepted(original);
    const broken = structuredClone(original); mutate(broken);
    const result = validateRoutingConfiguration(broken);
    assert.ok(!result.ok, `${name} unexpectedly accepted`);
    assert.ok("problems" in result.refusal && result.refusal.problems.some(p => p.code === code), JSON.stringify(result));
    accepted(original);
  });
});

describe("owner-controlled routing: resolution and editor export", { timeout: 5000 }, () => {
  it("resolves arbitrary tier roles, routers, efforts and purposes from JSON only", () => {
    assert.equal(tierRoleLane(C, "feature", "accessibility_audit"), "feature_accessibility");
    assert.equal(tierRoleLane(C, "feature", "implementation"), "feature_implementation");
    const result = resolveTierRole(C, "feature", "implementation"); assert.ok(result.ok);
    assert.equal(result.step.route.model, "writer-next");
    const dispatch = { ...toDispatch(C, result.step.route), prompt: "Synthetic task" };
    assert.ok(admitDispatch(C, dispatch, { lane: "old_writer" }).ok);
    const parsed = parseSwarm(renderSwarm(dispatch)); assert.ok(parsed);
    assert.deepEqual(toDispatchRequest(parsed), dispatch);
    assert.deepEqual(resolveTierRole(C, "feature", "missing"), { ok: false, reason: "unknown-tier-role", tier: "feature", role: "missing" });
    assert.equal(tierRoleLane(C, "missing", "implementation"), null);
    assert.equal(tierRoleLane(C, "feature", "toString"), null);
    assert.equal(tierRoleLane(C, "feature", "tier"), null);
    assert.ok(!admitDispatch(C, { ...dispatch, router: "unregistered" }).ok);
  });
  it("admits a document-defined relay provider without assuming its name", () => {
    const v = fixture(); v.lanes[0].chain[0].route.transport = "openrouter";
    const c = accepted(v); const dispatch = { ...toDispatch(c, c.lanes[0]!.chain[0]!.route), prompt: "Synthetic task" };
    assert.ok(admitDispatch(c, dispatch).ok);
    assert.ok(!admitDispatch(c, { ...dispatch, router: "missing-gateway" }).ok);
  });
  it("selects per-tier evaluator bindings and preserves a distinct legacy review binding", () => {
    const v = fixture(); const alternate = structuredClone(v.lanes[1]); alternate.lane = "second_evaluation";
    alternate.chain[0].route.model = "spare-next"; alternate.chain[1].route.model = "critic-next";
    v.lanes.push(alternate);
    v.tiers.push({ ...v.tiers[0], tier: "another", implementation_evaluation: alternate.lane, plan_evaluation: alternate.lane, review: "feature_evaluation" });
    const c = accepted(v);
    const first = resolveTierRole(c, "feature", "implementation_evaluation", "north");
    const second = resolveTierRole(c, "another", "implementation_evaluation", "north");
    assert.ok(first.ok && second.ok); assert.notEqual(first.step.route.model, second.step.route.model);
    assert.equal(tierPlan(c, "another")?.review.lane, "feature_evaluation");
    // Isolate the formal implementation guard: the plan and legacy review stay valid.
    v.tiers[1].plan_evaluation = "feature_evaluation";
    v.lanes[4].chain.forEach((s: any) => { s.route.model = "writer-next"; });
    assert.ok(!validateRoutingConfiguration(v).ok, "a valid legacy reviewer cannot hide an invalid formal evaluator");
  });
  it("preserves legacy role names and caller aliases without duplicating lanes", () => {
    assert.equal(lanePolicy(C, "old_writer"), lanePolicy(C, "feature_implementation"));
    assert.equal(canonicalLane(C, "absent"), "absent");
    assert.equal(tierRoleLane(C, "feature", "implement"), "feature_implementation");
    assert.equal(tierPlan(C, "feature")?.review.lane, "feature_evaluation");
    const v = fixture(); v.tiers[0].implement = v.tiers[0].implementation;
    v.tiers[0].review = v.tiers[0].implementation_evaluation;
    delete v.tiers[0].implementation; delete v.tiers[0].implementation_evaluation;
    v.constraints.feature_implementation = { models: ["writer-next", "spare-next"], why: "Fixture constraint" };
    const legacy = accepted(v);
    assert.ok(resolveTierRole(legacy, "feature", "implementation").ok);
    assert.deepEqual(laneConstraint(legacy, "old_writer"), v.constraints.feature_implementation);
    const noPlanEvaluator = fixture(); delete noPlanEvaluator.tiers[0].plan_evaluation; accepted(noPlanEvaluator);
  });
  it("matches custom fallback triggers and preserves payment and turn-boundary refusals", () => {
    const request = { lane: "feature_implementation", trigger: "capacity-changed", from: 0, atTurnBoundary: true };
    const fallback = resolveFallback(C, request); assert.ok(fallback.ok); assert.equal(fallback.step.route.model, "spare-next");
    assert.deepEqual(resolveFallback(C, { ...request, trigger: "undeclared" }), { ok: false, reason: "no-route" });
    assert.deepEqual(resolveFallback(C, { ...request, atTurnBoundary: false }), { ok: false, reason: "turn-boundary-required" });
    const v = fixture(); v.lanes[1].chain[1].subscription = "outside_plan";
    // This plan can be certified only by a paid fallback. Coverage does not imply permission.
    v.lanes[2].chain[0].route.model = "critic-next";
    const paid = accepted(v);
    const review = { lane: "feature_evaluation", trigger: "owner-request", from: 0, atTurnBoundary: true, authorFamily: "south" };
    assert.deepEqual(resolveFallback(paid, review), { ok: false, reason: "approval-required" });
    assert.ok(resolveFallback(paid, { ...review, explicitPaidApproval: true }).ok);
    assert.ok(!resolveRoute(paid, "feature_evaluation", "south").ok);
  });
  it("never selects a same-family any certifier for a known author", () => {
    assert.ok(resolveTierRole(C, "feature", "plan_evaluation", "north").ok);
    assert.ok(!resolveTierRole(C, "feature", "plan_evaluation", "south").ok);
    const request = { lane: "feature_evaluation", trigger: "owner-request", from: 0, atTurnBoundary: true };
    assert.ok(resolveFallback(C, { ...request, authorFamily: "north" }).ok);
    assert.deepEqual(resolveFallback(C, { ...request, authorFamily: "east" }), { ok: false, reason: "no-route" });
  });
  it("exports searchable labels, route combinations, vocabularies and unproven availability", () => {
    const catalog = routingEditorCatalog(C);
    assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog);
    for (const key of ["routers", "triggers", "purposes", "families", "profiles", "presets"] as const) {
      assert.deepEqual(catalog[key].map(v => v.value), C[key]);
    }
    assert.deepEqual(catalog.harnesses.map(v => v.value), HARNESSES);
    assert.deepEqual(catalog.transports.map(v => v.value), TRANSPORTS);
    assert.deepEqual(catalog.efforts.map(v => v.value), [...C.efforts.ordered, ...C.efforts.unordered ?? []]);
    assert.ok(catalog.roles.some(r => r.value === "accessibility_audit"));
    assert.deepEqual(catalog.tiers, C.tiers); assert.deepEqual(catalog.laneAliases, C.laneAliases);
    const model = catalog.models.find(m => m.value === "writer-next")!;
    assert.equal(model.label, "Next Writer");
    for (const term of ["writer-next", "next writer", "north", "custom-gateway", "general implementation"]) assert.ok(model.searchText.includes(term));
    assert.ok(model.routes.every(r => r.model === model.value && C.routers!.includes(r.router!)));
    assert.ok(catalog.models.every(m => m.availability === "unproven"));
    assert.deepEqual(catalog.models.find(m => m.value === "registered-only")?.routes, []);
    assert.ok(!catalog.models.some(m => m.value === "absent"));
    assert.throws(() => { (catalog.models as any[]).push({}); }, TypeError);
    const v = fixture(); delete v.models["writer-next"].label;
    assert.equal(routingEditorCatalog(accepted(v)).models.find(m => m.value === "writer-next")?.label, "Writer Next");
  });
  it("keeps original v1 vocabulary only when optional lists are omitted", () => {
    const legacy = JSON.parse(compatibilityText);
    const c = accepted(legacy); const catalog = routingEditorCatalog(c);
    assert.deepEqual(catalog.routers.map(x => x.value), ROUTERS);
    assert.deepEqual(catalog.triggers.map(x => x.value), FALLBACK_TRIGGERS);
    legacy.triggers = []; assert.ok(!validateRoutingConfiguration(legacy).ok);
  });
});

it("the shipped document satisfies invariants independent of model identities", { timeout: 5000 }, async () => {
  const text = await readFile(new URL("../config/routing.v1.json", import.meta.url), "utf8");
  const outcome = parseRoutingDocument(text, "shipped-document"); assert.ok(outcome.ok);
  const c = outcome.loaded.configuration;
  assert.deepEqual(checkPolicy(c), []);
  for (const l of c.lanes) {
    const primaries = l.chain.filter(s => s.when.length === 0);
    assert.ok(primaries.length > 0); assert.equal(new Set(primaries.map(s => s.certifies)).size, primaries.length);
    for (const s of l.chain) assert.ok(c.families.includes(familyOf(c, s.route.model)!));
    if (l.purpose === "implementation") {
      const rows = c.tiers.filter(t => tierRoleLane(c, t.tier, "implementation") === l.lane); assert.ok(rows.length > 0);
      for (const row of rows) for (const role of ["review", "implementation_evaluation"]) {
        const evaluator = lanePolicy(c, tierRoleLane(c, row.tier, role)!)!;
        assert.deepEqual(unreviewedSteps(c, l.chain, evaluator.chain), []);
      }
    }
  }
  // Editing every model identity and family name remains legal; no expected selection is compiled.
  const raw = JSON.parse(text);
  const replacements = new Map<string, string>([
    ...Object.keys(raw.models).map((id, i) => [id, `next-model-${i}`] as const),
    ...raw.families.map((id: string, i: number) => [id, `next-family-${i}`] as const),
  ]);
  const rename = (v: any): any => typeof v === "string" ? replacements.get(v) ?? v :
    Array.isArray(v) ? v.map(rename) : v && typeof v === "object" ?
      Object.fromEntries(Object.entries(v).map(([k, x]) => [replacements.get(k) ?? k, rename(x)])) : v;
  accepted(rename(raw));
  raw.models[Object.keys(raw.models)[0]!].family = "unregistered-family";
  assert.ok(!validateRoutingConfiguration(raw).ok);
});
