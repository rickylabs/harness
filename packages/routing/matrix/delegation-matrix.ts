/** Ported from the pinned fleet matrix at NetScript 0985265; Harness is the routing authority. */
/** Owner-ratified role/complexity delegation matrix. */

import { ROUTING_MODEL_IDS } from './models.ts';
import type { Effort } from './contract.ts';

export const LOGICAL_MODEL_IDS = [
  'luna',
  'sol',
  'astra',
  'fable_5_1',
  'opus_5',
  'opus_5_5',
  'gemini_3_8_flash',
  'qwen_3_8_flash_next',
  'qwen_3_8_max',
  'glm_5_3_flash',
  'glm_5_3',
  'muse_spark_1_3',
  'minimax_m3',
  'deepseek_v4_flash',
  'deepseek_v4_flash_vision',
  'deepseek_v4_pro',
  'kimi_k3',
  'grok_4_6',
] as const;
export type LogicalModelId = typeof LOGICAL_MODEL_IDS[number];

/** Stable human labels used by operator-facing matrix renderers. */
export const LOGICAL_MODEL_LABELS: Readonly<Record<LogicalModelId, string>> = {
  luna: 'Luna',
  sol: 'SOL',
  astra: 'Astra',
  fable_5_1: 'Fable 5.1',
  opus_5: 'Opus 5',
  opus_5_5: 'Opus 5.5',
  gemini_3_8_flash: 'Gemini 3.8 Flash',
  qwen_3_8_flash_next: 'Qwen 3.8 Flash Next',
  qwen_3_8_max: 'Qwen 3.8 Max',
  glm_5_3_flash: 'GLM 5.3 Flash',
  glm_5_3: 'GLM 5.3',
  muse_spark_1_3: 'Muse Spark 1.3',
  minimax_m3: 'MiniMax M3',
  deepseek_v4_flash: 'DeepSeek V4 Flash',
  deepseek_v4_flash_vision: 'DeepSeek V4 Flash Vision',
  deepseek_v4_pro: 'DeepSeek V4 Pro',
  kimi_k3: 'Kimi K3',
  grok_4_6: 'Grok 4.6',
} as const;

export const MODEL_VENDOR_FAMILIES = [
  'openai',
  'anthropic',
  'google',
  'alibaba',
  'zhipu',
  'meta',
  'minimax',
  'deepseek',
  'moonshot',
  'xai',
] as const;
export type ModelVendorFamily = typeof MODEL_VENDOR_FAMILIES[number];

export const MODEL_TRANSPORTS = [
  'claude',
  'codex',
  'agy',
  'github_copilot',
  'opencode_go',
  'ollama',
  'openrouter',
] as const;
export type ModelTransport = typeof MODEL_TRANSPORTS[number];

export interface ModelCapability {
  readonly transport: ModelTransport;
  readonly model: string;
}

export interface LogicalModelDefinition {
  readonly id: LogicalModelId;
  readonly family: ModelVendorFamily;
  readonly capabilities: readonly ModelCapability[];
}

const capability = (transport: ModelTransport, model: string): ModelCapability => ({
  transport,
  model,
});

export const MODEL_CATALOG: Readonly<Record<LogicalModelId, LogicalModelDefinition>> = {
  luna: {
    id: 'luna',
    family: 'openai',
    capabilities: [
      capability('codex', ROUTING_MODEL_IDS.lunaNative),
      capability('codex', ROUTING_MODEL_IDS.lunaPreviousNative),
      capability('opencode_go', ROUTING_MODEL_IDS.lunaGo),
    ],
  },
  sol: {
    id: 'sol',
    family: 'openai',
    capabilities: [
      capability('codex', ROUTING_MODEL_IDS.solNative),
      capability('codex', ROUTING_MODEL_IDS.solPreviousNative),
      capability('codex', ROUTING_MODEL_IDS.solLegacyNative),
    ],
  },
  astra: {
    id: 'astra',
    family: 'openai',
    capabilities: [capability('codex', ROUTING_MODEL_IDS.astraNative)],
  },
  fable_5_1: {
    id: 'fable_5_1',
    family: 'anthropic',
    capabilities: [
      capability('claude', ROUTING_MODEL_IDS.fable51Native),
      capability('github_copilot', ROUTING_MODEL_IDS.fable51Copilot),
    ],
  },
  opus_5: {
    id: 'opus_5',
    family: 'anthropic',
    capabilities: [capability('claude', ROUTING_MODEL_IDS.opus5Native)],
  },
  opus_5_5: {
    id: 'opus_5_5',
    family: 'anthropic',
    capabilities: [capability('claude', ROUTING_MODEL_IDS.opus55Native)],
  },
  gemini_3_8_flash: {
    id: 'gemini_3_8_flash',
    family: 'google',
    capabilities: [
      capability('agy', ROUTING_MODEL_IDS.gemini38FlashNative),
      capability('github_copilot', ROUTING_MODEL_IDS.gemini38FlashCopilot),
    ],
  },
  qwen_3_8_flash_next: {
    id: 'qwen_3_8_flash_next',
    family: 'alibaba',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.qwen38FlashNextGo),
      capability('openrouter', ROUTING_MODEL_IDS.qwen38FlashNextOpenRouter),
    ],
  },
  qwen_3_8_max: {
    id: 'qwen_3_8_max',
    family: 'alibaba',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.qwen38MaxGo),
      capability('openrouter', ROUTING_MODEL_IDS.qwen38MaxOpenRouter),
    ],
  },
  glm_5_3_flash: {
    id: 'glm_5_3_flash',
    family: 'zhipu',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.glm53FlashGo),
      capability('ollama', ROUTING_MODEL_IDS.glm53FlashOllama),
      capability('openrouter', ROUTING_MODEL_IDS.glm53FlashOpenRouter),
    ],
  },
  glm_5_3: {
    id: 'glm_5_3',
    family: 'zhipu',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.glm53Go),
      capability('ollama', ROUTING_MODEL_IDS.glm53Ollama),
      capability('openrouter', ROUTING_MODEL_IDS.glm53OpenRouter),
    ],
  },
  muse_spark_1_3: {
    id: 'muse_spark_1_3',
    family: 'meta',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.museSpark13Go),
      capability('openrouter', ROUTING_MODEL_IDS.museSpark13OpenRouter),
    ],
  },
  minimax_m3: {
    id: 'minimax_m3',
    family: 'minimax',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.minimaxM3Go),
      capability('ollama', ROUTING_MODEL_IDS.minimaxM3Ollama),
      capability('openrouter', ROUTING_MODEL_IDS.minimaxM3OpenRouter),
    ],
  },
  deepseek_v4_flash: {
    id: 'deepseek_v4_flash',
    family: 'deepseek',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.deepseekV4FlashGo),
      capability('ollama', ROUTING_MODEL_IDS.deepseekV4FlashOllama),
      capability('openrouter', ROUTING_MODEL_IDS.deepseekV4FlashOpenRouter),
    ],
  },
  deepseek_v4_flash_vision: {
    id: 'deepseek_v4_flash_vision',
    family: 'deepseek',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.deepseekV4FlashVisionGo),
      capability('openrouter', ROUTING_MODEL_IDS.deepseekV4FlashVisionOpenRouter),
    ],
  },
  deepseek_v4_pro: {
    id: 'deepseek_v4_pro',
    family: 'deepseek',
    capabilities: [
      capability('opencode_go', ROUTING_MODEL_IDS.deepseekV4ProGo),
      capability('ollama', ROUTING_MODEL_IDS.deepseekV4ProOllama),
      capability('openrouter', ROUTING_MODEL_IDS.deepseekV4ProOpenRouter),
    ],
  },
  kimi_k3: {
    id: 'kimi_k3',
    family: 'moonshot',
    capabilities: [
      capability('github_copilot', ROUTING_MODEL_IDS.kimiK3Copilot),
      capability('opencode_go', ROUTING_MODEL_IDS.kimiK3Go),
      capability('ollama', ROUTING_MODEL_IDS.kimiK3Ollama),
      capability('openrouter', ROUTING_MODEL_IDS.kimiK3OpenRouter),
    ],
  },
  grok_4_6: {
    id: 'grok_4_6',
    family: 'xai',
    capabilities: [
      capability('github_copilot', ROUTING_MODEL_IDS.grok46Copilot),
      capability('opencode_go', ROUTING_MODEL_IDS.grok46Go),
      capability('openrouter', ROUTING_MODEL_IDS.grok46OpenRouter),
    ],
  },
} as const;

export const MODEL_TRANSPORT_PRIORITY: readonly ModelTransport[] = [
  'claude',
  'codex',
  'agy',
  'github_copilot',
  'opencode_go',
  'ollama',
  'openrouter',
] as const;

export const WORKLOAD_TIERS = [
  'simple',
  'straightforward',
  'feature',
  'complex',
  'architecture',
] as const;
export type WorkloadTier = typeof WORKLOAD_TIERS[number];

/** Owner-facing row descriptions; routing still comes exclusively from DELEGATION_MATRIX. */
export const WORKLOAD_TIER_DESCRIPTIONS: Readonly<Record<WorkloadTier, string>> = {
  simple: 'Automation, simple fixes, and chores; low temperature and low complexity.',
  straightforward:
    'Straightforward implementations and features; medium temperature and medium complexity.',
  feature:
    'Workhorse for real implementations, features, fixes, and long-running work; low temperature and medium-high complexity.',
  complex: 'Complex implementations, fixes, and features; medium temperature and high complexity.',
  architecture:
    'Architecture-grade groundwork, RFCs, and explicitly escalated work; highest complexity.',
} as const;

export const PRIVILEGED_WORKLOAD_TIERS = ['complex', 'architecture'] as const;
export type PrivilegedWorkloadTier = typeof PRIVILEGED_WORKLOAD_TIERS[number];
export interface PrivilegedTierAuthorization {
  readonly authorizer: 'owner' | 'milestone_coordinator';
  readonly rationale: string;
}

/** Complex/architecture rows consume scarce subscriptions and require explicit authority. */
export function assertPrivilegedTierAuthorization(
  tier: WorkloadTier,
  authorization?: PrivilegedTierAuthorization,
): void {
  if (!PRIVILEGED_WORKLOAD_TIERS.includes(tier as PrivilegedWorkloadTier)) return;
  if (!authorization?.rationale.trim()) {
    throw new Error(
      `${tier} workload tier requires explicit owner or milestone-coordinator authorization`,
    );
  }
}

export const DELEGATION_ROLES = [
  'implementation',
  'ui_ux',
  'plan',
  'plan_evaluation',
  'implementation_evaluation',
  'vision_evaluation',
  'documentation',
  'deep_research',
] as const;
export type DelegationRole = typeof DELEGATION_ROLES[number];

/** Deep research permits native subscriptions and catalog-attested Copilot Google fallback only. */
export const DEEP_RESEARCH_TRANSPORTS = ['agy', 'github_copilot', 'codex'] as const;
export type DeepResearchTransport = typeof DEEP_RESEARCH_TRANSPORTS[number];

export function isTransportAllowedForRole(
  role: DelegationRole,
  transport: ModelTransport,
  family?: ModelVendorFamily,
): boolean {
  return role !== 'deep_research' ||
    (DEEP_RESEARCH_TRANSPORTS.includes(transport as DeepResearchTransport) &&
      (transport !== 'github_copilot' || family === 'google'));
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

const route = (
  model: LogicalModelId,
  effort: Effort | 'provider_default',
): ModelRoute => ({ model, effort });
const policy = (
  values: Omit<EvaluationPolicy, 'reSteerSameSession'>,
): EvaluationPolicy => ({ ...values, reSteerSameSession: true });

export const DELEGATION_MATRIX: Readonly<Record<WorkloadTier, DelegationCell>> = {
  simple: {
    implementation: [route('sol', 'xhigh'), route('qwen_3_8_flash_next', 'provider_default')],
    ui_ux: [route('kimi_k3', 'low'), route('minimax_m3', 'provider_default')],
    plan: [],
    plan_evaluation: [],
    implementation_evaluation: [
      route('minimax_m3', 'provider_default'),
      route('deepseek_v4_flash', 'provider_default'),
    ],
    vision_evaluation: [
      route('minimax_m3', 'provider_default'),
      route('deepseek_v4_flash_vision', 'provider_default'),
    ],
    documentation: [route('gemini_3_8_flash', 'medium'), route('opus_5', 'low')],
    deep_research: [route('gemini_3_8_flash', 'low'), route('sol', 'xhigh')],
    planPolicy: policy({ maxRounds: 'none' }),
    implementationPolicy: policy({ maxRounds: 'unspecified_by_owner' }),
    documentationPolicy: policy({ maxRounds: 2 }),
  },
  straightforward: {
    implementation: [route('sol', 'xhigh'), route('glm_5_3_flash', 'provider_default')],
    ui_ux: [route('kimi_k3', 'high'), route('gemini_3_8_flash', 'high')],
    plan: [route('sol', 'xhigh'), route('glm_5_3_flash', 'provider_default')],
    plan_evaluation: [
      route('opus_5', 'medium'),
      route('qwen_3_8_flash_next', 'provider_default'),
    ],
    implementation_evaluation: [
      route('glm_5_3_flash', 'provider_default'),
      route('deepseek_v4_pro', 'provider_default'),
    ],
    vision_evaluation: [
      route('deepseek_v4_flash_vision', 'provider_default'),
      route('kimi_k3', 'low'),
    ],
    documentation: [
      route('gemini_3_8_flash', 'high'),
      route('qwen_3_8_flash_next', 'provider_default'),
    ],
    deep_research: [route('gemini_3_8_flash', 'medium'), route('sol', 'xhigh')],
    planPolicy: policy({ maxRounds: 0, repairInFlightAt: 'immediate' }),
    implementationPolicy: policy({ maxRounds: 5, notifyOwnerAfter: 3 }),
    documentationPolicy: policy({ maxRounds: 2, notifyOwnerAfter: 2 }),
  },
  feature: {
    implementation: [route('sol', 'xhigh'), route('muse_spark_1_3', 'xhigh')],
    ui_ux: [route('kimi_k3', 'high'), route('gemini_3_8_flash', 'high')],
    plan: [route('fable_5_1', 'low'), route('muse_spark_1_3', 'xhigh')],
    plan_evaluation: [route('glm_5_3', 'provider_default'), route('fable_5_1', 'low')],
    implementation_evaluation: [
      route('muse_spark_1_3', 'xhigh'),
      route('opus_5', 'xhigh'),
    ],
    vision_evaluation: [
      route('gemini_3_8_flash', 'high'),
      route('muse_spark_1_3', 'xhigh'),
    ],
    documentation: [
      route('qwen_3_8_max', 'provider_default'),
      route('glm_5_3_flash', 'provider_default'),
    ],
    deep_research: [route('gemini_3_8_flash', 'high'), route('sol', 'xhigh')],
    planPolicy: policy({ maxRounds: 2, repairInFlightAt: 2 }),
    implementationPolicy: policy({ maxRounds: 5, notifyOwnerAfter: 3 }),
    documentationPolicy: policy({ maxRounds: 2, notifyOwnerAfter: 2 }),
  },
  complex: {
    implementation: [route('astra', 'medium'), route('fable_5_1', 'medium')],
    ui_ux: [route('kimi_k3', 'max'), route('fable_5_1', 'medium')],
    plan: [route('fable_5_1', 'medium'), route('muse_spark_1_3', 'max')],
    plan_evaluation: [route('muse_spark_1_3', 'max'), route('grok_4_6', 'high')],
    implementation_evaluation: [
      route('muse_spark_1_3', 'max'),
      route('muse_spark_1_3', 'max'),
    ],
    vision_evaluation: [
      route('kimi_k3', 'max'),
      route('gemini_3_8_flash', 'high'),
    ],
    documentation: [
      route('fable_5_1', 'medium'),
      route('qwen_3_8_max', 'provider_default'),
    ],
    deep_research: [route('gemini_3_8_flash', 'high'), route('sol', 'xhigh')],
    planPolicy: policy({ maxRounds: 3, repairInFlightAt: 3 }),
    implementationPolicy: policy({ maxRounds: 5, notifyOwnerAfter: 3 }),
    documentationPolicy: policy({ maxRounds: 2, notifyOwnerAfter: 2 }),
  },
  architecture: {
    implementation: [route('astra', 'xhigh'), route('fable_5_1', 'xhigh')],
    ui_ux: [route('kimi_k3', 'max'), route('fable_5_1', 'medium')],
    plan: [route('fable_5_1', 'xhigh'), route('muse_spark_1_3', 'max')],
    plan_evaluation: [route('muse_spark_1_3', 'max'), route('grok_4_6', 'xhigh')],
    implementation_evaluation: [
      route('grok_4_6', 'xhigh'),
      route('muse_spark_1_3', 'max'),
    ],
    vision_evaluation: [route('kimi_k3', 'max'), route('fable_5_1', 'high')],
    documentation: [
      route('fable_5_1', 'high'),
      route('qwen_3_8_max', 'provider_default'),
    ],
    deep_research: [route('gemini_3_8_flash', 'high'), route('sol', 'xhigh')],
    planPolicy: policy({ maxRounds: 1, escalateToOwnerAt: 2 }),
    implementationPolicy: policy({ maxRounds: 3, notifyOwnerAfter: 2 }),
    documentationPolicy: policy({ maxRounds: 2, notifyOwnerAfter: 2 }),
  },
} as const;

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
        isTransportAllowedForRole(role, capability.transport, MODEL_CATALOG[route.model].family))
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

export const COORDINATOR_TIERS = [
  'small_project',
  'project',
  'framework',
  'milestone',
] as const;
export type CoordinatorTier = typeof COORDINATOR_TIERS[number];

export const COORDINATOR_MATRIX: Readonly<Record<CoordinatorTier, readonly ModelRoute[]>> = {
  small_project: [route('sol', 'xhigh'), route('opus_5', 'low')],
  project: [route('sol', 'xhigh'), route('opus_5', 'medium')],
  framework: [route('sol', 'xhigh'), route('opus_5', 'xhigh')],
  milestone: [
    route('sol', 'xhigh'),
    route('fable_5_1', 'medium'),
    route('opus_5', 'xhigh'),
  ],
} as const;

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

export function modelFamily(model: LogicalModelId): ModelVendorFamily {
  return MODEL_CATALOG[model].family;
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
