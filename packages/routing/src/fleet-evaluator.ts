/** A logical evaluator choice from a validated fleet document; no launch is authorized here. */
import {
  cellOf, feasibleCandidate, feasibleEvaluator, roleOf,
  type Candidate, type FleetRoutingConfiguration,
} from "./fleet.js";

export interface FleetEvaluatorRequest {
  readonly tier: string;
  readonly generatorRole: string;
  /** The candidate actually selected for the generator, including its fallback effort. */
  readonly selectedGenerator: Candidate;
  readonly evaluatorRole: string;
}

/** Selects the first feasible, different-family certifier; every missing proof refuses. */
export function selectFleetEvaluator(
  configuration: FleetRoutingConfiguration,
  request: FleetEvaluatorRequest,
): Candidate {
  const generationRole = roleOf(configuration, request.generatorRole);
  const evaluatorRole = roleOf(configuration, request.evaluatorRole);
  const generators = cellOf(configuration, request.tier, request.generatorRole);
  const evaluators = cellOf(configuration, request.tier, request.evaluatorRole);
  if (generationRole === null || generationRole.certifies !== undefined ||
      evaluatorRole?.certifies !== "any" || !evaluatorRole.evaluates?.includes(request.generatorRole) ||
      !generators?.some(candidate => candidate.model === request.selectedGenerator.model &&
        candidate.effort === request.selectedGenerator.effort) ||
      !feasibleCandidate(configuration, request.selectedGenerator, generationRole) ||
      evaluators === null) throw new Error("fleet evaluator unavailable");

  const selected = evaluators.find(candidate =>
    feasibleEvaluator(configuration, request.selectedGenerator, candidate, evaluatorRole));
  if (selected === undefined) throw new Error("fleet evaluator unavailable");
  return selected;
}
