import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseRoutingDocument } from '../dist/load.js';
import { configuredRoutingPolicy } from './routing-policy.ts';
import { MATRIX_AUTHORITY, MODEL_CATALOG, isTransportAllowedForRole } from './delegation-matrix.ts';
import { openRouterLauncherModelIds } from './openrouter-launcher-policy.ts';
import { preflightWorkloadRoute } from './opencode-preflight.ts';

const shippedText = readFileSync(new URL('../config/routing.fleet.v2.json', import.meta.url), 'utf8');
function loaded(document, source = 'test-document') {
  const result = parseRoutingDocument(JSON.stringify(document), source);
  assert.ok(result.ok, JSON.stringify(result));
  return result.loaded;
}
function custom(prefix) {
  return {
    schemaVersion: 2, name: `${prefix}-configuration`, families: [`${prefix}_author`, `${prefix}_critic`],
    efforts: { ordered: ['low'] }, capabilities: [], providers: { codex: {}, openrouter: {} },
    providerPrecedence: ['codex', 'openrouter'], routers: ['openrouter'], profiles: [], presets: [],
    models: {
      [`${prefix}_writer`]: { family: `${prefix}_author`, launches: [{ provider: 'codex', seam: 'subagents',
        id: `${prefix}-writer-wire`, transport: 'native', harness: 'codex', effortSupport: { status: 'unknown' } }] },
      [`${prefix}_critic`]: { family: `${prefix}_critic`, launcherAlias: `${prefix}Critic`, approvedRelayEvaluator: true,
        launches: [{ provider: 'openrouter', seam: 'subagents', id: `openrouter/${prefix}-critic-wire`,
          transport: 'openrouter', harness: 'opencode', router: 'openrouter', effortSupport: { status: 'unknown' } }] },
    },
    roles: { writing: {}, review: { certifies: 'any', evaluates: ['writing'] } },
    tiers: [{ tier: `${prefix}_tier`, cells: {
      writing: [{ model: `${prefix}_writer`, effort: 'low' }], review: [{ model: `${prefix}_critic`, effort: 'low' }],
    } }], coordinators: {}, lanes: [{ lane: `${prefix}_writing`, tier: `${prefix}_tier`, role: 'writing' }],
    policy: { maxFallbackDepth: 1, ownerOverride: { evidence: ['worklog'] } }, placements: { backends: [], entries: [] },
  };
}

test('shipped runtime data passes the #271 whole-document loader and stays immutable', () => {
  const result = parseRoutingDocument(shippedText, 'shipped-fleet');
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.loaded.configuration, MATRIX_AUTHORITY.configuration);
  assert.ok(Object.isFrozen(MATRIX_AUTHORITY.configuration.models));
  assert.equal(Object.isFrozen(MODEL_CATALOG), true);
});

test('two disjoint #271 documents replace cells, families, concrete IDs and launcher approvals wholesale', async () => {
  const policies = ['alpha', 'beta'].map(prefix => configuredRoutingPolicy(loaded(custom(prefix), prefix)));
  for (const [index, prefix] of ['alpha', 'beta'].entries()) {
    const policy = policies[index];
    assert.deepEqual(Object.keys(policy.authority.catalog), [`${prefix}_writer`, `${prefix}_critic`]);
    assert.deepEqual(Object.keys(openRouterLauncherModelIds(policy.authority)), [`${prefix}Critic`]);
    assert.equal(policy.resolveWorkloadRoute({ tier: `${prefix}_tier`, role: 'writing', worktree: '.' }).model, `${prefix}-writer-wire`);
    const request = { tier: `${prefix}_tier`, role: 'review', generatorModel: `${prefix}_writer`, worktree: '.' };
    const result = await preflightWorkloadRoute(request, { authority: policy.authority,
      listModels: async () => `openrouter/${prefix}-critic-wire` });
    assert.equal(result.model, `openrouter/${prefix}-critic-wire`);
    assert.throws(() => policy.resolveWorkloadRoute({ tier: 'feature', role: 'implementation', worktree: '.' }), /unknown workload tier/);
    assert.throws(() => policy.resolveWorkloadRoute({ ...request, generatorModel: 'sol' }), /unknown configured model/);
    assert.throws(() => policy.assertEvaluatorIndependence(
      { model: `${prefix}_writer`, sessionId: 'same' }, { model: `${prefix}_critic`, sessionId: 'same' }), /sessions must differ/);
  }
  assert.equal(policies[0].resolveWorkloadRoute({ tier: 'alpha_tier', role: 'writing', worktree: '.' }).model, 'alpha-writer-wire');
  assert.equal(policies[0].authority.source.id, 'alpha');
  assert.notEqual(policies[0].authority.source.digest, policies[1].authority.source.digest);
});

test('invalid replacements and v1 documents cannot select a shipped fallback', () => {
  const bad = custom('alpha'); delete bad.models.alpha_critic;
  assert.equal(parseRoutingDocument(JSON.stringify(bad), 'invalid').ok, false);
  const v1 = parseRoutingDocument(readFileSync(new URL('../config/routing.v1.json', import.meta.url), 'utf8'), 'v1');
  assert.ok(v1.ok);
  assert.throws(() => configuredRoutingPolicy(v1.loaded), /requires fleet-cells schema/);
});

test('labels, aliases and provider catalogs are strictly validated document data', () => {
  for (const change of [
    d => { d.models.alpha_writer.label = 12; },
    d => { d.models.alpha_writer.launcherAlias = ''; },
    d => { d.models.alpha_writer.launcherAlias = 'alphaCritic'; },
    d => { d.routers = []; },
    d => { d.routers = ['space in provider']; },
  ]) {
    const value = custom('alpha'); change(value);
    assert.equal(parseRoutingDocument(JSON.stringify(value), 'bad').ok, false);
  }
});

test('new concrete Grok and Muse IDs occur only in data, never production TypeScript', () => {
  // Scan every production matrix module, including future files and alias shims.
  const { readdirSync } = process.getBuiltinModule('node:fs');
  const walk = url => readdirSync(url, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(new URL(`${entry.name}/`, url)) : entry.name.endsWith('.ts') ? [new URL(entry.name, url)] : []);
  for (const file of walk(new URL('./', import.meta.url))) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/(['"`])[^'"`\n]*(?:grok-4\.7|muse-spark-1\.3)[^'"`\n]*\1/.test(source), false, file.pathname);
  }
});

test('packaged v1 Grok and Muse evaluator routes use the matching OpenCode provider seam', () => {
  const result = parseRoutingDocument(readFileSync(new URL('../config/routing.v1.json', import.meta.url), 'utf8'), 'v1');
  assert.ok(result.ok);
  let count = 0;
  for (const lane of result.loaded.configuration.lanes) for (const step of lane.chain) {
    if (!['meta/muse-spark-1.3', 'x-ai/grok-4.7'].includes(step.route.model)) continue;
    assert.equal(step.route.harness, 'opencode'); assert.equal(step.route.router, 'openrouter');
    assert.equal(step.route.profile, undefined); count++;
  }
  assert.equal(count, 5);
});

test('the portable three-argument role guard remains compatible with bridge callers', () => {
  assert.equal(isTransportAllowedForRole('ui_ux', 'github_copilot', 'moonshot'), true);
  assert.equal(isTransportAllowedForRole('deep_research', 'github_copilot', 'google'), true);
  assert.equal(isTransportAllowedForRole('deep_research', 'github_copilot', 'anthropic'), false);
  assert.equal(isTransportAllowedForRole('deep_research', 'opencode_go', 'google'), false);
});
