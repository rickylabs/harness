/** Pure queries over the explicitly supplied immutable document. No active/default table. */
import type { RoutingConfiguration, ModelFamily, LanePolicy, LaneConstraint } from "./schema.js";
export function familyOf(configuration: RoutingConfiguration, model: string): ModelFamily | null {
  return Object.hasOwn(configuration.models, model) ? configuration.models[model]!.family : null;
}
export function isPinnedModel(configuration: RoutingConfiguration, model: string): boolean {
  return Object.hasOwn(configuration.models, model);
}
export function pinnedModels(configuration: RoutingConfiguration): readonly string[] { return Object.keys(configuration.models); }
export function isApprovedOpenEvaluator(configuration: RoutingConfiguration, model: string): boolean {
  return Object.hasOwn(configuration.models, model) && configuration.models[model]!.approvedRelayEvaluator === true;
}
export function lanePolicy(configuration: RoutingConfiguration, lane: string): LanePolicy | null {
  return configuration.lanes.find(p => p.lane === canonicalLane(configuration, lane)) ?? null;
}
export function lanes(configuration: RoutingConfiguration): readonly string[] { return configuration.lanes.map(p => p.lane); }
export function tiers(configuration: RoutingConfiguration): readonly string[] { return configuration.tiers.map(p => p.tier); }
export function tierLanes(configuration: RoutingConfiguration, tier: string) {
  const row = configuration.tiers.find(p => p.tier === tier);
  return row ? { ...row, implement: row.implementation ?? row.implement!, review: row.review ?? row.implementation_evaluation! } : null;
}
export function laneConstraint(configuration: RoutingConfiguration, lane: string): LaneConstraint | null {
  lane = canonicalLane(configuration, lane);
  return Object.hasOwn(configuration.constraints, lane) ? configuration.constraints[lane]! : null;
}
export function effortIndex(configuration: RoutingConfiguration, effort: string): number { return configuration.efforts.ordered.indexOf(effort); }
export function declaredEfforts(configuration: RoutingConfiguration): readonly string[] { return [...configuration.efforts.ordered, ...configuration.efforts.unordered ?? []]; }
export function isDeclaredEffort(configuration: RoutingConfiguration, effort: string): boolean { return declaredEfforts(configuration).includes(effort); }
export function maxFallbackDepth(configuration: RoutingConfiguration): number { return configuration.policy.maxFallbackDepth; }

/** Aliases are validated one-hop references, never parsed from a harness or role name. */
export function canonicalLane(configuration: RoutingConfiguration, lane: string): string {
  return configuration.laneAliases && Object.hasOwn(configuration.laneAliases, lane) ? configuration.laneAliases[lane]! : lane;
}
/** Exact role binding; legacy implementation spellings are accepted at this query boundary. */
export function tierRoleLane(configuration: RoutingConfiguration, tier: string, role: string): string | null {
  const row = configuration.tiers.find(p => p.tier === tier);
  if (!row || role === "tier") return null;
  let binding = Object.hasOwn(row, role) ? row[role] : undefined;
  if (binding === undefined && role === "implementation") binding = row.implement;
  if (binding === undefined && role === "implement") binding = row.implementation;
  if (binding === undefined && role === "implementation_evaluation") binding = row.review;
  if (binding === undefined && role === "review") binding = row.implementation_evaluation;
  return binding === undefined ? null : canonicalLane(configuration, binding);
}
