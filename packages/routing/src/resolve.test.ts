import { loadRoutingConfiguration } from "./load.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
const loadedA = await loadRoutingConfiguration({ path: fileURLToPath(new URL("../config/routing.v1.json", import.meta.url)) });
assert.ok(loadedA.ok);
const A = loadedA.loaded.configuration;


import { checkEvaluator, type RunIdentity } from "./family.js";

import { FALLBACK_TRIGGERS } from "./schema.js";
import { lanePolicy } from "./configuration.js";
import type { Certifies, Route, RouteStep } from "./schema.js";
import {
  checkPolicy,
  laneChain,
  resolveEffort,
  resolveFallback,
  resolveRoute,
  selfCertifies,
  tierPlan,
  toDispatch,
  unreviewedSteps,
  type FallbackOutcome,
  type RouteResolution,
} from "./resolve.js";

function expectRoute(resolution: RouteResolution): RouteStep {
  if (!resolution.ok) assert.fail(`expected a route, got ${resolution.reason}`);
  return resolution.step;
}

function expectFallback(outcome: FallbackOutcome): { step: RouteStep; index: number } {
  if (!outcome.ok) assert.fail(`expected a fallback, got ${outcome.reason}`);
  return { step: outcome.step, index: outcome.index };
}

function runOf(route: Route, runId: string): RunIdentity {
  return {
    runId,
    seam: "subagents",
    harness: route.harness,
    model: route.model,
    transport: route.transport,
  };
}

describe("the matrix itself", () => {
  it("satisfies every invariant this package is supposed to hold", () => {
    assert.deepEqual(checkPolicy(A), []);
  });

  it("routes every declared lane, and nothing it has not declared", () => {
    for (const lane of A.lanes.map(l => l.lane)) {
      assert.notEqual(laneChain(A, lane), null, lane);
    }
    assert.equal(laneChain(A, "no_such_lane"), null);
    assert.equal(lanePolicy(A, "no_such_lane"), null);
  });

  it("keeps deep research on native transport", () => {
    for (const lane of A.deepResearchLanes) {
      const constraint = A.constraints[lane];
      assert.notEqual(constraint, undefined, lane);
      assert.deepEqual(constraint?.transports, ["native"]);
      const chain = laneChain(A, lane) ?? [];
      assert.ok(chain.length > 0);
      for (const step of chain) {
        assert.equal(step.route.transport, "native", lane);
        assert.ok(
          step.route.harness === "agy" || step.route.harness.startsWith("codex"),
          `${lane} ran on ${step.route.harness}`,
        );
      }
    }
  });
});

describe("resolveRoute", () => {
  it("answers with the primary for a single-primary lane", () => {
    const step = expectRoute(resolveRoute(A, "planning_decisions"));
    assert.equal(step.route.model, "opus-5");
    assert.equal(step.route.effort, "high");
    assert.equal(step.route.transport, "native");
  });

  it("refuses to guess between the two primaries of a formal evaluation lane", () => {
    assert.deepEqual(resolveRoute(A, "formal_impl_evaluation"), {
      ok: false,
      reason: "author-family-required",
      lane: "formal_impl_evaluation",
    });
  });

  it("picks the evaluator leg from the author's family", () => {
    const forOpenai = expectRoute(resolveRoute(A, "formal_impl_evaluation", "openai"));
    assert.equal(forOpenai.route.model, "fable-5");
    const forAnthropic = expectRoute(resolveRoute(A, "formal_impl_evaluation", "anthropic"));
    assert.equal(forAnthropic.route.model, "gpt-5.6-sol");
    assert.equal(forAnthropic.route.effort, "xhigh");
  });

  it("has no formal evaluation seat for an author family the matrix does not admit", () => {
    assert.deepEqual(resolveRoute(A, "formal_plan_evaluation", "google"), {
      ok: false,
      reason: "no-primary-for-family",
      lane: "formal_plan_evaluation",
      authorFamily: "google",
    });
  });

  it("reports an unknown lane rather than falling back to something plausible", () => {
    assert.deepEqual(resolveRoute(A, "planning"), { ok: false, reason: "unknown-lane", lane: "planning" });
  });
});

describe("resolveFallback", () => {
  const boundary = { atTurnBoundary: true } as const;

  it("crosses families when the primary runs out of window", () => {
    const { step, index } = expectFallback(
      resolveFallback(A, { lane: "deep_analysis", trigger: "token-limit", from: 0, ...boundary }),
    );
    assert.equal(index, 1);
    assert.equal(step.route.model, "gpt-5.6-sol");
    assert.equal(step.route.effort, "high");
  });

  it("skips a step whose trigger does not match", () => {
    // docs_polish falls back Fable -> Opus on a token limit, but losing the Claude surface
    // entirely skips past Opus to the relay. Reaching the right step is chain order, not luck.
    const { step, index } = expectFallback(
      resolveFallback(A, { lane: "docs_polish", trigger: "no-claude-surface", from: 0, ...boundary }),
    );
    assert.equal(index, 2);
    assert.equal(step.route.model, "z-ai/glm-5.2");
    assert.equal(step.route.transport, "openrouter");
  });

  it("will not swap the route in the middle of a turn", () => {
    assert.deepEqual(
      resolveFallback(A, { lane: "deep_analysis", trigger: "token-limit", from: 0, atTurnBoundary: false }),
      { ok: false, reason: "turn-boundary-required" },
    );
  });

  it("stops falling back once the run has fallen back enough", () => {
    assert.deepEqual(
      resolveFallback(A, {
        lane: "docs_polish",
        trigger: "no-claude-surface",
        from: 0,
        depth: 2,
        maxDepth: 2,
        ...boundary,
      }),
      { ok: false, reason: "depth-exceeded" },
    );
  });

  it("gives the single-pass docs audit nowhere to go, by design", () => {
    // A cross-family fallback would defeat the lane rather than rescue it: the audit is defined
    // by being opposite-family to the Claude generators.
    assert.deepEqual(
      resolveFallback(A, { lane: "docs_audit", trigger: "token-limit", from: 0, ...boundary }),
      { ok: false, reason: "no-route" },
    );
  });

  it("reaches the relay evaluator on a deliberate third opinion, not only on failure", () => {
    const { step } = expectFallback(
      resolveFallback(A, {
        lane: "formal_plan_evaluation",
        trigger: "third-opinion",
        from: 1,
        ...boundary,
      }),
    );
    assert.equal(step.route.model, "qwen/qwen3.8-flash");
    assert.equal(step.certifies, "any");
  });

  it("has a native step left when the relay itself is limited", () => {
    const { step } = expectFallback(
      resolveFallback(A, {
        lane: "formal_plan_evaluation",
        trigger: "openrouter-limit",
        from: 2,
        depth: 1,
        ...boundary,
      }),
    );
    assert.equal(step.route.model, "gemini-3.6-flash-high");
    assert.equal(step.route.transport, "native");
  });

  it("reports an unknown lane", () => {
    assert.deepEqual(
      resolveFallback(A, { lane: "nope", trigger: "token-limit", from: 0, ...boundary }),
      { ok: false, reason: "unknown-lane" },
    );
  });
});

describe("resolveEffort", () => {
  it("answers the step's own effort when nothing is escalating", () => {
    const step = expectRoute(resolveRoute(A, "docs_audit"));
    assert.deepEqual(resolveEffort(A, step), { ok: true, effort: "medium" });
  });

  it("honours an escalation the step declared", () => {
    const step = expectRoute(resolveRoute(A, "docs_audit"));
    assert.deepEqual(resolveEffort(A, step, "large_changeset"), { ok: true, effort: "high" });
  });

  it("refuses an escalation nobody wrote down", () => {
    const step = expectRoute(resolveRoute(A, "docs_audit"));
    assert.deepEqual(resolveEffort(A, step, "feels_hard"), {
      ok: false,
      reason: "undeclared-escalation",
      condition: "feels_hard",
    });
    const noDiscretion = expectRoute(resolveRoute(A, "normal_implementation"));
    assert.deepEqual(resolveEffort(A, noDiscretion, "large_changeset"), {
      ok: false,
      reason: "undeclared-escalation",
      condition: "large_changeset",
    });
  });
});

describe("tiers", () => {
  it("pairs every implementation tier with a review lane that may certify it", () => {
    for (const tier of A.tiers.map(t => t.tier)) {
      const plan = tierPlan(A, tier);
      assert.notEqual(plan, null, tier);
      if (plan === null) continue;

      assert.equal(plan.implement.step.route.harness, "codex");
      const verdict = checkEvaluator(A, {
        author: runOf(plan.implement.step.route, `impl-${tier}`),
        evaluator: runOf(plan.review.step.route, `review-${tier}`),
        ...(plan.review.step.certifies === undefined ? {} : { certifies: plan.review.step.certifies }),
      });
      assert.equal(verdict.ok, true, `${tier}: ${JSON.stringify(verdict)}`);
    }
  });

  it("keeps every review fallback inside the Claude family", () => {
    // Availability is never traded for opposite-family review: a Codex-authored change reviewed
    // by another Codex run is the invariant failing quietly.
    for (const tier of A.tiers.map(t => t.tier)) {
      const chain = laneChain(A, A.tiers.find(t => t.tier === tier)!.review) ?? [];
      for (const step of chain) {
        assert.equal(step.route.harness, "claude", `${tier} review ran on ${step.route.harness}`);
      }
    }
  });

  it("names the four tiers in the matrix's own order", () => {
    assert.deepEqual([...A.tiers.map(t => t.tier)], ["light", "normal", "complex", "fast"]);
    assert.equal(A.tiers.find(t => t.tier === "light")!.implement, "light_implementation");
    assert.equal(A.tiers.find(t => t.tier === "fast")!.review, "review_codex_fast");
  });
});

describe("toDispatch", () => {
  it("carries only routing fields", () => {
    const step = expectRoute(resolveRoute(A, "normal_implementation"));
    assert.deepEqual(toDispatch(A, step.route), {
      harness: "codex",
      model: "gpt-5.6-sol",
      effort: "medium",
    });
  });

  it("carries the profile a relay route needs to bind its credential", () => {
    const step = expectRoute(resolveRoute(A, "major_ui_ux_design"));
    assert.deepEqual(toDispatch(A, step.route), {
      harness: "claude",
      model: "z-ai/glm-5.2",
      effort: "xhigh",
      profile: "claude-openrouter",
    });
  });

  it("splits an opencode route into an unprefixed model and its router", () => {
    const step = expectRoute(resolveRoute(A, "adversarial_design_eval"));
    assert.deepEqual(toDispatch(A, step.route), {
      harness: "opencode",
      model: "moonshotai/kimi-k3",
      effort: "high",
      router: "openrouter",
    });
  });

  it("applies a resolved escalation instead of the step's base effort", () => {
    const step = expectRoute(resolveRoute(A, "docs_audit"));
    const escalated = resolveEffort(A, step, "large_changeset");
    assert.equal(escalated.ok, true);
    if (!escalated.ok) return;
    assert.equal(toDispatch(A, step.route, escalated.effort).effort, "high");
  });
});

/**
 * A step on a chain nobody has committed.
 *
 * The direct predicate cases below supplement document-level invalid fixture tests, which show
 * that today's matrix passes — never that a violation would be caught. These build the broken tables
 * the repo must never contain, so the two invariants are proven to fire rather than merely present.
 */
function stepOf(model: string, certifies?: Certifies): RouteStep {
  const route: Route = { harness: "claude", transport: "native", model, effort: "medium" };
  return certifies === undefined ? { route, when: [] } : { route, when: [], certifies };
}

describe("selfCertifies", () => {
  it("catches a seat that certifies the family that authored it", () => {
    assert.equal(selfCertifies(A, stepOf("opus-5", "anthropic")), true);
    assert.equal(selfCertifies(A, stepOf("gpt-6-astra", "openai")), true);
  });

  it("accepts a seat that certifies somebody else", () => {
    assert.equal(selfCertifies(A, stepOf("opus-5", "openai")), false);
    assert.equal(selfCertifies(A, stepOf("gpt-6-astra", "anthropic")), false);
  });

  it("does not read `any` or `none` as a family", () => {
    // `familyOf` never answers either string, so a naive equality would call both of these clean
    // for the wrong reason. They are clean because neither names a family at all.
    assert.equal(selfCertifies(A, stepOf("opus-5", "any")), false);
    assert.equal(selfCertifies(A, stepOf("opus-5", "none")), false);
    assert.equal(selfCertifies(A, stepOf("opus-5")), false);
  });

  it("stays quiet about a model it cannot place", () => {
    // Reported once, as an unpinned model. An unknown family is not evidence of self-certification.
    assert.equal(selfCertifies(A, stepOf("not-a-pinned-model", "anthropic")), false);
  });

  it("holds across the live matrix", () => {
    for (const policy of A.lanes) {
      for (const step of policy.chain) {
        assert.equal(selfCertifies(A, step), false, `${policy.lane} routes ${step.route.model}`);
      }
    }
  });
});

describe("unreviewedSteps", () => {
  const astra = stepOf("gpt-6-astra");
  const opus = stepOf("opus-5");

  it("names the fallback no reviewer covers, not just the primary", () => {
    // The shape the check exists for: a lane whose primary is Codex-authored and whose fallback is
    // not. `tierPlan` resolves against the primary's family and reports the tier as healthy.
    assert.deepEqual(unreviewedSteps(A, [astra, opus], [stepOf("opus-5", "openai")]), [1]);
  });

  it("accepts a reviewer that certifies whoever authored", () => {
    assert.deepEqual(unreviewedSteps(A, [astra, opus], [stepOf("opus-5", "any")]), []);
  });

  it("accepts one reviewer per author family", () => {
    const review = [stepOf("opus-5", "openai"), stepOf("gpt-5.6-sol", "anthropic")];
    assert.deepEqual(unreviewedSteps(A, [astra, opus], review), []);
  });

  it("does not count a seat that certifies nothing", () => {
    assert.deepEqual(unreviewedSteps(A, [astra, opus], [stepOf("opus-5", "none")]), [0, 1]);
    assert.deepEqual(unreviewedSteps(A, [astra, opus], []), [0, 1]);
  });

  it("skips a step whose model it cannot place", () => {
    assert.deepEqual(unreviewedSteps(A, [stepOf("not-a-pinned-model")], []), []);
  });
});

describe("the Astra row", () => {
  it("leads complex implementation, and falls back on a CLI that cannot reach it", () => {
    const chain = laneChain(A, "complex_implementation") ?? [];
    assert.equal(chain.length, 2);
    assert.deepEqual(toDispatch(A, chain[0]?.route ?? ({} as Route)), {
      harness: "codex",
      model: "gpt-6-astra",
      effort: "medium",
    });
    assert.deepEqual(chain[0]?.when, []);

    // Not `native-quota-limit`. A quota trigger would mean the subscription is spent, and falling
    // back to a second model on that same subscription would be a fallback in name only.
    assert.deepEqual(chain[1]?.when, ["model-unavailable"]);
    assert.equal(chain[1]?.route.model, "gpt-5.6-sol");
    assert.ok(FALLBACK_TRIGGERS.includes("model-unavailable"));
  });

  it("keeps a reviewer for every step of the complex tier, not only its primary", () => {
    const lanes = A.tiers.find(t => t.tier === "complex")!;
    assert.deepEqual(unreviewedSteps(A, laneChain(A, lanes.implement) ?? [], laneChain(A, lanes.review) ?? []), []);
  });
});
