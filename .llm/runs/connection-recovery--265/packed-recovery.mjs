/** Local candidate proof only. Run from repository root after build; no registry or live sources. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = process.cwd();
const runDir = join(root, '.llm/runs/connection-recovery--265');
const contracts = join(root, 'packages/contracts');
const scratch = mkdtempSync('/home/agent/recovery265-pack-');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Only this explicit environment reaches npm. Empty config files prevent operator-config access.
for (const dir of ['consumer', 'pack', 'home']) mkdirSync(join(scratch, dir));
for (const name of ['npmrc', 'global-npmrc']) writeFileSync(join(scratch, name), '');
const env = { PATH: process.env.PATH, HOME: join(scratch, 'home'),
  npm_config_userconfig: join(scratch, 'npmrc'), npm_config_globalconfig: join(scratch, 'global-npmrc'),
  npm_config_cache: join(scratch, 'cache'), npm_config_offline: 'true',
  npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
const consumer = join(scratch, 'consumer');
const run = (bin, args, cwd = consumer) => execFileSync(bin, args, {
  cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
});
const runtime = `import assert from 'node:assert/strict';
import * as api from '@rickylabs/harness-contracts';
import { openHub, subscribe, resync, announce } from '@rickylabs/harness-contracts/server';
import pkg from '@rickylabs/harness-contracts/package.json' with { type: 'json' };
const { openCockpit, stepCockpit, board, boardStatus, cockpitStatus, resyncFrame, foldFromSnapshot } = api;
assert.equal(pkg.version, '0.4.0'); assert.equal(api.PROTOCOL_VERSION, 1);
for (const name of ['rebind', 'isBound', 'boundTo', 'openHub']) assert.equal(name in api, false);
const at = '2026-09-01T00:00:00.000Z';
const projection = { protocol: 1, generation: 900000, generatedAt: at, complete: false,
  repo: { owner: 'synthetic', name: 'recovery' }, lifecycle: { prefix: 'status:', phases: [] },
  tasks: [], runs: [], anomalies: [], governance: { generatedAt: at, regimes: [], pending: [], notes: [] },
  notes: ['synthetic partial board'] };
const endpoint = { origin: 'http://localhost:4400', relayed: false,
  credential: { mode: 'session', cookieName: 'synthetic' } };
const step = (c, input, now = 0) => stepCockpit(c, input, now);
const msg = (c, value, link = c.loop.link) => step(c, { kind: 'message', link, value }).cockpit;
const wire = (kind, generation, seq, payload) => ({ kind, generation, seq, at, payload });
const hello = generation => wire('hello', generation, 0, { protocol: 1, repo: projection.repo });
let c = openCockpit(endpoint);
assert.equal(boardStatus(c), 'absent');
c = step(c, { kind: 'start' }).cockpit;
c = step(c, { kind: 'ask', key: 'cold', reason: 'cold-start' }).cockpit;
c = step(c, { kind: 'answered', key: 'cold', command: 'snapshot', result: { ok: true, value: projection } }, 99999).cockpit;
assert.equal(boardStatus(c), 'retained'); assert.equal(c.fold.bound, false);
assert.equal(c.fold.appliedAt, at); assert.equal(board(c).generatedAt, at);
assert.deepEqual(resyncFrame(c.fold), { kind: 'resync', generation: 0 });
for (const frame of [wire('snapshot', 900000, 1, projection), wire('future', 900000, 1, {}),
  wire('task.removed', 900000, 1, { number: 265 })]) {
  const next = msg(c, frame); assert.deepEqual(board(next), board(c));
  assert.deepEqual(next.fold, { ...c.fold, counts: { ...c.fold.counts, discarded: c.fold.counts.discarded + 1 } });
}
c = msg(c, hello(8000)); assert.equal(boardStatus(c), 'retained');
c = msg(c, wire('snapshot', 8000, 1, { ...projection, generation: 8000 }));
assert.equal(boardStatus(c), 'synchronized'); assert.equal(board(c).complete, false);
assert.equal(cockpitStatus(c).includes('(stale)'), false);
const before = c;
c = step(c, { kind: 'dropped', link: 1, detail: 'synthetic restart' }).cockpit;
assert.equal(boardStatus(c), 'retained'); assert.deepEqual(board(c), board(before));
assert.equal(c.fold.counts, before.fold.counts); assert.equal(c.fold.lastSeq, null);
assert.equal(cockpitStatus(c).includes('(stale)'), true);
assert.equal(msg(c, hello(999999), 1), c);
c = step(c, { kind: 'tick' }, 60000).cockpit;
assert.equal(c.loop.link, 2); assert.equal(c.fold.bound, false);
assert.equal(msg(c, hello(999999), 1), c);
const greeted = subscribe(openHub({ ...projection, notes: ['new host'] }), 'synthetic', at);
assert.equal(greeted.deliveries[0].frame.generation, 1);
c = msg(c, greeted.deliveries[0].frame); assert.equal(boardStatus(c), 'retained');
c = msg(c, greeted.deliveries[1].frame); assert.equal(boardStatus(c), 'synchronized');
assert.equal(cockpitStatus(c).includes('(stale)'), false);
assert.deepEqual(board(c).notes, ['new host']); assert.equal(board(c).complete, false);
for (const gen of [0, 1]) {
  const repeated = msg(c, hello(gen)); assert.deepEqual(board(repeated), board(c));
  assert.equal(repeated.fold.lastSeq, c.fold.lastSeq);
  assert.equal(repeated.fold.counts.discarded, c.fold.counts.discarded + 1);
}
const zero = resyncFrame(foldFromSnapshot(projection));
const closed = resync(greeted.hub, 'synthetic', zero, at);
assert.deepEqual(closed.closed, ['synthetic']); assert.deepEqual(closed.deliveries, []);
const missed = announce(greeted.hub, { kind: 'task.removed', payload: { number: 1 } }, at);
const arrived = announce(missed.hub, { kind: 'task.removed', payload: { number: 265 } }, at);
const gap = step(c, { kind: 'message', link: 2, value: arrived.deliveries[0].frame });
assert.equal(boardStatus(gap.cockpit), 'retained');
const repaired = resync(arrived.hub, 'synthetic', gap.effects[0].frame, at);
c = msg(gap.cockpit, repaired.deliveries[0].frame);
assert.equal(boardStatus(c), 'synchronized');
const sent = step(c, { kind: 'dispatch', command: { item: 265, lane: 'impl', prompt: 'synthetic', idempotencyKey: 'unknown' } });
const stopped = step(sent.cockpit, { kind: 'answered', key: 'unknown', command: 'dispatch', result: {
  ok: false, error: { error: 'unauthorized', detail: 'synthetic', retryable: false } } });
assert.equal(boardStatus(stopped.cockpit), 'retained'); assert.equal(stopped.cockpit.fold.bound, false);
assert.equal(stopped.effects.some(e => e.kind === 'post'), false);
console.log('installed recovery runtime PASS');
`;
const declarations = `import { boardStatus, openCockpit, emptyFold, foldFromSnapshot, resyncFrame,
  type BoardStatus, type EventFold, type Cockpit, type RemoteSnapshot } from '@rickylabs/harness-contracts';
import { openHub, subscribe, resync, type Hub } from '@rickylabs/harness-contracts/server';
const { bound, ...oldShape } = emptyFold();
const legacy: EventFold = oldShape;
const status: BoardStatus = boardStatus(openCockpit({ origin: 'http://localhost:4400', relayed: false,
  credential: { mode: 'session', cookieName: 'synthetic' } }));
function consume(c: Cockpit, s: RemoteSnapshot, h: Hub): void {
  const frame = resyncFrame(foldFromSnapshot(s));
  const next: Hub = resync(subscribe(openHub(s), 'synthetic', s.generatedAt).hub, 'synthetic', frame, s.generatedAt).hub;
  boardStatus(c); void next; void h;
}
// @ts-expect-error no authorization status is defined
const wrong: BoardStatus = 'authorized';
// @ts-expect-error internal helper is not a root export
import { rebind } from '@rickylabs/harness-contracts';
// @ts-expect-error internal helper is not a root export
import { isBound } from '@rickylabs/harness-contracts';
// @ts-expect-error server-only export must remain absent at root
import { openHub as rootHub } from '@rickylabs/harness-contracts';
// @ts-expect-error server declarations reject unrelated shapes
openHub(42);
void bound; void legacy; void status; void consume; void wrong; void rebind; void isBound; void rootHub;
`;
try {
  const metadata = JSON.parse(run('npm', ['pack', contracts, '--json', '--ignore-scripts', '--pack-destination', join(scratch, 'pack')], scratch))[0];
  assert.equal(metadata.version, '0.4.0');
  const tarball = join(scratch, 'pack', metadata.filename);
  assert.ok(!metadata.files.some(f => /test|fixture|tsbuildinfo/.test(f.path)));
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const installed = join(consumer, 'node_modules/@rickylabs/harness-contracts');
  const files = {};
  for (const { path } of metadata.files) {
    const packed = readFileSync(join(installed, path));
    assert.deepEqual(packed, readFileSync(join(contracts, path)), 'installed bytes differ from candidate');
    files[path] = digest(packed);
    if (/\.(?:js|ts|json|md|map)$/.test(path)) {
      const body = packed.toString('utf8');
      assert.ok(!body.includes(root) && !body.includes(scratch), 'operational path in package');
      if (/\.(?:js|ts)$/.test(path)) assert.ok(!/from ["']node:|import\(["']node:|require\(/.test(body), 'nonportable package import');
    }
  }
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/server.js', 'dist/server.d.ts']) assert.ok(files[file]);
  const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  writeFileSync(join(consumer, 'runtime.mjs'), runtime);
  assert.match(run(process.execPath, ['runtime.mjs']), /installed recovery runtime PASS/);
  writeFileSync(join(consumer, 'consumer.ts'), declarations);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    noEmit: true, skipLibCheck: false, types: [], lib: ['ES2023', 'DOM'],
  }, files: ['consumer.ts'] }));
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json']);
  const receipt = { check: 'packed-recovery265', status: 'PASS', node: process.version,
    version: pkg.version, protocol: pkg.dsh.protocol, tarball: metadata.filename,
    sha256: digest(readFileSync(tarball)), fileCount: metadata.files.length,
    probeSourceSha256: digest(readFileSync(new URL(import.meta.url))),
    runtimeSourceSha256: digest(runtime), declarationSourceSha256: digest(declarations),
    gates: ['offline pack/install', 'installed/source byte equality', 'root/server runtime',
      'root/server declarations and negative exports', 'cold far-apart generation', 'prehello discard',
      'lower-generation restart', 'retention and old-link fence', 'three-phase stale marker',
      'partial synchronization', 'gap/resync', 'unauthorized refusal', 'sentinel closes hub link',
      'portable dependency-free package and safe paths'],
    files, limitations: ['local pack only; no publication/adoption', 'synthetic transport inputs only',
      'no backend authorization, private consumer compatibility, or live-source acceptance'] };
  writeFileSync(join(runDir, 'packed-recovery-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ...receipt, files: undefined }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
