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

test('OpenCode 2.x catalog: one owned private server over an in-memory store answers both reads', () => fixture('normal', async (cwd, binary, data) => {
  const s = await observe(cwd, binary), o = s.launchers.opencode;
  assert.equal(o.catalog, 'observed');
  assert.equal(o.version, data.version);
  assert.equal(o.models.length, data.models.length);
  assert.deepEqual(o.problems, []);
  assert.ok(validateCliDiscoverySnapshot(s));
  assert.ok(!JSON.stringify(s).includes('PRIVATE_CANARY'));
  assert.deepEqual(o.models.map(m => m.id), data.models.map((m: any) => m.providerID + '/' + m.id));
  for (const m of o.models) assert.equal(m.provider?.source, 'opencode.api/model.providerID');
  const log = await commands(cwd);
  assert.deepEqual(log.filter(v => v.args).map(v => v.args), [['--version'], ['serve', '--hostname', '127.0.0.1', '--port', '0']]);
  const server = log.find(v => v.args?.[0] === 'serve');
  assert.equal(server.database, ':memory:', 'discovery never opens opencode.db or a run database');
  assert.equal(server.legacyAuth, false, '1.x server credentials are gone in 2.x');
  assert.deepEqual(log.filter(v => v.endpoint).map(v => v.endpoint), ['/api/model', '/api/integration']);
  assert.ok(log.filter(v => v.endpoint).every(v => v.authorized));
  assert.throws(() => process.kill(server.pid, 0), { code: 'ESRCH' });
}));
test('OpenCode 2.x catalog: connections are yes, no for needs_auth, unknown when the private store cannot see one', () => fixture('normal', async (cwd, binary, data) => {
  const o = (await observe(cwd, binary)).launchers.opencode, facts = new Map(o.providerConnections!.map(c => [c.id, c.connected]));
  for (const id of data.connections) assert.equal(facts.get(id), 'yes');
  assert.equal(facts.get('fixture-needs-auth'), 'no');
  assert.equal(facts.has('fixture-unconnected'), false, 'an integration with no connection and no model is not reported');
  assert.ok(o.providerConnections!.every(c => c.source === 'opencode.api/integration.connections'));
  assert.ok(o.sources.includes('opencode.api/integration.connections'));
}));
test('OpenCode 2.x catalog: a disabled model is not offered', () => fixture('model-disabled', async (cwd, binary, data) => {
  const o = (await observe(cwd, binary)).launchers.opencode;
  assert.equal(o.catalog, 'observed');
  assert.deepEqual(o.models.map(m => m.id), data.models.slice(1).map((m: any) => m.providerID + '/' + m.id));
}));
test('OpenCode 2.x catalog: newer versions use the same API catalog', () => fixture('unverified', async (cwd, binary) => {
  const s = await observe(cwd, binary), o = s.launchers.opencode;
  assert.equal(o.catalog, 'observed'); assert.ok(validateCliDiscoverySnapshot(s));
  assert.ok(o.models.every(m => m.provider?.source === 'opencode.api/model.providerID'));
}));
for (const behavior of ['refused', 'redirect', 'empty', 'model-limit', 'data-missing', 'model-duplicate', 'provider-type', 'enabled-missing', 'duplicate', 'http-truncated', 'invalid-utf8']) {
  test('OpenCode 2.x catalog: ' + behavior + ' records the problem and certifies no model', () => fixture(behavior, async (cwd, binary) => {
    const s = await observe(cwd, binary), o = s.launchers.opencode;
    assert.equal(o.catalog, 'unknown');
    assert.deepEqual(o.models, []);
    assert.ok(o.problems.length > 0);
    assert.ok(validateCliDiscoverySnapshot(s)); assert.ok(!JSON.stringify(s).includes('PRIVATE_CANARY'));
    assert.ok(!(await commands(cwd)).some(v => v.args?.[0] === 'models'), 'no 1.x CLI fallback');
  }));
}
test('OpenCode 2.x catalog: bounded HTTP body and deadline remain reported problems', async () => {
  await fixture('normal', async (cwd, binary) => {
    const s = await observe(cwd, binary, 1500, 256);
    assert.equal(s.launchers.opencode.catalog, 'unknown'); assert.ok(s.launchers.opencode.problems.includes('oversized'));
  });
  await fixture('timeout', async (cwd, binary) => {
    const started = performance.now(), s = await observe(cwd, binary, 300);
    assert.ok(s.launchers.opencode.problems.includes('timeout'));
    assert.ok(performance.now()-started < 2000);
  });
});

test('OpenCode 2.x catalog: late body cannot succeed after its shared deadline', () => fixture('normal', async (cwd, binary) => {
  const now = Date.now, fetchOriginal = globalThis.fetch; let offset = 0;
  Date.now = () => now() + offset;
  globalThis.fetch = async (...args) => {
    const response = await fetchOriginal(...args);
    if (String(args[0]).endsWith('/api/model')) {
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

test('OpenCode 2.x catalog: paired reader binds API provenance to catalog origin', () => fixture('normal', async (cwd, binary) => {
  const good = await observe(cwd, binary); assert.ok(validateCliDiscoverySnapshot(good));
  const mutations: [string, (s: any) => void][] = [
    ['missing API root source', s => { s.launchers.opencode.sources = s.launchers.opencode.sources.filter((v: string) => v !== 'opencode.api/model'); }],
    ['retired 1.x model provenance', s => { s.launchers.opencode.models[3].provider.source = 'opencode.models.providerID'; s.launchers.opencode.sources.push('opencode.models.providerID'); }],
    ['retired 1.x connection provenance', s => { s.launchers.opencode.providerConnections[0].source = 'opencode.provider/list.connected'; }],
    ['missing API provider proof', s => { delete s.launchers.opencode.models[3].provider; }],
    ['API source with unknown catalog', s => { s.launchers.opencode.catalog = 'unknown'; s.launchers.opencode.models = []; delete s.launchers.opencode.providerConnections; s.launchers.opencode.sources = ['version', 'opencode.api/model']; }],
  ];
  for (const [name, mutate] of mutations) { const s = structuredClone(good); mutate(s); assert.equal(validateCliDiscoverySnapshot(s), false, name); }
}));

test('OpenCode 2.x catalog: shared deadline classifies a late failed read', () => fixture('normal', async (cwd, binary) => {
  const now = Date.now, fetchOriginal = globalThis.fetch; let offset = 0;
  Date.now = () => now() + offset;
  globalThis.fetch = async (...args) => {
    const response = await fetchOriginal(...args);
    if (String(args[0]).endsWith('/api/model')) { await response.arrayBuffer(); offset = 10000; throw new Error('fixture read failed'); }
    return response;
  };
  try { const s = await observe(cwd, binary); assert.deepEqual(s.launchers.opencode.problems, ['timeout']); }
  finally { Date.now = now; globalThis.fetch = fetchOriginal; }
}));
