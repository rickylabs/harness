import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COORDINATOR_MATRIX,
  DELEGATION_MATRIX,
  DELEGATION_ROLES,
  LOGICAL_MODEL_IDS,
  MODEL_CATALOG,
  MODEL_TRANSPORT_PRIORITY,
  WORKLOAD_TIERS,
  assertOwnerMatrixOverride,
  ownerMatrixOverrideWorklogEntry,
  selectEvaluator,
  validateDelegationMatrix,
} from "./delegation-matrix.ts";
import { assertEvaluatorIndependence, resolveCoordinatorRoute, resolveWorkloadRoute } from "./routing-policy.ts";
import { matrixTable } from "./cli/delegation-matrix-table.ts";

const fixture = name => JSON.parse(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8"));
const referenceTable = fixture("matrix-table.0985265.json");
const referenceCatalog = fixture("matrix-catalog.0985265.json");
const roles = [...DELEGATION_ROLES];

// The frozen source is historical evidence. Apply only the owner's 2026-09-30
// Codex policy to the expected table; other routes, order and loop policies stay exact.
function currentOwnerTable() {
  const expected = structuredClone(referenceTable.table);
  const update = routes => routes.map(candidate =>
    ["luna", "sol"].includes(candidate.model) ? { model: "sol", effort: "xhigh" } : candidate);
  for (const tier of expected.tiers) for (const role of roles) tier[role] = update(tier[role]);
  for (const scope of Object.keys(expected.coordinators)) expected.coordinators[scope] = update(expected.coordinators[scope]);
  return expected;
}
const expectedTable = currentOwnerTable();

// The reference files were generated once from a detached clean source at the recorded SHA.
// CI consumes frozen data and never installs, imports or reads NetScript.
test("every source cell retains its fallback order under the current owner decision", () => {
  assert.equal(referenceTable.sourceRevision, "0985265f491f508d55f3b56d2cfc5bda20f68426");
  assert.equal(createHash("sha256").update(JSON.stringify(referenceTable.table, null, 2) + "\n").digest("hex"), referenceTable.sourceSha256);
  assert.deepEqual(matrixTable(), expectedTable);
  assert.equal(WORKLOAD_TIERS.length, 5);
  assert.equal(roles.length, 8);
  for (const tier of WORKLOAD_TIERS) {
    for (const role of roles) {
      const expected = expectedTable.tiers.find(row => row.tier === tier)[role];
      assert.deepEqual(DELEGATION_MATRIX[tier][role], expected, `${tier}/${role}`);
    }
  }
  assert.deepEqual(COORDINATOR_MATRIX, expectedTable.coordinators);
  assert.deepEqual(MODEL_TRANSPORT_PRIORITY, referenceTable.table.transportPriority);
});

test("catalog retains each source capability and prefers newer Harness native IDs", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(referenceCatalog.catalog, null, 2) + "\n").digest("hex"), referenceCatalog.sourceSha256);
  assert.deepEqual(LOGICAL_MODEL_IDS, referenceCatalog.catalog.modelIds);
  assert.deepEqual(MODEL_TRANSPORT_PRIORITY, referenceCatalog.catalog.transportPriority);
  for (const id of referenceCatalog.catalog.modelIds) {
    const expected = referenceCatalog.catalog.models[id];
    const actual = MODEL_CATALOG[id];
    assert.equal(actual.family, expected.family, id);
    for (const capability of expected.capabilities) {
      assert.ok(actual.capabilities.some(candidate =>
        candidate.transport === capability.transport && candidate.model === capability.model),
      `${id} lost ${capability.transport}/${capability.model}`);
    }
  }
  assert.equal(MODEL_CATALOG.sol.capabilities[0].model, "gpt-6.1-sol");
  assert.equal(MODEL_CATALOG.luna.capabilities[0].model, "gpt-6-luna");
  assert.equal(resolveWorkloadRoute({ tier: "feature", role: "implementation", worktree: "." }).model, "gpt-6.1-sol");
});

test("all Codex defaults use Sol 6.1 xhigh except the unchanged Astra cells", () => {
  for (const tier of ["simple", "straightforward", "feature"]) {
    const selected = resolveWorkloadRoute({ tier, role: "implementation", worktree: "." });
    assert.deepEqual([selected.model, selected.effort], ["gpt-6.1-sol", "xhigh"], tier);
  }
  for (const tier of WORKLOAD_TIERS) for (const role of roles) {
    for (const candidate of DELEGATION_MATRIX[tier][role]) {
      assert.notEqual(candidate.model, "luna", `${tier}/${role}`);
      if (candidate.model === "sol") assert.equal(candidate.effort, "xhigh", `${tier}/${role}`);
    }
  }
  for (const tier of Object.keys(COORDINATOR_MATRIX)) {
    const selected = resolveCoordinatorRoute({ tier, worktree: "." });
    assert.deepEqual([selected.model, selected.effort], ["gpt-6.1-sol", "xhigh"], tier);
  }
  for (const [tier, effort] of [["complex", "medium"], ["architecture", "xhigh"]]) {
    const selected = resolveWorkloadRoute({ tier, role: "implementation", worktree: ".",
      privilegedTierAuthorization: { authorizer: "owner", rationale: "Approved complex work" } });
    assert.deepEqual([selected.model, selected.effort], ["gpt-6-astra", effort], tier);
  }
  assert.ok(MODEL_CATALOG.sol.capabilities.some(candidate => candidate.model === "gpt-6-sol"));
});

test("privileged routes and owner overrides keep source-backed guards", () => {
  assert.throws(() => resolveWorkloadRoute({ tier: "complex", role: "implementation", worktree: "." }));
  const auth = { authorizer: "owner", rationale: "Approved architecture review" };
  assert.equal(resolveWorkloadRoute({ tier: "complex", role: "implementation", worktree: ".", privilegedTierAuthorization: auth }).logicalModel, "astra");
  const override = { authorizer: "owner", rationale: "Measured proof", worklogPath: ".llm/runs/proof--one/worklog.md", route: { model: "opus_5_5", effort: "high" } };
  assertOwnerMatrixOverride("feature", "implementation", override);
  assert.equal(ownerMatrixOverrideWorklogEntry("feature", "implementation", override),
    "- **Owner matrix override:** owner authorized `feature/implementation` → `opus_5_5@high` because Measured proof");
  assert.throws(() => assertOwnerMatrixOverride("feature", "implementation", { ...override, authorizer: "milestone_coordinator" }));
  assert.throws(() => assertOwnerMatrixOverride("feature", "implementation", { ...override, worklogPath: "../worklog.md" }));
});

test("fallback, role transport and cross-family evaluator remain enforced", () => {
  const fallback = resolveWorkloadRoute({ tier: "feature", role: "implementation", worktree: ".", unavailableTransports: ["codex"] });
  assert.equal(fallback.logicalModel, "muse_spark_1_3");
  assert.throws(() => resolveWorkloadRoute({ tier: "feature", role: "deep_research", worktree: ".", unavailableTransports: ["agy", "codex", "github_copilot"] }));
  const evaluator = selectEvaluator("feature", "implementation", "sol");
  assert.notEqual(MODEL_CATALOG[evaluator.model].family, MODEL_CATALOG.sol.family);
  assert.throws(() => assertEvaluatorIndependence(
    { agent: "codex", model: "sol", sessionId: "one", worktree: ".", boundary: "idle" },
    { agent: "codex", model: "astra", sessionId: "two", worktree: ".", boundary: "idle" },
  ));
  assert.throws(() => assertEvaluatorIndependence(
    { agent: "codex", model: "sol", sessionId: "one", worktree: ".", boundary: "idle" },
    { agent: "claude", model: "opus_5", sessionId: "one", worktree: ".", boundary: "idle" },
  ));
  assert.deepEqual(validateDelegationMatrix(), []);
});

test("each distinct fallback can be selected from its declared cell", () => {
  let checked = 0;
  const evaluatorRoles = new Set(["plan_evaluation", "implementation_evaluation", "vision_evaluation"]);
  for (const tier of WORKLOAD_TIERS) for (const role of roles) {
    const seen = new Set();
    const earlier = [];
    for (const candidate of DELEGATION_MATRIX[tier][role]) {
      if (seen.has(candidate.model)) continue; // Source contains one deliberate duplicate.
      seen.add(candidate.model);
      const family = MODEL_CATALOG[candidate.model].family;
      const generatorModel = family === "openai" ? "fable_5_1" : "sol";
      const request = { tier, role, worktree: ".", unavailableModels: earlier,
        ...(evaluatorRoles.has(role) ? { generatorModel } : {}),
        ...(["complex", "architecture"].includes(tier)
          ? { privilegedTierAuthorization: { authorizer: "owner", rationale: "Pinned parity proof" } } : {}) };
      const selected = resolveWorkloadRoute(request);
      assert.equal(selected.logicalModel, candidate.model, `${tier}/${role}`);
      assert.equal(selected.requestedEffort, candidate.effort, `${tier}/${role}`);
      earlier.push(candidate.model);
      checked++;
    }
  }
  assert.ok(checked >= 70, `only ${checked} selections checked`);
});
