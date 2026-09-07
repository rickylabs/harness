import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CITATION_KINDS, parseCitation, type CitationKind } from "./citation.js";

/** The kind, or null — the shape most assertions below want. */
function kindOf(raw: string): CitationKind | null {
  return parseCitation(raw)?.kind ?? null;
}

describe("parseCitation", () => {
  it("reads each of the shapes this system's evidence actually takes", () => {
    assert.equal(kindOf("https://github.com/rickylabs/harness/pull/232"), "url");
    assert.equal(kindOf("#232"), "issue");
    assert.equal(kindOf("rickylabs/harness#232"), "issue");
    assert.equal(kindOf("run:01a07872-49d0-74e3-a8b1-a20a6e091064"), "run");
    assert.equal(kindOf("packages/coordinator/src/plan.ts"), "file");
    assert.equal(kindOf("packages/coordinator/src/plan.ts:190"), "file");
    assert.equal(kindOf("packages/coordinator/src/plan.ts:190-200"), "file");
    assert.equal(kindOf("README.md"), "file");
    assert.equal(kindOf("3c23219"), "sha");
    assert.equal(kindOf("3ee225b1c0ffee0badc0de1234567890abcdef12"), "sha");
  });

  it("refuses prose, which is the whole point of #203", () => {
    // Every one of these satisfied the old gate, which asked only that the string be non-empty.
    for (const notACitation of ["x", "ok", "s", "sha", "see the PR", "obviously", "TODO", "done", "-"]) {
      assert.equal(parseCitation(notACitation), null, `${JSON.stringify(notACitation)} is not a reference`);
    }
  });

  it("refuses blank and whitespace, the case the old gate did catch", () => {
    for (const blank of ["", "   ", "\t\n"]) assert.equal(parseCitation(blank), null, JSON.stringify(blank));
  });

  it("keeps the raw string so a refusal can quote what was written", () => {
    const citation = parseCitation("  #232  ");
    assert.equal(citation?.raw, "  #232  ");
    assert.equal(citation?.value, "#232");
  });

  it("normalises so two spellings of one reference are one value", () => {
    assert.equal(parseCitation("3C23219")?.value, "3c23219");
    assert.equal(parseCitation("RickyLabs/Harness#232")?.value, "rickylabs/harness#232");
    // A padded line number is the same line.
    assert.equal(parseCitation("src/plan.ts:0190")?.value, "src/plan.ts:190");
    assert.equal(parseCitation("src/plan.ts:190")?.value, "src/plan.ts:190");
  });

  it("is pure — same input, same output, no clock and no disk", () => {
    const once = parseCitation("packages/coordinator/src/plan.ts:190");
    const twice = parseCitation("packages/coordinator/src/plan.ts:190");
    assert.deepEqual(once, twice);
  });

  it("does not confuse the shapes with each other", () => {
    // `deadbeef` is 8 hex characters and reads as a sha; the same word with an extension is a file.
    assert.equal(kindOf("deadbeef"), "sha");
    assert.equal(kindOf("deadbeef.txt"), "file");
    // Six hex characters is below the short-sha floor, and nothing else claims it.
    assert.equal(parseCitation("abc123"), null);
    // A bare number is not an issue: `#` is what makes it one.
    assert.equal(parseCitation("232"), null);
    // A run id without its prefix has no shape of its own, so it refers to nothing.
    assert.equal(parseCitation("01a07872-49d0-74e3-a8b1-a20a6e091064"), null);
  });

  it("needs a scheme before it will call something a URL", () => {
    assert.equal(kindOf("http://n5.local:2299/board"), "url");
    // Without one there is nothing to distinguish a host from a path, and `file` claims it. Which is
    // the honest answer: shape alone cannot tell them apart, and both are followable.
    assert.equal(kindOf("github.com/rickylabs/harness"), "file");
  });

  it("accepts two things that are only shaped like references — the limit of parsing without I/O", () => {
    // Stated rather than fixed. Anything containing a slash reads as a path, so `n/a` is admitted as
    // a file citation and a bare domain as a path. Ruling them out needs to know whether the file
    // exists, and that is a network- and disk-touching job this module deliberately does not do (see
    // its header): `settle` would stop being pure, and the plan would stop being journallable.
    // The floor this still holds is the one #203 was filed about — prose with no slash, no scheme,
    // no `#` and no hex is refused, and that is what agents actually wrote.
    assert.equal(kindOf("n/a"), "file");
    assert.equal(kindOf("later/maybe"), "file");
  });

  it("refuses an issue reference with no number", () => {
    for (const bad of ["#", "#abc", "rickylabs/harness#", "rickylabs#12"]) {
      assert.equal(parseCitation(bad), null, bad);
    }
  });

  it("refuses a run prefix with nothing after it", () => {
    assert.equal(parseCitation("run:"), null);
    assert.equal(parseCitation("run: "), null);
  });

  it("returns a kind from the declared set, always", () => {
    const kinds = new Set<string>(CITATION_KINDS);
    for (const raw of ["https://example.invalid/x", "#1", "run:r", "a/b", "abcdefa"]) {
      const citation = parseCitation(raw);
      assert.ok(citation, raw);
      assert.ok(kinds.has(citation.kind), `${citation.kind} is not in CITATION_KINDS`);
    }
  });
});
