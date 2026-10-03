/** Generic read-only per-harness admission. Resolving a configured cell never invents catalog evidence. */
import { discoverCliCapabilities, type CliDiscoveryOptions } from './cli-discovery.ts';
import { resolveWorkloadRoute, type WorkloadRouteRequest } from './routing-policy.ts';
import { MATRIX_AUTHORITY, type MatrixAuthority } from './delegation-matrix.ts';
import { assertRouteLaunchable, RouteLaunchError } from './launchability.ts';

export async function preflightDiscoveredWorkloadRoute(request: WorkloadRouteRequest, options: {
  readonly authority?: MatrixAuthority;
  readonly binaries?: CliDiscoveryOptions['binaries'];
  readonly timeoutMs?: number;
  readonly now?: () => string;
  readonly discover?: typeof discoverCliCapabilities;
} = {}) {
  const authority = options.authority ?? MATRIX_AUTHORITY;
  const route = resolveWorkloadRoute(request, authority);
  const launcher = route.agent === 'antigravity' ? 'agy' : route.agent;
  const only: CliDiscoveryOptions['only'] = launcher === 'claude' || launcher === 'codex' || launcher === 'opencode' || launcher === 'agy' ? [launcher] : [];
  const discovery = await (options.discover ?? discoverCliCapabilities)({ cwd: request.worktree, only,
    ...(options.binaries === undefined ? {} : { binaries: options.binaries }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.now === undefined ? {} : { now: options.now }) });
  const launchability = assertRouteLaunchable(route, { discovery }, authority);
  return { ...route, launchability, discovery };
}

if (import.meta.main) {
  try {
    const maximum = 64 * 1024;
    const reader = Deno.stdin.readable.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > maximum) throw new Error('input oversized'); chunks.push(value); } }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const result = await preflightDiscoveredWorkloadRoute(request);
    console.log(JSON.stringify({ status: 'launchable', launcher: result.agent, model: result.model,
      logicalModel: result.logicalModel, catalogObservedAt: result.discovery.observedAt }));
  } catch (error) {
    console.log(JSON.stringify(error instanceof RouteLaunchError
      ? { status: 'unverified', reasonCode: error.code, model: error.model, launcher: error.launcher }
      : { status: 'unverified', reasonCode: 'discovery-invalid' }));
    Deno.exit(2);
  }
}
