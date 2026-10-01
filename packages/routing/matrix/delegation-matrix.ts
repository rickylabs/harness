/** INTERIM pinned-source adapter for #270: https://github.com/rickylabs/harness/issues/270.
 * Model IDs, labels, cells, loops and precedence come from #271 versioned document data.
 * Node callers replace the whole document with a successful #271 loader result.
 * The raw-source bridge imports the CI-validated shipped document until consumer loaders migrate.
 */
import shipped from '../config/routing.fleet.v2.json' with { type: 'json' };
import type { MatrixDocument, MatrixLaunch, MatrixLoadedConfiguration } from './configuration-contract.ts';
import type { Effort } from './contract.ts';
export type LogicalModelId = string;
export type ModelVendorFamily = string;
/** Existing executor vocabulary, interim until provider discovery (#270). No model choices. */
export const MODEL_TRANSPORTS = ['claude', 'codex', 'agy', 'github_copilot', 'opencode_go', 'ollama', 'openrouter'] as const;
export type ModelTransport = typeof MODEL_TRANSPORTS[number];
export interface ModelCapability { readonly transport: ModelTransport; readonly model: string; readonly launch: MatrixLaunch; readonly profileId?: string }
export interface LogicalModelDefinition { readonly id: LogicalModelId; readonly family: ModelVendorFamily; readonly capabilities: readonly ModelCapability[] }
export type WorkloadTier = string;
export type PrivilegedWorkloadTier = string;
export type DelegationRole = keyof typeof shipped.roles;
export type CoordinatorTier = string;
export interface PrivilegedTierAuthorization { readonly authorizer: 'owner' | 'milestone_coordinator'; readonly rationale: string }
export interface MatrixAuthority {
  readonly configuration: MatrixDocument;
  readonly catalog: Readonly<Record<string, LogicalModelDefinition>>;
  readonly matrix: Readonly<Record<string, DelegationCell>>;
  readonly coordinators: Readonly<Record<string, readonly ModelRoute[]>>;
  readonly source?: MatrixLoadedConfiguration['source'];
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function adapt(configuration: MatrixDocument, source?: MatrixLoadedConfiguration['source']): MatrixAuthority {
  const catalog = Object.fromEntries(Object.entries(configuration.models).map(([id,m]) => [id, {
    id, family:m.family, capabilities:m.launches.filter(l => l.seam === 'subagents').map(l => {
      if (!MODEL_TRANSPORTS.includes(l.provider as ModelTransport)) throw new Error('unsupported matrix provider');
      return { transport:l.provider as ModelTransport, model:l.id, launch:l, ...(l.profile ? { profileId:l.profile } : {}) };
    }),
  }]));
  const matrix = Object.fromEntries(configuration.tiers.map(t => [t.tier, {
    ...t.cells, planPolicy:t.loops?.plan, implementationPolicy:t.loops?.implementation, documentationPolicy:t.loops?.documentation,
  }])) as Readonly<Record<string, DelegationCell>>;
  return freeze({ configuration, catalog, matrix, coordinators:configuration.coordinators as MatrixAuthority['coordinators'], ...(source ? {source} : {}) });
}
/** Requires a successful #271 loader result. No merging or fallback to the shipped document. */
export function matrixAuthority(loaded: MatrixLoadedConfiguration): MatrixAuthority {
  const configuration = loaded.configuration as MatrixDocument;
  if (configuration?.schemaVersion !== 2 || loaded.source.schemaVersion !== 2) throw new Error('matrix requires fleet-cells schema');
  return adapt(configuration, loaded.source);
}
export const MATRIX_AUTHORITY = adapt(shipped as unknown as MatrixDocument);
export const LOGICAL_MODEL_IDS = Object.keys(MATRIX_AUTHORITY.catalog);
export const LOGICAL_MODEL_LABELS = Object.fromEntries(Object.entries(MATRIX_AUTHORITY.configuration.models).map(([id,m]) => [id,m.label ?? id]));
export const MODEL_VENDOR_FAMILIES = MATRIX_AUTHORITY.configuration.families;
export const MODEL_CATALOG = MATRIX_AUTHORITY.catalog;
export const MODEL_TRANSPORT_PRIORITY = MATRIX_AUTHORITY.configuration.providerPrecedence as readonly ModelTransport[];
export const WORKLOAD_TIERS = MATRIX_AUTHORITY.configuration.tiers.map(t => t.tier);
export const WORKLOAD_TIER_DESCRIPTIONS = Object.fromEntries(MATRIX_AUTHORITY.configuration.tiers.map(t => [t.tier,t.description ?? t.tier]));
export const PRIVILEGED_WORKLOAD_TIERS = MATRIX_AUTHORITY.configuration.tiers.filter(t => t.authorization).map(t => t.tier);
/** Complex/architecture rows consume scarce subscriptions and require explicit authority. */
export function assertPrivilegedTierAuthorization(
  tier: WorkloadTier,
  authorization?: PrivilegedTierAuthorization,
  authority: MatrixAuthority = MATRIX_AUTHORITY,
): void {
  const row = authority.configuration.tiers.find(t => t.tier === tier);
  if (!row) throw new Error('unknown workload tier');
  if (!row.authorization) return;
  if (!authorization?.rationale.trim() || !row.authorization.by.includes(authorization.authorizer === 'milestone_coordinator' ? 'milestone' : authorization.authorizer)) {
    throw new Error(
      `${tier} workload tier requires explicit owner or milestone-coordinator authorization`,
    );
  }
}

export const DELEGATION_ROLES = Object.keys(MATRIX_AUTHORITY.configuration.roles) as DelegationRole[];
export const DEEP_RESEARCH_TRANSPORTS = MATRIX_AUTHORITY.configuration.roles.deep_research?.restrictions?.providers ?? [];
export type DeepResearchTransport = ModelTransport;
export function isTransportAllowedForRole(role: string, transport: ModelTransport, family?: ModelVendorFamily, authority: MatrixAuthority = MATRIX_AUTHORITY, logicalModel?: string, launch?: MatrixLaunch): boolean {
  // Existing consumers use the three-argument coarse query. Check whether any declared
  // capability can serve it; active resolution supplies the exact model and launch below.
  if (logicalModel === undefined || launch === undefined) return Object.entries(authority.configuration.models).some(([id,m]) =>
    (family === undefined || m.family === family) && m.launches.some(l => l.provider === transport &&
      isTransportAllowedForRole(role, transport, m.family, authority, id, l)));
  const declared = authority.configuration.roles[role];
  if (!declared) throw new Error('unknown configured role');
  const r = declared.restrictions;
  const model = logicalModel ? authority.configuration.models[logicalModel] : undefined;
  return (!r?.providers || r.providers.includes(transport)) &&
    (!r?.families || (family !== undefined && r.families.includes(family))) &&
    (!r?.models || (logicalModel !== undefined && r.models.includes(logicalModel))) &&
    (!r?.seams || (launch !== undefined && r.seams.includes(launch.seam))) &&
    (!r?.transports || (launch !== undefined && r.transports.includes(launch.transport))) &&
    (!r?.harnesses || (launch?.harness !== undefined && r.harnesses.includes(launch.harness))) &&
    (!declared.requires || declared.requires.every(c => model?.capabilities?.includes(c))) &&
    !(declared.certifies !== undefined && launch?.transport === 'openrouter' && model?.approvedRelayEvaluator !== true);
}

export interface ModelRoute {
  readonly model: LogicalModelId;
  readonly effort: Effort | 'provider_default';
}

/** Owner-only escape hatch. The exact grant must also exist in the named harness worklog. */
export interface OwnerMatrixOverride {
  readonly authorizer: 'owner';
  readonly rationale: string;
  readonly worklogPath: string;
  readonly route: ModelRoute;
}

export function ownerMatrixOverrideWorklogEntry(
  tier: WorkloadTier,
  role: DelegationRole,
  override: OwnerMatrixOverride,
): string {
  assertOwnerMatrixOverride(tier, role, override);
  return `- **Owner matrix override:** owner authorized \`${tier}/${role}\` → ` +
    `\`${override.route.model}@${override.route.effort}\` because ${override.rationale}`;
}

export function assertOwnerMatrixOverride(
  _tier: WorkloadTier,
  _role: DelegationRole,
  override: OwnerMatrixOverride,
): void {
  if (override.authorizer !== 'owner') throw new Error('matrix override requires owner authority');
  if (!override.rationale.trim() || /[\r\n]/.test(override.rationale)) {
    throw new Error('matrix override requires a single-line owner rationale');
  }
  const path = override.worklogPath.replaceAll('\\', '/');
  const segments = path.split('/');
  if (
    path.startsWith('/') || segments[0] !== '.llm' || segments[1] !== 'runs' ||
    segments.length < 4 || segments.at(-1) !== 'worklog.md' ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('matrix override must cite a repo-relative .llm/runs/**/worklog.md');
  }
}

export interface EvaluationPolicy {
  readonly maxRounds: number | 'none' | 'unspecified_by_owner';
  readonly notifyOwnerAfter?: number;
  readonly repairInFlightAt?: number | 'immediate';
  readonly escalateToOwnerAt?: number;
  readonly reSteerSameSession: true;
}

export interface DelegationCell {
  readonly implementation: readonly ModelRoute[];
  readonly ui_ux: readonly ModelRoute[];
  readonly plan: readonly ModelRoute[];
  readonly plan_evaluation: readonly ModelRoute[];
  readonly implementation_evaluation: readonly ModelRoute[];
  readonly vision_evaluation: readonly ModelRoute[];
  readonly documentation: readonly ModelRoute[];
  readonly deep_research: readonly ModelRoute[];
  readonly planPolicy: EvaluationPolicy;
  readonly implementationPolicy: EvaluationPolicy;
  readonly documentationPolicy: EvaluationPolicy;
}

export const DELEGATION_MATRIX = MATRIX_AUTHORITY.matrix;

/** Refuses a concrete provider model that is not declared in the selected matrix cell. */
export function assertWorkloadModelAllowed(
  tier: WorkloadTier,
  role: DelegationRole,
  concreteModel: string,
  override?: OwnerMatrixOverride,
): void {
  if (override) assertOwnerMatrixOverride(tier, role, override);
  const routes = override ? [override.route] : DELEGATION_MATRIX[tier][role];
  const allowed = routes.some((route) =>
    MODEL_CATALOG[route.model].capabilities.some((capability) =>
      capability.model === concreteModel && (override !== undefined ||
        isTransportAllowedForRole(role, capability.transport, MODEL_CATALOG[route.model].family, MATRIX_AUTHORITY, route.model, capability.launch))
    )
  );
  if (!allowed) {
    throw new Error(
      `${concreteModel} is not declared for ${tier}/${role}` +
        (override ? ' by the recorded owner override' : ''),
    );
  }
}

/**
 * Refuses a launch whose concrete effort differs from the selected matrix route.
 * A provider-default route may resolve to the launcher's pinned default, but an
 * explicit matrix effort must always be requested explicitly.
 */
export function assertWorkloadEffortAllowed(
  tier: WorkloadTier,
  role: DelegationRole,
  concreteModel: string,
  launchEffort: Effort | 'provider_default',
  providerDefaultEffort?: Effort,
  override?: OwnerMatrixOverride,
): void {
  if (override) assertOwnerMatrixOverride(tier, role, override);
  const routes = override ? [override.route] : DELEGATION_MATRIX[tier][role];
  const matchingRoutes = routes.filter((candidate) =>
    MODEL_CATALOG[candidate.model].capabilities.some((capability) =>
      capability.model === concreteModel
    )
  );
  const allowed = matchingRoutes.some((candidate) =>
    candidate.effort === launchEffort ||
    (candidate.effort === 'provider_default' && launchEffort === providerDefaultEffort)
  );
  if (!allowed) {
    const expected = matchingRoutes.map((candidate) => candidate.effort).join(' or ') || 'none';
    throw new Error(
      `${concreteModel}@${launchEffort} does not match ${tier}/${role} effort ${expected}` +
        (override ? ' in the recorded owner override' : ''),
    );
  }
}

export const COORDINATOR_TIERS = Object.keys(MATRIX_AUTHORITY.coordinators);
export const COORDINATOR_MATRIX = MATRIX_AUTHORITY.coordinators;
/** INTERIM deserialize-only vocabulary, never a selection table (#270). */
export const LEGACY_ROUTING_LANES = [
  'light_implementation',
  'normal_implementation',
  'complex_implementation',
  'fast_iteration',
  'deep_analysis',
  'planning_decisions',
  'major_ui_ux_design',
  'major_ui_ux_adversarial_review',
  'adversarial_design_eval',
  'documentation_review',
  'documentation_authoring',
  'docs_audit',
  'docs_polish',
  'chore_code',
  'claude_workflow',
  'research_extraction',
  'formal_plan_evaluation',
  'formal_impl_evaluation',
  'review_claude',
  'review_codex_light',
  'review_codex',
  'review_codex_complex',
  'review_codex_fast',
] as const;
export type LegacyRoutingLane = typeof LEGACY_ROUTING_LANES[number];

export function modelFamily(model: LogicalModelId, authority: MatrixAuthority = MATRIX_AUTHORITY): ModelVendorFamily {
  const definition = authority.catalog[model];
  if (!definition) throw new Error('unknown configured model');
  return definition.family;
}

/** Selects the first evaluator that differs from the already-selected generator family. */
export function selectEvaluator(
  tier: WorkloadTier,
  phase: 'plan' | 'implementation' | 'vision',
  generator: LogicalModelId,
  authorization?: PrivilegedTierAuthorization,
): ModelRoute {
  assertPrivilegedTierAuthorization(tier, authorization);
  const candidates = phase === 'plan'
    ? DELEGATION_MATRIX[tier].plan_evaluation
    : phase === 'vision'
    ? DELEGATION_MATRIX[tier].vision_evaluation
    : DELEGATION_MATRIX[tier].implementation_evaluation;
  const selected = candidates.find((candidate) =>
    modelFamily(candidate.model) !== modelFamily(generator)
  );
  if (!selected) {
    throw new Error(`no different-family ${phase} evaluator for ${tier}/${generator}`);
  }
  return selected;
}

/** Proves every declared generator can compose a legal evaluator. */
export function validateDelegationMatrix(): readonly string[] {
  const errors: string[] = [];
  for (const tier of WORKLOAD_TIERS) {
    const cell = DELEGATION_MATRIX[tier];
    for (const generator of cell.implementation) {
      if (
        !cell.implementation_evaluation.some((candidate) =>
          modelFamily(candidate.model) !== modelFamily(generator.model)
        )
      ) errors.push(`${tier}/implementation/${generator.model}`);
    }
    for (const generator of cell.ui_ux) {
      if (
        !cell.vision_evaluation.some((candidate) =>
          modelFamily(candidate.model) !== modelFamily(generator.model)
        )
      ) errors.push(`${tier}/ui_ux/${generator.model}`);
    }
    for (const generator of cell.plan) {
      if (
        !cell.plan_evaluation.some((candidate) =>
          modelFamily(candidate.model) !== modelFamily(generator.model)
        )
      ) errors.push(`${tier}/plan/${generator.model}`);
    }
    for (const writer of cell.documentation) {
      if (
        !cell.implementation_evaluation.some((candidate) =>
          modelFamily(candidate.model) !== modelFamily(writer.model)
        )
      ) errors.push(`${tier}/documentation/${writer.model}`);
    }
  }
  return errors;
}

/** Refuses to guess how a pre-revamp lane should map into the replacement matrix. */
export function rejectLegacyLaneForNewSelection(lane: LegacyRoutingLane): never {
  throw new Error(
    `legacy routing lane ${lane} is deserialize-only; supply workload tier and delegation role`,
  );
}
