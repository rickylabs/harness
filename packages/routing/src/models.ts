/**
 * Model pins, and the family each one belongs to.
 *
 * `routing` is the single owner of model ids (#58). They are pinned here and nowhere else, so
 * that "which model does this lane get" has exactly one answer and changing it is a one-line
 * diff against a table rather than a search across packages.
 *
 * ## Family is a property of the model, not of the harness that launched it
 *
 * This is the load-bearing decision in this file and the reason the evaluator rule in
 * `family.ts` can be structural rather than advisory.
 *
 * The fleet's own resolver derives family from the *agent*: claude means anthropic, codex means
 * openai, anything else means google. That holds only while the transport is native. The moment
 * a run goes over OpenRouter the harness is just a driver — `claude` driving `z-ai/glm-5.3-flash`
 * is an **open**-family run wearing the Claude CLI, and calling it anthropic would let an open
 * model be refused as an evaluator for Claude-authored work, and an open model be accepted as an
 * evaluator for open-authored work. The fleet works around exactly this with an out-of-band
 * `evaluatorModelPolicy: 'open_only'` marker on the two OpenRouter evaluation routes, plus a
 * preset check. Reading family off the model makes that special case fall out of the general
 * rule instead of standing beside it.
 *
 * ## Spelling
 *
 * These are the ids the matrix names and the ids telemetry records. A vendor CLI may accept a
 * different spelling for the same model on its command line — the fleet carries a separate
 * `NATIVE_CANARY_MODEL_ARGS` table for precisely that reason. Translating a pin into a launch
 * argument is the provider packages' boundary (E3 - #33), not this one, and #34 owns making a
 * wrong id fail loudly there. Nothing here has verified that a given pin is accepted verbatim by
 * a given CLI; do not add a second spelling to this table until something can.
 */

/** Who trained the weights. The unit the evaluator rule is written in. */
export const MODEL_FAMILIES = ["anthropic", "openai", "google", "open"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/**
 * How a model is reached.
 *
 * `native` is the vendor's own endpoint on the vendor's own subscription; `openrouter` is the
 * relay. The distinction is not cosmetic: it decides what a run is metered by, whether a
 * reasoning trace comes back at all, and — see `DEEP_RESEARCH_LANES` — whether a lane may run.
 */
export const TRANSPORTS = ["native", "openrouter"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/** Reasoning-effort ladder, lowest to highest. Order is meaningful; do not sort it. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Native subscription models, reachable on each vendor's own plan. */
export const MODEL_IDS = {
  codexSol: "gpt-5.6-sol",
  codexLuna: "gpt-5.6-luna",
  fable: "fable-5",
  opus: "opus-5",
  sonnet: "sonnet-5",
  /** agy's documentation and research model. The fleet matrix pins the `-high` variant. */
  agyDocs: "gemini-3.6-flash-high",
} as const;

/**
 * Models served from the N5's own GPU, on one of the two local backends.
 *
 * Pinned here for the same reason every other id is: `routing` owns model ids, and a second table
 * naming a model would mean two answers to "which model did that run use". Where each of these can
 * physically run — and where it must not — is `@rickylabs/llm-local`'s capability matrix (#60),
 * which reads these ids rather than repeating their spelling.
 *
 * The `n5air/` prefix is part of the id, not a router key. It is how the fleet's `WORKFLOW.md`
 * names the local evaluator seats, and an unprefixed `qwen3.8-27b` would be a different model.
 */
export const LOCAL_MODEL_IDS = {
  /** The local plan-evaluation seat, and the smoke model — LM Studio on Vulkan. */
  planEvaluator: "n5air/qwen3.8-27b",
  /** The local implementation-evaluation seat. ROCm only; see the capability matrix. */
  implEvaluator: "n5air/ling-3.0-flash",
} as const;

/** Relay models, reachable only over OpenRouter. */
export const OPENROUTER_MODEL_IDS = {
  planEvaluator: "qwen/qwen3.8-flash",
  implEvaluator: "z-ai/glm-5.3-flash",
  designGlm: "z-ai/glm-5.2",
  grok: "x-ai/grok-4.5",
} as const;

/**
 * Models an opencode run reaches through a provider prefix.
 *
 * Pinned **unprefixed**. The fleet writes these joined — `openrouter/moonshotai/kimi-k3` — but
 * the `/swarm` wire format carries the prefix in its own `router:` key, and `validateDispatch`
 * refuses an opencode request that omits it because "without one the provider prefix is
 * ambiguous". Emitting both would send the prefix twice.
 */
export const OPENCODE_MODEL_IDS = {
  visionEval: "moonshotai/kimi-k3",
} as const;

/**
 * The open models approved to sit in an evaluator seat **over the relay**.
 *
 * A harness invariant, not a convenience list: relay evaluator lanes run OPEN models only. An
 * open model that is not on this list has not been approved to certify anything over OpenRouter.
 *
 * The two local evaluator seats in `LOCAL_MODEL_IDS` are deliberately absent. They are the fleet's
 * documented local defaults, but approval is granted per route and no step in `policy.ts` routes to
 * a local backend yet; `checkPolicy` only consults this list for `transport: "openrouter"` steps.
 * Adding them before a lane can reach them would widen a certification claim ahead of the routing
 * that would have to justify it.
 */
export const OPEN_EVALUATOR_MODEL_IDS = [
  OPENROUTER_MODEL_IDS.planEvaluator,
  OPENROUTER_MODEL_IDS.implEvaluator,
] as const;

/**
 * Every pinned model, and its family.
 *
 * Total over the ids above — `familyOf` answers `null` for anything else, and every caller that
 * asks treats `null` as a refusal rather than as a family. A model this package cannot place is
 * a model it must not certify with.
 *
 * A `Map` rather than an object, because a model id is untrusted input: it arrives from a lane
 * request, a `/swarm` block, or a telemetry record. On a plain object, `familyOf("toString")`
 * finds `Object.prototype.toString` and answers with a function, so a nonsense id gets placed in
 * a family instead of refused. A `Map` has no prototype chain to walk.
 */
const FAMILY_BY_MODEL: ReadonlyMap<string, ModelFamily> = new Map<string, ModelFamily>([
  [MODEL_IDS.codexSol, "openai"],
  [MODEL_IDS.codexLuna, "openai"],
  [MODEL_IDS.fable, "anthropic"],
  [MODEL_IDS.opus, "anthropic"],
  [MODEL_IDS.sonnet, "anthropic"],
  [MODEL_IDS.agyDocs, "google"],
  [LOCAL_MODEL_IDS.planEvaluator, "open"],
  [LOCAL_MODEL_IDS.implEvaluator, "open"],
  [OPENROUTER_MODEL_IDS.planEvaluator, "open"],
  [OPENROUTER_MODEL_IDS.implEvaluator, "open"],
  [OPENROUTER_MODEL_IDS.designGlm, "open"],
  [OPENROUTER_MODEL_IDS.grok, "open"],
  [OPENCODE_MODEL_IDS.visionEval, "open"],
]);

/** The family of a pinned model, or `null` for a model this package does not own. */
export function familyOf(model: string): ModelFamily | null {
  return FAMILY_BY_MODEL.get(model) ?? null;
}

/** Whether `model` is one this package pins. Fails closed on anything else. */
export function isPinnedModel(model: string): boolean {
  return FAMILY_BY_MODEL.has(model);
}

/** Every pinned model id, in table order. */
export function pinnedModels(): readonly string[] {
  return [...FAMILY_BY_MODEL.keys()];
}

/** Whether an open model has been approved to sit in an evaluator seat. */
export function isApprovedOpenEvaluator(model: string): boolean {
  return OPEN_EVALUATOR_MODEL_IDS.some((approved) => approved === model);
}
