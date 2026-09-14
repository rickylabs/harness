/** Prove the full suite does not own the live matrix. Always restore exact document bytes. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const path = 'packages/routing/config/routing.v1.json';
const original = readFileSync(path, 'utf8');
const c = JSON.parse(original);
const map = (values, prefix) => new Map(values.map((v, i) => [v, `${prefix}-${i}`]));
const models = map(Object.keys(c.models), 'replacement-model');
const families = map(c.families, 'replacement-family');
const efforts = map([...c.efforts.ordered, ...(c.efforts.unordered ?? [])], 'replacement-effort');
const routers = map(c.routers, 'replacement-router');
const triggers = map(c.triggers, 'replacement-trigger');
c.models = Object.fromEntries(Object.entries(c.models).map(([id, model]) => [models.get(id), { ...model, family: families.get(model.family) }]));
c.families = c.families.map(v => families.get(v));
c.efforts.ordered = c.efforts.ordered.map(v => efforts.get(v));
if (c.efforts.unordered) c.efforts.unordered = c.efforts.unordered.map(v => efforts.get(v));
c.routers = c.routers.map(v => routers.get(v)); c.triggers = c.triggers.map(v => triggers.get(v));
for (const lane of c.lanes) for (const step of lane.chain) {
  step.route.model = models.get(step.route.model); step.route.effort = efforts.get(step.route.effort);
  if (step.route.router) step.route.router = routers.get(step.route.router);
  if (families.has(step.certifies)) step.certifies = families.get(step.certifies);
  step.when = step.when.map(v => triggers.get(v));
  for (const escalation of step.effortEscalations ?? []) escalation.effort = efforts.get(escalation.effort);
}
for (const constraint of Object.values(c.constraints)) {
  if (constraint.models) constraint.models = constraint.models.map(v => models.get(v));
  if (constraint.families) constraint.families = constraint.families.map(v => families.get(v));
}
for (const placement of c.placements.entries) placement.model = models.get(placement.model);
let result;
try {
  writeFileSync(path, JSON.stringify(c, null, 2) + '\n');
  result = spawnSync('pnpm', ['--filter', '@rickylabs/routing', '--filter', '@rickylabs/coordinator', '--filter', '@rickylabs/telemetry', '--filter', '@rickylabs/llm-local', '--filter', '@rickylabs/dsh-app', 'test'], { encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
} finally { writeFileSync(path, original); }
assert.equal(readFileSync(path, 'utf8'), original, 'restore exact bytes');
assert.equal(result.error, undefined, 'test command must not time out');
assert.equal(result.signal, null);
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'policy substitution must stay green');
console.log('All live model/family/effort/router/trigger IDs replaced: PASS. Original bytes restored.');
