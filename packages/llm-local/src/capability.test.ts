import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LOCAL_MODEL_IDS, OPENCODE_MODEL_IDS, OPENROUTER_MODEL_IDS } from "@rickylabs/routing";

import { BACKENDS } from "./backends.js";
import {
  PLACEMENTS,
  backendsFor,
  canRun,
  checkCapability,
  placedModels,
  placementOf,
  refusalOf,
} from "./capability.js";

describe("the capability matrix", () => {
  it("satisfies its own invariants", () => {
    assert.deepEqual(checkCapability(), []);
  });

  it("is total over the models it places", () => {
    assert.equal(PLACEMENTS.length, placedModels().length * BACKENDS.length);
  });

  it("refuses a pair it does not describe rather than guessing", () => {
    assert.equal(placementOf("gpt-4o", "lm-studio"), null);
    assert.equal(placementOf(LOCAL_MODEL_IDS.planEvaluator, "ollama"), null);
    assert.equal(canRun("gpt-4o", "lm-studio"), false);
  });

  it("is not fooled by inherited object properties", () => {
    assert.equal(placementOf("toString", "lm-studio"), null);
    assert.equal(placementOf("constructor", "constructor"), null);
  });
});

describe("the placements the epic paid for", () => {
  it("keeps GLM-5.3-Flash off both local backends, and says the build is why", () => {
    // `glm5next` is absent from this box's llama.cpp build. The accelerator is not the obstacle,
    // which is why swapping to ROCm does not help and neither refusal is `crashes-on-backend`.
    for (const backend of ["lm-studio", "llama-rocm"] as const) {
      assert.equal(canRun(OPENROUTER_MODEL_IDS.implEvaluator, backend), false, backend);
      assert.equal(refusalOf(OPENROUTER_MODEL_IDS.implEvaluator, backend), "absent-from-build", backend);
    }
    assert.deepEqual(backendsFor(OPENROUTER_MODEL_IDS.implEvaluator), ["openrouter"]);
  });

  it("pins Ling to ROCm and states both conditions it needs to load", () => {
    const placement = placementOf(LOCAL_MODEL_IDS.implEvaluator, "llama-rocm");
    if (placement === null) throw new Error("Ling has no llama-rocm placement");
    if (placement.verdict !== "runs") throw new Error(`Ling on llama-rocm is ${placement.verdict}`);
    assert.deepEqual(placement.requires?.env, { GGML_HIP_ENABLE_UNIFIED_MEMORY: "1" });
    assert.deepEqual(placement.requires?.args, ["--load-mode", "none"]);
  });

  it("never routes Ling to LM Studio, where it succeeds slowly instead of failing", () => {
    // The dangerous case: it segfaults on Vulkan and LM Studio falls back to CPU at ~3 tok/s. A
    // lane routed here does not fail, it takes an hour and reads as a hung agent.
    assert.equal(canRun(LOCAL_MODEL_IDS.implEvaluator, "lm-studio"), false);
    assert.equal(refusalOf(LOCAL_MODEL_IDS.implEvaluator, "lm-studio"), "unusably-slow");
    assert.deepEqual(backendsFor(LOCAL_MODEL_IDS.implEvaluator), ["llama-rocm"]);
  });

  it("makes Qwen3.8-27B on LM Studio the local smoke and evaluation seat", () => {
    assert.equal(canRun(LOCAL_MODEL_IDS.planEvaluator, "lm-studio"), true);
    assert.deepEqual(backendsFor(LOCAL_MODEL_IDS.planEvaluator), ["lm-studio"]);
    assert.equal(placementOf(LOCAL_MODEL_IDS.planEvaluator, "lm-studio")?.verdict, "runs");
  });

  it("keeps the `n5air/` seats off the relay, because that namespace names this box", () => {
    for (const model of Object.values(LOCAL_MODEL_IDS)) {
      assert.equal(refusalOf(model, "openrouter"), "not-served-here", model);
    }
  });

  it("keeps closed weights off both local backends for a reason no rebuild changes", () => {
    assert.equal(refusalOf(OPENROUTER_MODEL_IDS.grok, "lm-studio"), "not-served-here");
    assert.equal(refusalOf(OPENROUTER_MODEL_IDS.grok, "llama-rocm"), "not-served-here");
    assert.deepEqual(backendsFor(OPENROUTER_MODEL_IDS.grok), ["openrouter"]);
  });
});

describe("what the matrix declines to claim", () => {
  it("says `unverified` rather than inventing a verdict for a pair nobody has tried", () => {
    const untried = PLACEMENTS.filter((placement) => placement.verdict === "unverified");
    assert.equal(untried.length > 0, true);
    for (const placement of untried) {
      assert.notEqual(placement.why.trim(), "", `${placement.model} ${placement.backend}`);
    }
  });

  it("treats `unverified` as 'do not route here', not as permission", () => {
    // Failing closed is the whole point of the third verdict: it records ignorance without
    // spending it. `canRun` is the question "may I dispatch without probing first".
    for (const placement of PLACEMENTS) {
      if (placement.verdict !== "unverified") continue;
      assert.equal(canRun(placement.model, placement.backend), false);
      assert.equal(refusalOf(placement.model, placement.backend), null);
    }
  });

  it("omits kimi, because it is reached through the subagent seam and not through ctx.llm", () => {
    // `routing` pins it, but opencode's own router addresses it. Placing it here would imply this
    // package could send it somewhere, and no adapter here ever will.
    assert.equal(placedModels().includes(OPENCODE_MODEL_IDS.visionEval), false);
    assert.equal(placementOf(OPENCODE_MODEL_IDS.visionEval, "openrouter"), null);
  });

  it("carries no quota, spend or load, because all three are wrong by the time they ship", () => {
    const serialised = JSON.stringify(PLACEMENTS);
    for (const moving of ["quota", "credits", "balance", "tok/s left", "remaining"]) {
      assert.equal(serialised.includes(moving), false, moving);
    }
  });
});
