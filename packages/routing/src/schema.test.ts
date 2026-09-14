import { loadRoutingConfiguration } from "./load.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
const loadedA = await loadRoutingConfiguration({ path: fileURLToPath(new URL("../test-fixtures/compatibility.json", import.meta.url)) });
assert.ok(loadedA.ok);
const A = loadedA.loaded.configuration;


import { familyOf, isApprovedOpenEvaluator, isPinnedModel, pinnedModels } from "./configuration.js";

describe("model pins", () => {
  it("places every native model in its vendor's family", () => {
    assert.equal(familyOf(A, "gpt-5.6-sol"), "openai");
    assert.equal(familyOf(A, "gpt-5.6-luna"), "openai");
    assert.equal(familyOf(A, "gpt-6-astra"), "openai");
    assert.equal(familyOf(A, "fable-5.1"), "anthropic");
    assert.equal(familyOf(A, "opus-5"), "anthropic");
    assert.equal(familyOf(A, "sonnet-5"), "anthropic");
    assert.equal(familyOf(A, "gemini-3.6-flash-high"), "google");
  });

  it("places every relay model with its vendor, whatever CLI drives it", () => {
    // One `open` bucket said Z.ai and Moonshot were the same family, so a GLM review of a Kimi
    // design read as self-certification. A family is the model's lineage; the relay is a seam.
    const vendor = {
      "qwen/qwen3.8-flash": "qwen",
      "z-ai/glm-5.3-flash": "zai",
      "z-ai/glm-5.2": "zai",
      "x-ai/grok-4.5": "xai",
      "moonshotai/kimi-k3": "moonshot",
      "meta/muse-spark-1.3": "meta",
      "deepseek/deepseek-v4.1-flash": "deepseek",
      "n5air/ling-3.0-flash": "inclusionai",
    };
    for (const [model, family] of Object.entries(vendor)) {
      assert.equal(familyOf(A, model), family, model);
    }
    // Two vendors that used to share the bucket must now come apart, or the split did nothing.
    assert.notEqual(familyOf(A, "z-ai/glm-5.3-flash"), familyOf(A, "moonshotai/kimi-k3"));
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
  it("approves exactly the five relay evaluator models, by name", () => {
    assert.equal(isApprovedOpenEvaluator(A, "qwen/qwen3.8-flash"), true);
    assert.equal(isApprovedOpenEvaluator(A, "z-ai/glm-5.3-flash"), true);
    // Grok 4.6 and Muse Spark 1.3 lead the two formal evaluation lanes. `resolve.ts` refuses an
    // openrouter step that certifies unless the model carries the flag, so the flag is what makes
    // those lanes resolvable at all.
    assert.equal(isApprovedOpenEvaluator(A, "x-ai/grok-4.6"), true);
    assert.equal(isApprovedOpenEvaluator(A, "meta/muse-spark-1.3"), true);
    // Gemini 3.8 Flash is the only approved evaluator outside the open family, which is what lets it
    // certify the three open-family implementers of the third lane without self-certifying.
    assert.equal(isApprovedOpenEvaluator(A, "google/gemini-3.8-flash"), true);
    // The set, not the count: a fifth model gaining the flag by accident fails on its name here
    // rather than on an arithmetic total that says nothing about which model slipped in.
    assert.deepEqual(
      Object.entries(A.models).filter(([, m]) => m.approvedRelayEvaluator).map(([name]) => name).sort(),
      ["google/gemini-3.8-flash", "meta/muse-spark-1.3", "qwen/qwen3.8-flash", "x-ai/grok-4.6", "z-ai/glm-5.3-flash"],
    );
  });

  it("approves nothing else, including open models the matrix uses elsewhere", () => {
    // GLM 5.2 leads design and is a polish fallback; neither is an evaluator seat. Kimi supplies
    // vision evidence that complements the required GLM review rather than certifying anything.
    assert.equal(isApprovedOpenEvaluator(A, "z-ai/glm-5.2"), false);
    assert.equal(isApprovedOpenEvaluator(A, "x-ai/grok-4.5"), false);
    assert.equal(isApprovedOpenEvaluator(A, "moonshotai/kimi-k3"), false);
    assert.equal(isApprovedOpenEvaluator(A, "opus-5"), false);
    // The third implementation lane relays through openrouter too, but it implements rather than
    // certifies, so its models must NOT be approved evaluators. Grok 4.5 above is the same shape:
    // a near-neighbour of an approved id that must stay unapproved.
    assert.equal(isApprovedOpenEvaluator(A, "deepseek/deepseek-v4.1-flash"), false);
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
