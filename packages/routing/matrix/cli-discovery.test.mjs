import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoveredModels, validateCliDiscoverySnapshot } from './cli-discovery.ts';
import { resolveWorkloadRoute } from './routing-policy.ts';
import { preflightDiscoveredWorkloadRoute } from './cli-preflight.ts';
import { routeLaunchability, assertRouteLaunchable, RouteLaunchError } from './launchability.ts';

const request = (tier = 'simple', role = 'implementation') => ({
  tier, role, ...(role.endsWith('_evaluation') ? { generatorModel: 'sol' } : {}), worktree: '.',
  privilegedTierAuthorization: { authorizer: 'owner', rationale: 'Synthetic evaluator coverage' },
});
function snapshot(launcher, ids, observedAt = new Date().toISOString()) {
  const absent = () => ({ installed: 'unknown', version: null, authenticated: 'unknown', entitlement: 'unknown',
    quota: 'unknown', catalog: 'unknown', models: [], sources: [], problems: ['not-requested'] });
  const launchers = Object.fromEntries(['claude', 'codex', 'opencode', 'agy'].map(name => [name, absent()]));
  if (launcher) launchers[launcher] = { ...absent(), installed: 'yes', version: '1.2.3', catalog: 'observed',
    models: ids.map(id => ({ id, efforts: null })), sources: [launcher === 'codex' ? 'model/list' : 'models'], problems: [] };
  return { schemaVersion: 1, observedAt, launchers };
}
const refuses = (code, selected) => error => error instanceof RouteLaunchError && error.code === code &&
  error.model === selected.model && error.launcher === selected.agent;

test('resolver consumes exact fresh native observations and keeps unseen configured IDs unverified', () => {
  const selected = resolveWorkloadRoute(request());
  assert.equal(selected.agent, 'codex');
  const good = snapshot(selected.agent, [selected.model]);
  assert.ok(validateCliDiscoverySnapshot(good));
  assert.equal(resolveWorkloadRoute({ ...request(), launcherInventory: { discovery: good } }).launchability.status, 'launchable');
  const unseen = snapshot(selected.agent, ['fixture-unseen-v99']);
  const result = resolveWorkloadRoute({ ...request(), launcherInventory: { discovery: unseen } });
  assert.equal(result.model, selected.model);
  assert.deepEqual(result.launchability, { status: 'unverified', launcher: selected.agent, model: selected.model, reason: 'catalog-model-unseen' });
  assert.throws(() => assertRouteLaunchable(selected, { discovery: unseen }), refuses('launcher-model-absent', selected));
});

test('unknown, stale, future, credential-bearing and declared catalogs cannot admit a route', () => {
  const selected = resolveWorkloadRoute(request());
  const stale = snapshot(selected.agent, [selected.model], new Date(Date.now() - 600001).toISOString());
  const future = snapshot(selected.agent, [selected.model], new Date(Date.now() + 60000).toISOString());
  const unsafe = snapshot(selected.agent, [selected.model]); unsafe.launchers.codex.token = 'fixture-credential';
  const declared = snapshot(selected.agent, [selected.model]); declared.launchers.codex.catalog = 'declared';
  const coerced = snapshot(selected.agent, [selected.model]); coerced.launchers.codex.installed = ['yes'];
  for (const discovery of [snapshot(), stale, future, unsafe, declared, coerced]) {
    assert.equal(routeLaunchability(selected, { discovery }).status, 'unverified');
    assert.throws(() => assertRouteLaunchable(selected, { discovery }), refuses('launcher-catalog-unavailable', selected));
  }
  const agy = snapshot(); agy.launchers.agy.catalog = 'declared'; agy.launchers.agy.models = [{ id: 'fixture/declared-v1', efforts: null }];
  assert.ok(validateCliDiscoverySnapshot(agy));
  assert.equal(discoveredModels(agy, 'antigravity'), null);
});

test('generic preflight probes only the selected launcher and never falls through when its ID is unseen', async () => {
  for (const req of [request(), request('architecture', 'implementation_evaluation')]) {
    const selected = resolveWorkloadRoute(req); const seen = [];
    const discover = async options => { seen.push(options); return snapshot(selected.agent, [selected.model]); };
    const result = await preflightDiscoveredWorkloadRoute(req, { discover });
    assert.equal(result.model, selected.model); assert.equal(result.launchability.status, 'launchable');
    assert.deepEqual(seen.map(options => options.only), [[selected.agent]]);
    assert.deepEqual(seen.map(options => options.cwd), ['.']);
    await assert.rejects(preflightDiscoveredWorkloadRoute(req, { discover: async () => snapshot(selected.agent, ['fixture-unseen-v99']) }),
      refuses('launcher-model-absent', selected));
  }
});

test('Claude version and login presence leave its undocumented model catalog unverified', async () => {
  const req = request('feature', 'plan'); const selected = resolveWorkloadRoute(req);
  assert.equal(selected.agent, 'claude');
  const discovery = snapshot(); discovery.launchers.claude.installed = 'yes';
  discovery.launchers.claude.version = '1.2.3'; discovery.launchers.claude.authenticated = 'yes';
  discovery.launchers.claude.sources = ['version', 'auth-status']; discovery.launchers.claude.problems = ['unsupported'];
  assert.equal(resolveWorkloadRoute({ ...req, launcherInventory: { discovery } }).launchability.status, 'unverified');
  await assert.rejects(preflightDiscoveredWorkloadRoute(req, { discover: async () => discovery }),
    refuses('launcher-catalog-unavailable', selected));
});
