// Owner decision (Eric, 2026-10-08): Opus 5.5 high implements, Sol high evaluates plans and
// implementations, and Opus 5.5 xhigh coordinates milestones. Each new route is prepended to its
// cell; the previous chain stays as the fallback. Architecture and other scopes are unchanged.
export const OWNER_ROUTING_2026_10_08 = Object.freeze({
  tiers: Object.freeze(["simple", "straightforward", "feature", "complex"]),
  roles: Object.freeze({
    implementation: Object.freeze({ model: "opus_5_5", effort: "high" }),
    plan_evaluation: Object.freeze({ model: "sol", effort: "high" }),
    implementation_evaluation: Object.freeze({ model: "sol", effort: "high" }),
  }),
  coordinators: Object.freeze({ milestone: Object.freeze({ model: "opus_5_5", effort: "xhigh" }) }),
});

const same = (left, right) => left.model === right.model && left.effort === right.effort;
const prepend = (head, routes) => [{ ...head }, ...routes.filter(route => !same(route, head))];

/** The route the decision prepends to a non-empty workload cell, if any. */
export function ownerWorkloadHead(tier, role) {
  return OWNER_ROUTING_2026_10_08.tiers.includes(tier) ? OWNER_ROUTING_2026_10_08.roles[role] : undefined;
}

/** Applies the decision to one workload cell. An empty cell has no lane and stays empty. */
export function ownerWorkloadRoutes(tier, role, routes) {
  const head = ownerWorkloadHead(tier, role);
  return head && routes.length ? prepend(head, routes) : routes;
}

export function ownerCoordinatorRoutes(scope, routes) {
  const head = OWNER_ROUTING_2026_10_08.coordinators[scope];
  return head ? prepend(head, routes) : routes;
}
