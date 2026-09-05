import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkEvaluator, type RunIdentity } from "./family.js";
import { MODEL_IDS, OPENCODE_MODEL_IDS, OPENROUTER_MODEL_IDS } from "./models.js";
import { DEEP_RESEARCH_LANES, LANES, LANE_CONSTRAINTS, TIERS, TIER_LANES, lanePolicy } from "./policy.js";
import type { Route, RouteStep } from "./policy.js";
import {
  checkPolicy,
  laneChain,
  resolveEffort,
  resolveFallback,
  resolveRoute,
  tierPlan,
  toDispatch,
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
    assert.deepEqual(checkPolicy(), []);
  });

  it("routes every declared lane, and nothing it has not declared", () => {
    for (const lane of LANES) {
      assert.notEqual(laneChain(lane), null, lane);
    }
    assert.equal(laneChain("no_such_lane"), null);
    assert.equal(lanePolicy("no_such_lane"), null);
  });

  it("keeps deep research on native transport", () => {
    for (const lane of DEEP_RESEARCH_LANES) {
      const constraint = LANE_CONSTRAINTS[lane];
      assert.notEqual(constraint, undefined, lane);
      assert.deepEqual(constraint?.transports, ["native"]);
      const chain = laneChain(lane) ?? [];
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
    const step = expectRoute(resolveRoute("planning_decisions"));
    assert.equal(step.route.model, MODEL_IDS.opus);
    assert.equal(step.route.effort, "high");
    assert.equal(step.route.transport, "native");
  });

  it("refuses to guess between the two primaries of a formal evaluation lane", () => {
    assert.deepEqual(resolveRoute("formal_impl_evaluation"), {
      ok: false,
      reason: "author-family-required",
      lane: "formal_impl_evaluation",
    });
  });

  it("picks the evaluator leg from the author's family", () => {
    const forOpenai = expectRoute(resolveRoute("formal_impl_evaluation", "openai"));
    assert.equal(forOpenai.route.model, MODEL_IDS.fable);
    const forAnthropic = expectRoute(resolveRoute("formal_impl_evaluation", "anthropic"));
    assert.equal(forAnthropic.route.model, MODEL_IDS.codexSol);
    assert.equal(forAnthropic.route.effort, "xhigh");
  });

  it("has no formal evaluation seat for an author family the matrix does not admit", () => {
    assert.deepEqual(resolveRoute("formal_plan_evaluation", "google"), {
      ok: false,
      reason: "no-primary-for-family",
      lane: "formal_plan_evaluation",
      authorFamily: "google",
    });
  });

  it("reports an unknown lane rather than falling back to something plausible", () => {
    assert.deepEqual(resolveRoute("planning"), { ok: false, reason: "unknown-lane", lane: "planning" });
  });
});

describe("resolveFallback", () => {
  const boundary = { atTurnBoundary: true } as const;

  it("crosses families when the primary runs out of window", () => {
    const { step, index } = expectFallback(
      resolveFallback({ lane: "deep_analysis", trigger: "token-limit", from: 0, ...boundary }),
    );
    assert.equal(index, 1);
    assert.equal(step.route.model, MODEL_IDS.codexSol);
    assert.equal(step.route.effort, "high");
  });

  it("skips a step whose trigger does not match", () => {
    // docs_polish falls back Fable -> Opus on a token limit, but losing the Claude surface
    // entirely skips past Opus to the relay. Reaching the right step is chain order, not luck.
    const { step, index } = expectFallback(
      resolveFallback({ lane: "docs_polish", trigger: "no-claude-surface", from: 0, ...boundary }),
    );
    assert.equal(index, 2);
    assert.equal(step.route.model, OPENROUTER_MODEL_IDS.designGlm);
    assert.equal(step.route.transport, "openrouter");
  });

  it("will not swap the route in the middle of a turn", () => {
    assert.deepEqual(
      resolveFallback({ lane: "deep_analysis", trigger: "token-limit", from: 0, atTurnBoundary: false }),
      { ok: false, reason: "turn-boundary-required" },
    );
  });

  it("stops falling back once the run has fallen back enough", () => {
    assert.deepEqual(
      resolveFallback({
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
      resolveFallback({ lane: "docs_audit", trigger: "token-limit", from: 0, ...boundary }),
      { ok: false, reason: "no-route" },
    );
  });

  it("reaches the relay evaluator on a deliberate third opinion, not only on failure", () => {
    const { step } = expectFallback(
      resolveFallback({
        lane: "formal_plan_evaluation",
        trigger: "third-opinion",
        from: 1,
        ...boundary,
      }),
    );
    assert.equal(step.route.model, OPENROUTER_MODEL_IDS.planEvaluator);
    assert.equal(step.certifies, "any");
  });

  it("has a native step left when the relay itself is limited", () => {
    const { step } = expectFallback(
      resolveFallback({
        lane: "formal_plan_evaluation",
        trigger: "openrouter-limit",
        from: 2,
        depth: 1,
        ...boundary,
      }),
    );
    assert.equal(step.route.model, MODEL_IDS.agyDocs);
    assert.equal(step.route.transport, "native");
  });

  it("reports an unknown lane", () => {
    assert.deepEqual(
      resolveFallback({ lane: "nope", trigger: "token-limit", from: 0, ...boundary }),
      { ok: false, reason: "unknown-lane" },
    );
  });
});

describe("resolveEffort", () => {
  it("answers the step's own effort when nothing is escalating", () => {
    const step = expectRoute(resolveRoute("docs_audit"));
    assert.deepEqual(resolveEffort(step), { ok: true, effort: "medium" });
  });

  it("honours an escalation the step declared", () => {
    const step = expectRoute(resolveRoute("docs_audit"));
    assert.deepEqual(resolveEffort(step, "large_changeset"), { ok: true, effort: "high" });
  });

  it("refuses an escalation nobody wrote down", () => {
    const step = expectRoute(resolveRoute("docs_audit"));
    assert.deepEqual(resolveEffort(step, "feels_hard"), {
      ok: false,
      reason: "undeclared-escalation",
      condition: "feels_hard",
    });
    const noDiscretion = expectRoute(resolveRoute("normal_implementation"));
    assert.deepEqual(resolveEffort(noDiscretion, "large_changeset"), {
      ok: false,
      reason: "undeclared-escalation",
      condition: "large_changeset",
    });
  });
});

describe("tiers", () => {
  it("pairs every implementation tier with a review lane that may certify it", () => {
    for (const tier of TIERS) {
      const plan = tierPlan(tier);
      assert.notEqual(plan, null, tier);
      if (plan === null) continue;

      assert.equal(plan.implement.step.route.harness, "codex");
      const verdict = checkEvaluator({
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
    for (const tier of TIERS) {
      const chain = laneChain(TIER_LANES[tier].review) ?? [];
      for (const step of chain) {
        assert.equal(step.route.harness, "claude", `${tier} review ran on ${step.route.harness}`);
      }
    }
  });

  it("names the four tiers in the matrix's own order", () => {
    assert.deepEqual([...TIERS], ["light", "normal", "complex", "fast"]);
    assert.equal(TIER_LANES.light.implement, "light_implementation");
    assert.equal(TIER_LANES.fast.review, "review_codex_fast");
  });
});

describe("toDispatch", () => {
  it("carries only routing fields", () => {
    const step = expectRoute(resolveRoute("normal_implementation"));
    assert.deepEqual(toDispatch(step.route), {
      harness: "codex",
      model: MODEL_IDS.codexSol,
      effort: "medium",
    });
  });

  it("carries the profile a relay route needs to bind its credential", () => {
    const step = expectRoute(resolveRoute("major_ui_ux_design"));
    assert.deepEqual(toDispatch(step.route), {
      harness: "claude",
      model: OPENROUTER_MODEL_IDS.designGlm,
      effort: "xhigh",
      profile: "claude-openrouter",
    });
  });

  it("splits an opencode route into an unprefixed model and its router", () => {
    const step = expectRoute(resolveRoute("adversarial_design_eval"));
    assert.deepEqual(toDispatch(step.route), {
      harness: "opencode",
      model: OPENCODE_MODEL_IDS.visionEval,
      effort: "high",
      router: "openrouter",
    });
  });

  it("applies a resolved escalation instead of the step's base effort", () => {
    const step = expectRoute(resolveRoute("docs_audit"));
    const escalated = resolveEffort(step, "large_changeset");
    assert.equal(escalated.ok, true);
    if (!escalated.ok) return;
    assert.equal(toDispatch(step.route, escalated.effort).effort, "high");
  });
});
