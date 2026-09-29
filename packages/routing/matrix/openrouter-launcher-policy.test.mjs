import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OPENROUTER_LAUNCHER_MODEL_IDS,
  isApprovedOpenRouterLauncherModelId,
} from './openrouter-launcher-policy.ts';

const approved = [
  'qwen/qwen3.8-flash',
  'z-ai/glm-5.3-flash',
  'z-ai/glm-5.2',
  'x-ai/grok-4.5',
];

test('launcher approval is exactly the four current OpenRouter IDs', () => {
  assert.deepEqual(Object.values(OPENROUTER_LAUNCHER_MODEL_IDS), approved);
  for (const id of approved) assert.equal(isApprovedOpenRouterLauncherModelId(id), true, id);
});

test('retired IDs remain refused even when a route catalog still knows them', () => {
  for (const id of [
    'minimax/minimax-m3',
    'deepseek/deepseek-v4-flash-0731',
    'qwen/qwen3.8-max',
  ]) assert.equal(isApprovedOpenRouterLauncherModelId(id), false, id);
});

test('unapproved new IDs remain refused pending an explicit decision', () => {
  for (const id of [
    'meta/muse-spark-1.3',
    'meta/muse-spark-1.3-contributor',
    'x-ai/grok-4.6',
    '',
  ]) assert.equal(isApprovedOpenRouterLauncherModelId(id), false, id);
});
