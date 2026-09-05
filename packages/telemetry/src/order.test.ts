import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareNullableStrings, compareStrings } from "./order.js";

describe("compareStrings", () => {
  it("orders by code unit, which is the same order on every host", () => {
    // The counterexample from finding F-6 on #105, verbatim: these two keys sort ["ä","z"] under
    // en_US.UTF-8 and ["z","ä"] under sv_SE.UTF-8, so a snapshot ordered by the host's default
    // collation changes its bytes when LANG changes and nothing else does.
    //
    // "ä" is U+00E4, above "z" (U+007A) in code-unit order, so this assertion is the sv_SE answer
    // rather than the en_US one. That is the point: the answer is a property of the strings, and it
    // does not become the other answer on the reviewer's machine.
    assert.deepEqual(["ä", "z"].slice().sort(compareStrings), ["z", "ä"]);
    assert.equal(compareStrings("ä", "z"), 1);
    assert.equal(compareStrings("z", "ä"), -1);
  });

  it("does not agree with the host collation, which is how we know it is not reading it", () => {
    // If this ever starts agreeing on this pair, either the runtime's default collation changed or
    // someone put localeCompare back. Both are worth a failing test.
    assert.notEqual(Math.sign(compareStrings("ä", "z")), Math.sign("ä".localeCompare("z")));
  });

  it("is total, reflexive and antisymmetric", () => {
    const corpus = ["", "a", "A", "z", "ä", "é", "0", "9", "_", "e6", "e10", "e2", "🙂", " "];
    for (const a of corpus) {
      assert.equal(compareStrings(a, a), 0);
      for (const b of corpus) {
        // Summed rather than negated: `assert.equal` is `Object.is`, under which `-0` is not `0`.
        assert.equal(compareStrings(a, b) + compareStrings(b, a), 0, `${a} vs ${b}`);
      }
    }
  });

  it("sorts a list the same way however it arrived", () => {
    const keys = ["z", "ä", "e10", "e2", "A", "a"];
    const forward = keys.slice().sort(compareStrings);
    const backward = keys.slice().reverse().sort(compareStrings);
    assert.deepEqual(forward, backward);
  });
});

describe("compareNullableStrings", () => {
  it("puts the unknown bucket last rather than first", () => {
    // A `null` milestone is a real bucket, not an error, but it is the least informative one and
    // reading a board should not start there.
    assert.deepEqual([null, "b", "a"].slice().sort(compareNullableStrings), ["a", "b", null]);
  });

  it("treats two nulls as equal", () => {
    assert.equal(compareNullableStrings(null, null), 0);
  });
});
