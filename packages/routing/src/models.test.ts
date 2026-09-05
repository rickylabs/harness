import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MODEL_IDS,
  OPENCODE_MODEL_IDS,
  OPENROUTER_MODEL_IDS,
  OPEN_EVALUATOR_MODEL_IDS,
  familyOf,
  isApprovedOpenEvaluator,
  isPinnedModel,
  pinnedModels,
} from "./models.js";

describe("model pins", () => {
  it("places every native model in its vendor's family", () => {
    assert.equal(familyOf(MODEL_IDS.codexSol), "openai");
    assert.equal(familyOf(MODEL_IDS.codexLuna), "openai");
    assert.equal(familyOf(MODEL_IDS.fable), "anthropic");
    assert.equal(familyOf(MODEL_IDS.opus), "anthropic");
    assert.equal(familyOf(MODEL_IDS.sonnet), "anthropic");
    assert.equal(familyOf(MODEL_IDS.agyDocs), "google");
  });

  it("places every relay model in the open family, whatever CLI drives it", () => {
    for (const model of Object.values(OPENROUTER_MODEL_IDS)) {
      assert.equal(familyOf(model), "open", model);
    }
    assert.equal(familyOf(OPENCODE_MODEL_IDS.visionEval), "open");
  });

  it("refuses to place a model it does not pin", () => {
    assert.equal(familyOf("gpt-4o"), null);
    assert.equal(familyOf(""), null);
    assert.equal(isPinnedModel("gpt-4o"), false);
    assert.equal(isPinnedModel(MODEL_IDS.opus), true);
  });

  it("is not fooled by inherited object properties", () => {
    assert.equal(familyOf("toString"), null);
    assert.equal(isPinnedModel("constructor"), false);
  });

  it("pins each model exactly once", () => {
    const models = pinnedModels();
    assert.equal(new Set(models).size, models.length);
  });

  it("pins opencode models unprefixed, because the wire carries the router separately", () => {
    // The fleet writes this joined as `openrouter/moonshotai/kimi-k3`. `validateDispatch` refuses
    // an opencode request with no `router:` key, so emitting the prefix here would send it twice.
    assert.equal(OPENCODE_MODEL_IDS.visionEval.startsWith("openrouter/"), false);
  });
});

describe("approved open evaluators", () => {
  it("approves the two relay evaluator models", () => {
    assert.equal(isApprovedOpenEvaluator(OPENROUTER_MODEL_IDS.planEvaluator), true);
    assert.equal(isApprovedOpenEvaluator(OPENROUTER_MODEL_IDS.implEvaluator), true);
    assert.equal(OPEN_EVALUATOR_MODEL_IDS.length, 2);
  });

  it("approves nothing else, including open models the matrix uses elsewhere", () => {
    // GLM 5.2 leads design and is a polish fallback; neither is an evaluator seat. Kimi supplies
    // vision evidence that complements the required GLM review rather than certifying anything.
    assert.equal(isApprovedOpenEvaluator(OPENROUTER_MODEL_IDS.designGlm), false);
    assert.equal(isApprovedOpenEvaluator(OPENROUTER_MODEL_IDS.grok), false);
    assert.equal(isApprovedOpenEvaluator(OPENCODE_MODEL_IDS.visionEval), false);
    assert.equal(isApprovedOpenEvaluator(MODEL_IDS.opus), false);
  });
});
