/**
 * Reading the matrix: which step a lane starts on, where it goes when that fails, and what any
 * of it looks like on the wire.
 *
 * `policy.ts` is the data and this is the only sanctioned way to ask it a question. Everything
 * here returns a verdict rather than throwing, for the same reason `family.ts` does: at the
 * coordinator a refusal is a routing fact to record and act on, not an exception to unwind a run
 * around.
 *
 * Two refusals in particular are features and not gaps:
 *
 * - **An undeclared effort escalation is refused, never inferred.** No implicit higher-effort
 *   escalation is a harness invariant, and the only way to keep it is for the discretion to be
 *   written down on the step. `docs_audit` may go to `high` on a large changeset because it says
 *   so; nothing else may, however reasonable it would look.
 * - **A step outside the plan needs explicit approval.** No step in the current matrix declares
 *   `outside_plan`, so today this guard never fires. It exists so that the day one does, adding
 *   the row cannot quietly start spending money on a fallback nobody approved.
 */

import type { DispatchRequest } from "@rickylabs/subagents";

import { EFFORTS, familyOf, isApprovedOpenEvaluator, isPinnedModel } from "./models.js";
import type { Effort, ModelFamily } from "./models.js";
import {
  LANE_CONSTRAINTS,
  LANES,
  ROUTE_POLICY,
  TIER_LANES,
  lanePolicy,
} from "./policy.js";
import type { Certifies, FallbackTrigger, Lane, Route, RouteStep, Tier } from "./policy.js";

/**
 * The one author family a step certifies, or `null` when it does not name one.
 *
 * `"any"` and `"none"` are not families and must not be compared against one: `"any"` certifies
 * whoever authored, and `"none"` certifies nothing at all.
 */
function certifiedFamily(certifies: Certifies | undefined): ModelFamily | null {
  if (certifies === undefined || certifies === "any" || certifies === "none") return null;
  return certifies;
}

/**
 * Whether a step certifies work authored by its own family.
 *
 * Generator is not evaluator, asked of the table rather than only of a pairing. `checkEvaluator`
 * refuses such a seat at dispatch, but by then the matrix has already promised a reviewer it
 * cannot supply and the work is done. Exported so `checkPolicy` is a caller rather than the only
 * place the rule lives — a chain nobody has committed yet can be asked the same question.
 */
export function selfCertifies(step: RouteStep): boolean {
  const certified = certifiedFamily(step.certifies);
  return certified !== null && familyOf(step.route.model) === certified;
}

/**
 * The indexes in `implement` whose author family no step in `review` will certify.
 *
 * Every step of an implementation lane needs a reviewer, not just its primary. `tierPlan` resolves
 * a review lane against `openai` on the stated grounds that every implementation tier is
 * Codex-authored; that was prose, and prose does not fail a build. Add one cross-family fallback to
 * an implementation lane and the tier still resolves, still dispatches, and only refuses at
 * `checkEvaluator` — after the work is done, with no reviewer left to fall back to.
 *
 * A step whose model is not pinned is skipped rather than reported: `checkPolicy` already calls that
 * out as an unpinned model, and an unknown family is not evidence of a missing reviewer.
 */
export function unreviewedSteps(
  implement: readonly RouteStep[],
  review: readonly RouteStep[],
): readonly number[] {
  const unreviewed: number[] = [];
  for (let index = 0; index < implement.length; index += 1) {
    const step = implement[index];
    if (step === undefined) continue;
    const family = familyOf(step.route.model);
    if (family === null) continue;
    const reviewed = review.some(
      (candidate) => candidate.certifies === "any" || certifiedFamily(candidate.certifies) === family,
    );
    if (!reviewed) unreviewed.push(index);
  }
  return unreviewed;
}

/** The lane's ordered chain, or `null` for a lane the matrix does not route. */
export function laneChain(lane: string): readonly RouteStep[] | null {
  return lanePolicy(lane)?.chain ?? null;
}

/** What a lane resolves to before anything has failed. */
export type RouteResolution =
  | { readonly ok: true; readonly step: RouteStep; readonly index: number }
  | { readonly ok: false; readonly reason: "unknown-lane"; readonly lane: string }
  /** The lane has more than one primary, each bound to an author family. Say which. */
  | { readonly ok: false; readonly reason: "author-family-required"; readonly lane: Lane }
  | {
      readonly ok: false;
      readonly reason: "no-primary-for-family";
      readonly lane: Lane;
      readonly authorFamily: ModelFamily;
    };

function primaryIndexes(chain: readonly RouteStep[]): readonly number[] {
  const indexes: number[] = [];
  for (let index = 0; index < chain.length; index += 1) {
    const step = chain[index];
    if (step !== undefined && step.when.length === 0) indexes.push(index);
  }
  return indexes;
}

/**
 * Whether a step may run against work authored by `authorFamily`.
 *
 * A question about launching, not about certifying. `none` passes here — vision evidence runs
 * against any author family — and is refused by `checkEvaluator`, which is the gate. Keeping the
 * two apart is what lets a supplementary run be scheduled without it becoming a certification.
 */
function certifiesMatches(step: RouteStep, authorFamily: ModelFamily): boolean {
  const certifies = step.certifies;
  if (certifies === undefined || certifies === "any" || certifies === "none") return true;
  return certifies === authorFamily;
}

/**
 * The step a lane starts on.
 *
 * Most lanes have one primary and `authorFamily` is irrelevant. The two formal evaluation lanes
 * have two — Fable certifying openai-authored work, Codex certifying anthropic-authored work —
 * and picking between them without being told the author family is exactly the mistake the
 * generator-is-not-evaluator invariant exists to prevent, so it refuses instead of guessing.
 */
export function resolveRoute(lane: string, authorFamily?: ModelFamily): RouteResolution {
  const policy = lanePolicy(lane);
  if (policy === null) return { ok: false, reason: "unknown-lane", lane };

  const primaries = primaryIndexes(policy.chain);
  if (authorFamily === undefined) {
    if (primaries.length > 1) {
      return { ok: false, reason: "author-family-required", lane: policy.lane };
    }
    const index = primaries[0] ?? 0;
    const step = policy.chain[index];
    if (step === undefined) return { ok: false, reason: "unknown-lane", lane };
    return { ok: true, step, index };
  }

  for (const index of primaries) {
    const step = policy.chain[index];
    if (step !== undefined && certifiesMatches(step, authorFamily)) {
      return { ok: true, step, index };
    }
  }
  return { ok: false, reason: "no-primary-for-family", lane: policy.lane, authorFamily };
}

/** Why a fallback could not be taken. */
export type FallbackRefusal =
  | "unknown-lane"
  /** Swapping a route mid-turn is not a fallback, it is a different run wearing the same id. */
  | "turn-boundary-required"
  | "depth-exceeded"
  /** A step exists but is outside the plan and nobody approved paying for it. */
  | "approval-required"
  /** The chain has nowhere left to go for this trigger. The lane is out of options. */
  | "no-route";

export interface FallbackRequest {
  readonly lane: string;
  readonly trigger: FallbackTrigger;
  /** Index in the chain of the step that failed. Later steps only. */
  readonly from: number;
  /** How many fallbacks this run has already taken. */
  readonly depth?: number;
  readonly maxDepth?: number;
  /**
   * Whether the run is between turns. A fallback replaces the model mid-flight otherwise, and a
   * transcript that changes model in the middle of a turn cannot be read as one run.
   */
  readonly atTurnBoundary: boolean;
  readonly authorFamily?: ModelFamily;
  readonly explicitPaidApproval?: boolean;
}

export type FallbackOutcome =
  | { readonly ok: true; readonly step: RouteStep; readonly index: number }
  | { readonly ok: false; readonly reason: FallbackRefusal };

/** How many fallbacks a run may take before the answer is "ask a human". */
export const DEFAULT_MAX_FALLBACK_DEPTH = 2;

/**
 * The next step for a lane whose current step failed.
 *
 * Walks the chain forward from `from`, which is why chain order is data here rather than a
 * `filter` predicate over condition strings.
 */
export function resolveFallback(request: FallbackRequest): FallbackOutcome {
  const policy = lanePolicy(request.lane);
  if (policy === null) return { ok: false, reason: "unknown-lane" };

  if (!request.atTurnBoundary) return { ok: false, reason: "turn-boundary-required" };

  const depth = request.depth ?? 0;
  const maxDepth = request.maxDepth ?? DEFAULT_MAX_FALLBACK_DEPTH;
  if (depth >= maxDepth) return { ok: false, reason: "depth-exceeded" };

  let sawUnapprovedPaidStep = false;
  for (let index = request.from + 1; index < policy.chain.length; index += 1) {
    const step = policy.chain[index];
    if (step === undefined) continue;
    if (!step.when.includes(request.trigger)) continue;
    if (request.authorFamily !== undefined && !certifiesMatches(step, request.authorFamily)) {
      continue;
    }
    if (step.subscription === "outside_plan" && request.explicitPaidApproval !== true) {
      sawUnapprovedPaidStep = true;
      continue;
    }
    return { ok: true, step, index };
  }

  return { ok: false, reason: sawUnapprovedPaidStep ? "approval-required" : "no-route" };
}

export type EffortResolution =
  | { readonly ok: true; readonly effort: Effort }
  | { readonly ok: false; readonly reason: "undeclared-escalation"; readonly condition: string };

/**
 * The effort a step runs at, optionally under a named escalation condition.
 *
 * Without a condition this is the step's own effort. With one, the step must have declared that
 * condition; an undeclared escalation is refused rather than approximated upward.
 */
export function resolveEffort(step: RouteStep, condition?: string): EffortResolution {
  if (condition === undefined) return { ok: true, effort: step.route.effort };
  const declared = step.effortEscalations?.find((escalation) => escalation.condition === condition);
  if (declared === undefined) return { ok: false, reason: "undeclared-escalation", condition };
  return { ok: true, effort: declared.effort };
}

/** An implementation tier and the two lanes it runs as one unit. */
export interface TierPlan {
  readonly tier: Tier;
  readonly implement: { readonly lane: Lane; readonly step: RouteStep };
  readonly review: { readonly lane: Lane; readonly step: RouteStep };
}

/**
 * The implement-then-review pair for a tier.
 *
 * Returns `null` only if the tables disagree, which `checkPolicy` makes a test failure. The
 * review lane is resolved against `openai` because every implementation tier is Codex-authored;
 * that is not an assumption, it is what the four implementation lanes say — and `checkPolicy` now
 * holds them to it, step by step, so the day one of them stops being Codex-authored the table
 * fails rather than this line quietly becoming wrong.
 */
export function tierPlan(tier: Tier): TierPlan | null {
  const lanes = TIER_LANES[tier];
  const implement = resolveRoute(lanes.implement);
  const review = resolveRoute(lanes.review, "openai");
  if (!implement.ok || !review.ok) return null;
  return {
    tier,
    implement: { lane: lanes.implement, step: implement.step },
    review: { lane: lanes.review, step: review.step },
  };
}

/** The routing half of a dispatch payload. The caller owns the prompt and the run's budget. */
export type RoutedDispatch = Pick<DispatchRequest, "harness" | "model" | "effort" | "router" | "profile">;

/**
 * A route, as the fields a `/swarm` block carries.
 *
 * Deliberately partial: `dispatch.ts` says it "does not choose models" and that the matrix is the
 * single source of truth for which model and effort a lane gets. This is that hand-off, and it
 * ends here — the prompt, the timeout and the token budget belong to whoever is launching, not
 * to the table that decided where.
 */
export function toDispatch(route: Route, effort?: Effort): RoutedDispatch {
  const base = {
    harness: route.harness,
    model: route.model,
    effort: effort ?? route.effort,
  };
  const withRouter = route.router === undefined ? base : { ...base, router: route.router };
  return route.profile === undefined ? withRouter : { ...withRouter, profile: route.profile };
}

/** Something in `policy.ts` that violates an invariant this package is supposed to hold. */
export interface PolicyProblem {
  readonly lane: string;
  readonly index?: number;
  readonly message: string;
}

/**
 * Every invariant the matrix must satisfy, checked against the table itself.
 *
 * The table is hand-maintained and ported from another system, so the invariants that make it
 * trustworthy have to be executable or they are just more prose. This is what the suite runs, and
 * what a `doctor` command can run later against a matrix somebody has edited.
 */
export function checkPolicy(): readonly PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  const seen = new Set<string>();

  for (const policy of ROUTE_POLICY) {
    if (seen.has(policy.lane)) {
      problems.push({ lane: policy.lane, message: "lane appears more than once" });
    }
    seen.add(policy.lane);

    const constraint = LANE_CONSTRAINTS[policy.lane];
    const primaryFamilies = new Set<string>();
    let primaries = 0;

    for (let index = 0; index < policy.chain.length; index += 1) {
      const step = policy.chain[index];
      if (step === undefined) continue;
      const { route } = step;
      const at = { lane: policy.lane, index };

      if (!isPinnedModel(route.model)) {
        problems.push({ ...at, message: `model ${route.model} is not pinned in models.ts` });
      }

      const isEvaluation = policy.purpose === "evaluation";
      if (isEvaluation && step.certifies === undefined) {
        problems.push({ ...at, message: "evaluation step does not say what it certifies" });
      }
      if (!isEvaluation && step.certifies !== undefined) {
        problems.push({ ...at, message: "only evaluation steps may declare certifies" });
      }

      const isGate = step.certifies !== undefined && step.certifies !== "none";
      if (isGate && route.transport === "openrouter" && !isApprovedOpenEvaluator(route.model)) {
        problems.push({ ...at, message: `relay evaluator ${route.model} is not an approved open evaluator` });
      }

      if (selfCertifies(step)) {
        problems.push({ ...at, message: `${route.model} certifies its own family (${step.certifies})` });
      }

      if (index === 0 && step.when.length > 0) {
        problems.push({ ...at, message: "the first step of a chain must be a primary" });
      }
      if (step.when.length === 0) {
        primaries += 1;
        const family = step.certifies ?? "unbound";
        if (primaryFamilies.has(family)) {
          problems.push({ ...at, message: `two primaries certify the same thing (${family})` });
        }
        primaryFamilies.add(family);
      }

      const isOpencode = route.harness === "opencode" || route.harness === "opencode-run";
      if (isOpencode && route.router === undefined) {
        problems.push({ ...at, message: "an opencode route must name its router" });
      }
      if (!isOpencode && route.router !== undefined) {
        problems.push({ ...at, message: "only opencode routes carry a router" });
      }
      if (route.transport === "openrouter" && !isOpencode && route.profile === undefined) {
        problems.push({ ...at, message: "a relay route must name the profile that binds its credential" });
      }

      for (const escalation of step.effortEscalations ?? []) {
        if (EFFORTS.indexOf(escalation.effort) <= EFFORTS.indexOf(route.effort)) {
          problems.push({ ...at, message: `escalation ${escalation.condition} does not raise effort` });
        }
      }

      if (constraint !== undefined) {
        if (constraint.transports !== undefined && !constraint.transports.includes(route.transport)) {
          problems.push({ ...at, message: `transport ${route.transport} violates: ${constraint.why}` });
        }
        if (constraint.harnesses !== undefined && !constraint.harnesses.includes(route.harness)) {
          problems.push({ ...at, message: `harness ${route.harness} violates: ${constraint.why}` });
        }
        const family = familyOf(route.model);
        if (constraint.families !== undefined && (family === null || !constraint.families.includes(family))) {
          problems.push({ ...at, message: `family ${family ?? "unknown"} violates: ${constraint.why}` });
        }
        if (constraint.models !== undefined && !constraint.models.includes(route.model)) {
          problems.push({ ...at, message: `model ${route.model} violates: ${constraint.why}` });
        }
      }
    }

    if (primaries === 0) {
      problems.push({ lane: policy.lane, message: "chain has no primary" });
    }
  }

  for (const lane of LANES) {
    if (!seen.has(lane)) problems.push({ lane, message: "lane has no policy" });
  }

  for (const tier of Object.keys(TIER_LANES) as readonly Tier[]) {
    const lanes = TIER_LANES[tier];
    if (tierPlan(tier) === null) {
      problems.push({ lane: lanes.implement, message: `tier ${tier} does not resolve` });
    }

    // Every step of an implementation lane must have a reviewer, not just its primary, so the
    // table breaks at edit time rather than at `checkEvaluator` after the work is done.
    const implementChain = laneChain(lanes.implement) ?? [];
    for (const index of unreviewedSteps(implementChain, laneChain(lanes.review) ?? [])) {
      const family = familyOf(implementChain[index]?.route.model ?? "");
      problems.push({
        lane: lanes.implement,
        index,
        message: `no step in ${lanes.review} certifies ${family ?? "unknown"}-authored work`,
      });
    }
  }

  return problems;
}
