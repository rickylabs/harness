/**
 * `ctx.harnessCoordinator` — the workflow registry and the evaluator independence policy.
 *
 * Two things a daemon has to be able to answer without reading a file: *what are the stages of the
 * work* and *who is allowed to review it*. Both are already implemented as pure functions in
 * `@rickylabs/coordinator`; both need a deployment-level decision bound to them before a caller can
 * use them, and this plugin is where that binding happens.
 *
 * ## The policy is configuration, but the default is not neutral
 *
 * #72 states the floor as "a different seam or vendor family" — `SEAM_OR_FAMILY`. What the lane
 * policy actually runs is the stronger form, `OPPOSITE_FAMILY`, because two runs of the same family
 * share training, tokenizer and failure modes, and an evaluator that shares the author's blind spot
 * is a rubber stamp with a different session id.
 *
 * Both exist in the package, so both are selectable here. That is not an invitation. Selecting the
 * weaker one is a deployment writing down, in a file under review, that it is reviewing itself more
 * loosely than the doctrine says — which is the point of making it a named row rather than an
 * argument someone passes at a call site nobody reads.
 *
 * ## Why the workflow registry is a service and not an import
 *
 * `WORKFLOWS` holds exactly one workflow today. A service that hands it out by name looks like
 * overhead at n=1 and stops looking like overhead the moment a second deployment ships a second
 * workflow, because the alternative is every caller importing the array and doing its own lookup
 * with its own answer for "not found". The lookup is `null` here, once.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import {
  checkWorkflow,
  selectEvaluator,
  OPPOSITE_FAMILY,
  SEAM_OR_FAMILY,
  WORKFLOWS,
  type Actor,
  type Candidate,
  type EvaluatorDecision,
  type IndependencePolicy,
  type Problem,
  type Workflow,
} from "@rickylabs/coordinator";

/** Where this service attaches. Prefixed so it cannot collide with a service dsh adds later. */
export const CONTEXT_KEY = "harnessCoordinator" as const;

/** Row id in `cordis.patch.yml`. */
export const name = "harness-coordinator";

/**
 * The selectable policies, in the order a reader should meet them: the one that runs first.
 *
 * Listed as values rather than as a map keyed by string literal so the names come from the policies
 * themselves. A hand-written key would be a second copy of a name the package already carries, and
 * the copy would be the one a deployment types into YAML.
 */
export const POLICIES: readonly IndependencePolicy[] = [OPPOSITE_FAMILY, SEAM_OR_FAMILY];

/** Opposite-family review. Never traded away by default; see the header. */
export const DEFAULT_POLICY: IndependencePolicy = OPPOSITE_FAMILY;

/** What a deployment may set on the `harness-coordinator` row. */
export interface CoordinatorConfig {
  /** Name of one of `POLICIES`. */
  readonly policy: string;
}

export const Config = z.object({
  policy: z
    .string()
    .default(DEFAULT_POLICY.name)
    .description(
      "Evaluator independence policy. The default is the stronger of the two; see the plugin header.",
    ),
});

/** The coordinator seam. */
export interface CoordinatorService {
  /** Every workflow this deployment knows, in declaration order. */
  readonly workflows: readonly Workflow[];
  /** The independence policy in force. Named, so a record can say which rule applied. */
  readonly policy: IndependencePolicy;
  /** Look one up by name. `null` rather than a throw: an unknown name is a caller's question. */
  workflow(name: string): Workflow | null;
  /** Structural problems in a workflow — cycles, ungated effects, unreachable steps. */
  check(workflow: Workflow): readonly Problem[];
  /** Choose an evaluator for `author`, under the configured policy. */
  selectEvaluator(author: Actor, candidates: readonly Candidate[]): EvaluatorDecision;
}

/**
 * Resolve the policy named by the config.
 *
 * @throws {RangeError} if the name is not one of `POLICIES`. A misspelled policy must not fall back
 * to the default: the deployment asked for a specific review rule and silently getting a different
 * one is the failure this whole seam exists to prevent.
 */
export function resolvePolicy(policy: string | undefined): IndependencePolicy {
  if (policy === undefined) return DEFAULT_POLICY;
  for (const candidate of POLICIES) {
    if (candidate.name === policy) return candidate;
  }
  const known = POLICIES.map((p) => p.name).join(", ");
  throw new RangeError(`unknown independence policy ${JSON.stringify(policy)}; known: ${known}`);
}

/** Build the service without a context, so it can be tested without booting cordis. */
export function createService(config: Partial<CoordinatorConfig> | undefined): CoordinatorService {
  const policy = resolvePolicy(config?.policy);
  return {
    workflows: WORKFLOWS,
    policy,
    workflow(wanted) {
      for (const candidate of WORKFLOWS) {
        if (candidate.name === wanted) return candidate;
      }
      return null;
    },
    check(workflow) {
      return checkWorkflow(workflow);
    },
    selectEvaluator(author, candidates) {
      return selectEvaluator(author, candidates, policy);
    },
  };
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    harnessCoordinator: CoordinatorService;
  }
}

export function apply(ctx: Context, config?: Partial<CoordinatorConfig>): void {
  ctx.provide(CONTEXT_KEY, createService(config));
}

export default { name, Config, apply };
