import { loadRoutingConfiguration } from "./load.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
const loadedA = await loadRoutingConfiguration({ path: fileURLToPath(new URL("../config/routing.v1.json", import.meta.url)) });
assert.ok(loadedA.ok);
const A = loadedA.loaded.configuration;


import { familyOf, isApprovedOpenEvaluator, isPinnedModel, pinnedModels } from "./configuration.js";

describe("model pins", () => {
  it("places every native model in its vendor's family", () => {
    assert.equal(familyOf(A, "gpt-5.6-sol"), "openai");
    assert.equal(familyOf(A, "gpt-5.6-luna"), "openai");
    assert.equal(familyOf(A, "gpt-6-astra"), "openai");
    assert.equal(familyOf(A, "fable-5"), "anthropic");
    assert.equal(familyOf(A, "opus-5"), "anthropic");
    assert.equal(familyOf(A, "sonnet-5"), "anthropic");
    assert.equal(familyOf(A, "gemini-3.6-flash-high"), "google");
  });

  it("places every relay model in the open family, whatever CLI drives it", () => {
    for (const model of ["qwen/qwen3.8-flash", "z-ai/glm-5.3-flash", "z-ai/glm-5.2", "x-ai/grok-4.5"]) {
      assert.equal(familyOf(A, model), "open", model);
    }
    assert.equal(familyOf(A, "moonshotai/kimi-k3"), "open");
  });

  it("refuses to place a model it does not pin", () => {
    assert.equal(familyOf(A, "gpt-4o"), null);
    assert.equal(familyOf(A, ""), null);
    assert.equal(isPinnedModel(A, "gpt-4o"), false);
    assert.equal(isPinnedModel(A, "opus-5"), true);
  });

  it("is not fooled by inherited object properties", () => {
    assert.equal(familyOf(A, "toString"), null);
    assert.equal(isPinnedModel(A, "constructor"), false);
  });

  it("pins each model exactly once", () => {
    const models = pinnedModels(A);
    assert.equal(new Set(models).size, models.length);
  });

  it("pins opencode models unprefixed, because the wire carries the router separately", () => {
    // The fleet writes this joined as `openrouter/moonshotai/kimi-k3`. `validateDispatch` refuses
    // an opencode request with no `router:` key, so emitting the prefix here would send it twice.
    assert.equal("moonshotai/kimi-k3".startsWith("openrouter/"), false);
  });
});

describe("approved open evaluators", () => {
  it("approves the two relay evaluator models", () => {
    assert.equal(isApprovedOpenEvaluator(A, "qwen/qwen3.8-flash"), true);
    assert.equal(isApprovedOpenEvaluator(A, "z-ai/glm-5.3-flash"), true);
    assert.equal(Object.values(A.models).filter(m => m.approvedRelayEvaluator).length, 2);
  });

  it("approves nothing else, including open models the matrix uses elsewhere", () => {
    // GLM 5.2 leads design and is a polish fallback; neither is an evaluator seat. Kimi supplies
    // vision evidence that complements the required GLM review rather than certifying anything.
    assert.equal(isApprovedOpenEvaluator(A, "z-ai/glm-5.2"), false);
    assert.equal(isApprovedOpenEvaluator(A, "x-ai/grok-4.5"), false);
    assert.equal(isApprovedOpenEvaluator(A, "moonshotai/kimi-k3"), false);
    assert.equal(isApprovedOpenEvaluator(A, "opus-5"), false);
  });
});

it("keeps compatibility model, lane, tier and CLI-version literals out of routing runtime source", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const source = new URL("../src/", import.meta.url);
  const forbidden = [...Object.keys(A.models), ...A.lanes.map(l => l.lane), ...A.tiers.map(t => t.tier), "0.144.3", "0.153.4"];
  for (const file of await readdir(source)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const code = (await readFile(new URL(file, source), "utf8")).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    for (const value of forbidden) assert.ok(!code.includes(JSON.stringify(value)), `${file} compiles ${value}`);
  }
});
