import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalJson,
  differences,
  digest,
  CircularValueError,
  DIFF_PATH_CAP,
  DIGEST_LENGTH,
} from "./canonical.js";

describe("canonicalJson", () => {
  it("does not depend on the order the keys were assigned in", () => {
    // The reason this module exists. Two code paths that build the same decision must serialise to
    // the same bytes, or every replay reports drift and everybody stops reading the result.
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it("sorts nested keys too", () => {
    assert.equal(canonicalJson({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
  });

  it("drops undefined properties, the way JSON.stringify does", () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  });

  it("writes undefined inside an array as null, so positions are preserved", () => {
    assert.equal(canonicalJson([1, undefined, 3]), "[1,null,3]");
  });

  it("writes non-finite numbers as null, because JSON has no other spelling", () => {
    assert.equal(canonicalJson({ a: Number.NaN, b: Infinity, c: -Infinity }), '{"a":null,"b":null,"c":null}');
  });

  it("writes a Date as its ISO string rather than the {} a naive walk produces", () => {
    assert.equal(canonicalJson(new Date("2026-09-05T09:00:00.000Z")), '"2026-09-05T09:00:00.000Z"');
    assert.notEqual(canonicalJson(new Date(0)), "{}");
  });

  it("writes an invalid Date as null instead of throwing", () => {
    assert.equal(canonicalJson(new Date(Number.NaN)), "null");
  });

  it("keeps array order, because a plan that dispatches B before A is a different plan", () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  it("treats a value shared by two properties as data, not as a cycle", () => {
    // A DAG is ordinary — the same policy object referenced twice, say. Only a true self-reference
    // is an error, so `seen` has to be a path, not a visited set.
    const shared = { a: 1 };
    assert.equal(canonicalJson({ x: shared, y: shared }), '{"x":{"a":1},"y":{"a":1}}');
  });

  it("throws CircularValueError with the path, rather than looping", () => {
    const loop: Record<string, unknown> = { name: "root" };
    loop["self"] = loop;
    assert.throws(
      () => canonicalJson({ outer: loop }),
      (error: unknown) => error instanceof CircularValueError && /outer\.self/.test(error.message),
    );
  });

  it("treats null and a missing key as the same thing", () => {
    assert.equal(canonicalJson({ a: null }), '{"a":null}');
  });
});

describe("digest", () => {
  it("is sha256: followed by exactly DIGEST_LENGTH hex characters", () => {
    const value = digest({ a: 1 });
    assert.match(value, new RegExp(`^sha256:[0-9a-f]{${String(DIGEST_LENGTH)}}$`));
  });

  it("is equal for values that differ only in key order", () => {
    assert.equal(digest({ b: 1, a: 2 }), digest({ a: 2, b: 1 }));
  });

  it("differs for values that differ at all", () => {
    assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
  });
});

describe("differences", () => {
  it("is empty for values that are canonically equal", () => {
    assert.deepEqual(differences({ b: 1, a: 2 }, { a: 2, b: 1 }), []);
  });

  it("names a nested path the way somebody would say it out loud", () => {
    const before = { policy: "opposite-family", roster: { candidates: [{ id: "a" }, { id: "b", blockedBy: null }] } };
    const after = { policy: "opposite-family", roster: { candidates: [{ id: "a" }, { id: "b", blockedBy: "quota" }] } };
    assert.deepEqual(differences(before, after), ["roster.candidates[1].blockedBy"]);
  });

  it("names an added or removed key rather than the object holding it", () => {
    assert.deepEqual(differences({ a: 1 }, { a: 1, b: 2 }), ["b"]);
    assert.deepEqual(differences({ a: 1, b: 2 }, { a: 1 }), ["b"]);
  });

  it("names the index when an array grows or shrinks", () => {
    assert.deepEqual(differences([1, 2], [1, 2, 3]), ["[2]"]);
  });

  it("says so plainly when the whole value changed", () => {
    assert.deepEqual(differences("before", "after"), ["(the whole value)"]);
  });

  it("does not descend into a value whose type changed", () => {
    // `{a: 1}` becoming `null` is one difference at `a`, not a walk over the object that is gone.
    assert.deepEqual(differences({ a: { x: 1 } }, { a: null }), ["a"]);
  });

  it("stops at DIFF_PATH_CAP so a caller can say the list was capped", () => {
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (let i = 0; i < DIFF_PATH_CAP + 8; i += 1) {
      before[`k${String(i).padStart(2, "0")}`] = 0;
      after[`k${String(i).padStart(2, "0")}`] = 1;
    }
    const found = differences(before, after);
    assert.equal(found.length, DIFF_PATH_CAP);
    assert.equal(found[0], "k00");
  });
});
