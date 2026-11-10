// Compile real method sources, then kill each single-guard mutant with a named public assertion.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = mkdtempSync(join(tmpdir(), 'method-compiled-mutations-'));
const compiled = join(scratch, 'compiled');
const tests = join(root, 'packages/method/tests/default-branch.test.mjs');
const mutants = [];
const domain = 'src/domain/milestone/';
const app = 'src/application/';
const adapter = 'src/adapters/github-pr-export.js';
function mutant(id, file, before, after, test) { mutants.push({ id, file, before, after, test }); }

mutant('leaf-target', domain + 'state.js', 'leaf.baseBranch !== defaultBranch', "leaf.baseBranch !== 'main'",
  'master: zero-PR bootstrap and correctly targeted leaf pass');
mutant('recorded-leaf-filter', app + 'reconcile-milestone-prs.js',
  'if (leaf.baseBranch !== defaultBranch || livePullRequest.baseBranch !== defaultBranch)',
  "if (leaf.baseBranch !== 'main') continue;\n    if (leaf.baseBranch !== defaultBranch || livePullRequest.baseBranch !== defaultBranch)",
  'master: live changed head reports stale-head');
mutant('open-pr-filter', app + 'reconcile-milestone-prs.js', 'pullRequest.baseBranch !== defaultBranch', "pullRequest.baseBranch !== 'main'",
  'master: unrecorded default-branch PR reports missing-leaf');
for (const field of ['repo', 'defaultBranch']) {
  mutant('canonical-' + field, domain + 'identity.js', '!valid || new Set(values).size !== 1',
    `field !== '${field}' && (!valid || new Set(values).size !== 1)`,
    `canonical ${field === 'repo' ? 'repository' : field} agreement is mandatory in every artifact`);
  mutant('snapshot-' + field, domain + 'identity.js', `snapshot.${field} !== identity.${field}`, 'false',
    'snapshot repository and branch must match canonical identity');
}
mutant('branch-syntax', domain + 'identity.js', "value !== '@'", 'true',
  'canonical malformed branch names refuse even when all copies agree');
mutant('repository-export-agreement', adapter, 'repository.nameWithOwner !== value.repo', 'false',
  'export repository metadata must match export.repo');
for (const [id, expression] of [['shadow-branch', "Object.hasOwn(value, 'defaultBranch')"], ['shadow-capture', "Object.hasOwn(repository, 'capturedAt')"]]) {
  mutant(id, adapter, expression, 'false', 'competing branch and capture evidence refuse');
}
mutant('export-branch', adapter, 'if (!branchName(branch))', 'if (false)',
  'missing or ambiguous repository default branch refuses at export ingestion');
mutant('export-time', adapter, 'if (captureTime(value.capturedAt) === null)', 'if (false)',
  'export capture requires a real UTC calendar timestamp');
mutant('export-entry', adapter, '!issueNumber(entry.number) ||', 'false ||',
  'malformed PR entries refuse before reconciliation');
mutant('export-duplicate-pr', adapter, 'duplicateValues(pullRequests.map((pullRequest) => pullRequest.number))', '[]',
  'duplicate PRs refuse even when records agree');
mutant('artifact-time-required', domain + 'identity.js', 'if (time === null)', 'if (false)',
  'missing and malformed artifact capture anchors refuse in both state schemas');
mutant('artifact-time-calendar', domain + 'identity.js', 'date.toISOString() === canonical', 'true',
  'missing and malformed artifact capture anchors refuse in both state schemas');
mutant('artifact-time-order', domain + 'identity.js', 'intakeTime > inventoryTime || inventoryTime > stateTime', 'false',
  'backdated or inconsistent artifact anchors refuse');
mutant('export-stale', domain + 'identity.js', 'capturedAt < updatedAt', 'false',
  'export older than current state refuses including zero PRs');
mutant('export-future', domain + 'identity.js', 'capturedAt > now', 'false',
  'future export refuses including zero PRs');
mutant('coordinator-exclusion', app + 'reconcile-milestone-prs.js', "pullRequest.role === 'coordinator-artifact'", 'false',
  'other-base and coordinator-artifact PRs remain excluded');
mutant('leaf-receipt-head', domain + 'state.js', 'receipt.gitHead !== leaf.headSha', 'false',
  'leaf receipts remain pinned to the immutable head');
mutant('independent-session', domain + 'state.js', 'leaf.implementerAgentId === leaf.evaluatorAgentId', 'false',
  'implementer and evaluator sessions must remain independent');
mutant('release-exact-head', domain + 'state.js', 'exactEvidence.gitHead === state.currentMainSha', 'true',
  'release evidence still requires exact current SHA and passing receipts');
mutant('duplicate-json-wiring', app + 'validate-milestone-cluster.js', "duplicateKeys(text) !== 'ok'", 'false',
  'run and CLI ingestion refuse semantic duplicate identity keys without disclosure');
mutant('live-pr-base', app + 'reconcile-milestone-prs.js', 'livePullRequest.baseBranch !== defaultBranch', 'false',
  'live retargeting refuses even at an unchanged head');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function control(test, red) {
  const args = ['--test', '--test-reporter=tap'];
  if (test) args.push('--test-name-pattern', `^${escapeRegex(test)}$`);
  args.push(tests);
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HARNESS_METHOD_TEST_ENTRY: pathToFileURL(join(compiled, 'mod.js')).href }, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(run.error); assert.equal(run.signal, null);
  assert.doesNotMatch(run.stdout + run.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError:|ReferenceError:|TypeError:/,
    'a broken module is not a killed mutant');
  if (red) {
    assert.equal(run.status, 1, 'mutant must fail by assertion');
    assert.match(run.stdout, new RegExp(`^not ok \\d+ - ${escapeRegex(test)}$`, 'm'));
    assert.match(run.stdout, /ERR_ASSERTION/);
    assert.match(run.stdout, /^# fail 1$/m);
    console.log(`  assertion-red (exit 1): ${test}`);
  } else {
    assert.equal(run.status, 0, 'compiled control must pass');
    assert.match(run.stdout, /^# fail 0$/m);
    if (test) assert.match(run.stdout, /^# pass 1$/m);
  }
}

try {
  writeFileSync(join(scratch, 'package.json'), '{"type":"module"}');
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  const compile = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p',
    'packages/method/tsconfig.json', '--emitDeclarationOnly', 'false', '--rewriteRelativeImportExtensions', 'true',
    '--outDir', compiled, '--tsBuildInfoFile', join(scratch, 'compile.tsbuildinfo')], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.ifError(compile.error); assert.equal(compile.signal, null);
  assert.equal(compile.status, 0, 'the actual method sources must compile before mutation');
  control(undefined, false);
  console.log('Compiled baseline: PASS (all public default-branch assertions, exit 0)');
  for (const mutation of mutants) {
    const file = join(compiled, mutation.file);
    const original = readFileSync(file, 'utf8');
    assert.equal(original.split(mutation.before).length - 1, 1, `${mutation.id}: match exactly one emitted guard`);
    control(mutation.test, false);
    try {
      writeFileSync(file, original.replace(mutation.before, mutation.after));
      console.log(`Mutation: ${mutation.id}`);
      control(mutation.test, true);
    } finally { writeFileSync(file, original); }
    control(mutation.test, false);
    console.log(`  restored-green (exit 0): ${mutation.id}`);
  }
  control(undefined, false);
  console.log(`Compiled mutations: ${mutants.length}/${mutants.length} assertion-red, restored-green; final suite PASS (exit 0)`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
