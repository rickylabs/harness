/**
 * The delegation matrix, as data: lanes, tiers, provider order, and fallback chains.
 *
 * Ported from the fleet's canonical route policy, not reinvented (#58). Every model id, effort
 * and ordering below is the fleet's; what changed is the shape, and only where the old shape
 * could not say something the acceptance criteria require it to say.
 *
 * ## What changed, and why
 *
 * The fleet stores routes as one flat array where a free-text `condition` string does three
 * different jobs at once: it describes when a lane applies, it marks a row as a fallback, and it
 * names the trigger. So the chain order is implicit — recovered by filtering the array for rows
 * whose condition does not begin with `fallback`, which means the ordering exists in a `filter`
 * predicate rather than in the data. Here each lane owns an ordered `chain`, `chain[0]` is the
 * primary, and every later step names the closed set of triggers that reach it. Nothing about a
 * route moved; the order stopped being a side effect of string prefixes.
 *
 * ## Why a step declares what it certifies
 *
 * Four evaluation steps in the fleet matrix carry no author family, and they do not all mean the
 * same thing by it. The two relay routes are family-agnostic — an open model is opposite-family
 * to anthropic and to openai alike — while `adversarial_design_eval` carries none because it is
 * not a gate at all: it is vision evidence that *complements* the required GLM design review.
 * Collapsing those two into "unspecified" is how a supplementary run ends up certifying
 * something. `certifies` distinguishes them: a family, `any`, or `none`.
 */

import type { Harness, Router } from "@rickylabs/subagents";

import { MODEL_IDS, OPENCODE_MODEL_IDS, OPENROUTER_MODEL_IDS } from "./models.js";
import type { Effort, ModelFamily, Transport } from "./models.js";

/** What a lane is for. Decides which invariants bind it. */
export const PURPOSES = [
  "orchestration",
  "implementation",
  "analysis",
  "design",
  "documentation",
  "claude_workflow",
  "research_extraction",
  "evaluation",
  "docs_audit",
  "docs_polish",
] as const;
export type Purpose = (typeof PURPOSES)[number];

/** Every lane the matrix routes. */
export const LANES = [
  "light_implementation",
  "normal_implementation",
  "complex_implementation",
  "fast_iteration",
  "deep_analysis",
  "planning_decisions",
  "major_ui_ux_design",
  "major_ui_ux_adversarial_review",
  "adversarial_design_eval",
  "documentation_review",
  "documentation_authoring",
  "docs_audit",
  "docs_polish",
  "chore_code",
  "claude_workflow",
  "research_extraction",
  "formal_plan_evaluation",
  "formal_impl_evaluation",
  "review_claude",
  "review_codex_light",
  "review_codex",
  "review_codex_complex",
  "review_codex_fast",
] as const;
export type Lane = (typeof LANES)[number];

/**
 * Why a run left its primary route.
 *
 * A closed set, where the fleet has free text. Its four token-limit spellings
 * (`fallback_on_fable_token_limit`, `..._opus_...`, `..._sonnet_...`, `token_limit_fallback`)
 * all name one condition and differ only in which model ran out, which the step already says.
 */
export const FALLBACK_TRIGGERS = [
  /** The primary model's context or plan window is exhausted. */
  "token-limit",
  /** No Claude-agent surface is reachable at all. Distinct from running out of one model. */
  "no-claude-surface",
  /** A deliberate extra evaluator, not a failure. Reaches the relay route on a healthy fleet. */
  "third-opinion",
  /** The native opposite-family evaluator is quota-blocked. */
  "native-quota-limit",
  /** The relay itself is limited. The last step before a lane has nowhere to go. */
  "openrouter-limit",
] as const;
export type FallbackTrigger = (typeof FALLBACK_TRIGGERS)[number];

/** Whether a route is inside a subscription or is billed on top of one. */
export const SUBSCRIPTION_STATES = ["included", "outside_plan"] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** A concrete place to send a run. */
export interface Route {
  readonly harness: Harness;
  readonly transport: Transport;
  readonly model: string;
  readonly effort: Effort;
  /** opencode only: the provider prefix. `validateDispatch` refuses an opencode run without it. */
  readonly router?: Router;
  /** Provider profile id, where the transport needs one to know which credential to bind. */
  readonly profile?: string;
  /** OpenRouter preset id, where the route is one of the validated presets. */
  readonly preset?: string;
}

/**
 * What an evaluation step is allowed to certify.
 *
 * A family binds the seat to work authored by that family. `any` is a relay route, valid against
 * any author family because an open model is opposite to all of them. `none` is evidence, not a
 * gate — it runs, it is read, and it certifies nothing.
 */
export type Certifies = ModelFamily | "any" | "none";

/** A named effort change the launcher may make on the same route. Never changes the model. */
export interface EffortEscalation {
  readonly condition: string;
  readonly effort: Effort;
}

/** One position in a lane's chain. */
export interface RouteStep {
  readonly route: Route;
  /** Triggers that reach this step. Empty on a primary — a primary is reached by default. */
  readonly when: readonly FallbackTrigger[];
  /** Present exactly on the steps of `evaluation` lanes. */
  readonly certifies?: Certifies;
  readonly subscription?: SubscriptionState;
  /** Declared effort discretion. An undeclared escalation is refused, never inferred. */
  readonly effortEscalations?: readonly EffortEscalation[];
  /** The fleet's own condition string, kept so a reader can diff this table against the matrix. */
  readonly note?: string;
}

/** A lane and its ordered chain. */
export interface LanePolicy {
  readonly lane: Lane;
  readonly purpose: Purpose;
  /** Ordered. `chain[0]` is the primary; later steps are reached only by their triggers. */
  readonly chain: readonly [RouteStep, ...RouteStep[]];
}

const CLAUDE_OPENROUTER = "claude-openrouter";
const DESIGN_PRESET = "claude-design-glm-5-2";
const PLAN_EVALUATOR_PRESET = "claude-evaluator-qwen-3-8-flash";
const IMPL_EVALUATOR_PRESET = "claude-evaluator-glm-5-3-flash";

/**
 * The matrix.
 *
 * One entry per lane, in the fleet's own order. Read a row as: the primary, then what happens
 * when it cannot run.
 */
export const ROUTE_POLICY: readonly LanePolicy[] = [
  {
    lane: "light_implementation",
    purpose: "implementation",
    chain: [
      {
        route: { harness: "codex", transport: "native", model: MODEL_IDS.codexSol, effort: "low" },
        when: [],
        note: "small_scoped_slices",
      },
    ],
  },
  {
    lane: "normal_implementation",
    purpose: "implementation",
    chain: [
      {
        route: {
          harness: "codex",
          transport: "native",
          model: MODEL_IDS.codexSol,
          effort: "medium",
        },
        when: [],
      },
    ],
  },
  {
    lane: "complex_implementation",
    purpose: "implementation",
    chain: [
      {
        route: { harness: "codex", transport: "native", model: MODEL_IDS.codexSol, effort: "high" },
        when: [],
        note: "large_or_cross_cutting_slices",
      },
    ],
  },
  {
    lane: "fast_iteration",
    purpose: "implementation",
    chain: [
      {
        route: { harness: "codex", transport: "native", model: MODEL_IDS.codexLuna, effort: "max" },
        when: [],
      },
    ],
  },
  {
    lane: "deep_analysis",
    purpose: "analysis",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.fable, effort: "medium" },
        when: [],
        subscription: "included",
        note: "default_complex_decision_subagent",
      },
      {
        route: { harness: "codex", transport: "native", model: MODEL_IDS.codexSol, effort: "high" },
        when: ["token-limit"],
      },
    ],
  },
  {
    lane: "planning_decisions",
    purpose: "orchestration",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "high" },
        when: [],
        subscription: "included",
        note: "default_orchestrator",
      },
      {
        route: { harness: "codex", transport: "native", model: MODEL_IDS.codexSol, effort: "high" },
        when: ["token-limit"],
      },
    ],
  },
  {
    lane: "major_ui_ux_design",
    purpose: "design",
    chain: [
      {
        route: {
          harness: "claude",
          transport: "openrouter",
          model: OPENROUTER_MODEL_IDS.designGlm,
          effort: "xhigh",
          profile: CLAUDE_OPENROUTER,
          preset: DESIGN_PRESET,
        },
        when: [],
        note: "lead_route_for_major_ui_ux_work",
      },
    ],
  },
  {
    lane: "major_ui_ux_adversarial_review",
    purpose: "design",
    chain: [
      {
        route: {
          harness: "claude",
          transport: "openrouter",
          model: OPENROUTER_MODEL_IDS.designGlm,
          effort: "xhigh",
          profile: CLAUDE_OPENROUTER,
          preset: DESIGN_PRESET,
        },
        when: [],
        note: "required_before_merge_when_glm_not_lead",
      },
    ],
  },
  {
    lane: "adversarial_design_eval",
    purpose: "evaluation",
    chain: [
      {
        route: {
          harness: "opencode",
          transport: "openrouter",
          model: OPENCODE_MODEL_IDS.visionEval,
          effort: "high",
          router: "openrouter",
        },
        when: [],
        certifies: "none",
        note: "vision_evidence_complements_required_glm_design_review",
      },
    ],
  },
  {
    lane: "documentation_review",
    purpose: "documentation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.sonnet, effort: "high" },
        when: [],
        subscription: "included",
        note: "docs_cleanup_easy_chores",
      },
      {
        route: {
          harness: "codex",
          transport: "native",
          model: MODEL_IDS.codexLuna,
          effort: "high",
        },
        when: ["token-limit"],
      },
    ],
  },
  {
    lane: "documentation_authoring",
    purpose: "documentation",
    chain: [
      {
        route: { harness: "agy", transport: "native", model: MODEL_IDS.agyDocs, effort: "low" },
        when: [],
        note: "documentation_generation",
      },
    ],
  },
  {
    // The whole generated-docs changeset is audited in ONE pass by Codex, opposite-family to the
    // Claude generators, which is what restores family diversity for generated-docs accuracy.
    // There is deliberately NO cross-family fallback: the audit is defined by its opposite-family
    // transport, so a fallback outside openai would defeat the lane rather than rescue it. That
    // is why the chain has one step and `LANE_CONSTRAINTS` fails it closed.
    lane: "docs_audit",
    purpose: "docs_audit",
    chain: [
      {
        route: {
          harness: "codex",
          transport: "native",
          model: MODEL_IDS.codexSol,
          effort: "medium",
        },
        when: [],
        effortEscalations: [{ condition: "large_changeset", effort: "high" }],
        note: "single_pass_opposite_family_audit_of_generated_docs_changeset",
      },
    ],
  },
  {
    // Runs LAST in the docs pipeline: edit-only prose polish, in place, for voice and flow. It
    // must not re-author a document or change a technical claim — accuracy doubt returns to
    // `docs_audit`. GLM is a polish-fallback of last resort here and nowhere else; reaching it
    // needs no Claude surface at all, which is a stronger condition than one model running out.
    lane: "docs_polish",
    purpose: "docs_polish",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.fable, effort: "medium" },
        when: [],
        subscription: "included",
        note: "edit_only_prose_polish_after_audit",
      },
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "xhigh" },
        when: ["token-limit"],
      },
      {
        route: {
          harness: "claude",
          transport: "openrouter",
          model: OPENROUTER_MODEL_IDS.designGlm,
          effort: "xhigh",
          profile: CLAUDE_OPENROUTER,
          preset: DESIGN_PRESET,
        },
        when: ["no-claude-surface"],
      },
    ],
  },
  {
    lane: "chore_code",
    purpose: "implementation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "medium" },
        when: [],
        subscription: "included",
        note: "delegated_code_chores",
      },
      {
        route: { harness: "codex", transport: "native", model: MODEL_IDS.codexLuna, effort: "max" },
        when: ["token-limit"],
      },
    ],
  },
  {
    lane: "claude_workflow",
    purpose: "claude_workflow",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "low" },
        when: [],
      },
    ],
  },
  {
    lane: "research_extraction",
    purpose: "research_extraction",
    chain: [
      {
        route: { harness: "agy", transport: "native", model: MODEL_IDS.agyDocs, effort: "low" },
        when: [],
      },
    ],
  },
  {
    lane: "formal_plan_evaluation",
    purpose: "evaluation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.fable, effort: "medium" },
        when: [],
        certifies: "openai",
        subscription: "included",
      },
      {
        route: { harness: "codex", transport: "native", model: MODEL_IDS.codexSol, effort: "high" },
        when: [],
        certifies: "anthropic",
      },
      {
        route: {
          harness: "claude",
          transport: "openrouter",
          model: OPENROUTER_MODEL_IDS.planEvaluator,
          effort: "max",
          profile: CLAUDE_OPENROUTER,
          preset: PLAN_EVALUATOR_PRESET,
        },
        when: ["third-opinion", "native-quota-limit"],
        certifies: "any",
        note: "open_model_route",
      },
      {
        route: { harness: "agy", transport: "native", model: MODEL_IDS.agyDocs, effort: "high" },
        when: ["openrouter-limit"],
        certifies: "any",
      },
    ],
  },
  {
    lane: "formal_impl_evaluation",
    purpose: "evaluation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.fable, effort: "medium" },
        when: [],
        certifies: "openai",
        subscription: "included",
      },
      {
        route: {
          harness: "codex",
          transport: "native",
          model: MODEL_IDS.codexSol,
          effort: "xhigh",
        },
        when: [],
        certifies: "anthropic",
      },
      {
        route: {
          harness: "claude",
          transport: "openrouter",
          model: OPENROUTER_MODEL_IDS.implEvaluator,
          effort: "max",
          profile: CLAUDE_OPENROUTER,
          preset: IMPL_EVALUATOR_PRESET,
        },
        when: ["third-opinion", "native-quota-limit"],
        certifies: "any",
        note: "open_model_route",
      },
      {
        route: { harness: "agy", transport: "native", model: MODEL_IDS.agyDocs, effort: "high" },
        when: ["openrouter-limit"],
        certifies: "any",
      },
    ],
  },
  {
    lane: "review_claude",
    purpose: "evaluation",
    chain: [
      {
        route: {
          harness: "codex",
          transport: "native",
          model: MODEL_IDS.codexSol,
          effort: "xhigh",
        },
        when: [],
        certifies: "anthropic",
      },
    ],
  },
  // Adversarial review of Codex-authored work, effort-paired to the implementation tier that
  // produced it. Fable is reserved for the medium-and-above pairings, and every fallback stays
  // Claude-family so opposite-family review is never traded away for availability.
  {
    lane: "review_codex_light",
    purpose: "evaluation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "high" },
        when: [],
        certifies: "openai",
        note: "pairs_with_light_implementation",
      },
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.sonnet, effort: "high" },
        when: ["token-limit"],
        certifies: "openai",
      },
    ],
  },
  {
    lane: "review_codex",
    purpose: "evaluation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.fable, effort: "low" },
        when: [],
        certifies: "openai",
        subscription: "included",
      },
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "low" },
        when: ["token-limit"],
        certifies: "openai",
      },
    ],
  },
  {
    lane: "review_codex_complex",
    purpose: "evaluation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.fable, effort: "medium" },
        when: [],
        certifies: "openai",
        subscription: "included",
      },
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "medium" },
        when: ["token-limit"],
        certifies: "openai",
      },
    ],
  },
  {
    lane: "review_codex_fast",
    purpose: "evaluation",
    chain: [
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.opus, effort: "medium" },
        when: [],
        certifies: "openai",
        note: "pairs_with_fast_iteration",
      },
      {
        route: { harness: "claude", transport: "native", model: MODEL_IDS.sonnet, effort: "high" },
        when: ["token-limit"],
        certifies: "openai",
      },
    ],
  },
];

const POLICY_BY_LANE: ReadonlyMap<Lane, LanePolicy> = new Map(
  ROUTE_POLICY.map((policy) => [policy.lane, policy]),
);

/** The lane's policy, or `null` for a lane the matrix does not route. */
export function lanePolicy(lane: string): LanePolicy | null {
  return POLICY_BY_LANE.get(lane as Lane) ?? null;
}

/**
 * Implementation tiers, smallest to largest, plus the review lane each one is paired with.
 *
 * The pairing is the matrix's, and it is why review effort tracks implementation effort rather
 * than being chosen per run: two of the four are stated outright on the review steps
 * (`pairs_with_light_implementation`, `pairs_with_fast_iteration`), and the remaining two follow
 * by name and by the rule that Fable is reserved for the medium-and-above pairings.
 */
export const TIERS = ["light", "normal", "complex", "fast"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LANES: Readonly<Record<Tier, { readonly implement: Lane; readonly review: Lane }>> = {
  light: { implement: "light_implementation", review: "review_codex_light" },
  normal: { implement: "normal_implementation", review: "review_codex" },
  complex: { implement: "complex_implementation", review: "review_codex_complex" },
  fast: { implement: "fast_iteration", review: "review_codex_fast" },
};

/**
 * Extra invariants a lane carries beyond its chain.
 *
 * These exist because a chain says where a lane *goes* and not what it is *forbidden* to become.
 * Each one is checked by `checkPolicy`, so an edit that violates it fails the suite rather than
 * shipping as a quieter matrix.
 */
export interface LaneConstraint {
  readonly transports?: readonly Transport[];
  readonly harnesses?: readonly Harness[];
  readonly families?: readonly ModelFamily[];
  readonly models?: readonly string[];
  readonly why: string;
}

/**
 * Lanes that count as deep research.
 *
 * Deep research is a native capability of agy and of Codex, not a prompt style, and it does not
 * survive a relay: the relay presets that could carry it are exactly the ones whose reasoning
 * trace is absent or unverified. So the lane is pinned to native transport (#58).
 */
export const DEEP_RESEARCH_LANES = ["research_extraction"] as const;

const DEEP_RESEARCH_HARNESSES: readonly Harness[] = ["agy", "codex", "codex-run"];

export const LANE_CONSTRAINTS: Readonly<Partial<Record<Lane, LaneConstraint>>> = {
  research_extraction: {
    transports: ["native"],
    harnesses: DEEP_RESEARCH_HARNESSES,
    why: "deep research runs on native agy or native Codex transport only",
  },
  docs_audit: {
    families: ["openai"],
    why: "the audit is defined by being opposite-family to the Claude generators; it fails closed",
  },
  major_ui_ux_design: {
    models: [OPENROUTER_MODEL_IDS.designGlm],
    why: "major UI/UX work is led by GLM 5.2",
  },
  major_ui_ux_adversarial_review: {
    models: [OPENROUTER_MODEL_IDS.designGlm],
    why: "major UI/UX review is GLM 5.2, required before merge when GLM did not lead",
  },
};
