import { loadRoutingConfiguration } from "@rickylabs/routing";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";



import { BACKENDS } from "./backends.js";
import {
  requirePlacements,
  backendsFor,
  canRun,
  checkCapability,
  placedModels,
  placementOf,
  refusalOf,
} from "./capability.js";

const loadedRouting = await loadRoutingConfiguration({ path: fileURLToPath(import.meta.resolve("@rickylabs/routing/config/routing.v1.json")) });
assert.ok(loadedRouting.ok);
const routing = loadedRouting.loaded;
const placements = requirePlacements(routing.configuration.placements);
describe("the capability matrix", () => {
  it("satisfies its own invariants", () => {
    assert.deepEqual(checkCapability(routing.configuration.placements), []);
  });

  it("is total over the models it places", () => {
    assert.equal(placements.length, placedModels(placements).length * BACKENDS.length);
  });

  it("refuses a pair it does not describe rather than guessing", () => {
    assert.equal(placementOf(placements, "gpt-4o", "lm-studio"), null);
    assert.equal(placementOf(placements, "n5air/qwen3.8-27b", "ollama"), null);
    assert.equal(canRun(placements, "gpt-4o", "lm-studio"), false);
  });

  it("is not fooled by inherited object properties", () => {
    assert.equal(placementOf(placements, "toString", "lm-studio"), null);
    assert.equal(placementOf(placements, "constructor", "constructor"), null);
  });
});

describe("the placements the epic paid for", () => {
  it("keeps GLM-5.3-Flash off both local backends, and says the build is why", () => {
    // `glm5next` is absent from this box's llama.cpp build. The accelerator is not the obstacle,
    // which is why swapping to ROCm does not help and neither refusal is `crashes-on-backend`.
    for (const backend of ["lm-studio", "llama-rocm"] as const) {
      assert.equal(canRun(placements, "z-ai/glm-5.3-flash", backend), false, backend);
      assert.equal(refusalOf(placements, "z-ai/glm-5.3-flash", backend), "absent-from-build", backend);
    }
    assert.deepEqual(backendsFor(placements, "z-ai/glm-5.3-flash"), ["openrouter"]);
  });

  it("pins Ling to ROCm and states both conditions it needs to load", () => {
    const placement = placementOf(placements, "n5air/ling-3.0-flash", "llama-rocm");
    if (placement === null) throw new Error("Ling has no llama-rocm placement");
    if (placement.verdict !== "runs") throw new Error(`Ling on llama-rocm is ${placement.verdict}`);
    assert.deepEqual(placement.requires?.env, { GGML_HIP_ENABLE_UNIFIED_MEMORY: "1" });
    assert.deepEqual(placement.requires?.args, ["--load-mode", "none"]);
  });

  it("never routes Ling to LM Studio, where it succeeds slowly instead of failing", () => {
    // The dangerous case: it segfaults on Vulkan and LM Studio falls back to CPU at ~3 tok/s. A
    // lane routed here does not fail, it takes an hour and reads as a hung agent.
    assert.equal(canRun(placements, "n5air/ling-3.0-flash", "lm-studio"), false);
    assert.equal(refusalOf(placements, "n5air/ling-3.0-flash", "lm-studio"), "unusably-slow");
    assert.deepEqual(backendsFor(placements, "n5air/ling-3.0-flash"), ["llama-rocm"]);
  });

  it("makes Qwen3.8-27B on LM Studio the local smoke and evaluation seat", () => {
    assert.equal(canRun(placements, "n5air/qwen3.8-27b", "lm-studio"), true);
    assert.deepEqual(backendsFor(placements, "n5air/qwen3.8-27b"), ["lm-studio"]);
    assert.equal(placementOf(placements, "n5air/qwen3.8-27b", "lm-studio")?.verdict, "runs");
  });

  it("keeps the `n5air/` seats off the relay, because that namespace names this box", () => {
    for (const model of ["n5air/qwen3.8-27b", "n5air/ling-3.0-flash"]) {
      assert.equal(refusalOf(placements, model, "openrouter"), "not-served-here", model);
    }
  });

  it("keeps closed weights off both local backends for a reason no rebuild changes", () => {
    assert.equal(refusalOf(placements, "x-ai/grok-4.5", "lm-studio"), "not-served-here");
    assert.equal(refusalOf(placements, "x-ai/grok-4.5", "llama-rocm"), "not-served-here");
    assert.deepEqual(backendsFor(placements, "x-ai/grok-4.5"), ["openrouter"]);
  });
});

describe("what the matrix declines to claim", () => {
  it("says `unverified` rather than inventing a verdict for a pair nobody has tried", () => {
    const untried = placements.filter((placement) => placement.verdict === "unverified");
    assert.equal(untried.length > 0, true);
    for (const placement of untried) {
      assert.notEqual(placement.why.trim(), "", `${placement.model} ${placement.backend}`);
    }
  });

  it("treats `unverified` as 'do not route here', not as permission", () => {
    // Failing closed is the whole point of the third verdict: it records ignorance without
    // spending it. `canRun` is the question "may I dispatch without probing first".
    for (const placement of placements) {
      if (placement.verdict !== "unverified") continue;
      assert.equal(canRun(placements, placement.model, placement.backend), false);
      assert.equal(refusalOf(placements, placement.model, placement.backend), null);
    }
  });

  it("omits kimi, because it is reached through the subagent seam and not through ctx.llm", () => {
    // `routing` pins it, but opencode's own router addresses it. Placing it here would imply this
    // package could send it somewhere, and no adapter here ever will.
    assert.equal(placedModels(placements).includes("moonshotai/kimi-k3"), false);
    assert.equal(placementOf(placements, "moonshotai/kimi-k3", "openrouter"), null);
  });

  it("carries no quota, spend or load, because all three are wrong by the time they ship", () => {
    const serialised = JSON.stringify(placements);
    for (const moving of ["quota", "credits", "balance", "tok/s left", "remaining"]) {
      assert.equal(serialised.includes(moving), false, moving);
    }
  });
});


describe("configured placement mechanism refuses before exposure", () => {
  it("accepts an empty membership without retaining the compatibility table", () => {
    const empty = { backends: [], entries: [] };
    assert.deepEqual(checkCapability(empty), []); assert.deepEqual(placedModels(requirePlacements(empty)), []);
    for (const model of placedModels(placements)) assert.deepEqual(backendsFor(requirePlacements(empty), model), []);
  });
  for (const [change, expected] of [
    [{ verdict: "refused" }, "placement-reason-invalid"],
    [{ verdict: "runs", requires: {} }, "placement-requires-invalid"],
    [{ verdict: "invented" }, "placement-verdict-unsupported"],
    [{ verdict: "unverified", reason: "not-served-here" }, "placement-reason-invalid"],
    [{ verdict: "refused", reason: "invented" }, "placement-reason-invalid"],
    [{ verdict: "unverified", requires: { args: ["--something"] } }, "placement-requires-invalid"],
    [{ backend: "unimplemented" }, "placement-backend-unsupported"],
  ] as const) it(`rejects ${expected} with a fixed code`, () => {
    const configured = { backends: ["lm-studio"], entries: [Object.assign({ model: "synthetic", backend: "lm-studio", verdict: "runs", why: "synthetic" }, change)] };
    assert.ok(checkCapability(configured).some(p => p.code === expected));
    assert.throws(() => requirePlacements(configured), new RegExp(expected));
  });
  it("copies and freezes independent placements and never leaks another project's members", () => {
    const input = { backends: ["lm-studio"], entries: [{ model: "second-project-only", backend: "lm-studio", verdict: "runs", why: "synthetic" }] };
    const second = requirePlacements(input); input.entries[0]!.model = "mutated";
    assert.deepEqual(placedModels(second), ["second-project-only"]);
    assert.deepEqual(backendsFor(second, "second-project-only"), ["lm-studio"]);
    assert.deepEqual(backendsFor(placements, "second-project-only"), []);
    for (const model of placedModels(placements)) assert.deepEqual(backendsFor(second, model), []);
    assert.throws(() => Object.assign(second[0]!, { model: "mutated" }), TypeError);
  });
  it("does not place refusal values or credential-shaped backend identifiers in diagnostics", () => {
    const secret = "sk-or-v1-" + "a".repeat(40);
    const configured = { backends: [secret], entries: [{ model: secret, backend: secret, verdict: secret, why: secret, reason: secret }] };
    const problems = checkCapability(configured);
    assert.ok(problems.length > 0); assert.ok(!JSON.stringify(problems).includes(secret));
    assert.throws(() => requirePlacements(configured), e => e instanceof RangeError && !e.message.includes(secret));
  });
});
