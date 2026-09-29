/** Ported from the pinned fleet resolver at NetScript 0985265; Harness owns this policy. */
/** Active route resolution derived from the owner-ratified delegation matrix. */

import { OPENCODE_TOOL } from './versions.ts';
import type {
  AgentKind,
  Effort,
  ProviderKind,
  RouteIdentity,
  SessionIdentity,
} from './contract.ts';
import {
  assertOwnerMatrixOverride,
  assertPrivilegedTierAuthorization,
  COORDINATOR_MATRIX,
  type CoordinatorTier,
  DELEGATION_MATRIX,
  type DelegationRole,
  isTransportAllowedForRole,
  type LegacyRoutingLane,
  type LogicalModelId,
  MODEL_CATALOG,
  MODEL_TRANSPORT_PRIORITY,
  modelFamily,
  type ModelRoute,
  type ModelTransport,
  type OwnerMatrixOverride,
  type PrivilegedTierAuthorization,
  rejectLegacyLaneForNewSelection,
  WORKLOAD_TIERS,
  type WorkloadTier,
} from './delegation-matrix.ts';

export interface CanonicalRoutePolicy {
  readonly tier: WorkloadTier;
  readonly role: DelegationRole;
  readonly priority: number;
  readonly model: LogicalModelId;
  readonly family: ReturnType<typeof modelFamily>;
  readonly effort: ModelRoute['effort'];
}

/** Human/inspection view; active launch resolution reads the matrix directly. */
export const CANONICAL_ROUTE_POLICY: readonly CanonicalRoutePolicy[] = WORKLOAD_TIERS.flatMap(
  (tier) => {
    const cell = DELEGATION_MATRIX[tier];
    return (Object.keys(cell) as (keyof typeof cell)[]).flatMap((role) => {
      if (!Array.isArray(cell[role])) return [];
      return (cell[role] as readonly ModelRoute[]).map((candidate, priority) => ({
        tier,
        role: role as DelegationRole,
        priority,
        model: candidate.model,
        family: modelFamily(candidate.model),
        effort: candidate.effort,
      }));
    });
  },
);

export interface CanonicalCoordinatorPolicy {
  readonly tier: CoordinatorTier;
  readonly priority: number;
  readonly model: LogicalModelId;
  readonly family: ReturnType<typeof modelFamily>;
  readonly effort: ModelRoute['effort'];
}

export const CANONICAL_COORDINATOR_POLICY: readonly CanonicalCoordinatorPolicy[] = Object.entries(
  COORDINATOR_MATRIX,
).flatMap(([tier, routes]) =>
  routes.map((candidate, priority) => ({
    tier: tier as CoordinatorTier,
    priority,
    model: candidate.model,
    family: modelFamily(candidate.model),
    effort: candidate.effort,
  }))
);

export interface RouteAvailability {
  readonly unavailableModels?: readonly LogicalModelId[];
  readonly unavailableTransports?: readonly ModelTransport[];
}

export interface WorkloadRouteRequest extends RouteAvailability {
  readonly tier: WorkloadTier;
  readonly role: DelegationRole;
  readonly generatorModel?: LogicalModelId;
  readonly worktree: string;
  readonly mobileRequired?: boolean;
  readonly privilegedTierAuthorization?: PrivilegedTierAuthorization;
  readonly ownerMatrixOverride?: OwnerMatrixOverride;
}

export interface CoordinatorRouteRequest extends RouteAvailability {
  readonly tier: CoordinatorTier;
  readonly worktree: string;
  readonly mobileRequired?: boolean;
}

export interface ResolvedDelegationRoute extends RouteIdentity {
  readonly logicalModel: LogicalModelId;
  readonly family: ReturnType<typeof modelFamily>;
  readonly transport: ModelTransport;
  readonly requestedEffort: ModelRoute['effort'];
  readonly privilegedTierAuthorization?: PrivilegedTierAuthorization;
  readonly ownerMatrixOverride?: OwnerMatrixOverride;
}

const TRANSPORT_AGENT: Readonly<Record<ModelTransport, AgentKind>> = {
  claude: 'claude',
  codex: 'codex',
  agy: 'antigravity',
  github_copilot: 'opencode',
  opencode_go: 'opencode',
  ollama: 'opencode',
  openrouter: 'opencode',
};

const TRANSPORT_PROVIDER: Readonly<Record<ModelTransport, ProviderKind>> = {
  claude: 'anthropic',
  codex: 'openai',
  agy: 'google',
  github_copilot: 'github_copilot',
  opencode_go: 'opencode_go',
  ollama: 'ollama',
  openrouter: 'openrouter',
};

const TRANSPORT_PROFILE = {
  github_copilot: 'opencode-copilot',
  opencode_go: 'opencode-go',
  ollama: 'opencode-ollama',
  openrouter: 'opencode-openrouter',
} as const;

function concreteEffort(effort: ModelRoute['effort']): Effort {
  return effort === 'provider_default' ? OPENCODE_TOOL.defaultVariant : effort;
}

function resolveRouteChain(
  candidates: readonly ModelRoute[],
  request: RouteAvailability & {
    readonly role?: DelegationRole;
    readonly generatorModel?: LogicalModelId;
    readonly worktree: string;
    readonly mobileRequired?: boolean;
  },
): ResolvedDelegationRoute {
  const unavailableModels = new Set(request.unavailableModels ?? []);
  const unavailableTransports = new Set(request.unavailableTransports ?? []);
  const generatorFamily = request.generatorModel ? modelFamily(request.generatorModel) : undefined;
  for (const candidate of candidates) {
    if (unavailableModels.has(candidate.model)) continue;
    const definition = MODEL_CATALOG[candidate.model];
    if (generatorFamily && definition.family === generatorFamily) continue;
    const capability = definition.capabilities.toSorted((left, right) =>
      MODEL_TRANSPORT_PRIORITY.indexOf(left.transport) -
      MODEL_TRANSPORT_PRIORITY.indexOf(right.transport)
    ).find((entry) =>
      !unavailableTransports.has(entry.transport) &&
      (!request.role || isTransportAllowedForRole(request.role, entry.transport, definition.family))
    );
    if (!capability) continue;
    return {
      agent: TRANSPORT_AGENT[capability.transport],
      provider: TRANSPORT_PROVIDER[capability.transport],
      ...(capability.transport in TRANSPORT_PROFILE
        ? {
          profileId: TRANSPORT_PROFILE[
            capability.transport as keyof typeof TRANSPORT_PROFILE
          ],
        }
        : {}),
      model: capability.model,
      effort: concreteEffort(candidate.effort),
      worktree: request.worktree,
      mobileRequired: request.mobileRequired ?? false,
      logicalModel: candidate.model,
      family: definition.family,
      transport: capability.transport,
      requestedEffort: candidate.effort,
    };
  }
  const pairing = generatorFamily ? ` opposite ${generatorFamily}` : '';
  throw new Error(`no available${pairing} route in the declared fallback chain`);
}

/** Resolves a workload role without consulting the retired flat lane table. */
export function resolveWorkloadRoute(request: WorkloadRouteRequest): ResolvedDelegationRoute {
  if (request.ownerMatrixOverride) {
    assertOwnerMatrixOverride(request.tier, request.role, request.ownerMatrixOverride);
  } else {
    assertPrivilegedTierAuthorization(request.tier, request.privilegedTierAuthorization);
  }
  const cell = DELEGATION_MATRIX[request.tier];
  const candidates = request.ownerMatrixOverride
    ? [request.ownerMatrixOverride.route]
    : cell[request.role];
  if (candidates.length === 0) {
    throw new Error(`${request.tier}/${request.role} is not applicable`);
  }
  const evaluation = request.role === 'plan_evaluation' ||
    request.role === 'implementation_evaluation' || request.role === 'vision_evaluation';
  if (evaluation && !request.generatorModel) {
    throw new Error(`${request.role} requires the selected generator model`);
  }
  return {
    ...resolveRouteChain(candidates, {
      ...request,
      role: request.ownerMatrixOverride ? undefined : request.role,
    }),
    ...(request.privilegedTierAuthorization
      ? { privilegedTierAuthorization: request.privilegedTierAuthorization }
      : {}),
    ...(request.ownerMatrixOverride ? { ownerMatrixOverride: request.ownerMatrixOverride } : {}),
  };
}

/** Resolves an orchestrator/coordinator route from its dedicated matrix. */
export function resolveCoordinatorRoute(
  request: CoordinatorRouteRequest,
): ResolvedDelegationRoute {
  return resolveRouteChain(COORDINATOR_MATRIX[request.tier], request);
}

/** Evaluators must be both a different session and a different vendor family. */
export function assertEvaluatorIndependence(
  generator: SessionIdentity & { readonly model: LogicalModelId },
  evaluator: SessionIdentity & { readonly model: LogicalModelId },
): void {
  if (generator.sessionId === evaluator.sessionId) {
    throw new Error('generator and evaluator sessions must differ');
  }
  if (modelFamily(generator.model) === modelFamily(evaluator.model)) {
    throw new Error('generator and evaluator model families must differ');
  }
}

/** Explicit new-selection boundary for persisted pre-revamp lane values. */
export function resolveLegacyRouteForNewSelection(lane: LegacyRoutingLane): never {
  return rejectLegacyLaneForNewSelection(lane);
}

export {
  type CoordinatorTier,
  DELEGATION_MATRIX,
  type DelegationRole,
  type LegacyRoutingLane,
  type LogicalModelId,
  MODEL_CATALOG,
  type ModelTransport,
  type OwnerMatrixOverride,
  type WorkloadTier,
};
