import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REDACTION, SECRET_KINDS, countSecrets, describeSecretKind, leaked, redact } from "./redact.js";
import type { SecretKind } from "./redact.js";

const kinds = (text: string): readonly SecretKind[] => redact(text).hits.map((hit) => hit.kind);

// Shapes only, assembled at runtime so no line of this file is itself a credential-looking literal
// a scanner would flag. `x` repeated is not anyone's token.
const body = (length: number): string => "x".repeat(length);
const GH_TOKEN = `ghp_${body(36)}`;
const GH_PAT = `github_pat_${body(22)}_${body(59)}`;
const OR_KEY = `sk-or-v1-${body(64)}`;

describe("redact", () => {
  it("finds a classic GitHub token in the middle of a command line", () => {
    const { text, hits } = redact(`$ GH_TOKEN=${GH_TOKEN} gh pr list`);
    assert.equal(text, `$ GH_TOKEN=ghp_${REDACTION} gh pr list`);
    assert.deepEqual(hits, [{ kind: "github-token", count: 1 }]);
  });

  it("keeps the prefix, which is the half that tells the operator what to rotate", () => {
    for (const prefix of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]) {
      const { text } = redact(`${prefix}${body(36)}`);
      assert.equal(text, `${prefix}${REDACTION}`, prefix);
    }
  });

  it("finds a fine-grained PAT, which the gh*_ shapes do not cover", () => {
    assert.deepEqual(kinds(GH_PAT), ["github-pat"]);
    assert.equal(redact(GH_PAT).text, `github_pat_${REDACTION}`);
  });

  it("finds an Authorization header, case-insensitively, as gh --verbose prints it", () => {
    const { text, hits } = redact(`> Authorization: bearer ${body(40)}`);
    assert.equal(text, `> Authorization: bearer ${REDACTION}`);
    assert.deepEqual(hits, [{ kind: "bearer-header", count: 1 }]);
  });

  it("finds a credential embedded in a remote url, which git echoes on every push", () => {
    const { text, hits } = redact(`remote: https://x-access-token:${body(40)}@github.com/rickylabs/harness.git`);
    assert.equal(text, `remote: https://x-access-token:${REDACTION}@github.com/rickylabs/harness.git`);
    assert.deepEqual(hits, [{ kind: "basic-auth-url", count: 1 }]);
  });

  it("finds a router key", () => {
    assert.deepEqual(kinds(OR_KEY), ["api-key"]);
    assert.equal(redact(OR_KEY).text, `sk-or-v1-${REDACTION}`);
    assert.equal(redact(`sk-ant-api03-${body(90)}`).text, `sk-ant-${REDACTION}`);
  });

  it("counts every occurrence of a kind, not just the first", () => {
    const { hits } = redact(`${GH_TOKEN} ... ${GH_TOKEN} ... ${GH_TOKEN}`);
    assert.deepEqual(hits, [{ kind: "github-token", count: 3 }]);
    assert.equal(countSecrets({ text: "", hits }), 3);
  });

  it("reports several kinds from one pane", () => {
    const { hits } = redact([`$ gh auth login --with-token <<< ${GH_TOKEN}`, `> Authorization: Bearer ${body(40)}`].join("\n"));
    assert.deepEqual(
      hits.map((hit) => hit.kind),
      ["github-token", "bearer-header"],
    );
  });

  it("is idempotent, so a second pass over sed-redacted text reports nothing", () => {
    // The property `secret-in-transcript` depends on. A run that re-reported the operator's own
    // earlier redaction would turn "rotate this" into a line nobody reads.
    const once = redact(`${GH_TOKEN} ${GH_PAT} Bearer ${body(40)} ${OR_KEY} https://x:${body(30)}@example.com`);
    const twice = redact(once.text);
    assert.equal(twice.text, once.text);
    assert.deepEqual(twice.hits, []);
    assert.equal(leaked(twice), false);
  });

  it("leaves the line count alone, so the tail an operator reads is still the tail", () => {
    const pane = ["$ git push", `remote: https://x-access-token:${body(40)}@github.com/r/h.git`, "", "To github.com"].join("\n");
    const { text } = redact(pane);
    assert.equal(text.split("\n").length, pane.split("\n").length);
    assert.equal(text.split("\n")[3], "To github.com");
  });

  it("never lengthens the text, so a redaction cannot push a pane past a size limit", () => {
    assert.ok(redact(`${GH_TOKEN} ${GH_PAT} ${OR_KEY}`).text.length <= `${GH_TOKEN} ${GH_PAT} ${OR_KEY}`.length);
  });

  it("leaves ordinary output completely alone", () => {
    for (const line of [
      "$ pnpm run build",
      "ghost_writer.ts:12  no such file",
      "sk-short",
      "Bearer",
      "https://github.com/rickylabs/harness/pull/169",
    ]) {
      const { text, hits } = redact(line);
      assert.equal(text, line, line);
      assert.deepEqual(hits, [], line);
    }
  });

  it("reports nothing for empty text", () => {
    assert.deepEqual(redact(""), { text: "", hits: [] });
    assert.equal(leaked({ text: "", hits: [] }), false);
  });
});

describe("SECRET_KINDS", () => {
  it("is closed, and every kind is reachable from real terminal output", () => {
    const found = new Set<SecretKind>();
    for (const sample of [
      GH_TOKEN,
      GH_PAT,
      `Authorization: Bearer ${body(40)}`,
      `https://x-access-token:${body(40)}@github.com/r/h.git`,
      OR_KEY,
    ]) {
      for (const hit of redact(sample).hits) found.add(hit.kind);
    }
    assert.deepEqual([...found].sort(), [...SECRET_KINDS].sort());
  });

  it("describes every kind", () => {
    for (const kind of SECRET_KINDS) assert.ok(describeSecretKind(kind).length > 0, kind);
  });
});
