import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generationName, planRotation, type RotationPolicy } from "./rotation.js";

const policy = (over: Partial<RotationPolicy> = {}): RotationPolicy => ({
  name: "runs.jsonl",
  maxBytes: 100,
  maxGenerations: 3,
  ...over,
});

describe("generationName", () => {
  it("puts the generation before the extension, where a glob will still find it", () => {
    assert.equal(generationName("runs.jsonl", 0), "runs.jsonl");
    assert.equal(generationName("runs.jsonl", 2), "runs.2.jsonl");
  });

  it("handles a name with no extension and a dotfile", () => {
    assert.equal(generationName("runs", 1), "runs.1");
    assert.equal(generationName(".runs", 1), ".runs.1");
  });
});

describe("planRotation", () => {
  it("does not rotate when the record lands exactly on the bound", () => {
    // The boundary is the only interesting size. Rotating here would throw away a file that fits.
    const plan = planRotation(policy(), 60, 40);
    assert.equal(plan.rotate, false);
    assert.deepEqual(plan.renames, []);
  });

  it("rotates before the write that would breach the bound, not after", () => {
    // A bound enforced after the fact is not a bound: the file has already exceeded it.
    const plan = planRotation(policy(), 60, 41);
    assert.equal(plan.rotate, true);
  });

  it("renames oldest first, so no generation is overwritten before it has moved", () => {
    const plan = planRotation(policy(), 100, 1);
    assert.deepEqual(
      plan.renames.map((r) => `${r.from}->${r.to}`),
      ["runs.2.jsonl->runs.3.jsonl", "runs.1.jsonl->runs.2.jsonl", "runs.jsonl->runs.1.jsonl"],
    );
  });

  it("evicts the generation the first rename lands on", () => {
    // Getting this wrong loses a generation silently: .3 would be overwritten by .2 with no
    // opportunity to move it to the cold tier first.
    const plan = planRotation(policy(), 100, 1);
    assert.equal(plan.evicted, "runs.3.jsonl");
    assert.equal(plan.renames[0]?.to, plan.evicted);
  });

  it("evicts the live file itself when no generations are kept", () => {
    const plan = planRotation(policy({ maxGenerations: 0 }), 100, 1);
    assert.deepEqual(plan.renames, []);
    assert.equal(plan.evicted, "runs.jsonl");
  });

  it("flags a record larger than the whole budget rather than rotating for it", () => {
    // Rotating would produce an empty generation and still breach the bound. The caller has to
    // know that rotation is not the remedy, or it loops.
    const plan = planRotation(policy(), 0, 101);
    assert.equal(plan.oversizedRecord, true);
    assert.equal(plan.rotate, true);
  });

  it("does not flag a record that merely does not fit right now", () => {
    const plan = planRotation(policy(), 99, 50);
    assert.equal(plan.rotate, true);
    assert.equal(plan.oversizedRecord, false);
  });
});
