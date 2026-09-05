/**
 * The two rules every seam shares: a line that is not an object is not a record, and a line this
 * package declined to read is counted rather than forgotten.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isoFromMillis,
  MAX_TIME_MS,
  NoteTally,
  NOT_AN_OBJECT,
  NOT_JSON,
  parseLine,
  parseLineWithReason,
  typeLabel,
} from "./jsonl.js";

describe("parseLine", () => {
  it("reads a JSON object", () => {
    assert.deepEqual(parseLine('{"type":"user","n":1}'), { type: "user", n: 1 });
  });

  it("refuses every JSON value that is not an object", () => {
    // Finding F-4 on #105: `JSON.parse` returns all of these happily, and a parser that casts the
    // result to its record interface throws a TypeError on the first one — which took down all
    // three seams from a single line in a single file.
    for (const raw of ["null", "7", '"x"', "[]", "[1,2]", "true"]) {
      assert.equal(parseLine(raw), null, `${raw} was accepted as a record`);
    }
  });

  it("refuses text that is not JSON at all", () => {
    assert.equal(parseLine('{"half":'), null);
    assert.equal(parseLine("not json"), null);
  });

  it("tells the two failures apart, because they mean different things", () => {
    // A truncated tail is the normal state of a live transcript. A `null` record is a file that
    // does not say what it claims to say. An operator reading a note deserves to know which.
    assert.equal(parseLineWithReason('{"half":').reason, NOT_JSON);
    assert.equal(parseLineWithReason("null").reason, NOT_AN_OBJECT);
    assert.equal(parseLineWithReason("{}").reason, null);
  });
});

describe("isoFromMillis", () => {
  it("converts a real timestamp", () => {
    assert.equal(isoFromMillis(1_788_566_400_000), "2026-09-05T00:00:00.000Z");
  });

  it("returns null rather than throwing for a value too large to be a date", () => {
    // `new Date(1e20).toISOString()` throws a RangeError. The value arrives from a file this
    // package does not write, so one absurd number would otherwise end the whole scan.
    assert.equal(isoFromMillis(MAX_TIME_MS + 1), null);
    assert.equal(isoFromMillis(1e20), null);
    assert.equal(isoFromMillis(Number.MAX_VALUE), null);
  });

  it("accepts the last millisecond Date represents", () => {
    assert.equal(isoFromMillis(MAX_TIME_MS), new Date(MAX_TIME_MS).toISOString());
  });

  it("returns null for a missing value rather than a moment in 1970", () => {
    for (const bad of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1", {}]) {
      assert.equal(isoFromMillis(bad), null, `${String(bad)} produced a date`);
    }
  });
});

describe("NoteTally", () => {
  it("counts lines per reason", () => {
    const tally = new NoteTally();
    tally.bump("a");
    tally.bump("b");
    tally.bump("a");
    assert.deepEqual(tally.notes(), [
      { reason: "a", lines: 2 },
      { reason: "b", lines: 1 },
    ]);
  });

  it("orders notes by reason, so the same transcript reports the same way twice", () => {
    const forward = new NoteTally();
    const backward = new NoteTally();
    for (const r of ["z", "a", "m"]) forward.bump(r);
    for (const r of ["m", "a", "z"]) backward.bump(r);
    assert.deepEqual(forward.notes(), backward.notes());
  });

  it("says nothing when nothing degraded", () => {
    assert.deepEqual(new NoteTally().notes(), []);
  });
});

describe("typeLabel", () => {
  it("passes a schema token through untouched", () => {
    assert.equal(typeLabel("response_item"), "response_item");
    assert.equal(typeLabel("custom-title"), "custom-title");
  });

  it("bounds a type field that is carrying something else", () => {
    // The value comes from a file this package does not write and the note may be published, so
    // neither its length nor its alphabet is the file's decision.
    const label = typeLabel(`x${"y".repeat(200)}`);
    assert.equal(label.length, 40);
    assert.equal(typeLabel("hello world\nsecret: value"), "hello?world?secret:?value");
  });

  it("names the absence rather than printing undefined", () => {
    assert.equal(typeLabel(undefined), "(absent)");
    assert.equal(typeLabel(7), "(not a string)");
    assert.equal(typeLabel(""), "(empty)");
  });
});
