/** Pure route resolution over a caller-selected document. Fallbacks walk forward, require
 * a turn boundary and explicit paid approval, and never infer an effort escalation.
 */
import type { DispatchRequest } from "@rickylabs/subagents";

import { familyOf, isApprovedOpenEvaluator, lanePolicy, tierLanes, maxFallbackDepth, effortIndex } from "./configuration.js";
import type { RoutingConfiguration, Effort, ModelFamily, Certifies, FallbackTrigger, Lane, Route, RouteStep, Tier } from "./schema.js";

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
export function selfCertifies(configuration: RoutingConfiguration, step: RouteStep): boolean {
  const certified = certifiedFamily(step.certifies);
  return certified !== null && familyOf(configuration, step.route.model) === certified;
}

/** Every implementation step needs a declared certification seat; checkEvaluator enforces independence at use. */
export function unreviewedSteps(configuration: RoutingConfiguration,
  implement: readonly RouteStep[],
  review: readonly RouteStep[],
): readonly number[] {
  const unreviewed: number[] = [];
  for (let index = 0; index < implement.length; index += 1) {
    const step = implement[index];
    if (step === undefined) continue;
    const family = familyOf(configuration, step.route.model);
    if (family === null) continue;
    const reviewed = review.some(
      (candidate) => candidate.certifies === "any" || certifiedFamily(candidate.certifies) === family,
    );
    if (!reviewed) unreviewed.push(index);
  }
  return unreviewed;
}

/** The lane's ordered chain, or `null` for a lane the matrix does not route. */
export function laneChain(configuration: RoutingConfiguration, lane: string): readonly RouteStep[] | null {
  return lanePolicy(configuration, lane)?.chain ?? null;
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
export function resolveRoute(configuration: RoutingConfiguration, lane: string, authorFamily?: ModelFamily): RouteResolution {
  const policy = lanePolicy(configuration, lane);
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


/**
 * The next step for a lane whose current step failed.
 *
 * Walks the chain forward from `from`, which is why chain order is data here rather than a
 * `filter` predicate over condition strings.
 */
export function resolveFallback(configuration: RoutingConfiguration, request: FallbackRequest): FallbackOutcome {
  const policy = lanePolicy(configuration, request.lane);
  if (policy === null) return { ok: false, reason: "unknown-lane" };

  if (!request.atTurnBoundary) return { ok: false, reason: "turn-boundary-required" };

  const depth = request.depth ?? 0;
  const maxDepth = request.maxDepth ?? maxFallbackDepth(configuration);
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
export function resolveEffort(_configuration: RoutingConfiguration, step: RouteStep, condition?: string): EffortResolution {
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

/** The review lane is resolved against the configured implementation primary family. */
export function tierPlan(configuration: RoutingConfiguration, tier: Tier): TierPlan | null {
  const lanes = tierLanes(configuration, tier);
  if (lanes === null) return null;
  const implement = resolveRoute(configuration, lanes.implement);
  if (!implement.ok) return null;
  const authorFamily = familyOf(configuration, implement.step.route.model);
  if (authorFamily === null) return null;
  const review = resolveRoute(configuration, lanes.review, authorFamily);
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
export function toDispatch(_configuration: RoutingConfiguration, route: Route, effort?: Effort): RoutedDispatch {
  const base = {
    harness: route.harness,
    model: route.model,
    effort: effort ?? route.effort,
  };
  const withRouter = route.router === undefined ? base : { ...base, router: route.router };
  return route.profile === undefined ? withRouter : { ...withRouter, profile: route.profile };
}

/** Structural locations only: a document's lane identifier is never a diagnostic. */
export type PolicyCode = "self-certifies" | "evaluation-without-certifies" | "certifies-outside-evaluation" |
  "relay-evaluator-unapproved" | "first-step-not-primary" | "duplicate-primary" | "no-primary" |
  "opencode-without-router" | "router-outside-opencode" | "relay-without-profile" |
  "escalation-not-raising" | "escalation-not-comparable" | "constraint-violated" | "tier-unresolved" |
  "unreviewed-step" | "duplicate-lane" | "lane-unrouted";
export interface PolicyProblem {
  readonly code: PolicyCode;
  readonly lane: string;
  readonly index?: number;
}
export function checkPolicy(configuration: RoutingConfiguration): readonly PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  const seen = new Set<string>();
  configuration.lanes.forEach((policy, laneIndex) => {
    const lane = `lanes[${laneIndex}]`;
    const add = (code: PolicyCode, index?: number) => { problems.push({ code, lane, ...(index === undefined ? {} : { index }) }); };
    if (seen.has(policy.lane)) add("duplicate-lane");
    seen.add(policy.lane);
    const constraint = Object.hasOwn(configuration.constraints, policy.lane) ? configuration.constraints[policy.lane] : undefined;
    const primaryFamilies = new Set<string | undefined>();
    let primaries = 0;
    policy.chain.forEach((step, index) => {
      const { route } = step;
      const evaluation = policy.purpose === "evaluation";
      if (evaluation && step.certifies === undefined) add("evaluation-without-certifies", index);
      if (!evaluation && step.certifies !== undefined) add("certifies-outside-evaluation", index);
      if (step.certifies !== undefined && step.certifies !== "none" && route.transport === "openrouter" && !isApprovedOpenEvaluator(configuration, route.model)) add("relay-evaluator-unapproved", index);
      if (selfCertifies(configuration, step)) add("self-certifies", index);
      if (index === 0 && step.when.length > 0) add("first-step-not-primary", index);
      if (step.when.length === 0) {
        primaries++;
        if (primaryFamilies.has(step.certifies)) add("duplicate-primary", index);
        primaryFamilies.add(step.certifies);
      }
      const opencode = route.harness === "opencode" || route.harness === "opencode-run";
      if (opencode && route.router === undefined) add("opencode-without-router", index);
      if (!opencode && route.router !== undefined) add("router-outside-opencode", index);
      if (route.transport === "openrouter" && !opencode && route.profile === undefined) add("relay-without-profile", index);
      for (const escalation of step.effortEscalations ?? []) {
        const from = effortIndex(configuration, route.effort);
        const to = effortIndex(configuration, escalation.effort);
        if (from < 0 || to < 0) add("escalation-not-comparable", index);
        else if (to <= from) add("escalation-not-raising", index);
      }
      if (constraint) {
        const family = familyOf(configuration, route.model);
        if ((constraint.transports && !constraint.transports.includes(route.transport)) ||
            (constraint.harnesses && !constraint.harnesses.includes(route.harness)) ||
            (constraint.families && (family === null || !constraint.families.includes(family))) ||
            (constraint.models && !constraint.models.includes(route.model))) add("constraint-violated", index);
      }
    });
    if (primaries === 0) add("no-primary");
  });
  configuration.tiers.forEach((tier, i) => {
    if (tierPlan(configuration, tier.tier) === null) problems.push({ code: "tier-unresolved", lane: `tiers[${i}]` });
    for (const index of unreviewedSteps(configuration, laneChain(configuration, tier.implement) ?? [], laneChain(configuration, tier.review) ?? [])) {
      problems.push({ code: "unreviewed-step", lane: `lanes[${configuration.lanes.findIndex(l => l.lane === tier.implement)}]`, index });
    }
  });
  return problems;
}
