/** INTERIM API launcher projection, #270: https://github.com/rickylabs/harness/issues/270.
 * Explicit launcherAlias in #271 fleet data approves API spending. Catalog membership does not.
 */
import { MATRIX_AUTHORITY, type MatrixAuthority } from './delegation-matrix.ts';
export function openRouterLauncherModelIds(authority: MatrixAuthority = MATRIX_AUTHORITY): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.values(authority.configuration.models).filter(m => m.launcherAlias).map(m => {
    const launch = m.launches.find(l => l.provider === 'openrouter' && l.harness === 'opencode' && l.id.startsWith('openrouter/'));
    if (!launch) throw new Error('configured API launcher alias lacks OpenRouter identity');
    return [m.launcherAlias!, launch.id.slice('openrouter/'.length)];
  })));
}
export const OPENROUTER_LAUNCHER_MODEL_IDS = openRouterLauncherModelIds();
export type ApprovedOpenRouterLauncherModelId = string;
export function isApprovedOpenRouterLauncherModelId(modelId: string): modelId is ApprovedOpenRouterLauncherModelId {
  return Object.values(OPENROUTER_LAUNCHER_MODEL_IDS).includes(modelId);
}
