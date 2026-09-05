import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkEvaluator, familyOfRun, type RunIdentity } from "./family.js";
import { MODEL_IDS, OPENCODE_MODEL_IDS, OPENROUTER_MODEL_IDS } from "./models.js";

const nativeOpus: RunIdentity = {
  runId: "run-opus",
  seam: "subagents",
  harness: "claude",
  model: MODEL_IDS.opus,
  transport: "native",
};

const nativeFable: RunIdentity = {
  runId: "run-fable",
  seam: "subagents",
  harness: "claude",
  model: MODEL_IDS.fable,
  transport: "native",
};

const nativeCodex: RunIdentity = {
  runId: "run-codex",
  seam: "subagents",
  harness: "codex",
  model: MODEL_IDS.codexSol,
  transport: "native",
};

/** The Claude CLI pointed at OpenRouter. The harness says claude; the weights are not Anthropic's. */
const relayGlmUnderClaude: RunIdentity = {
  runId: "run-relay-glm",
  seam: "subagents",
  harness: "claude",
  model: OPENROUTER_MODEL_IDS.implEvaluator,
  transport: "openrouter",
};

/** The same weights on the other seam, metered per token instead of by quota window. */
const llmGlm: RunIdentity = {
  runId: "run-llm-glm",
  seam: "llm",
  model: OPENROUTER_MODEL_IDS.implEvaluator,
  transport: "openrouter",
};

describe("familyOfRun", () => {
  it("reads the family off the model, not off the harness", () => {
    assert.equal(familyOfRun(nativeOpus), "anthropic");
    // Same harness, same seam, different family — because the model is what was actually run.
    assert.equal(familyOfRun(relayGlmUnderClaude), "open");
  });

  it("gives the same answer on either seam", () => {
    assert.equal(familyOfRun(relayGlmUnderClaude), familyOfRun(llmGlm));
  });
});

describe("checkEvaluator", () => {
  it("accepts opposite-family review", () => {
    const verdict = checkEvaluator({ author: nativeCodex, evaluator: nativeFable });
    assert.deepEqual(verdict, { ok: true, authorFamily: "openai", evaluatorFamily: "anthropic" });
  });

  it("refuses a run reviewing itself", () => {
    const verdict = checkEvaluator({ author: nativeOpus, evaluator: nativeOpus });
    assert.deepEqual(verdict, { ok: false, reason: "same-run", runId: nativeOpus.runId });
  });

  it("refuses same-family review even across different models", () => {
    const verdict = checkEvaluator({ author: nativeFable, evaluator: nativeOpus });
    assert.deepEqual(verdict, { ok: false, reason: "same-family", family: "anthropic" });
  });

  it("refuses two runs on different seams that are running the same weights", () => {
    // This is the case a harness-derived family gets wrong in the permissive direction: one is
    // `claude`, the other is not a CLI at all, so nothing about the launch says they are the same
    // model — and letting GLM certify GLM is a run agreeing with itself.
    const verdict = checkEvaluator({ author: llmGlm, evaluator: relayGlmUnderClaude });
    assert.deepEqual(verdict, { ok: false, reason: "same-family", family: "open" });
  });

  it("accepts a relay evaluator over Claude-authored work", () => {
    // The mirror case, wrong in the restrictive direction: derive family from the harness and
    // both sides read `anthropic`, so the fleet's own approved third-opinion route would be
    // refused as self-certification. Reading the model makes it simply an open-family evaluator.
    const verdict = checkEvaluator({
      author: nativeOpus,
      evaluator: relayGlmUnderClaude,
      certifies: "any",
    });
    assert.deepEqual(verdict, { ok: true, authorFamily: "anthropic", evaluatorFamily: "open" });
  });

  it("refuses a model it cannot place, on either side", () => {
    const stranger: RunIdentity = {
      runId: "run-stranger",
      seam: "llm",
      model: "some-local-gguf",
      transport: "native",
    };
    assert.deepEqual(checkEvaluator({ author: stranger, evaluator: nativeOpus }), {
      ok: false,
      reason: "unpinned-model",
      side: "author",
      model: "some-local-gguf",
    });
    assert.deepEqual(checkEvaluator({ author: nativeOpus, evaluator: stranger }), {
      ok: false,
      reason: "unpinned-model",
      side: "evaluator",
      model: "some-local-gguf",
    });
  });

  it("refuses to let supplementary evidence act as a gate", () => {
    const vision: RunIdentity = {
      runId: "run-vision",
      seam: "subagents",
      harness: "opencode",
      model: OPENCODE_MODEL_IDS.visionEval,
      transport: "openrouter",
    };
    const verdict = checkEvaluator({ author: nativeOpus, evaluator: vision, certifies: "none" });
    assert.deepEqual(verdict, { ok: false, reason: "not-a-gate" });
  });

  it("refuses a seat bound to a different author family", () => {
    // The Codex leg of formal evaluation certifies anthropic-authored work. Pointing it at
    // agy-authored work is opposite-family and still wrong: nobody approved that pairing.
    const agy: RunIdentity = {
      runId: "run-agy",
      seam: "subagents",
      harness: "agy",
      model: MODEL_IDS.agyDocs,
      transport: "native",
    };
    const verdict = checkEvaluator({
      author: agy,
      evaluator: nativeCodex,
      certifies: "anthropic",
    });
    assert.deepEqual(verdict, {
      ok: false,
      reason: "wrong-author-family",
      certifies: "anthropic",
      authorFamily: "google",
    });
  });

  it("refuses a relay evaluator that was never approved to certify", () => {
    const designGlm: RunIdentity = {
      runId: "run-design-glm",
      seam: "subagents",
      harness: "claude",
      model: OPENROUTER_MODEL_IDS.designGlm,
      transport: "openrouter",
    };
    const verdict = checkEvaluator({ author: nativeOpus, evaluator: designGlm, certifies: "any" });
    assert.deepEqual(verdict, {
      ok: false,
      reason: "unapproved-open-evaluator",
      model: OPENROUTER_MODEL_IDS.designGlm,
    });
  });

  it("does not treat a shared seam as a conflict", () => {
    // Both are `subagents` runs on the Claude and Codex CLIs. The seam is metering, not identity.
    assert.equal(nativeFable.seam, nativeCodex.seam);
    assert.equal(checkEvaluator({ author: nativeCodex, evaluator: nativeFable }).ok, true);
  });
});
