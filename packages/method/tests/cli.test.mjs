import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATUS_PROVENANCE } from '../mod.ts';

// The Node adapter that replaced the Deno entrypoints: help and usage exits, and the render/validate
// round trip on a synthetic run directory copied from the package templates.
const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '../src/adapters/cli/main.ts');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15_000 });

function runDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'method-run-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(join(here, '../templates'), directory, { recursive: true });
  return directory;
}

test('help exits 0 for the binary and every subcommand', () => {
  for (const args of [['--help'], ['milestone', 'validate', '--help'], ['milestone', 'render', '--help'], ['receipts', '--help']]) {
    const result = run(...args);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(result.stderr, '');
  }
  assert.ok(run('--help').stdout.startsWith('harness-method — '));
});

test('usage errors exit 2 and never run a check', () => {
  for (const args of [[], ['milestone'], ['milestone', 'publish'], ['milestone', 'render'], ['milestone', 'validate', 'a', 'b'], ['milestone', 'validate', 'a', '--github-prs'], ['milestone', 'render', 'a', '--force']]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
  }
});

test('render writes the page with the package provenance, and --check refuses it once the state moves', (t) => {
  const directory = runDirectory(t);
  assert.equal(run('milestone', 'render', directory, '--check').status, 1, 'the template page is not a rendering');
  assert.equal(run('milestone', 'render', directory).status, 0);
  const page = readFileSync(join(directory, 'milestone-status.md'), 'utf8');
  assert.equal(page.split('\n')[0], STATUS_PROVENANCE);
  assert.equal(run('milestone', 'render', directory, '--check').status, 0);
  const statePath = join(directory, 'milestone-cluster-state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.updatedAt = '1970-01-01T09:00:00.000Z';
  writeFileSync(statePath, JSON.stringify(state));
  const stale = run('milestone', 'render', directory, '--check');
  assert.equal(stale.status, 1);
  const validated = run('milestone', 'validate', directory);
  assert.equal(validated.status, 1);
  assert.ok(JSON.parse(validated.stdout).errors.includes('milestone-status.md is stale; regenerate it from milestone-cluster-state.json'));
});

test('validate without a PR export never passes, and an unreadable run directory exits 1', (t) => {
  const directory = runDirectory(t);
  assert.equal(run('milestone', 'render', directory).status, 0);
  const result = run('milestone', 'validate', directory);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).findings.at(-1).kind, 'source-unavailable');
  const missing = run('milestone', 'validate', join(directory, 'absent'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^error: unable to validate milestone cluster/);
});
