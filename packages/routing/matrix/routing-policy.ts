/** Ported from the pinned fleet resolver at NetScript 0985265; Harness owns this policy. */
/** Active route resolution derived from the owner-ratified delegation matrix. */

import type { MatrixLoadedConfiguration } from './configuration-contract.ts';
import { routeLaunchability, type LauncherInventory, type Launchability } from './launchability.ts';
import { OPENCODE_TOOL } from './versions.ts';
import type {
  AgentKind,
  Effort,
  ProviderKind,
  RouteIdentity,
  SessionIdentity,
} from './contract.ts';
import {
  MATRIX_AUTHORITY,
  matrixAuthority,
  type MatrixAuthority,
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
  /** Exact dispatch-host IDs. Missing observation remains unverified. */
  readonly launcherInventory?: LauncherInventory;
  readonly unavailableModels?: readonly LogicalModelId[];
  readonly unavailableTransports?: readonly ModelTransport[];
}

export interface WorkloadRouteRequest extends RouteAvailability {
  readonly tier: WorkloadTier;
  readonly role: string;
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
  readonly launchability: Launchability;
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

function concreteEffort(effort: ModelRoute['effort']): Effort {
  return effort === 'provider_default' ? OPENCODE_TOOL.defaultVariant : effort;
}

function resolveRouteChain(
  candidates: readonly ModelRoute[],
  request: RouteAvailability & {
    readonly role?: string;
    readonly generatorModel?: LogicalModelId;
    readonly worktree: string;
    readonly mobileRequired?: boolean;
  },
  authority: MatrixAuthority,
): ResolvedDelegationRoute {
  const unavailableModels = new Set(request.unavailableModels ?? []);
  const unavailableTransports = new Set(request.unavailableTransports ?? []);
  const generatorFamily = request.generatorModel ? modelFamily(request.generatorModel, authority) : undefined;
  for (const candidate of candidates) {
    if (unavailableModels.has(candidate.model)) continue;
    const definition = authority.catalog[candidate.model];
    if (!definition) throw new Error('unknown configured model');
    if (generatorFamily && definition.family === generatorFamily) continue;
    const capability = definition.capabilities.toSorted((left, right) =>
      authority.configuration.providerPrecedence.indexOf(left.transport) -
      authority.configuration.providerPrecedence.indexOf(right.transport)
    ).find((entry) =>
      !unavailableTransports.has(entry.transport) &&
      (!request.role || isTransportAllowedForRole(request.role, entry.transport, definition.family, authority, candidate.model, entry.launch))
    );
    if (!capability) continue;
    const route = {
      agent: TRANSPORT_AGENT[capability.transport],
      provider: TRANSPORT_PROVIDER[capability.transport],
      ...(capability.profileId ? { profileId: capability.profileId } : {}),
      model: capability.model,
      effort: concreteEffort(candidate.effort),
      worktree: request.worktree,
      mobileRequired: request.mobileRequired ?? false,
      logicalModel: candidate.model,
      family: definition.family,
      transport: capability.transport,
      requestedEffort: candidate.effort,
    };
    return { ...route, launchability: routeLaunchability(route, request.launcherInventory, authority) };
  }
  const pairing = generatorFamily ? ` opposite ${generatorFamily}` : '';
  throw new Error(`no available${pairing} route in the declared fallback chain`);
}

/** Resolves a workload role without consulting the retired flat lane table. */
export function resolveWorkloadRoute(request: WorkloadRouteRequest, authority: MatrixAuthority = MATRIX_AUTHORITY): ResolvedDelegationRoute {
  if (request.ownerMatrixOverride) {
    assertOwnerMatrixOverride(request.tier, request.role as DelegationRole, request.ownerMatrixOverride);
  } else {
    assertPrivilegedTierAuthorization(request.tier, request.privilegedTierAuthorization, authority);
  }
  const cell = authority.matrix[request.tier];
  if (!cell || !Object.hasOwn(authority.configuration.roles, request.role)) throw new Error('unknown configured tier or role');
  const candidates: readonly ModelRoute[] = request.ownerMatrixOverride
    ? [request.ownerMatrixOverride.route]
    : (cell as unknown as Readonly<Record<string, readonly ModelRoute[]>>)[request.role]!;
  if (candidates.length === 0) {
    throw new Error(`${request.tier}/${request.role} is not applicable`);
  }
  const evaluation = authority.configuration.roles[request.role]?.certifies !== undefined;
  if (evaluation && !request.generatorModel) {
    throw new Error(`${request.role} requires the selected generator model`);
  }
  return {
    ...resolveRouteChain(candidates, {
      ...request,
      role: request.ownerMatrixOverride ? undefined : request.role,
    }, authority),
    ...(request.privilegedTierAuthorization
      ? { privilegedTierAuthorization: request.privilegedTierAuthorization }
      : {}),
    ...(request.ownerMatrixOverride ? { ownerMatrixOverride: request.ownerMatrixOverride } : {}),
  };
}

/** Resolves an orchestrator/coordinator route from its dedicated matrix. */
export function resolveCoordinatorRoute(
  request: CoordinatorRouteRequest,
  authority: MatrixAuthority = MATRIX_AUTHORITY,
): ResolvedDelegationRoute {
  const candidates = authority.coordinators[request.tier];
  if (!candidates) throw new Error('unknown configured coordinator scope');
  return resolveRouteChain(candidates, request, authority);
}

/** Evaluators must be both a different session and a different vendor family. */
export function assertEvaluatorIndependence(
  generator: SessionIdentity & { readonly model: LogicalModelId },
  evaluator: SessionIdentity & { readonly model: LogicalModelId },
  authority: MatrixAuthority = MATRIX_AUTHORITY,
): void {
  if (generator.sessionId === evaluator.sessionId) {
    throw new Error('generator and evaluator sessions must differ');
  }
  if (modelFamily(generator.model, authority) === modelFamily(evaluator.model, authority)) {
    throw new Error('generator and evaluator model families must differ');
  }
}

/** #271 whole-document replacement. This never manufactures a loader result or a default. */
export function configuredRoutingPolicy(loaded: MatrixLoadedConfiguration) {
  const authority = matrixAuthority(loaded);
  return {
    authority,
    resolveWorkloadRoute: (request: WorkloadRouteRequest) => resolveWorkloadRoute(request, authority),
    resolveCoordinatorRoute: (request: CoordinatorRouteRequest) => resolveCoordinatorRoute(request, authority),
    assertEvaluatorIndependence: (generator: SessionIdentity & { readonly model: LogicalModelId }, evaluator: SessionIdentity & { readonly model: LogicalModelId }) => assertEvaluatorIndependence(generator, evaluator, authority),
  };
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
