/** Launcher admission is separate from matrix selection and evaluator certification. */
import { discoveredModels, type CliDiscoverySnapshot } from './cli-discovery.ts';
import { MATRIX_AUTHORITY, type MatrixAuthority } from './delegation-matrix.ts';
export interface LauncherInventory { readonly opencode?: readonly string[]; readonly discovery?: CliDiscoverySnapshot }
export interface Launchability {
  readonly status: 'unverified' | 'launchable';
  readonly launcher: string;
  readonly model: string;
  readonly reason?: 'catalog-not-observed' | 'catalog-model-unseen';
}
export interface LaunchRoute { readonly agent: string; readonly model: string; readonly logicalModel: string }
export type LaunchRefusalCode = 'launcher-model-unconfigured' | 'launcher-catalog-unavailable' | 'launcher-model-absent';
export class RouteLaunchError extends Error {
  readonly code: LaunchRefusalCode;
  readonly model: string;
  readonly launcher: string;
  constructor(code: LaunchRefusalCode, model: string, launcher = 'opencode') {
    super(`Resolved model ${model} cannot be launched by ${launcher}: ${code}`);
    this.name = 'RouteLaunchError'; this.code = code; this.model = model; this.launcher = launcher;
  }
}
/** Selected wire identity and executor must occur on the selected document's launch seam. */
export function assertConfiguredEvaluator(route: LaunchRoute, authority: MatrixAuthority = MATRIX_AUTHORITY): void {
  const configured = authority.configuration.models[route.logicalModel]?.launches.some(launch =>
    launch.seam === 'subagents' && launch.id === route.model &&
    (launch.harness === route.agent || (launch.harness === 'agy' && route.agent === 'antigravity')));
  if (!configured) throw new RouteLaunchError('launcher-model-unconfigured', route.model, route.agent);
}
/** Complete IDs only. Catalog membership is not quota, I2, effort support or reachability. */
export function routeLaunchability(route: LaunchRoute, inventory?: LauncherInventory, authority: MatrixAuthority = MATRIX_AUTHORITY): Launchability {
  assertConfiguredEvaluator(route, authority);
  const observed = inventory?.discovery ? discoveredModels(inventory.discovery, route.agent) : null;
  const models = inventory?.discovery ? observed?.map(entry => entry.id) : route.agent === 'opencode' ? inventory?.opencode : undefined;
  if (models === undefined) return { status: 'unverified', launcher: route.agent, model: route.model, reason: 'catalog-not-observed' };
  if (!models.includes(route.model)) {
    if (inventory?.discovery) return { status: 'unverified', launcher: route.agent, model: route.model, reason: 'catalog-model-unseen' };
    throw new RouteLaunchError('launcher-model-absent', route.model, route.agent);
  }
  return { status: 'launchable', launcher: route.agent, model: route.model };
}
export function assertRouteLaunchable(route: LaunchRoute, inventory?: LauncherInventory, authority: MatrixAuthority = MATRIX_AUTHORITY): Launchability {
  const result = routeLaunchability(route, inventory, authority);
  if (result.status !== 'launchable') throw new RouteLaunchError(result.reason === 'catalog-model-unseen' ? 'launcher-model-absent' : 'launcher-catalog-unavailable', route.model, route.agent);
  return result;
}
