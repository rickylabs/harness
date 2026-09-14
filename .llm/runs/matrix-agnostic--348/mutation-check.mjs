/** Run after building routing. Mutate ignored compiled files only; always restore their exact bytes. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = 'packages/routing/dist/';
const mutations = [
  ['router syntax', 'schema.js', 'routers.forEach((r, i) => str(r, `routers[${i}]`, /^[a-z0-9][a-z0-9_.-]*$/));', ''],
  ['model display fields', 'schema.js', 'str(m[key], `${at}.${key}`);', 'void 0;'],
  ['trigger registration', 'schema.js', 'strings(s.when, `${stepAt}.when`, false, triggers);', 'strings(s.when, `${stepAt}.when`, false);'],
  ['alias collision', 'schema.js', 'if (laneNames.includes(key))', 'if (false)'],
  ['alias target', 'schema.js', 'ref(target, at, laneNames);', 'void 0;'],
  ['alias syntax', 'schema.js', 'str(key, at, /^[a-z][a-z0-9_]*$/);', 'void 0;'],
  ['role syntax', 'schema.js', 'str(key, path, /^[a-z][a-z0-9_]*$/);', 'void 0;'],
  ['role reference', 'schema.js', 'ref(binding, path, laneNames);', 'void 0;'],
  ['implementation required', 'schema.js', 'if (t.implementation === undefined && t.implement === undefined)', 'if (false)'],
  ['evaluator required', 'schema.js', 'if (t.implementation_evaluation === undefined && t.review === undefined)', 'if (false)'],
  ['ambiguous implementation', 'schema.js', 'if (t.implementation !== undefined && t.implement !== undefined && t.implementation !== t.implement)', 'if (false)'],
  ['opposite-family coverage', 'resolve.js', 'familyOf(configuration, candidate.route.model) !== family &&', 'true &&'],
  ['author-relative any resolution', 'resolve.js', 'if (certifies !== undefined && certifies !== "none" && familyOf(configuration, step.route.model) === authorFamily)', 'if (false)'],
  ['implementation role purpose', 'resolve.js', 'if (generator?.purpose !== "implementation")', 'if (false)'],
  ['evaluation role purpose', 'resolve.js', 'if (evaluator?.purpose !== "evaluation")', 'if (false)'],
  ['plan requires generator', 'resolve.js', 'problems.push({ code: "evaluation-without-generator", lane: `tiers[${i}]` });', 'void 0;'],
  ['formal evaluator coverage', 'resolve.js', 'pair(implementation, tierRoleLane(configuration, tier.tier, "implementation_evaluation"));', 'void 0;'],
  ['plan evaluator coverage', 'resolve.js', 'pair(tierRoleLane(configuration, tier.tier, "plan"), tierRoleLane(configuration, tier.tier, "plan_evaluation"));', 'void 0;'],
  ['orphan implementation', 'resolve.js', 'if (lane.purpose === "implementation" && !coveredImplementations.has(lane.lane))', 'if (false)'],
];
function run() {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', root + 'agnostic.test.js'], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined, 'test process must fail, never time out');
  assert.equal(result.signal, null, 'test process must exit normally');
  return { exit: result.status, tests: Number(result.stdout.match(/# tests (\d+)/)?.[1]), failures: Number(result.stdout.match(/# fail (\d+)/)?.[1]) };
}
const control = run(); assert.equal(control.exit, 0); assert.ok(control.tests > 0);
console.log(JSON.stringify({ control }));
for (const [name, file, from, to] of mutations) {
  const path = root + file; const original = readFileSync(path, 'utf8');
  assert.equal(original.split(from).length - 1, 1, `${name}: unique mutation target`);
  let broken;
  try { writeFileSync(path, original.replace(from, to)); broken = run(); }
  finally { writeFileSync(path, original); }
  const restored = run();
  assert.notEqual(broken.exit, 0, `${name}: mutant survived`);
  assert.ok(broken.failures > 0, `${name}: no failing assertions`);
  assert.equal(restored.exit, 0, `${name}: restore failed`);
  console.log(JSON.stringify({ name, broken, restored }));
}
