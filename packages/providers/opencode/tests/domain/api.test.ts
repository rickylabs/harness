/**
 * The prompt shape and the checked readers.
 *
 * The readers are the reason this package can say "nothing here has been run against a real
 * `opencode serve`" without that being a confession. A reply shape that is not what was assumed has
 * to produce `null` — which the verbs turn into `unknown`, a state the contract has a meaning for —
 * rather than a `TypeError` in a background loop that leaves a run reported as running forever.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bagOf, promptBody, readBoolean, readSessionId, stringAt } from "../../src/domain/api.js";

describe("bagOf and stringAt", () => {
  it("accepts only a plain object", () => {
    assert.deepEqual(bagOf({ a: 1 }), { a: 1 });
    assert.equal(bagOf(null), null);
    assert.equal(bagOf([1, 2]), null);
    assert.equal(bagOf("x"), null);
    assert.equal(bagOf(7), null);
  });

  it("accepts only a non-empty string", () => {
    assert.equal(stringAt({ a: "x" }, "a"), "x");
    assert.equal(stringAt({ a: "" }, "a"), null);
    assert.equal(stringAt({ a: 3 }, "a"), null);
    assert.equal(stringAt({}, "a"), null);
  });
});

describe("promptBody", () => {
  it("carries the model and one text part", () => {
    const body = promptBody({ providerID: "openrouter", modelID: "z-ai/glm-5.2" }, "do it", null);
    assert.deepEqual(body, {
      model: { providerID: "openrouter", modelID: "z-ai/glm-5.2" },
      parts: [{ type: "text", text: "do it" }],
    });
  });

  it("names an agent only when a deployment asked for one", () => {
    // A body the server accepts while ignoring a field is the quiet failure this guards: absent means
    // the server's default, and an explicit `undefined` would be a field we did not mean to send.
    assert.equal("agent" in promptBody({ providerID: "p", modelID: "m" }, "x", null), false);
    assert.equal(promptBody({ providerID: "p", modelID: "m" }, "x", "build").agent, "build");
  });
});

describe("readSessionId", () => {
  it("reads the id at the top level", () => {
    assert.equal(readSessionId({ id: "ses_1", title: "t" }), "ses_1");
  });

  it("reads it through the envelopes an http api grows", () => {
    assert.equal(readSessionId({ info: { id: "ses_2" } }), "ses_2");
    assert.equal(readSessionId({ session: { id: "ses_3" } }), "ses_3");
    assert.equal(readSessionId({ data: { id: "ses_4" } }), "ses_4");
  });

  it("is null when there is no handle, which is the honest answer", () => {
    assert.equal(readSessionId(null), null);
    assert.equal(readSessionId({}), null);
    assert.equal(readSessionId({ id: 7 }), null);
    assert.equal(readSessionId({ id: "" }), null);
    assert.equal(readSessionId([{ id: "ses_1" }]), null);
    assert.equal(readSessionId("ses_1"), null);
  });
});

describe("readBoolean", () => {
  it("reads a bare boolean and refuses to guess at anything else", () => {
    assert.equal(readBoolean(true), true);
    assert.equal(readBoolean(false), false);
    // Guessing which field of this was meant is how a run gets reported stopped while it works on.
    assert.equal(readBoolean({ ok: true, aborted: false }), null);
    assert.equal(readBoolean("true"), null);
    assert.equal(readBoolean(1), null);
    assert.equal(readBoolean(null), null);
  });
});
