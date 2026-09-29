/**
 * OpenRouter IDs admitted by the legacy remote-model launcher for a new run.
 *
 * This is launcher policy, not the route catalog. A model capability in MODEL_CATALOG
 * does not authorize the launcher to spend against that model. The four IDs are the
 * active NetScript launcher set at the decision-F cutover; additions require a
 * separate approval decision and test update.
 */
export const OPENROUTER_LAUNCHER_MODEL_IDS = Object.freeze({
  planEvaluator: 'qwen/qwen3.8-flash',
  implEvaluator: 'z-ai/glm-5.3-flash',
  designGlm: 'z-ai/glm-5.2',
  grok: 'x-ai/grok-4.5',
} as const);

export type ApprovedOpenRouterLauncherModelId =
  typeof OPENROUTER_LAUNCHER_MODEL_IDS[keyof typeof OPENROUTER_LAUNCHER_MODEL_IDS];

const approved = new Set<string>(Object.values(OPENROUTER_LAUNCHER_MODEL_IDS));

/** An unknown or retired ID is refused even if the route catalog knows it. */
export function isApprovedOpenRouterLauncherModelId(modelId: string): modelId is ApprovedOpenRouterLauncherModelId {
  return approved.has(modelId);
}
