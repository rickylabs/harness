import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from './check-compiled-policy.mjs';
const ids = new Set(['vendor/native-engine-v9', 'engine_v9']);
test('model identities cannot hide in aliases, arrays, computed keys or defaults', () => {
  for (const source of [
    'export const REVIEWER = "vendor/native-engine-v9";',
    'export const seats = ["engine_v9"];',
    'export const lookups = { ["vendor/native-engine-v9"]: true };',
    'export function pick(model = "vendor/native-engine-v9") { return model; }',
    'export const newSeat = "vendor/future-engine-v99";',
    'export const route = { model: "never-seen-here" };',
    'export function pick(modelId = "brand-new-seat") { return modelId; }',
    'export class Client { model = "brand-new-seat"; }',
  ]) assert.ok(scan('packages/routing/src/new.ts', source, [], ids).length > 0, source);
});
test('configuration, fixtures, comments and observed identities stay data', () => {
  for (const file of ['packages/routing/config/settings.ts', 'packages/routing/src/fixtures/data.ts', 'packages/routing/src/discovery.test.ts']) {
    assert.deepEqual(scan(file, 'export const seat = "vendor/native-engine-v9";', [], ids), []);
  }
  assert.deepEqual(scan('packages/routing/src/new.ts', '// "vendor/native-engine-v9"\nexport const route = { model: observed.id };', [], ids), []);
  assert.deepEqual(scan('packages/routing/src/new.ts', 'export const method = "model/list";', [], ids), []);
});
