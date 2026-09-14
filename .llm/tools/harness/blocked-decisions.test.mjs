import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateMilestoneCluster } from './validate-milestone-cluster.ts';
import { renderMilestoneStatus } from './render-milestone-status.ts';

// All identities and data here are synthetic. Exercise the full validator with a
// nonempty admitted inventory and an explicit PR source, never a helper-only gate.
function fixture() {
  const load = (name) => JSON.parse(readFileSync(new URL(`../../harness/templates/milestone-${name}.json`, import.meta.url), 'utf8'));
  const intake = load('intake');
  const inventory = load('inventory');
  const dag = load('dependency-dag');
  const state = load('cluster-state');
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
  return { intake, inventory, dag, state };
}
function row(f, lane = 'internals') {
  return f.state.reporting.orchestratorMatrix.find((entry) => entry.lane === lane);
}
function decision(f) {
  const value = { id: 'fixture-decision', lane: 'internals', status: 'open', question: 'Which fixture option?', options: ['One', 'Two'], recommendation: 'One', costOfBeingWrong: 'Repeat the fixture', raisedAt: '1970-01-01T00:00:00.000Z', whyOwnerOnly: 'Fixture preference', blockedItems: [101], answer: null, answeredAt: null };
  f.state.reporting.ownerDecisions.push(value);
  return value;
}
function blocked(f) {
  const value = decision(f);
  Object.assign(row(f), { state: 'blocked', decisionRef: value.id });
  return value;
}
function leaf(f) {
  const value = { id: 'fixture-leaf', lane: 'internals', phase: 'blocked', issueNumbers: [101], baseBranch: 'main', prNumber: 201, headSha: '1'.repeat(40), receiptRefs: [] };
  f.state.leaves.push(value);
  f.state.reporting.scope.openPullRequestCount = 1;
  return value;
}
function source(f) {
  const prs = f.state.leaves.map((entry) => ({ number: entry.prNumber, issueNumbers: entry.issueNumbers, lane: entry.lane, baseBranch: entry.baseBranch, headSha: entry.headSha, state: 'open', role: 'leaf' }));
  return {
    async listOpenMilestonePrs() { return prs; },
    async readPrHead(_repo, number) {
      const pr = prs.find((entry) => entry.number === number);
      assert.ok(pr, 'fixture PR must exist');
      return pr;
    },
  };
}
async function check(f, options = {}) {
  const artifacts = { ...f, status: await renderMilestoneStatus(f.state) };
  if (options.stale) artifacts.status += '\nstale fixture';
  return options.unavailable ? validateMilestoneCluster(artifacts) : validateMilestoneCluster(artifacts, source(f));
}
async function passes(f) {
  assert.deepEqual(await check(f), { ok: true, errors: [], findings: [] });
}
async function failsI4(f) {
  const result = await check(f);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith('I4 lane ')), JSON.stringify(result));
  assert.deepEqual(result.findings, [], 'controlled reconciliation must succeed');
  return result;
}

test('nonempty unblocked baseline and historical unreferenced decisions remain valid', async () => {
  const f = fixture();
  await passes(f);
  f.state.reporting.ownerDecisions = [{ id: 'historical-fixture', question: 'Legacy?', whyOwnerOnly: 'Preference', blockedItems: [] }];
  row(f).decisionRef = 'ignored-while-unblocked';
  await passes(f);
});

test('a blocked report row passes with one complete open decision in its own lane', async () => {
  const f = fixture();
  blocked(f);
  await passes(f);
  delete f.state.reporting.ownerDecisions[0].answer;
  delete f.state.reporting.ownerDecisions[0].answeredAt;
  await passes(f);
});

test('a blocked row cannot pass with missing, blank, mistyped or unmatched reference', async () => {
  for (const ref of [undefined, null, '', '  ', 123, [], {}, 'not-recorded', ' fixture-decision']) {
    const f = fixture(); blocked(f); row(f).decisionRef = ref;
    await failsI4(f);
  }
});

for (const field of ['status', 'lane', 'question', 'recommendation', 'costOfBeingWrong', 'raisedAt']) {
  test(`a referenced decision requires valid ${field}`, async () => {
    for (const value of [undefined, null, '', '  ', 42, {}]) {
      const f = fixture(); blocked(f)[field] = value;
      await failsI4(f);
    }
  });
}

test('closed, wrong-lane, answered and malformed open decisions fail', async () => {
  for (const [key, value] of [['status', 'closed'], ['lane', 'docs'], ['raisedAt', 'not-a-date'], ['answer', ''], ['answer', false], ['answer', {}], ['answeredAt', ''], ['answeredAt', '1970-01-01T00:00:00Z']]) {
    const f = fixture(); blocked(f)[key] = value;
    await failsI4(f);
  }
  for (const options of [undefined, null, {}, [], ['One'], ['One', ''], ['One', '  '], ['One', 2]]) {
    const f = fixture(); blocked(f).options = options;
    await failsI4(f);
  }
});

test('duplicate identity is ambiguous before filtering status', async () => {
  for (const status of ['open', 'closed']) {
    const f = fixture(); const d = blocked(f);
    f.state.reporting.ownerDecisions.push({ ...d, status });
    await failsI4(f);
  }
});

test('missing and malformed decision collections cannot satisfy a blocked row', async () => {
  for (const collection of [undefined, null, {}, [], [null]]) {
    const f = fixture(); blocked(f); f.state.reporting.ownerDecisions = collection;
    await failsI4(f);
  }
});

test('blocked leaves use an explicit decision or inherit their own blocked row', async () => {
  const f = fixture(); blocked(f); const l = leaf(f);
  await passes(f);
  l.decisionRef = 'fixture-decision'; row(f).state = 'active';
  await passes(f);
});

test('an invalid explicit leaf reference never falls back to a valid row reference', async () => {
  for (const reference of [undefined, null, '', 'missing-fixture']) {
    const f = fixture(); blocked(f); leaf(f).decisionRef = reference;
    await failsI4(f);
  }
});

test('inheritance requires a blocked row in the same lane and a decision in that lane', async () => {
  const f = fixture(); blocked(f); leaf(f); row(f).state = 'active';
  await failsI4(f);
  Object.assign(row(f, 'docs'), { state: 'blocked', decisionRef: 'fixture-decision' });
  f.state.reporting.ownerDecisions[0].lane = 'docs';
  await failsI4(f);
  row(f).state = 'blocked'; row(f, 'docs').state = 'active';
  await failsI4(f);
});

test('schema-1 blocked leaves fail closed; nonblocked legacy leaves remain valid', async () => {
  const f = fixture(); leaf(f); f.state.schemaVersion = 1; delete f.state.reporting;
  const result = await failsI4(f);
  assert.ok(result.errors.some((error) => error.includes('schema-2 decision snapshot is required')));
  f.state.leaves[0].phase = 'planned'; f.state.leaves[0].decisionRef = 'ignored-while-unblocked';
  await passes(f);
});

test('a blocked leaf cannot pass when schema-2 reporting is missing', async () => {
  const f = fixture(); leaf(f); delete f.state.reporting;
  await failsI4(f);
});

test('new I4 diagnostics disclose no decision references or question values', async () => {
  const f = fixture(); const d = blocked(f);
  const sentinel = 'PRIVATE_DECISION_SENTINEL';
  d.id = row(f).decisionRef = sentinel; d.question = sentinel; d.status = 'closed';
  const result = await failsI4(f);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test('valid I4 snapshot does not bypass stale reporting, rendering or unavailable PR evidence', async () => {
  const f = fixture(); blocked(f);
  const stale = await check(f, { stale: true });
  assert.equal(stale.ok, false); assert.ok(stale.errors.some((error) => error.includes('milestone-status.md is stale')));
  const unavailable = await check(f, { unavailable: true });
  assert.equal(unavailable.ok, false); assert.equal(unavailable.findings[0].kind, 'source-unavailable');
  f.state.updatedAt = '1970-01-01T02:00:00.000Z';
  const expired = await check(f);
  assert.equal(expired.ok, false); assert.ok(expired.errors.includes('state.reporting is stale relative to state.updatedAt'));
});

test('CI aggregate explicitly includes the Node cluster test stage', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.scripts.test.split(/\s+/).includes('check:cluster'));
  assert.equal(manifest.scripts['check:cluster'], 'node --test .llm/tools/harness/blocked-decisions.test.mjs');
});
