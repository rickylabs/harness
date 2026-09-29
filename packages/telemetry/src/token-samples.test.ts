import assert from "node:assert/strict";
import { it } from "node:test";
import { MAX_TOKEN_SAMPLES, TokenSampleCollector } from "./token-samples.js";

it("keeps the first and latest fifteen native cumulative samples without summing them", () => {
  const samples = new TokenSampleCollector();
  for (let second = 0; second < 20; second++) {
    samples.observe(`2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`, second + 1, second + 2);
  }
  const result = samples.snapshot();
  assert.equal(result.points.length, MAX_TOKEN_SAMPLES);
  assert.equal(result.truncated, true);
  assert.equal(result.invalid, false);
  assert.equal(result.points[0]?.usedTokens, 3);
  assert.equal(result.points[1]?.usedTokens, 13);
  assert.equal(result.points.at(-1)?.usedTokens, 41);
});

it("normalizes native nanoseconds and coalesces equal millisecond samples", () => {
  const samples = new TokenSampleCollector();
  samples.observe("2026-01-01T00:00:00.123456789Z", 5, 2);
  samples.observe("2026-01-01T00:00:00.123999999Z", 6, 2);
  assert.deepEqual(samples.snapshot().points, [{ at: "2026-01-01T00:00:00.123Z", usedTokens: 8 }]);
});

it("refuses missing, unsafe, decreasing and invalid source samples rather than making zeroes", () => {
  for (const [when, input, output] of [
    [null, 1, 1], ["2026-02-30T00:00:00.000Z", 1, 1],
    ["2026-01-01T00:00:01.000Z", undefined, 1],
    ["2026-01-01T00:00:01.000Z", Number.MAX_SAFE_INTEGER, 1],
    ["2026-01-01T00:00:01.000Z", 1.5, 1],
  ] as const) {
    const samples = new TokenSampleCollector();
    samples.observe(when, input, output);
    assert.deepEqual(samples.snapshot(), { points: [], truncated: false, invalid: true });
  }
  const decreasing = new TokenSampleCollector();
  decreasing.observe("2026-01-01T00:00:00.000Z", 5, 5);
  decreasing.observe("2026-01-01T00:00:01.000Z", 4, 5);
  assert.equal(decreasing.snapshot().invalid, true);
  const backwards = new TokenSampleCollector();
  backwards.observe("2026-01-01T00:00:01.000Z", 1, 1);
  backwards.observe("2026-01-01T00:00:00.000Z", 2, 1);
  assert.equal(backwards.snapshot().invalid, true);
});
