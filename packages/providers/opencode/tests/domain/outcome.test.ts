/**
 * The outcome union, and the split the whole provider is built on.
 *
 * The split these tests exist for is `refutes`. A `409` and a dropped connection are the same
 * JavaScript event and opposite facts, and everything downstream — whether a dispatch is `refused`
 * or `unknown`, and therefore whether `isSafeToRetry` licenses a second agent onto a branch — is
 * decided by which of the two an outcome is. A `504` is a third thing that looks like the first and
 * behaves like the second, and it has its own case below.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeOutcome, excerpt, refutes, EXCERPT_LIMIT } from "../../src/domain/outcome.js";

describe("excerpt", () => {
  it("collapses whitespace and names an empty body", () => {
    assert.equal(excerpt("  a\n\n b  "), "a b");
    assert.equal(excerpt("   "), "(empty body)");
  });

  it("truncates rather than dumping a body", () => {
    const long = excerpt("x".repeat(EXCERPT_LIMIT * 3));
    assert.equal(long.length, EXCERPT_LIMIT + 1);
    assert.ok(long.endsWith("…"));
  });
});

describe("refutes", () => {
  it("is true only for a 4xx, the one class that proves nothing ran", () => {
    assert.equal(refutes({ kind: "http", status: 400, detail: "bad model" }), true);
    assert.equal(refutes({ kind: "http", status: 409, detail: "busy" }), true);
    assert.equal(refutes({ kind: "http", status: 499, detail: "client closed" }), true);
    // Deliberate: the server responded, but what it said is unreadable, and "it did something and we
    // do not know what" is exactly what `unknown` is for.
    assert.equal(refutes({ kind: "malformed", detail: "not json" }), false);
    assert.equal(refutes({ kind: "unreachable", detail: "ECONNREFUSED" }), false);
    // Nor does success refute anything. `ok` is the caller's own branch; asking this predicate about
    // it would be asking whether a thing that happened did not happen.
    assert.equal(refutes({ kind: "ok", status: 200, body: null }), false);
  });

  it("does not treat a 5xx as a refusal, which is the whole point", () => {
    // The failure this predicate was rewritten to prevent. A gateway timeout on `prompt_async` is
    // the exact shape of *the agent started and the proxy stopped waiting*: bytes came back, and
    // they say nothing about whether the origin ran the request. Reading it as `refused` would let
    // `isSafeToRetry` put a second agent on a branch the first one is still holding.
    assert.equal(refutes({ kind: "http", status: 500, detail: "internal" }), false);
    assert.equal(refutes({ kind: "http", status: 502, detail: "bad gateway" }), false);
    assert.equal(refutes({ kind: "http", status: 503, detail: "unavailable" }), false);
    assert.equal(refutes({ kind: "http", status: 504, detail: "gateway timeout" }), false);
  });
});

describe("describeOutcome", () => {
  it("gives every outcome a sentence", () => {
    assert.equal(describeOutcome({ kind: "ok", status: 204, body: null }), "HTTP 204");
    assert.match(describeOutcome({ kind: "http", status: 500, detail: "boom" }), /HTTP 500: boom/);
    assert.match(describeOutcome({ kind: "malformed", detail: "x" }), /could not read/);
    assert.match(describeOutcome({ kind: "unreachable", detail: "x" }), /could not be reached/);
  });
});
