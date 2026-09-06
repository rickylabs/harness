/**
 * #55's third acceptance criterion, asserted rather than promised.
 *
 * "Never prints `auth.json`" is satisfiable by not typing the string and unkeepable that way, because
 * the path is something the *server* says: an error body, a rejection carrying a config path, a stack
 * in a JSON reply. So the criterion is a predicate, and this file is the part of it that fails.
 *
 * Every sample below is assembled from fragments at runtime. Not decoration: a test file containing a
 * literal that looks like a credential is a file every scanner downstream — the push gate, the
 * archiver, whatever reads a PR diff — has to make a judgement about, and it would be making it about
 * a fake. The regexes see the same string either way.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { basename, leaks, pathIsCredentialFile, scrub, CREDENTIAL_FILES } from "./secrets.js";

const FAKE = {
  github: `gh${"p"}_${"A".repeat(30)}`,
  pat: `github${"_"}pat_${"B".repeat(24)}`,
  openai: `s${"k"}-${"C".repeat(40)}`,
  openrouter: `s${"k"}-or-v1-${"d".repeat(40)}`,
  slack: `xox${"b"}-${"1234567890"}-${"E".repeat(20)}`,
  google: `AI${"za"}${"F".repeat(30)}`,
} as const;

describe("CREDENTIAL_FILES", () => {
  it("names the file the criterion is about", () => {
    assert.deepEqual(CREDENTIAL_FILES, ["auth.json"]);
  });
});

describe("basename", () => {
  it("reads the last segment on either separator", () => {
    assert.equal(basename("/home/agent/.local/share/opencode/auth.json"), "auth.json");
    assert.equal(basename("C:\\Users\\a\\opencode\\auth.json"), "auth.json");
    assert.equal(basename("auth.json"), "auth.json");
    assert.equal(basename("/a/b/"), "b");
    assert.equal(basename(""), "");
    assert.equal(basename("/"), "");
  });
});

describe("pathIsCredentialFile", () => {
  it("recognises the credential file wherever it lives", () => {
    assert.equal(pathIsCredentialFile("/home/agent/.local/share/opencode/auth.json"), true);
    assert.equal(pathIsCredentialFile("C:\\opencode\\AUTH.JSON"), true);
  });

  it("does not fire on the directory that contains it", () => {
    // The directory is refused as an artifact path for a different reason, argued in `secrets.ts`.
    // This predicate is only about a path that *is* the file.
    assert.equal(pathIsCredentialFile("/home/agent/.local/share/opencode"), false);
    assert.equal(pathIsCredentialFile("/var/log/opencode/session.log"), false);
  });
});

describe("scrub", () => {
  it("replaces the credential path whole, wherever it appears in a sentence", () => {
    const said = scrub("failed to read /home/agent/.local/share/opencode/auth.json: EACCES");
    assert.equal(said, "failed to read <credential file>: EACCES");
    assert.ok(!said.includes("auth.json"));
  });

  it("replaces it inside a quoted json error body", () => {
    const said = scrub('{"error":"ENOENT: no such file, open \'/root/.config/opencode/auth.json\'"}');
    assert.ok(!said.includes("auth.json"));
    assert.ok(!said.includes(".config/opencode"));
  });

  it("redacts the token shapes an error body carries", () => {
    for (const value of Object.values(FAKE)) {
      const said = scrub(`the provider rejected ${value}`);
      assert.ok(!said.includes(value), `${value} survived scrubbing`);
    }
  });

  it("redacts a bearer header echoed back in an error", () => {
    const said = scrub(`401 for header authorization: Bearer ${FAKE.openrouter}`);
    assert.ok(!said.includes(FAKE.openrouter));
  });

  it("redacts a named secret field in a config dump, keeping the field name", () => {
    const said = scrub('{"api_key": "hunter2xyz", "model": "glm-5.2"}');
    assert.ok(!said.includes("hunter2xyz"));
    assert.ok(said.includes("api_key"));
    // The rest of the dump is diagnostic and stays: a redactor that mangles ordinary output is a
    // redactor somebody turns off.
    assert.ok(said.includes("glm-5.2"));
  });

  it("leaves ordinary provider output alone", () => {
    const plain = "session ses_a1b2c3 on openrouter/z-ai/glm-5.2; queued";
    assert.equal(scrub(plain), plain);
    const withIds = "run 12-provider-opencode at 2026-09-06T00:00:00.000Z, commit 9f8e7d6c5b4a3210";
    assert.equal(scrub(withIds), withIds);
  });
});

describe("leaks", () => {
  it("names what a string would have exposed", () => {
    assert.deepEqual(leaks("/x/opencode/auth.json"), ["credential file path"]);
    assert.deepEqual(leaks(FAKE.github), ["github token"]);
    assert.deepEqual(leaks(FAKE.google), ["google api key"]);
    assert.deepEqual(leaks("nothing to see"), []);
  });

  it("is empty for anything scrubbed, which is the property that makes the boundary worth having", () => {
    // A replacement that reintroduced a matching shape would be invisible without this. It has
    // happened once already in this file's history: `<redacted>` satisfied the named-field rule's own
    // value pattern until angle brackets were excluded from it.
    const samples = [
      "open /home/agent/.local/share/opencode/auth.json failed",
      `authorization: Bearer ${FAKE.openrouter}`,
      `{"token":"${FAKE.github}"}`,
      `api_key=${FAKE.openai}`,
      `secret: '${FAKE.slack}'`,
      `{"access_token": "${FAKE.pat}", "expires": 3600}`,
    ];
    for (const sample of samples) {
      assert.ok(leaks(sample).length > 0, `sample was not a leak to begin with: ${sample}`);
      assert.deepEqual(leaks(scrub(sample)), [], `scrubbing left a leak in: ${sample}`);
      assert.deepEqual(leaks(scrub(scrub(sample))), [], `scrubbing is not idempotent for: ${sample}`);
    }
  });
});
