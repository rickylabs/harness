import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_REASONING_BUDGET,
  clampToFloor,
  isReasoningBudget,
  reasoningBudget,
} from "./budget.js";

describe("the token budget floor", () => {
  it("accepts the floor itself and anything above it", () => {
    for (const proposed of [MIN_REASONING_BUDGET, MIN_REASONING_BUDGET + 1, 4096, 128_000]) {
      const verdict = reasoningBudget(proposed);
      assert.equal(verdict.ok, true, String(proposed));
      if (!verdict.ok) throw new Error("unreachable");
      assert.equal(verdict.budget, proposed);
    }
  });

  it("refuses the budget that produced an empty completion with a success status", () => {
    // The observed failure: 71 reasoning tokens consumed a 10-token ceiling in full and the call
    // returned HTTP 200 with empty content. Nothing anywhere reported an error.
    const verdict = reasoningBudget(10);
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.reason, "below-floor");
    assert.equal(verdict.message.includes("300"), true);
  });

  it("refuses everything under the floor, including zero and negatives", () => {
    for (const proposed of [MIN_REASONING_BUDGET - 1, 299, 1, 0, -1, -4096]) {
      assert.equal(isReasoningBudget(proposed), false, String(proposed));
    }
  });

  it("refuses a budget that would reach the wire as `null`", () => {
    // NaN serialises to null, and some servers read a null ceiling as "no limit". A budget that
    // silently becomes unlimited is a spend incident, so it is refused at the same door.
    for (const proposed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const verdict = reasoningBudget(proposed);
      assert.equal(verdict.ok, false, String(proposed));
      if (verdict.ok) throw new Error("unreachable");
      assert.equal(verdict.reason, "not-finite");
    }
  });

  it("refuses a fractional ceiling rather than rounding one into existence", () => {
    const verdict = reasoningBudget(4096.5);
    assert.equal(verdict.ok, false);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.reason, "not-an-integer");
  });

  it("returns a verdict rather than throwing, for every input", () => {
    // Refusing a budget is an ordinary outcome of asking. A caller deciding what to do about it is
    // not exception handling.
    for (const proposed of [-1, 0, 10, 299.5, Number.NaN, 300, 1e9]) {
      assert.doesNotThrow(() => reasoningBudget(proposed));
    }
  });

  it("says why, in terms that name the failure rather than the rule", () => {
    const verdict = reasoningBudget(42);
    if (verdict.ok) throw new Error("unreachable");
    assert.equal(verdict.message.includes("empty completion"), true);
  });
});

describe("clampToFloor", () => {
  it("raises anything unacceptable to the floor", () => {
    assert.equal(clampToFloor(0), MIN_REASONING_BUDGET);
    assert.equal(clampToFloor(-9), MIN_REASONING_BUDGET);
    assert.equal(clampToFloor(299), MIN_REASONING_BUDGET);
    assert.equal(clampToFloor(Number.NaN), MIN_REASONING_BUDGET);
    assert.equal(clampToFloor(12.5), MIN_REASONING_BUDGET);
  });

  it("leaves an acceptable budget alone", () => {
    assert.equal(clampToFloor(MIN_REASONING_BUDGET), MIN_REASONING_BUDGET);
    assert.equal(clampToFloor(8192), 8192);
  });

  it("always produces something the constructor would accept", () => {
    for (const proposed of [-1, 0, 10, 299, 300, 301, Number.NaN, 12.5, 1e6]) {
      assert.equal(isReasoningBudget(clampToFloor(proposed)), true, String(proposed));
    }
  });
});
