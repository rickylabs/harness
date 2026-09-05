/**
 * @rickylabs/routing — the delegation matrix: tiers, the family rule, and fallback chains.
 *
 * Owned by E4 · #34, defined by #58. One question, one answer: which model, at which effort, over
 * which transport, for a given lane — and who is allowed to certify the result.
 *
 * ## The shape
 *
 * - `models.ts` pins every model id and says which family it belongs to. Family is read off the
 *   *model*, never off the harness that launched it, which is what makes the evaluator rule hold
 *   over the relay instead of needing a marker bolted onto the two routes that go through it.
 * - `policy.ts` is the matrix as data: one entry per lane, each an ordered chain whose first step
 *   is the primary and whose later steps name the triggers that reach them.
 * - `family.ts` is the invariant — generator is not evaluator, no implementation lane
 *   self-certifies — checked against the two-seam topology from #33.
 * - `resolve.ts` is the only sanctioned way to ask the table a question.
 * - `admit.ts` is the gate a dispatch passes on its way out: it composes `validateDispatch` from
 *   `@rickylabs/subagents` with everything only the matrix can answer, so a wrong model id is
 *   refused for the price of a table walk instead of a subscription window.
 *
 * ## What this package does not do
 *
 * It does not launch anything, and it does not translate a pinned model id into a vendor CLI's
 * command line. `dispatch.ts` states the direction of the dependency from the other side: it
 * "does not choose models", because the matrix is the single source of truth and duplicating any
 * of it there would create a second answer to a question that must only have one. `toDispatch` is
 * the hand-off, and it carries routing fields only — the prompt, the timeout and the token budget
 * belong to whoever is launching the run.
 *
 * That direction is also why admission lives here rather than beside the validator it wraps:
 * `routing` depends on `subagents`, and an import the other way would close the edge into a cycle.
 */

export const PACKAGE_NAME = "@rickylabs/routing" as const;
export type PackageName = typeof PACKAGE_NAME;

export {
  EFFORTS,
  LOCAL_MODEL_IDS,
  MODEL_FAMILIES,
  MODEL_IDS,
  OPENCODE_MODEL_IDS,
  OPENROUTER_MODEL_IDS,
  OPEN_EVALUATOR_MODEL_IDS,
  TRANSPORTS,
  familyOf,
  isApprovedOpenEvaluator,
  isPinnedModel,
  pinnedModels,
} from "./models.js";
export type { Effort, ModelFamily, Transport } from "./models.js";

export {
  DEEP_RESEARCH_LANES,
  FALLBACK_TRIGGERS,
  LANES,
  LANE_CONSTRAINTS,
  PURPOSES,
  ROUTE_POLICY,
  SUBSCRIPTION_STATES,
  TIERS,
  TIER_LANES,
  lanePolicy,
} from "./policy.js";
export type {
  Certifies,
  EffortEscalation,
  FallbackTrigger,
  Lane,
  LaneConstraint,
  LanePolicy,
  Purpose,
  Route,
  RouteStep,
  SubscriptionState,
  Tier,
} from "./policy.js";

export { SEAMS, checkEvaluator, familyOfRun } from "./family.js";
export type { AssignmentSide, EvaluatorAssignment, EvaluatorVerdict, RunIdentity, Seam } from "./family.js";

export {
  DEFAULT_MAX_FALLBACK_DEPTH,
  checkPolicy,
  laneChain,
  resolveEffort,
  resolveFallback,
  resolveRoute,
  tierPlan,
  toDispatch,
} from "./resolve.js";
export type {
  EffortResolution,
  FallbackOutcome,
  FallbackRefusal,
  FallbackRequest,
  PolicyProblem,
  RouteResolution,
  RoutedDispatch,
  TierPlan,
} from "./resolve.js";

export {
  ADMISSION_REFUSALS,
  admitDispatch,
  describeAdmission,
  laneModels,
  relayProfiles,
  routableModels,
  routedModels,
  transportsFor,
} from "./admit.js";
export type { Admission, AdmissionContext, AdmissionProblem, AdmissionRefusal } from "./admit.js";
