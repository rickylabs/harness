/**
 * The endpoint set and the checked readers.
 *
 * The readers are the reason this package can say "nothing here has been run against a real
 * `opencode serve`" without that being a confession. A reply shape that is not what was assumed has
 * to produce `null` — which the verbs turn into `unknown`, a state the contract has a meaning for —
 * rather than a `TypeError` in a background loop that leaves a run reported as running forever.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bagOf,
  promptBody,
  readBoolean,
  readHealth,
  readSessionId,
  segment,
  sessionBody,
  stringAt,
  PATHS,
} from "./api.js";

describe("PATHS", () => {
  it("names the six endpoints this package uses", () => {
    assert.equal(PATHS.sessions, "/session");
    assert.equal(PATHS.session("ses_1"), "/session/ses_1");
    assert.equal(PATHS.prompt("ses_1"), "/session/ses_1/prompt_async");
    assert.equal(PATHS.abort("ses_1"), "/session/ses_1/abort");
    assert.equal(PATHS.events, "/event");
    assert.equal(PATHS.health, "/global/health");
  });

  it("escapes an id, because the server chooses it and we build a path out of it", () => {
    // Unescaped, `POST /session/a/b/abort` is not `abort` on session `a/b` — it is a request to
    // somewhere else entirely, which a server may well answer.
    assert.equal(segment("a/b"), "a%2Fb");
    assert.equal(PATHS.abort("a/b"), "/session/a%2Fb/abort");
    assert.equal(PATHS.prompt("a b"), "/session/a%20b/prompt_async");
  });
});

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

describe("sessionBody", () => {
  it("carries a title and nothing else", () => {
    assert.deepEqual(sessionBody("dsh run-1"), { title: "dsh run-1" });
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

describe("readHealth", () => {
  it("requires the field it is named for", () => {
    assert.deepEqual(readHealth({ healthy: true, version: "0.1.0" }), {
      healthy: true,
      version: "0.1.0",
    });
    assert.deepEqual(readHealth({ healthy: false }), { healthy: false, version: null });
    assert.equal(readHealth({ version: "0.1.0" }), null);
    assert.equal(readHealth({ healthy: "yes" }), null);
    assert.equal(readHealth(null), null);
  });
});
