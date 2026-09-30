import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { routingEditorCatalog } from "./catalog.js";
import { laneRouting } from "./document.js";
import { loadRoutingConfiguration } from "./load.js";
import { resolveRoute } from "./resolve.js";

const loaded = await loadRoutingConfiguration({
  path: fileURLToPath(new URL("../config/routing.v1.json", import.meta.url)),
});
assert.ok(loaded.ok);
const narrowed = laneRouting(loaded.loaded.configuration);
assert.ok(narrowed.ok);
const catalog = narrowed.configuration;

function primary(lane: string): { model: string; effort: string } {
  const resolved = resolveRoute(catalog, lane);
  assert.ok(resolved.ok, `missing primary for ${lane}`);
  return { model: resolved.step.route.model, effort: resolved.step.route.effort };
}

describe("packaged owner routing catalog", () => {
  it("routes trivial work to Sol 6.1 at low effort", () => {
    assert.deepEqual(primary("fast_implementation"), { model: "gpt-6.1-sol", effort: "low" });
  });

  it("routes every coordinator scope to the exact Sol effort", () => {
    for (const scope of ["small_project", "project", "milestone"]) {
      assert.deepEqual(primary(`coordinator_${scope}`), { model: "gpt-6.1-sol", effort: "xhigh" });
    }
    assert.deepEqual(primary("coordinator_framework"), { model: "gpt-6.1-sol", effort: "xhigh" });
    const sol = routingEditorCatalog(catalog).models.find(model => model.value === "gpt-6.1-sol");
    assert.ok(sol);
    assert.deepEqual(
      sol.routes.filter(route => route.lane.startsWith("coordinator_"))
        .map(route => [route.lane, route.effort]),
      [
        ["coordinator_small_project", "xhigh"],
        ["coordinator_project", "xhigh"],
        ["coordinator_framework", "xhigh"],
        ["coordinator_milestone", "xhigh"],
      ],
    );
  });

  it("uses the new Codex default throughout the packaged chains", () => {
    for (const lane of catalog.lanes) for (const step of lane.chain) {
      if (step.route.harness !== "codex" || step.route.model === "gpt-6-astra") continue;
      assert.deepEqual(
        { model: step.route.model, effort: step.route.effort },
        { model: "gpt-6.1-sol", effort: lane.lane === "fast_implementation" ? "low" : "xhigh" },
        lane.lane,
      );
    }
    const ids = routingEditorCatalog(catalog).models.map(model => model.value);
    for (const id of ["gpt-6-sol", "gpt-6-luna"]) assert.ok(ids.includes(id));
  });

  it("retains the distinct implementation and Claude orchestration primaries", () => {
    assert.deepEqual(primary("light_implementation"), { model: "gpt-6.1-sol", effort: "xhigh" });
    assert.deepEqual(primary("normal_implementation"), { model: "gpt-6.1-sol", effort: "xhigh" });
    assert.deepEqual(primary("complex_implementation"), { model: "gpt-6-astra", effort: "high" });
    assert.deepEqual(primary("planning_decisions"), { model: "claude-opus-5-5", effort: "high" });
  });
});
