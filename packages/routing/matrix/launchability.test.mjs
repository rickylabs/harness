import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveWorkloadRoute } from './routing-policy.ts';
import { assertRouteLaunchable, RouteLaunchError } from './launchability.ts';
import { preflightWorkloadRoute } from './opencode-preflight.ts';

const auth = { authorizer: 'owner', rationale: 'Authorized evaluator coverage' };
const request = (tier, role = 'implementation_evaluation', generatorModel = 'sol') => ({
  tier, role, generatorModel, worktree: '.', privilegedTierAuthorization: auth,
});
const refusal = (error, code, model) => error instanceof RouteLaunchError &&
  error.code === code && error.model === model && error.launcher === 'opencode' && error.message.includes(model);

test('feature, complex and architecture evaluators select the exact standard variant through OpenCode', () => {
  for (const tier of ['feature', 'complex']) {
    const route = resolveWorkloadRoute(request(tier));
    assert.deepEqual([route.agent, route.model, route.family], ['opencode', 'openrouter/meta/muse-spark-1.3', 'meta']);
    assert.equal(route.launchability.status, 'unverified');
  }
  const grok = resolveWorkloadRoute(request('architecture'));
  assert.deepEqual([grok.agent, grok.model, grok.family], ['opencode', 'opencode-go/grok-4.7', 'xai']);
  const fallback = resolveWorkloadRoute({ ...request('architecture'), unavailableTransports: ['opencode_go'] });
  assert.equal(fallback.model, 'openrouter/x-ai/grok-4.7');
  const opposite = resolveWorkloadRoute(request('complex', 'plan_evaluation', 'muse_spark_1_3'));
  assert.equal(opposite.logicalModel, 'grok_4_7');
  assert.notEqual(opposite.family, 'meta');
  assert.throws(() => resolveWorkloadRoute(request('complex', 'implementation_evaluation', 'muse_spark_1_3')),
    /no available opposite meta route/);
});

test('a resolved model missing from the dispatch launcher is a named refusal', () => {
  const selected = resolveWorkloadRoute(request('architecture'));
  assert.equal(assertRouteLaunchable(selected, { opencode: [selected.model] }).status, 'launchable');
  assert.throws(() => resolveWorkloadRoute({ ...request('architecture'), launcherInventory: { opencode: [] } }),
    error => refusal(error, 'launcher-model-absent', selected.model));
  assert.throws(() => assertRouteLaunchable(selected),
    error => refusal(error, 'launcher-catalog-unavailable', selected.model));
  assert.throws(() => assertRouteLaunchable({ ...selected, model: 'openrouter/meta/muse-spark-1.3-contributor' }, { opencode: [] }),
    error => refusal(error, 'launcher-model-unconfigured', 'openrouter/meta/muse-spark-1.3-contributor'));
});

test('catalog membership is exact, provider-specific and never silently falls through to another model', async () => {
  const req = request('feature');
  const seen = [];
  const options = { now: () => '2026-09-30T00:00:00Z', listModels: async (...args) => {
    seen.push(args); return 'openrouter/meta/muse-spark-1.3\n';
  } };
  const good = await preflightWorkloadRoute(req, options);
  assert.equal(good.launchability.status, 'launchable');
  assert.equal(good.catalogObservedAt, '2026-09-30T00:00:00Z');
  assert.deepEqual(seen, [['opencode', 'openrouter', '.']]);
  for (const catalog of ['', 'meta/muse-spark-1.3', 'opencode/muse-spark-1.3',
    'openrouter/meta/muse-spark-1.3-contributor', 'openrouter/meta/muse-spark-1.3-extra']) {
    await assert.rejects(preflightWorkloadRoute(req, { listModels: async () => catalog }),
      error => refusal(error, 'launcher-model-absent', good.model));
  }
});

test('catalog failure and oversized output expose fixed diagnostics and the selected model only', async () => {
  for (const listModels of [async () => { throw new Error('private native error'); }, async () => 'x'.repeat(1024 * 1024 + 1)]) {
    await assert.rejects(preflightWorkloadRoute(request('feature'), { listModels }), error => {
      assert.ok(!error.message.includes('private native error'));
      return refusal(error, 'launcher-catalog-unavailable', 'openrouter/meta/muse-spark-1.3');
    });
  }
});
