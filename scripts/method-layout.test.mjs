import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const map = JSON.parse(read('method/path-map.json'));
const entries = map.entries;
const tools = entries.filter((entry) => entry.kind === 'cli');
function run(command, args, cwd = root) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Nested test processes must run their own nonempty suites.
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined, 'runtime must execute; milestone tools require Deno 2');
  assert.equal(result.signal, null, 'a killed invocation is unproven');
  return result;
}
const invoke = (path, args, cwd = root) => path.endsWith('.ts')
  ? run('deno', ['run', '--no-config', '--allow-read', '--allow-write', resolve(root, path), ...args], cwd)
  : run(process.execPath, [resolve(root, path), ...args], cwd);
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-method-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function cluster(t) {
  const dir = scratch(t);
  const load = (name) => JSON.parse(read(`run-record/templates/milestone-${name}.json`));
  const intake = load('intake'), inventory = load('inventory'), dag = load('dependency-dag'), state = load('cluster-state');
  intake.repo = inventory.repo = 'example/fixture';
  intake.ownerRatifiedAt = inventory.ownerRatifiedAt = intake.capturedAt;
  intake.candidates = [{ number: 101, source: 'targetMilestone', decision: 'include', reason: 'Synthetic admitted issue', evidence: ['fixture-evidence'], ownerRatified: true }];
  inventory.targetIssueCount = 1;
  inventory.issues = [{ number: 101, disposition: 'active', lane: 'internals' }];
  dag.nodes = [{ id: 'issue:101', kind: 'issue', issueNumber: 101 }];
  dag.waves = [{ index: 0, nodeIds: ['issue:101'] }];
  state.lanes.find((lane) => lane.id === 'internals').issueNumbers = [101];
  state.committedIssues = [{ number: 101, state: 'open' }];
  Object.assign(state.reporting.scope, { openIssueCount: 1, ownedIssueCount: 1, scheduledIssueCount: 1 });
  for (const [name, value] of Object.entries({ intake, inventory, 'dependency-dag': dag, 'cluster-state': state }))
    writeFileSync(join(dir, `milestone-${name}.json`), JSON.stringify(value));
  const source = join(dir, 'prs.json');
  writeFileSync(source, JSON.stringify({ schemaVersion: 1, repo: intake.repo, milestone: intake.milestone, capturedAt: intake.capturedAt, pullRequests: [] }));
  return { dir, source, state };
}

test('all 26 canonical method paths exist before compatibility can be claimed', () => {
  assert.equal(map.schemaVersion, 1);
  assert.equal(entries.length, 26);
  assert.equal(new Set(entries.map((entry) => entry.canonical)).size, 26);
  for (const entry of entries) {
    assert.equal(existsSync(join(root, entry.canonical)), true, entry.canonical);
    assert.equal(existsSync(join(root, entry.legacy)), true, entry.legacy);
  }
});
test('templates have one canonical source and byte-identical legacy copies', () => {
  const templates = entries.filter((entry) => entry.kind === 'template');
  assert.equal(templates.length, 10);
  for (const entry of templates) assert.equal(read(entry.legacy), read(entry.canonical), entry.legacy);
});
test('compatibility generator checks all mapped entries without writing', () => {
  const result = run(process.execPath, ['scripts/method-compatibility.mjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /26 entries current/);
});
for (const entry of tools) {
  test(`${entry.canonical} and legacy path preserve cold usage exits`, (t) => {
    const cwd = scratch(t);
    const current = invoke(entry.canonical, [], cwd), legacy = invoke(entry.legacy, [], cwd);
    for (const result of [current, legacy]) assert.equal(result.status, 2, result.stderr);
    assert.equal(legacy.stdout, current.stdout);
    assert.equal(legacy.stderr, current.stderr);
    assert.notEqual(current.stdout + current.stderr, '');
    const checkoutAlias = join(cwd, 'checkout');
    symlinkSync(root, checkoutAlias, 'dir');
    for (const [index, path] of [entry.canonical, entry.legacy].entries()) {
      // Deno resolves relative imports from the supplied path; preserve its directory tree.
      const alias = path.endsWith('.ts') ? join(checkoutAlias, path) : join(cwd, `alias-${index}.mjs`);
      if (path.endsWith('.mjs')) symlinkSync(join(root, path), alias);
      const result = invoke(alias, [], cwd);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, current.stdout);
      assert.equal(result.stderr, current.stderr);
    }
    for (const path of [entry.canonical, entry.legacy]) {
      const code = `await import(${JSON.stringify(pathToFileURL(join(root, path)).href)}); console.log('IMPORT_ONLY')`;
      const imported = path.endsWith('.ts') ? run('deno', ['eval', '--no-config', code], cwd)
        : run(process.execPath, ['--input-type=module', '-e', code], cwd);
      assert.equal(imported.status, 0, imported.stderr);
      assert.equal(imported.stdout, 'IMPORT_ONLY\n');
      assert.equal(imported.stderr, '');
    }
  });
}
test('receipt aliases execute pass, fail and unproven inputs, including symlinks', (t) => {
  const dir = scratch(t), paths = [];
  const valid = join(dir, 'valid.json'), invalid = join(dir, 'invalid.json');
  writeFileSync(valid, read('scripts/fixtures/method-receipt.json'));
  writeFileSync(invalid, '{');
  const entry = tools.find((tool) => tool.canonical.endsWith('.mjs'));
  for (const path of [entry.canonical, entry.legacy]) {
    const link = join(dir, `${paths.length}.mjs`);
    symlinkSync(join(root, path), link);
    paths.push(path, link);
  }
  for (const [args, exit, verdict] of [[[valid], 0, 'pass'], [[invalid], 1, 'fail'], [[], 2, 'unproven'], [[join(dir, 'absent.json')], 2, 'unproven']]) {
    const outputs = paths.map((path) => invoke(path, args, dir));
    for (const output of outputs) {
      assert.equal(output.status, exit, output.stderr);
      assert.notEqual(output.stdout, '', 'a silent exit is not a receipt verdict');
      assert.equal(JSON.parse(output.stdout).verdict, verdict);
      assert.equal(output.stderr, '');
      assert.equal(output.stdout, outputs[0].stdout);
    }
  }
});
test('renderer aliases preserve historical header, deterministic bytes and failure exits', (t) => {
  const { dir } = cluster(t);
  const entry = tools.find((tool) => tool.canonical.endsWith('render-milestone-status.ts'));
  let rendered;
  for (const path of [entry.canonical, entry.legacy]) {
    const output = invoke(path, [dir], dir);
    assert.equal(output.status, 0, output.stderr);
    const current = readFileSync(join(dir, 'milestone-status.md'), 'utf8');
    assert.match(current, /^<!-- Generated by \.llm\/tools\/harness\/render-milestone-status\.ts\. Do not edit\. -->/);
    if (rendered) assert.equal(current, rendered); else rendered = current;
    assert.equal(invoke(path, [dir, '--check'], dir).status, 0);
    writeFileSync(join(dir, 'milestone-status.md'), `${current}\nstale`);
    const stale = invoke(path, [dir, '--check'], dir);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /stale or missing generated status/);
    assert.equal(invoke(path, ['--unknown'], dir).status, 2);
    assert.equal(invoke(path, [join(dir, 'absent')], dir).status, 1);
  }
});
test('validator aliases keep valid, unavailable, stale, foreign-source and I4 refusal semantics', (t) => {
  const f = cluster(t);
  const renderer = tools.find((tool) => tool.canonical.endsWith('render-milestone-status.ts')).canonical;
  const entry = tools.find((tool) => tool.canonical.endsWith('validate-milestone-cluster.ts'));
  assert.equal(invoke(renderer, [f.dir], f.dir).status, 0);
  const check = (args, code, expectation) => {
    const outputs = [entry.canonical, entry.legacy].map((path) => invoke(path, args, f.dir));
    for (const output of outputs) {
      assert.equal(output.status, code, output.stderr);
      assert.equal(output.stderr, '');
      expectation(JSON.parse(output.stdout));
      assert.equal(output.stdout, outputs[0].stdout);
    }
  };
  check([f.dir, '--github-prs', f.source], 0, (result) => assert.deepEqual(result, { ok: true, errors: [], findings: [] }));
  check([f.dir], 1, (result) => assert.equal(result.findings[0].kind, 'source-unavailable'));
  const source = JSON.parse(readFileSync(f.source, 'utf8'));
  writeFileSync(f.source, JSON.stringify({ ...source, repo: 'example/foreign' }));
  check([f.dir, '--github-prs', f.source], 1, (result) => assert.equal(result.findings[0].kind, 'source-unavailable'));
  writeFileSync(f.source, JSON.stringify(source));
  writeFileSync(join(f.dir, 'milestone-status.md'), 'stale');
  check([f.dir, '--github-prs', f.source], 1, (result) => assert.ok(result.errors.some((error) => error.includes('milestone-status.md is stale'))));
  f.state.reporting.orchestratorMatrix.find((row) => row.lane === 'internals').state = 'blocked';
  writeFileSync(join(f.dir, 'milestone-cluster-state.json'), JSON.stringify(f.state));
  assert.equal(invoke(renderer, [f.dir], f.dir).status, 0);
  check([f.dir, '--github-prs', f.source], 1, (result) => assert.ok(result.errors.some((error) => error.startsWith('I4 lane '))));
  for (const path of [entry.canonical, entry.legacy]) assert.equal(invoke(path, ['--github-prs'], f.dir).status, 2);
});
test('canonical and legacy module APIs expose identical bindings without CLI effects', async () => {
  for (const entry of entries.filter((entry) => entry.kind === 'module' || entry.kind === 'cli')) {
    const current = await import(pathToFileURL(join(root, entry.canonical)));
    const legacy = await import(pathToFileURL(join(root, entry.legacy)));
    assert.deepEqual(Object.keys(legacy).sort(), Object.keys(current).sort());
    for (const key of Object.keys(current)) assert.equal(legacy[key], current[key]);
  }
});
test('canonical root scripts reach method gates and legacy test commands remain nonempty', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.scripts['check:cluster'], 'node --test method/tools/harness/blocked-decisions.test.mjs');
  assert.equal(manifest.scripts['check:receipts'], 'node --test method/tools/harness/matrix-receipts.test.mjs');
  assert.equal(manifest.scripts['check:method'], 'node --test scripts/method-layout.test.mjs && node scripts/method-compatibility.mjs');
  assert.ok(manifest.scripts.test.split(/\s+/).includes('check:method'));
  const deno = JSON.parse(read('deno.json'));
  assert.equal(deno.tasks['harness:milestone:render'], 'deno run --allow-read --allow-write method/tools/harness/render-milestone-status.ts');
  assert.equal(deno.tasks['harness:milestone:validate'], 'deno run --allow-read method/tools/harness/validate-milestone-cluster.ts');
  assert.match(read('.github/workflows/ci.yml'), /denoland\/setup-deno@/);
  for (const entry of entries.filter((entry) => entry.kind === 'test')) {
    const result = run(process.execPath, ['--test', '--test-reporter=tap', join(root, entry.legacy)]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /# fail 0/);
    assert.doesNotMatch(result.stdout, /# tests 0\b/);
    const witness = entry.canonical.includes('blocked-decisions') ? 'nonempty unblocked baseline' : 'known synthetic receipt';
    assert.ok(result.stdout.includes(`# Subtest: ${witness}`), 'a file-only pass is not suite execution');
  }
});

test('read-only compatibility check refuses each stale artifact without rewriting it', (t) => {
  const dir = scratch(t);
  const files = ['method/path-map.json', 'scripts/method-compatibility.mjs', ...entries.flatMap((entry) => [entry.legacy, entry.canonical])];
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(root, file), join(dir, file));
  }
  const check = () => run(process.execPath, [join(dir, 'scripts/method-compatibility.mjs')], dir);
  assert.equal(check().status, 0);
  for (const entry of entries) {
    const path = join(dir, entry.legacy), saved = readFileSync(path, 'utf8');
    const stale = `${saved}\nstale-copy`;
    writeFileSync(path, stale);
    const result = check();
    assert.equal(result.status, 1, entry.legacy);
    assert.match(result.stderr, /method compatibility stale:/);
    assert.ok(result.stderr.includes(entry.legacy));
    assert.equal(readFileSync(path, 'utf8'), stale, 'a read-only gate must never bless its own copy');
    writeFileSync(path, saved);
  }
  assert.equal(check().status, 0);
});
test('declared Deno tasks execute canonical tools with real argument forwarding in a cold config copy', (t) => {
  const f = cluster(t), cwd = scratch(t);
  // Deno task's child may refresh npm workspace metadata even with outer --no-lock.
  // A byte-identical isolated config/tool copy exercises the declared tasks without changing the checkout lock.
  for (const file of ['deno.json', 'deno.lock', ...entries.filter((entry) => entry.kind !== 'document' && entry.kind !== 'template').map((entry) => entry.canonical)]) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    copyFileSync(join(root, file), join(cwd, file));
  }
  const rendered = run('deno', ['task', '--no-lock', 'harness:milestone:render', '--', f.dir], cwd);
  assert.equal(rendered.status, 0, rendered.stderr);
  const checked = run('deno', ['task', '--no-lock', 'harness:milestone:render', '--', f.dir, '--check'], cwd);
  assert.equal(checked.status, 0, checked.stderr);
  const validated = run('deno', ['task', '--no-lock', 'harness:milestone:validate', '--', f.dir, '--github-prs', f.source], cwd);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).ok, true);
  const unproven = run('deno', ['task', '--no-lock', 'harness:milestone:validate', '--', f.dir], cwd);
  assert.equal(unproven.status, 1, unproven.stderr);
  assert.equal(JSON.parse(unproven.stdout).findings[0].kind, 'source-unavailable');
});
