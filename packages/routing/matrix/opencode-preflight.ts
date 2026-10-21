/** Read-only dispatch-host catalog check. Never starts a model turn. */
import { resolveWorkloadRoute, type WorkloadRouteRequest } from './routing-policy.ts';
import { MATRIX_AUTHORITY, type MatrixAuthority } from './delegation-matrix.ts';
import { assertRouteLaunchable, RouteLaunchError } from './launchability.ts';
const maximumBytes = 1024 * 1024;
async function boundedText(stream: ReadableStream<Uint8Array>, maximum = maximumBytes): Promise<string> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) throw new Error('catalog-oversized'); chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}
/** OpenCode 2.x `model.list` through a private server the command owns, over an in-memory store: it opens no
 * `opencode.db` and no run database, so it never resumes a session. */
export const OPENCODE_MODEL_LIST_ARGS = ['api', 'model.list', '--standalone'] as const;
export const OPENCODE_PRIVATE_DB = ':memory:';
/** `{ location, data: [{ id, providerID }] }` to `providerID/id` lines for one provider. */
export function openCodeCatalogLines(body: string, provider: string): string {
  const parsed: unknown = JSON.parse(body);
  const data = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error('catalog-malformed');
  return data.flatMap((value: unknown) => {
    const model = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (typeof model.id !== 'string' || typeof model.providerID !== 'string') throw new Error('catalog-malformed');
    return model.providerID === provider && model.enabled !== false ? [`${model.providerID}/${model.id}`] : [];
  }).join('\n');
}
/** Caller launcher binary; native errors never cross the diagnostic boundary. */
export async function readOpenCodeModels(binary: string, provider: string, cwd: string): Promise<string> {
  const child = new Deno.Command(binary, { args: [...OPENCODE_MODEL_LIST_ARGS], cwd, env: { OPENCODE_DB: OPENCODE_PRIVATE_DB },
    stdin: 'null', stdout: 'piped', stderr: 'null' }).spawn();
  const deadline = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } }, 15_000);
  try {
    const output = await boundedText(child.stdout);
    if (!(await child.status).success) throw new Error('catalog-unavailable');
    return openCodeCatalogLines(output, provider);
  } finally {
    clearTimeout(deadline); try { child.kill('SIGKILL'); } catch { /* already exited */ }
    await child.status;
  }
}
export async function preflightWorkloadRoute(request: WorkloadRouteRequest, options: {
  readonly authority?: MatrixAuthority;
  readonly binary?: string;
  readonly now?: () => string;
  readonly listModels?: (binary: string, provider: string, cwd: string) => Promise<string>;
} = {}) {
  const authority = options.authority ?? MATRIX_AUTHORITY;
  // Select once. Missing selected ID is a named refusal, never a silent downgrade.
  const route = resolveWorkloadRoute(request, authority);
  if (route.agent !== 'opencode') throw new RouteLaunchError('launcher-catalog-unavailable', route.model, route.agent);
  let output: string;
  try {
    output = await (options.listModels ?? readOpenCodeModels)(options.binary ?? 'opencode', route.model.split('/')[0]!, request.worktree);
    if (new TextEncoder().encode(output).length > maximumBytes) throw new Error('catalog-oversized');
  } catch { throw new RouteLaunchError('launcher-catalog-unavailable', route.model); }
  const inventory = { opencode: output.split(/\r?\n/).map(line => line.trim()) };
  const launchability = assertRouteLaunchable(route, inventory, authority);
  return { ...route, launchability, catalogObservedAt: (options.now ?? (() => new Date().toISOString()))() };
}
if (import.meta.main) {
  try {
    const request = JSON.parse(await boundedText(Deno.stdin.readable, 64 * 1024));
    const result = await preflightWorkloadRoute(request);
    console.log(JSON.stringify({ status: 'launchable', launcher: result.launchability.launcher, model: result.model,
      logicalModel: result.logicalModel, family: result.family, effort: result.effort, catalogObservedAt: result.catalogObservedAt }));
  } catch (error) {
    console.log(JSON.stringify(error instanceof RouteLaunchError
      ? { status: 'refused', reasonCode: error.code, model: error.model, launcher: error.launcher }
      : { status: 'refused', reasonCode: 'routing-invalid' }));
    Deno.exit(2);
  }
}
