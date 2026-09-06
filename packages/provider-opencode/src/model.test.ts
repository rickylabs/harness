/**
 * `router:` and `model:` becoming `{ providerID, modelID }`, and the one case that refuses.
 *
 * #55's second acceptance criterion. The translation is an assignment, so most of what is worth
 * testing is what it will not do: invent a router, and guess at a model id whose spelling collides
 * with one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROUTERS, TIMER_CEILING_MS, type DispatchRequest } from "@rickylabs/subagents";

import { translateModel, untranslated } from "./model.js";

function request(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    harness: "opencode",
    model: "z-ai/glm-5.2",
    effort: "medium",
    router: "openrouter",
    prompt: "do the thing",
    ...overrides,
  };
}

describe("translateModel", () => {
  it("puts the router in providerID and the model in modelID, verbatim", () => {
    const translated = translateModel(request());
    assert.deepEqual(translated, {
      ok: true,
      model: { providerID: "openrouter", modelID: "z-ai/glm-5.2" },
    });
  });

  it("passes a vendor-prefixed model through untouched", () => {
    // `z-ai/`, `qwen/`, `x-ai/` are the vendor's own namespaces, not routers. Only a first segment
    // that is a *router* is ambiguous.
    for (const model of ["qwen/qwen3.8-flash", "x-ai/grok-4.5", "moonshotai/kimi-k3"]) {
      const translated = translateModel(request({ model }));
      assert.equal(translated.ok, true);
      if (!translated.ok) throw new Error("expected ok");
      assert.equal(translated.model.modelID, model);
    }
  });

  it("honours all four routers", () => {
    for (const router of ROUTERS) {
      const translated = translateModel(request({ router, model: "some-model" }));
      assert.equal(translated.ok, true);
      if (!translated.ok) throw new Error("expected ok");
      assert.equal(translated.model.providerID, router);
    }
  });

  it("refuses a request with no router, for both opencode harnesses", () => {
    // Stricter than `validateDispatch`, which requires `router` only for `opencode`. Deliberate: the
    // prompt body's `providerID` has no default, and inventing one here would put a routing decision
    // in a second place.
    for (const harness of ["opencode", "opencode-run"] as const) {
      const { router: _drop, ...rest } = request({ harness });
      const translated = translateModel(rest);
      assert.equal(translated.ok, false);
      if (translated.ok) throw new Error("expected a refusal");
      assert.match(translated.detail, /needs a router/);
      assert.match(translated.detail, /openrouter/);
    }
  });

  it("refuses a request with no model", () => {
    const { model: _drop, ...rest } = request();
    const translated = translateModel(rest);
    assert.equal(translated.ok, false);
    if (translated.ok) throw new Error("expected a refusal");
    assert.match(translated.detail, /names no model/);
    assert.equal(translateModel(request({ model: "" })).ok, false);
  });

  it("refuses the doubled router prefix rather than guessing at it", () => {
    // `routing` pins the two local evaluator seats *with* their `n5air/` prefix, and `n5air` is also
    // a router. Stripping it and sending it doubled are both guesses, and a guess that lands wrong
    // runs the job against a model nobody asked for — the failure shape #59 exists because of.
    const translated = translateModel(request({ router: "n5air", model: "n5air/qwen3.8-27b" }));
    assert.equal(translated.ok, false);
    if (translated.ok) throw new Error("expected a refusal");
    assert.match(translated.detail, /already carries the router prefix/);
    assert.match(translated.detail, /nothing was launched/);
  });

  it("says something different when the prefix disagrees with the router", () => {
    const translated = translateModel(request({ router: "openrouter", model: "n5air/ling-3.0-flash" }));
    assert.equal(translated.ok, false);
    if (translated.ok) throw new Error("expected a refusal");
    assert.match(translated.detail, /while the request routes through/);
  });

  it("does not mistake a leading slash for a prefix", () => {
    const translated = translateModel(request({ model: "/odd-model" }));
    assert.equal(translated.ok, true);
  });
});

describe("untranslated", () => {
  it("names every field the prompt body cannot carry", () => {
    const lost = untranslated(
      request({ effort: "high", maxTokens: "500k", profile: "build", timeout: "30m" }),
    );
    assert.equal(lost.length, 3);
    assert.match(lost.join("; "), /effort=high/);
    assert.match(lost.join("; "), /max-tokens=500k/);
    assert.match(lost.join("; "), /profile=build/);
  });

  it("says nothing about a timeout the provider can actually arm", () => {
    assert.deepEqual(untranslated({ harness: "opencode", model: "m", router: "openai", prompt: "p", timeout: "30m" }), []);
  });

  it("says so when a deadline is clamped to the timer ceiling", () => {
    // Past `2^31 - 1` ms Node wraps the delay to 1 and fires on the next tick, which turns "stop this
    // in a month" into "stop this now". Clamping is the lesser wrong; saying so is the point.
    const lost = untranslated(request({ timeout: "9000h" }));
    assert.equal(lost.length, 2);
    assert.match(lost.join("; "), new RegExp(`clamped to ${TIMER_CEILING_MS}ms`));
  });

  it("is empty for a request with nothing to lose", () => {
    assert.deepEqual(untranslated({ harness: "opencode", model: "m", router: "openai", prompt: "p" }), []);
  });
});
