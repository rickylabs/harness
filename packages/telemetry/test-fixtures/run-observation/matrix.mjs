/** Executable synthetic fixtures shared by package tests and the offline installed decoder gate. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, rename, symlink, truncate } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
export const CANARY = 'synthetic-private-message-canary';
const T = n => `2026-09-01T00:00:0${n}.000Z`;
const row = (type, payload, n = 0) => ({ timestamp: T(n), type, payload });
const git = path => execFileSync('git', ['init', '--quiet', path], { env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'pipe' });
export async function runObservationMatrix({ scratch, collect, decode, cli, raceCli }) {
  const passed = [];
  let serial = 0;
  async function setup() {
    const base = join(scratch, `synthetic-case-${serial++}`), worktree = join(base, 'worktree'), root = join(base, 'native-store');
    await mkdir(root, { recursive: true }); git(worktree);
    const d = { schema: 1, binding: { namespace: 'synthetic-issuer', id: 'association-a', revision: 'r1', sourceScopeId: 'store-a', repo: { owner: 'synthetic', name: 'repository' } }, source: { kind: 'codex', root, file: join(root, 'selected.jsonl'), nativeId: 'native-1' }, worktree, gitCommonDirectory: join(worktree, '.git') };
    const descriptorPath = join(base, 'descriptor.json');
    const rows = [row('session_meta', { id: 'native-1', cwd: worktree, model_provider: 'synthetic-provider', title: CANARY, remote_url: CANARY, notes: CANARY, credential: CANARY }),
      row('turn_context', { cwd: worktree, model: 'synthetic/model-a', effort: 'medium' }, 1),
      row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 11, output_tokens: 3 } }, rate_limits: { notes: CANARY } }, 2),
      row('turn_context', { model: 'synthetic/model-b' }, 3),
      row('event_msg', { type: 'task_complete', message: CANARY }, 4)];
    const save = async () => { await writeFile(descriptorPath, JSON.stringify(d)); await writeFile(d.source.file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
    await save();
    return { base, worktree, root, d, rows, descriptorPath, save };
  }
  function check(document, reason, f) {
    const read = decode(document); assert.equal(read.ok, true, reason);
    assert.deepEqual(read.observation, document);
    const o = read.observation;
    assert.deepEqual(o.binding, f.d.binding);
    const publicText = JSON.stringify(o);
    for (const privateText of [CANARY, scratch, f.worktree, f.root, 'remote_url', 'credential']) assert.ok(!publicText.includes(privateText), 'public source text leaked');
    if (reason === 'read') {
      assert.deepEqual(o.coverage, { status: 'read', reason: null });
      assert.equal(o.verification.basis, 'enrollment-and-local-worktree');
      assert.ok(o.verification.verifiedAt <= o.capturedAt);
      assert.equal(o.run.nativeId, 'native-1');
    } else {
      assert.equal(o.coverage.reason, reason); assert.equal(o.run, null); assert.equal(o.verification, null);
    }
    return o;
  }
  async function fixture(name, reason, mutate = async () => {}, inspect = () => {}) {
    const f = await setup(); await mutate(f);
    const o = check(await collect(f.descriptorPath), reason, f); inspect(o);
    const output = await cli(f.descriptorPath);
    assert.equal(output.code, reason === 'read' ? 0 : 3, name); assert.equal(output.stderr, '', name);
    check(JSON.parse(output.stdout), reason, f);
    assert.ok(!output.stdout.includes(CANARY));
    passed.push(name);
    return { f, o };
  }
  const initial = await fixture('read-distinct-roots-independent-clocks', 'read', undefined, o => {
    assert.equal(o.run.identity.provider.observedAt, T(0));
    assert.equal(o.run.identity.model.observedAt, T(3));
    assert.equal(o.run.identity.effort.observedAt, T(1));
    assert.deepEqual(o.run.usage, { observedAt: T(2), inputTokens: 11, outputTokens: 3 });
    assert.deepEqual(o.run.execution, { status: 'source-reported-complete', observedAt: T(4) });
    assert.equal(o.run.firstObservedAt, T(0)); assert.equal(o.run.lastObservedAt, T(4));
    assert.deepEqual(Object.values(o.run.relationships), Array(5).fill('unavailable'));
  });
  await initial.f.save();
  initial.f.d.binding.revision = 'r2'; await initial.f.save();
  const again = check(await collect(initial.f.descriptorPath), 'read', initial.f);
  assert.deepEqual(again.run, initial.o.run); passed.push('revision-echo-repeat-read');
  for (const [name, edit, reason] of [
    ['wrong-id', p => { p.id = 'wrong'; }, 'identity-mismatch'],
    ['conflicting-aliases', p => { p.session_id = 'wrong'; }, 'identity-mismatch'],
    ['invalid-alias', p => { p.session_id = 'bad/id'; }, 'identity-mismatch'],
    ['null-id', p => { p.id = null; }, 'identity-mismatch'],
    ['long-id', p => { p.id = 'a'.repeat(129); }, 'identity-mismatch'],
    ['missing-id', p => { delete p.id; }, 'identity-missing'],
    ['equal-aliases', p => { p.session_id = p.id; }, 'read'],
  ]) await fixture(name, reason, async f => { edit(f.rows[0].payload); await f.save(); });
  await fixture('repeated-equal-id', 'read', async f => { f.rows.splice(1, 0, structuredClone(f.rows[0])); await f.save(); });
  await fixture('repeated-conflicting-id', 'identity-mismatch', async f => { const r = structuredClone(f.rows[0]); r.payload.id = 'other'; f.rows.splice(1, 0, r); await f.save(); });
  await fixture('turn-context-only', 'identity-missing', async f => { f.rows.shift(); f.rows[0].payload.turn_id = 'native-1'; await f.save(); });
  await fixture('no-session-cwd-proof', 'scope-unverified', async f => { delete f.rows[0].payload.cwd; await f.save(); });
  await fixture('null-cwd', 'scope-unverified', async f => { f.rows[1].payload.cwd = null; await f.save(); });
  await fixture('unresolvable-cwd', 'scope-unverified', async f => { f.rows[1].payload.cwd = join(f.worktree, 'missing'); await f.save(); });
  await fixture('relative-cwd', 'scope-unverified', async f => { f.rows[0].payload.cwd = '.'; await f.save(); });
  await fixture('outside-session-cwd', 'scope-mismatch', async f => { f.rows[0].payload.cwd = f.root; await f.save(); });
  await fixture('outside-turn-cwd', 'scope-mismatch', async f => { f.rows[1].payload.cwd = f.root; await f.save(); });
  await fixture('repeated-session-outside-cwd', 'scope-mismatch', async f => { const r = structuredClone(f.rows[0]); r.payload.cwd = f.root; f.rows.splice(1, 0, r); await f.save(); });
  await fixture('cwd-symlink-outside', 'scope-mismatch', async f => { const p = join(f.worktree, 'linked'); await symlink(f.root, p); f.rows[1].payload.cwd = p; await f.save(); });
  await fixture('cwd-subdirectory', 'read', async f => { const p = join(f.worktree, 'nested'); await mkdir(p); f.rows[1].payload.cwd = p; await f.save(); });
  await fixture('linked-worktree-common-directory-outside', 'read', async f => {
    const env = {PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
    execFileSync('git', ['-C', f.worktree, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--quiet', '-m', 'synthetic'], {env,stdio:'pipe'});
    const linked = join(f.base, 'linked-worktree');
    execFileSync('git', ['-C', f.worktree, 'worktree', 'add', '--quiet', '--detach', linked], {env,stdio:'pipe'});
    f.worktree = linked; f.d.worktree = linked;
    f.rows[0].payload.cwd = linked; f.rows[1].payload.cwd = linked; await f.save();
  });
  await fixture('source-symlink-inside', 'read', async f => { const target = join(f.root, 'target.jsonl'); await rename(f.d.source.file, target); await symlink(target, f.d.source.file); });
  await fixture('source-symlink-outside', 'scope-mismatch', async f => { const p = join(f.base, 'outside.jsonl'); await rename(f.d.source.file, p); await symlink(p, f.d.source.file); });
  await fixture('wrong-common-directory', 'scope-mismatch', async f => { f.d.gitCommonDirectory = f.root; await f.save(); });
  await fixture('deleted-worktree', 'scope-unverified', async f => { await rm(f.worktree, { recursive: true }); });
  await fixture('missing-source-root', 'scope-unverified', async f => { f.d.source.root = join(f.base, 'missing'); await f.save(); });
  await fixture('source-missing', 'source-missing', async f => { await rm(f.d.source.file); });
  await fixture('source-unreadable-directory', 'source-unreadable', async f => { await rm(f.d.source.file); await mkdir(f.d.source.file); });
  await fixture('source-too-large', 'source-too-large', async f => { await truncate(f.d.source.file, 32 * 1024 * 1024 + 1); });
  await fixture('line-too-large', 'source-too-large', async f => { await writeFile(f.d.source.file, '{bad\n' + ' '.repeat(1024 * 1024 + 1)); });
  await fixture('malformed-tail', 'malformed-record', async f => { await writeFile(f.d.source.file, await readFile(f.d.source.file, 'utf8') + '{"private":"' + CANARY); });
  await fixture('array-line', 'malformed-record', async f => { f.rows.push([]); await f.save(); });
  await fixture('non-object-payload', 'malformed-record', async f => { f.rows[0].payload = null; await f.save(); });
  await fixture('unknown-envelope', 'unknown-envelope', async f => { f.rows[0].type = 'future-envelope'; await f.save(); });
  await fixture('unknown-payload-neutral', 'read', async f => { f.rows.push(row('event_msg', { type: 'future-kind', message: CANARY }, 5)); await f.save(); });
  await fixture('malformed-before-identity-precedence', 'malformed-record', async f => { f.rows[0].payload.id = 'wrong'; f.rows.push(null); await f.save(); });
  for (const [name, timestamp] of [['missing', undefined], ['impossible', '2026-02-30T00:00:00.000Z'], ['backward', T(0)], ['no-milliseconds', '2026-09-01T00:00:04Z']]) {
    await fixture(`timestamp-${name}`, 'invalid-timestamp', async f => { f.rows[4].timestamp = timestamp; await f.save(); });
  }
  for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '11']) await fixture(`invalid-count-${String(count)}`, 'invalid-evidence', async f => { f.rows[2].payload.info.total_token_usage.input_tokens = count; await f.save(); });
  await fixture('invalid-identity-label', 'invalid-evidence', async f => { f.rows[1].payload.model = 'synthetic private prose'; await f.save(); });
  await fixture('no-accounting-no-identity-no-terminal', 'read', async f => { delete f.rows[0].payload.model_provider; f.rows.splice(1); await f.save(); }, o => {
    assert.equal(o.run.usage, null); assert.deepEqual(o.run.identity, { provider: null, model: null, effort: null }); assert.deepEqual(o.run.execution, { status: 'unknown', observedAt: null });
  });
  const skew = await setup();
  const skewed = check(await collect(skew.descriptorPath, {now: () => '2020-01-01T00:00:00.000Z'}), 'read', skew);
  assert.ok(skewed.run.lastObservedAt > skewed.capturedAt); passed.push('source-clock-skew-does-not-imply-freshness');
  await fixture('last-token-usage-not-accounting', 'read', async f => { f.rows[2].payload.info = {last_token_usage: {input_tokens: 100}}; await f.save(); }, o => assert.equal(o.run.usage, null));
  await fixture('accounting-cumulative-not-summed', 'read', async f => { f.rows.push(row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 20 } } }, 5)); await f.save(); }, o => assert.deepEqual(o.run.usage, { observedAt: T(5), inputTokens: 20 }));
  await fixture('response-item-cannot-supply-accounting-or-completion', 'read', async f => { f.rows[2].type = 'response_item'; f.rows[4].type = 'response_item'; await f.save(); }, o => { assert.equal(o.run.usage, null); assert.equal(o.run.execution.status, 'unknown'); });
  await fixture('terminal-then-start-reset', 'read', async f => { f.rows.push(row('event_msg', { type: 'task_started' }, 5)); await f.save(); }, o => assert.deepEqual(o.run.execution, { status: 'unknown', observedAt: null }));
  for (const type of ['error', 'stream_error', 'turn_aborted']) await fixture(`execution-${type}`, 'read', async f => { f.rows[4].payload.type = type; await f.save(); }, o => assert.deepEqual(o.run.execution, { status: 'source-reported-error', observedAt: T(4) }));
  await fixture('nested-model-effort', 'read', async f => { f.rows[3].payload.collaboration_mode = { settings: { model: 'synthetic/nested', reasoning_effort: 'high' } }; await f.save(); }, o => { assert.equal(o.run.identity.model.value, 'synthetic/nested'); assert.equal(o.run.identity.effort.observedAt, T(3)); });

  const world = f => row('world_state', { full: true, state: { environments: { environments: {
    [CANARY]: { cwd: f.worktree, instructions: CANARY, model: CANARY, settings: {effort: CANARY} },
  } } }, timestamp: CANARY, instructions: CANARY }, 5);
  const token = () => row('token_usage_record', { thread_id: 'native-1', session_id: 'native-1',
    usage: { input_tokens: 9000 }, thread_token_usage: CANARY, turn_token_usage: {input_tokens:-1},
    turn_id: CANARY, root_turn_id: CANARY, response_id: CANARY, timestamp: CANARY }, 6);
  await fixture('world-state-full-and-token-corroboration', 'read', async f => { f.rows.push(world(f), token()); await f.save(); }, o => {
    assert.equal(o.run.lastObservedAt, T(6)); assert.equal(o.run.identity.provider.observedAt, T(0));
    assert.equal(o.run.identity.model.observedAt, T(3)); assert.equal(o.run.identity.effort.observedAt, T(1));
    assert.equal(o.run.usage.observedAt, T(2)); assert.equal(o.run.usage.inputTokens, 11); assert.equal(o.run.execution.observedAt, T(4));
  });
  for (const [name, mutate, reason] of [
    ['outside', (p,f) => {p.state.environments.environments[CANARY].cwd=f.root;}, 'scope-mismatch'],
    ['unresolved', (p,f) => {p.state.environments.environments[CANARY].cwd=join(f.worktree,'missing');}, 'scope-unverified'],
    ['missing-cwd', p => {delete p.state.environments.environments[CANARY].cwd;}, 'invalid-evidence'],
    ['relative-cwd', p => {p.state.environments.environments[CANARY].cwd='relative';}, 'invalid-evidence'],
    ['null-cwd', p => {p.state.environments.environments[CANARY].cwd=null;}, 'invalid-evidence'],
    ['empty-cwd', p => {p.state.environments.environments[CANARY].cwd='';}, 'invalid-evidence'],
    ['non-object-record', p => {p.state.environments.environments[CANARY]=[];}, 'invalid-evidence'],
    ['missing-state', p => {delete p.state;}, 'invalid-evidence'],
    ['missing-environments', p => {delete p.state.environments;}, 'invalid-evidence'],
    ['missing-map', p => {delete p.state.environments.environments;}, 'invalid-evidence'],
    ['array-map', p => {p.state.environments.environments=[];}, 'invalid-evidence'],
    ['empty-map', p => {p.state.environments.environments={};}, 'invalid-evidence'],
    ['partial', p => {p.full=false;}, 'invalid-evidence'],
    ['nonboolean-full', p => {p.full='true';}, 'invalid-evidence'],
    ['mixed-invalid-and-outside', (p,f) => {p.state.environments.environments.bad=null;p.state.environments.environments[CANARY].cwd=f.root;}, 'scope-mismatch'],
  ]) await fixture(`world-state-${name}`, reason, async f => {const r=world(f);mutate(r.payload,f);f.rows.push(r);await f.save();});
  await fixture('world-state-null-payload', 'invalid-evidence', async f => {f.rows.push(row('world_state',null,5));await f.save();});
  await fixture('world-state-symlink-outside', 'scope-mismatch', async f => {const p=join(f.worktree,'world-link');await symlink(f.root,p);const r=world(f);r.payload.state.environments.environments[CANARY].cwd=p;f.rows.push(r);await f.save();});
  await fixture('world-state-no-session-meta', 'identity-missing', async f => {f.rows.shift();f.rows.push(world(f));await f.save();});
  await fixture('world-state-cannot-replace-session-cwd', 'scope-unverified', async f => {delete f.rows[0].payload.cwd;f.rows.push(world(f));await f.save();});
  await fixture('world-state-invalid-timestamp', 'invalid-timestamp', async f => {const r=world(f);r.timestamp='2026-02-30T00:00:00.000Z';f.rows.push(r);await f.save();});
  for (const key of ['thread_id','session_id']) for (const value of ['wrong',undefined,null,'bad/id']) {
    await fixture(`token-record-${key}-${String(value)}`, 'identity-mismatch', async f => {const r=token();r.payload[key]=value;f.rows.push(r);await f.save();});
  }
  await fixture('token-record-only-no-session-meta', 'identity-missing', async f => {f.rows.splice(0,f.rows.length,token());await f.save();});
  await fixture('token-record-null-payload', 'identity-mismatch', async f => {f.rows.push(row('token_usage_record',null,6));await f.save();});
  await fixture('token-record-no-supported-accounting', 'read', async f => {f.rows.splice(2,1);f.rows.push(token());await f.save();}, o => assert.equal(o.run.usage,null));
  await fixture('token-record-total-ignore-guard', 'read', async f => {const r=token();r.payload.type='task_started';r.payload.model=CANARY;r.payload.cwd=CANARY;r.payload.info={total_token_usage:{input_tokens:10000}};f.rows.push(r);await f.save();}, o => {assert.equal(o.run.usage.inputTokens,11);assert.equal(o.run.execution.status,'source-reported-complete');});
  await fixture('token-record-backwards-timestamp', 'invalid-timestamp', async f => {const r=token();r.timestamp=T(0);f.rows.push(r);await f.save();});
  await fixture('supplemental-third-envelope-refused', 'unknown-envelope', async f => {f.rows.push(world(f),token(),row('third_supplemental',{},7));await f.save();});

  // Same native ID in two stores belongs to distinct tuples; stale results retain original binding.
  const storeB = await setup(); storeB.d.binding.sourceScopeId = 'store-b'; await storeB.save();
  const b = check(await collect(storeB.descriptorPath), 'read', storeB);
  const tuple = o => [o.binding.namespace, o.binding.sourceScopeId, o.run.source, o.run.nativeId];
  assert.notDeepEqual(tuple(initial.o), tuple(b));
  const matches = (o, enrolled) => ['namespace', 'id', 'revision', 'sourceScopeId'].every(k => o.binding[k] === enrolled[k]);
  const enrolledB = { ...b.binding, revision: 'r2' };
  const delayed = await setup();
  let activeEnrollment = delayed.d.binding, rebound = false;
  const delayedA = await collect(delayed.descriptorPath, {checkpoint: async point => {
    if (point === 'source-read') { activeEnrollment = enrolledB; rebound = true; }
  }});
  assert.equal(rebound, true); check(delayedA, 'read', delayed);
  const persisted = [];
  if (matches(delayedA, activeEnrollment)) persisted.push(delayedA);
  assert.equal(persisted.length, 0); assert.equal(delayedA.binding.revision, 'r1');
  const collision = structuredClone(initial.o); collision.run.source = 'other'; assert.equal(decode(collision).ok, false);
  collision.run.source = 'codex'; collision.schema = 2; assert.equal(decode(collision).ok, false);
  passed.push('store-collision-and-delayed-A-carrier-fence');
  const rejected = value => assert.equal(decode(value).ok, false, 'strict installed decoder accepted invalid input');
  for (const path of [[], ['binding'], ['binding','repo'], ['coverage'], ['verification'], ['run'], ['run','identity'], ['run','identity','model'], ['run','usage'], ['run','execution'], ['run','relationships']]) {
    const v = structuredClone(initial.o); const target = path.reduce((o,k) => o[k], v); target.extra = CANARY; rejected(v);
  }
  for (const change of [
    v => {v.run.usage.inputTokens = Infinity;}, v => {v.run.usage.inputTokens = NaN;},
    v => {v.capturedAt = '2026-02-30T00:00:00.000Z';}, v => {v.verification = null;},
    v => {v.coverage.reason = 'future-reason';}, v => {v.run.nativeId = 'bad/id';},
    v => {v.binding.sourceScopeId = 'a'.repeat(129);}, v => {v.run.execution.observedAt = null;},
    v => {v.run.usage.observedAt = '2020-01-01T00:00:00.000Z';},
  ]) {const v = structuredClone(initial.o); change(v); rejected(v);}
  let invoked = false;
  const accessor = structuredClone(initial.o); Object.defineProperty(accessor, 'run', {get() {invoked = true; throw new Error(CANARY);}});
  rejected(accessor); assert.equal(invoked, false);
  passed.push('installed-strict-decoder-negative-matrix');


  // Actions are serialized into a temp-only CLI harness, which calls the actual CLI main with the
  // same in-process checkpoint seam. No environment/flag test backdoor is shipped.
  const races = [
    ['opened-source-appended', 'source-changed', 'source-opened', async f => { await writeFile(f.d.source.file, '\n', { flag: 'a' }); }],
    ['opened-source-replaced', 'source-changed', 'source-opened', async f => { const bytes = await readFile(f.d.source.file); await rename(f.d.source.file, f.d.source.file + '.old'); await writeFile(f.d.source.file, bytes); }],
    ['opened-source-truncated', 'source-changed', 'source-opened', async f => { await writeFile(f.d.source.file, ''); }],
    ['descriptor-revision', 'binding-changed', 'descriptor-snapshotted', async f => { const d = structuredClone(f.d); d.binding.revision = 'r2'; await writeFile(f.descriptorPath, JSON.stringify(d)); }],
    ['descriptor-replaced-same-bytes', 'binding-changed', 'source-read', async f => { await rename(f.descriptorPath, f.descriptorPath + '.old'); await writeFile(f.descriptorPath, JSON.stringify(f.d)); }],
    ['descriptor-deleted', 'binding-changed', 'source-read', async f => { await rm(f.descriptorPath); }],
    ['source-appended', 'source-changed', 'source-read', async f => { await writeFile(f.d.source.file, '\n', { flag: 'a' }); }],
    ['source-replaced', 'source-changed', 'source-read', async f => { const bytes = await readFile(f.d.source.file); await rename(f.d.source.file, f.d.source.file + '.old'); await writeFile(f.d.source.file, bytes); }],
    ['source-deleted', 'source-changed', 'source-read', async f => { await rm(f.d.source.file); }],
    ['root-replaced', 'binding-changed', 'source-read', async f => { await rename(f.root, f.root + '.old'); await mkdir(f.root); await writeFile(f.d.source.file, await readFile(join(f.root + '.old', 'selected.jsonl'))); }],
    ['worktree-replaced', 'binding-changed', 'source-read', async f => { await rename(f.worktree, f.worktree + '.old'); git(f.worktree); }],
    ['common-directory-replaced', 'binding-changed', 'source-read', async f => { await rename(f.d.gitCommonDirectory, f.d.gitCommonDirectory + '.old'); git(f.worktree); }],
    ['git-association-changed', 'binding-changed', 'before-final-checks', async f => { await rename(f.d.gitCommonDirectory, f.d.gitCommonDirectory + '.old'); await writeFile(f.d.gitCommonDirectory, 'gitdir: ' + join(f.base, 'absent') + '\n'); }],
  ];
  for (const [name, reason, point, action] of races) {
    const f = await setup(); let invoked = 0;
    const o = await collect(f.descriptorPath, { checkpoint: async p => { if (p === point) { invoked++; await action(f); } } });
    assert.equal(invoked, 1); check(o, reason, f);
    if (raceCli) {
      const f2 = await setup();
      const result = await raceCli(f2, point, action.toString());
      assert.equal(result.code, 3, name); assert.equal(result.stderr, '', name); check(JSON.parse(result.stdout), reason, f2);
    }
    passed.push(`race-${name}`);
  }
  const invalid = await setup();
  for (const mutate of [d => { d.binding.namespace = 'bad/id'; }, d => { d.source.nativeId = 'bad/id'; }, d => { d.source.root = 'relative'; }, d => { d.extra = CANARY; }, d => { d.binding.repo.owner = 'bad/name'; }]) {
    const d = structuredClone(invalid.d); mutate(d); await writeFile(invalid.descriptorPath, JSON.stringify(d));
    const output = await cli(invalid.descriptorPath);
    assert.equal(output.code, 1); assert.equal(output.stdout, ''); assert.equal(output.stderr, 'run-observation: invalid descriptor or collection failed\n');
  }
  await writeFile(invalid.descriptorPath, ' '.repeat(64 * 1024 + 1));
  const oversize = await cli(invalid.descriptorPath); assert.equal(oversize.code, 1); assert.equal(oversize.stdout, '');
  passed.push('invalid-descriptor-fixed-output');
  const required = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(passed, required, 'a required synthetic fixture is missing or unexecuted');
  return passed;
}
