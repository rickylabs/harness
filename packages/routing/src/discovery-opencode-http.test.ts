import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { discoverCliCapabilities, validateCliDiscoverySnapshot } from './discovery.js';

async function fixture(behavior: string, run: (cwd: string, binary: string, data: any) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'http-catalog-'));
  const data = JSON.parse(await readFile(new URL('../src/fixtures/opencode-native-default.json', import.meta.url), 'utf8'));
  await writeFile(join(cwd, 'data.json'), JSON.stringify({ ...data, behavior }), { mode: 0o600 });
  const binary = fileURLToPath(new URL('../src/fixtures/opencode-http-catalog-cli.mjs', import.meta.url));
  try { await run(cwd, binary, data); }
  finally {
    // Kill only exact fixture-owned server PIDs if a lifecycle mutant leaves one alive.
    const commands = await readFile(join(cwd, 'commands.jsonl'), 'utf8').catch(() => '');
    for (const line of commands.trim().split('\n').filter(Boolean)) {
      const command = JSON.parse(line);
      if (command.args?.[0] === 'serve') { try { process.kill(command.pid, 'SIGKILL'); } catch { /* Already reaped. */ } }
    }
    await rm(cwd, { recursive: true, force: true });
  }
}
const observe = (cwd: string, binary: string, timeoutMs = 1500, maximumBytes?: number) => discoverCliCapabilities({ cwd, only: ['opencode'], binaries: { opencode: binary }, timeoutMs, ...(maximumBytes === undefined ? {} : { maximumBytes }) });
async function commands(cwd: string) { return (await readFile(join(cwd, 'commands.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }

for (const behavior of ['truncated', 'complete-prefix']) {
  test('OpenCode HTTP catalog: complete native metadata survives successful ' + behavior + ' CLI output', () => fixture(behavior, async (cwd, binary, data) => {
    const s = await observe(cwd, binary), o = s.launchers.opencode;
    assert.equal(o.catalog, 'observed');
    assert.equal(o.models.length, data.models.length, 'a complete-looking CLI prefix is not a complete catalog');
    assert.deepEqual(o.problems, []);
    assert.ok(validateCliDiscoverySnapshot(s));
    assert.ok(!JSON.stringify(s).includes('PRIVATE_CANARY'));
    assert.deepEqual(o.models.map(m => m.id), data.models.map((m: any) => m.providerID + '/' + m.id));
    for (const m of o.models) assert.equal(m.provider?.source, 'opencode.config/providers.providerID');
    const log = await commands(cwd);
    assert.deepEqual(log.filter(v => v.args).map(v => v.args[0]), ['--version', 'serve']);
    assert.deepEqual(log.filter(v => v.endpoint).map(v => v.endpoint), ['/config/providers', '/provider']);
    assert.ok(log.filter(v => v.endpoint).every(v => v.authorized));
    assert.throws(() => process.kill(log.find(v => v.args?.[0] === 'serve').pid, 0), { code: 'ESRCH' });
  }));
}
test('OpenCode HTTP catalog: unverified versions retain legacy CLI provenance', () => fixture('unverified', async (cwd, binary) => {
  const s = await observe(cwd, binary), o = s.launchers.opencode;
  assert.equal(o.catalog, 'observed'); assert.ok(validateCliDiscoverySnapshot(s));
  assert.ok(o.models.every(m => m.provider?.source === 'opencode.models.providerID'));
  assert.ok(!(await commands(cwd)).some(v => v.endpoint === '/config/providers'));
}));
for (const behavior of ['refused', 'redirect', 'empty', 'default-bound', 'model-limit', 'provider-limit', 'providers-missing', 'provider-duplicate', 'provider-type', 'models-array', 'model-id', 'model-provider', 'duplicate-json', 'http-truncated', 'invalid-utf8']) {
  test('OpenCode HTTP catalog: ' + behavior + ' remains unknown without CLI fallback', () => fixture(behavior, async (cwd, binary) => {
    const s = await observe(cwd, binary), o = s.launchers.opencode;
    assert.equal(o.catalog, 'unknown'); assert.deepEqual(o.models, []); assert.ok(o.problems.length > 0);
    if (behavior === 'providers-missing') assert.deepEqual(o.problems, ['malformed']);
    assert.ok(validateCliDiscoverySnapshot(s)); assert.ok(!JSON.stringify(s).includes('PRIVATE_CANARY'));
    assert.ok(!(await commands(cwd)).some(v => v.args?.[0] === 'models'));
  }));
}
test('OpenCode HTTP catalog: bounded body and deadline remain refusals', async () => {
  await fixture('normal', async (cwd, binary) => {
    const s = await observe(cwd, binary, 1500, 256);
    assert.equal(s.launchers.opencode.catalog, 'unknown'); assert.ok(s.launchers.opencode.problems.includes('oversized'));
  });
  await fixture('timeout', async (cwd, binary) => {
    const started = performance.now(), s = await observe(cwd, binary, 300);
    assert.equal(s.launchers.opencode.catalog, 'unknown'); assert.ok(s.launchers.opencode.problems.includes('timeout'));
    assert.ok(performance.now()-started < 2000);
  });
});

test('OpenCode HTTP catalog: late body cannot succeed after its shared deadline', () => fixture('normal', async (cwd, binary) => {
  const now = Date.now, fetchOriginal = globalThis.fetch; let offset = 0;
  Date.now = () => now() + offset;
  globalThis.fetch = async (...args) => {
    const response = await fetchOriginal(...args);
    if (String(args[0]).endsWith('/config/providers')) {
      const body = response.body!, reader = body.getReader();
      return new Response(new ReadableStream({ async pull(controller) {
        const value = await reader.read();
        if (value.done) { offset = 10000; controller.close(); } else controller.enqueue(value.value);
      } }), { status: 200 });
    }
    return response;
  };
  try {
    const s = await observe(cwd, binary);
    assert.equal(s.launchers.opencode.catalog, 'unknown');
    assert.deepEqual(s.launchers.opencode.problems, ['timeout']);
  } finally { Date.now = now; globalThis.fetch = fetchOriginal; }
}));

test('OpenCode HTTP catalog: paired reader binds API provenance to exact version and catalog origin', () => fixture('normal', async (cwd, binary, data) => {
  const good = await observe(cwd, binary); assert.ok(validateCliDiscoverySnapshot(good));
  const mutations: [string, (s: any) => void][] = [
    ['unverified API contract', s => { s.launchers.opencode.version = data.unverifiedVersion; s.launchers.opencode.models = [s.launchers.opencode.models[3]]; }],
    ['missing API version', s => { s.launchers.opencode.version = null; s.launchers.opencode.models = [s.launchers.opencode.models[3]]; }],
    ['missing API root source', s => { s.launchers.opencode.sources = s.launchers.opencode.sources.filter((v: string) => v !== 'opencode.config/providers'); }],
    ['legacy model in API capture', s => { s.launchers.opencode.models[3].provider.source = 'opencode.models.providerID'; s.launchers.opencode.sources.push('opencode.models.providerID'); }],
    ['orphan API provenance', s => { s.launchers.opencode.models.forEach((m: any) => { m.provider.source = 'opencode.models.providerID'; m.effortSource = 'opencode.models.variants'; }); s.launchers.opencode.sources = ['version', 'models', 'opencode.models.providerID', 'opencode.models.variants', 'opencode.provider/list.connected', 'opencode.config/providers.variants']; }],
    ['missing API provider proof', s => { delete s.launchers.opencode.models[3].provider; }],
    ['API source with unknown catalog', s => { s.launchers.opencode.catalog = 'unknown'; s.launchers.opencode.models = []; delete s.launchers.opencode.providerConnections; s.launchers.opencode.sources = ['version', 'opencode.config/providers']; }],
  ];
  for (const [name, mutate] of mutations) { const s = structuredClone(good); mutate(s); assert.equal(validateCliDiscoverySnapshot(s), false, name); }
}));

test('OpenCode HTTP catalog: shared deadline classifies a late failed read', () => fixture('normal', async (cwd, binary) => {
  const now = Date.now, fetchOriginal = globalThis.fetch; let offset = 0;
  Date.now = () => now() + offset;
  globalThis.fetch = async (...args) => {
    const response = await fetchOriginal(...args);
    if (String(args[0]).endsWith('/config/providers')) { await response.arrayBuffer(); offset = 10000; throw new Error('fixture read failed'); }
    return response;
  };
  try { const s = await observe(cwd, binary); assert.deepEqual(s.launchers.opencode.problems, ['timeout']); }
  finally { Date.now = now; globalThis.fetch = fetchOriginal; }
}));
