import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// The mutation runner uses these identical public assertions against actual emitted JavaScript.
const entry = process.env.HARNESS_METHOD_TEST_ENTRY ?? new URL('../mod.ts', import.meta.url).href;
const { milestonePrSourceFromExport, renderMilestoneStatus, validateMilestoneCluster,
  validateMilestoneRun, nodeRunDirectory, jsYamlDuplicateKeys } = await import(entry);
const head = '1'.repeat(40);
const changedHead = '2'.repeat(40);
const repo = 'example/fixture';
const fields = ['intake', 'inventory', 'dag', 'state'];

function fixture(defaultBranch = 'main', withLeaf = false) {
  const load = (name) => JSON.parse(readFileSync(new URL(`../templates/milestone-${name}.json`, import.meta.url), 'utf8'));
  const f = { intake: load('intake'), inventory: load('inventory'), dag: load('dependency-dag'), state: load('cluster-state') };
  for (const field of fields) Object.assign(f[field], { repo, defaultBranch });
  f.intake.capturedAt = '2026-01-01T00:00:00.000Z';
  f.inventory.capturedAt = '2026-01-01T00:01:00.000Z';
  f.intake.ownerRatifiedAt = f.intake.capturedAt;
  f.inventory.ownerRatifiedAt = f.inventory.capturedAt;
  f.state.updatedAt = f.state.reporting.lastReportAt = '2026-01-01T00:02:00.000Z';
  f.state.reporting.nextReportDueAt = '2026-01-01T01:02:00.000Z';
  f.export = { schemaVersion: 1, repo, milestone: f.state.milestone, capturedAt: '2026-01-01T00:03:00.000Z',
    repository: { nameWithOwner: repo, defaultBranchRef: { name: defaultBranch } }, pullRequests: [] };
  if (withLeaf) {
    f.intake.candidates = [{ number: 101, source: 'targetMilestone', decision: 'include', reason: 'Synthetic issue', evidence: ['fixture'], ownerRatified: true }];
    f.inventory.targetIssueCount = 1;
    f.inventory.issues = [{ number: 101, disposition: 'active', lane: 'fixes' }];
    const issueId = `issue:${101}`;
    f.dag.nodes = [{ id: issueId, kind: 'issue', issueNumber: 101 }];
    f.dag.waves = [{ index: 0, nodeIds: [issueId] }];
    f.state.lanes.find((lane) => lane.id === 'fixes').issueNumbers = [101];
    f.state.committedIssues = [{ number: 101, state: 'open' }];
    Object.assign(f.state.reporting.scope, { openIssueCount: 1, ownedIssueCount: 1, scheduledIssueCount: 1, openPullRequestCount: 1 });
    f.state.leaves = [{ id: 'fixture-leaf', prNumber: 201, lane: 'fixes', phase: 'planned', issueNumbers: [101],
      baseBranch: defaultBranch, headSha: head, implementerAgentId: 'fixture-author', evaluatorAgentId: 'fixture-reviewer', receiptRefs: [] }];
    f.export.pullRequests.push(pr(defaultBranch));
  }
  return f;
}
function pr(baseBranch, overrides = {}) {
  return { number: 201, issueNumbers: [101], lane: 'fixes', baseBranch, headSha: head, state: 'open', role: 'leaf', ...overrides };
}
async function check(f, source = milestonePrSourceFromExport(f.export)) {
  return validateMilestoneCluster({ intake: f.intake, inventory: f.inventory, dag: f.dag, state: f.state,
    status: await renderMilestoneStatus(f.state) }, source);
}
async function pass(f) { assert.deepEqual(await check(f), { ok: true, errors: [], findings: [] }); }
async function refusal(f, diagnostic) {
  const result = await check(f);
  assert.equal(result.ok, false, 'invalid evidence must refuse');
  assert.ok(result.errors.some((error) => error.includes(diagnostic)), JSON.stringify(result));
}
async function unavailable(f, source) {
  const result = await check(f, source);
  assert.equal(result.ok, false, 'invalid provenance must refuse');
  assert.ok(result.findings.some((finding) => finding.kind === 'source-unavailable'), JSON.stringify(result));
}

for (const branch of ['main', 'master', 'release/stable']) {
  test(`${branch}: zero-PR bootstrap and correctly targeted leaf pass`, async () => {
    await pass(fixture(branch));
    await pass(fixture(branch, true));
  });
  test(`${branch}: live changed head reports stale-head`, async () => {
    const f = fixture(branch, true); f.export.pullRequests[0].headSha = changedHead;
    const result = await check(f);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.findings.map(({ kind, recordedHead, liveHead }) => ({ kind, recordedHead, liveHead })),
      [{ kind: 'stale-head', recordedHead: head, liveHead: changedHead }]);
    assert.equal(result.ok, false);
  });
  test(`${branch}: unrecorded default-branch PR reports missing-leaf`, async () => {
    const f = fixture(branch); f.export.pullRequests.push(pr(branch));
    const result = await check(f);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.findings.map(({ kind, prNumber, liveHead }) => ({ kind, prNumber, liveHead })),
      [{ kind: 'missing-leaf', prNumber: 201, liveHead: head }]);
    assert.equal(result.ok, false);
  });
}

test('wrong-base leaves refuse without suppressing stale-head reconciliation', async () => {
  const f = fixture('master', true);
  f.state.leaves[0].baseBranch = 'topic/wrong'; f.export.pullRequests[0].headSha = changedHead;
  const result = await check(f);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('must target the verified repository defaultBranch')));
  assert.ok(result.findings.some((finding) => finding.kind === 'stale-head'));
});

test('live retargeting refuses even at an unchanged head', async () => {
  const f = fixture('master', true); f.export.pullRequests[0].baseBranch = 'topic/wrong';
  await unavailable(f);
});

test('other-base and coordinator-artifact PRs remain excluded', async () => {
  const f = fixture('master');
  f.export.pullRequests.push(pr('topic/other'), pr('master', { number: 202, role: 'coordinator-artifact' }));
  await pass(f);
});

test('canonical repository agreement is mandatory in every artifact', async () => {
  for (const field of fields) {
    for (const value of [undefined, null, '', '  ', 42, [], ['example/other'], 'example/other']) {
      const f = fixture(); f[field].repo = value;
      await refusal(f, 'same valid repo');
    }
  }
});

test('canonical defaultBranch agreement is mandatory in every artifact', async () => {
  for (const field of fields) {
    for (const value of [undefined, null, '', '  ', 42, [], ['main', 'master'], 'master']) {
      const f = fixture(); f[field].defaultBranch = value;
      await refusal(f, 'same valid defaultBranch');
    }
  }
});

test('canonical malformed branch names refuse even when all copies agree', async () => {
  for (const value of ['bad branch', 'branch\n', '@', '@{-1}', '-main', '/main', 'main/', 'main//next', 'a..b', '.hidden', 'a/.hidden', 'main.lock', 'a/b.lock', 'main.', 'a\\b', 'a:b', 'a~b', 'a^b', 'a?b', 'a*b', 'a[b', '\u007f']) {
    const f = fixture(); for (const field of fields) f[field].defaultBranch = value;
    await refusal(f, 'same valid defaultBranch');
  }
});

test('snapshot repository and branch must match canonical identity', async () => {
  for (const field of ['repo', 'defaultBranch']) {
    const f = fixture();
    const source = milestonePrSourceFromExport(f.export);
    const original = await source.readRepository(repo);
    source.readRepository = async () => ({ ...original, [field]: field === 'repo' ? 'example/other' : 'master' });
    await unavailable(f, source);
    const result = await check(f, source);
    assert.equal(result.ok, false);
    assert.match(result.findings[0].detail, /does not match canonical/);
  }
});

test('export repository metadata must match export.repo', () => {
  const f = fixture(); f.export.repository.nameWithOwner = 'example/other';
  assert.throws(() => milestonePrSourceFromExport(f.export), /metadata must match export.repo/);
});

test('competing branch and capture evidence refuse', () => {
  for (const field of ['defaultBranch', 'capturedAt']) {
    const f = fixture();
    if (field === 'defaultBranch') f.export.defaultBranch = 'main';
    else f.export.repository.capturedAt = f.export.capturedAt;
    assert.throws(() => milestonePrSourceFromExport(f.export), /competing branch or capture evidence/);
  }
});

test('missing or ambiguous repository default branch refuses at export ingestion', () => {
  for (const value of [undefined, null, {}, [], { name: undefined }, { name: [] }, { name: ['main', 'master'] }, { name: '' }, { name: 'bad branch' }]) {
    const f = fixture(); f.export.repository.defaultBranchRef = value;
    assert.throws(() => milestonePrSourceFromExport(f.export), /valid defaultBranchRef.name/);
  }
  for (const value of [undefined, null, [], {}]) {
    const f = fixture(); f.export.repository = value;
    assert.throws(() => milestonePrSourceFromExport(f.export), /metadata must match/);
  }
});

test('export capture requires a real UTC calendar timestamp', () => {
  for (const value of [undefined, null, 42, '', 'garbage', '2026-02-30T00:00:00.000Z', '2026-01-01', '2026-01-01T00:00:00+00:00']) {
    const f = fixture(); f.export.capturedAt = value;
    assert.throws(() => milestonePrSourceFromExport(f.export), /capturedAt/);
  }
});

test('malformed PR entries refuse before reconciliation', () => {
  for (const field of ['number', 'issueNumbers', 'lane', 'baseBranch', 'headSha', 'state', 'role']) {
    const f = fixture('master', true); delete f.export.pullRequests[0][field];
    assert.throws(() => milestonePrSourceFromExport(f.export), /malformed/);
  }
});

test('duplicate PRs refuse even when records agree', () => {
  const f = fixture('master', true); f.export.pullRequests.push({ ...f.export.pullRequests[0] });
  assert.throws(() => milestonePrSourceFromExport(f.export), /duplicated/);
});

test('missing and malformed artifact capture anchors refuse in both state schemas', async () => {
  for (const schema of [1, 2]) for (const [field, key] of [['intake', 'capturedAt'], ['inventory', 'capturedAt'], ['state', 'updatedAt']]) {
    for (const value of [undefined, null, '', 'garbage', '2026-02-30T00:00:00.000Z']) {
      const f = fixture(); f.state.schemaVersion = schema; f[field][key] = value;
      await refusal(f, `${field}.${key} must be a real UTC timestamp`);
    }
  }
});

test('backdated or inconsistent artifact anchors refuse', async () => {
  for (const [field, key, value] of [['intake', 'capturedAt', '2026-01-01T00:02:00Z'],
    ['inventory', 'capturedAt', '2025-12-31T23:59:00Z'], ['state', 'updatedAt', '2026-01-01T00:00:30Z']]) {
    const f = fixture(); f[field][key] = value;
    await refusal(f, 'capture anchors must be ordered');
  }
});

test('export older than current state refuses including zero PRs', async () => {
  const f = fixture(); f.export.capturedAt = '2026-01-01T00:01:59Z';
  await unavailable(f);
});

test('future export refuses including zero PRs', async () => {
  const f = fixture(); f.export.capturedAt = '9999-01-01T00:00:00Z';
  await unavailable(f);
});

test('missing recorded PR and unavailable metadata stay source-unavailable', async () => {
  const f = fixture('master', true); f.export.pullRequests = [];
  await unavailable(f);
  const result = await validateMilestoneCluster({ ...f, status: await renderMilestoneStatus(f.state) });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].kind, 'source-unavailable');
});

test('export repo and milestone remain bound at the port', async () => {
  const source = milestonePrSourceFromExport(fixture().export);
  assert.throws(() => source.readRepository('example/other'), /does not match/);
  assert.throws(() => source.readPrHead('example/other', 201), /does not match/);
  assert.throws(() => source.listOpenMilestonePrs(repo, 'other'), /does not match/);
});

test('leaf receipts remain pinned to the immutable head', async () => {
  const f = fixture('master', true); f.state.leaves[0].receiptRefs = [{ id: 'fixture-gate', gitHead: changedHead }];
  await refusal(f, 'receipt missing its id or pinned to a different head');
});

test('implementer and evaluator sessions must remain independent', async () => {
  const f = fixture('master', true); f.state.leaves[0].evaluatorAgentId = f.state.leaves[0].implementerAgentId;
  await refusal(f, 'same implementer and evaluator session');
});

function releaseFixture() {
  const f = fixture('master');
  f.state.releaseCaptain = { state: 'claimed', agentId: 'fixture-release', leaseId: 'fixture-lease', contentSha: f.state.currentMainSha };
  f.state.releaseWriters = ['fixture-release'];
  f.state.exactMainEvidence = { gitHead: f.state.currentMainSha, surface: 'repository', expectedGateIds: ['fixture-check'], receipts: [{
    schemaVersion: 1, gateId: 'fixture-check', invocationId: 'fixture-invocation', argv: ['fixture-check'], cwd: '.',
    gitHead: f.state.currentMainSha, actualGitHead: f.state.currentMainSha, timeoutMs: 1, runnerIdentity: 'fixture-runner',
    attempt: 1, requestHash: 'fixture-hash', lifecycleId: 'fixture-lifecycle', outcome: 'PASS', claimedAt: f.state.updatedAt,
  }] };
  return f;
}

test('release evidence still requires exact current SHA and passing receipts', async () => {
  await pass(releaseFixture());
  const f = releaseFixture(); f.state.exactMainEvidence.gitHead = changedHead;
  await refusal(f, 'release-readiness preconditions');
  for (const field of ['gitHead', 'actualGitHead', 'outcome']) {
    const invalid = releaseFixture(); invalid.state.exactMainEvidence.receipts[0][field] = field === 'outcome' ? 'FAIL' : changedHead;
    await refusal(invalid, 'exactMainEvidence:');
  }
  const empty = releaseFixture(); empty.state.exactMainEvidence.expectedGateIds = []; empty.state.exactMainEvidence.receipts = [];
  await refusal(empty, 'expectedGateIds must not be empty');
  const captain = releaseFixture(); captain.state.releaseCaptain.contentSha = changedHead;
  await refusal(captain, 'must own the single writer lease');
});

test('run and CLI ingestion refuse semantic duplicate identity keys without disclosure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'method-identity-'));
  const names = { intake: 'intake', inventory: 'inventory', dag: 'dependency-dag', state: 'cluster-state' };
  const f = fixture('master');
  const write = async () => {
    for (const field of fields) writeFileSync(join(directory, `milestone-${names[field]}.json`), JSON.stringify(f[field]));
    writeFileSync(join(directory, 'milestone-status.md'), await renderMilestoneStatus(f.state));
    writeFileSync(join(directory, 'export.json'), JSON.stringify(f.export));
  };
  const source = milestonePrSourceFromExport(f.export);
  try {
    await write();
    assert.equal((await validateMilestoneRun(nodeRunDirectory(directory), source, jsYamlDuplicateKeys)).ok, true);
    for (const field of fields) {
      await write();
      const file = join(directory, `milestone-${names[field]}.json`);
      writeFileSync(file, readFileSync(file, 'utf8').replace('"defaultBranch":', '"default\\u0042ranch":"PRIVATE_BRANCH_SENTINEL","defaultBranch":'));
      await assert.rejects(() => validateMilestoneRun(nodeRunDirectory(directory), source, jsYamlDuplicateKeys), /ambiguous or unsupported JSON keys/);
    }
    await write();
    const exportFile = join(directory, 'export.json');
    writeFileSync(exportFile, readFileSync(exportFile, 'utf8').replace('"name":"master"', '"n\\u0061me":"PRIVATE_BRANCH_SENTINEL","name":"master"'));
    const cli = new URL(entry.endsWith('.js') ? './src/adapters/cli/main.js' : './src/adapters/cli/main.ts', entry);
    const run = spawnSync(process.execPath, [cli.pathname, 'milestone', 'validate', directory, '--github-prs', exportFile], { encoding: 'utf8', timeout: 15000 });
    assert.ifError(run.error); assert.equal(run.status, 1);
    const result = JSON.parse(run.stdout);
    assert.equal(result.ok, false); assert.equal(result.findings[0].kind, 'source-unavailable');
    assert.equal((run.stdout + run.stderr).includes('PRIVATE_BRANCH_SENTINEL'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
