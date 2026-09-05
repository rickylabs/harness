import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { closingKeywordTargets } from "./closing.js";

const REPO = "rickylabs/harness";

describe("closingKeywordTargets", () => {
  it("finds nothing in a body with no keyword", () => {
    assert.deepEqual(closingKeywordTargets("See #38 for the pipeline.", REPO), []);
    assert.deepEqual(closingKeywordTargets("", REPO), []);
    assert.deepEqual(closingKeywordTargets(undefined, REPO), []);
  });

  it("reads every keyword GitHub acts on, in every tense", () => {
    const body = [
      "Closes #1",
      "closed #2",
      "Close #3",
      "Fixes #4",
      "fixed #5",
      "fix #6",
      "Resolves #7",
      "resolved #8",
      "RESOLVE #9",
    ].join("\n");
    assert.deepEqual(closingKeywordTargets(body, REPO), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("accepts the colon form and rejects the unseparated one", () => {
    assert.deepEqual(closingKeywordTargets("Closes: #12", REPO), [12]);
    // GitHub requires the whitespace; `Closes#12` links nothing, so neither does this.
    assert.deepEqual(closingKeywordTargets("Closes#12", REPO), []);
  });

  it("reads the qualified and URL forms for this repository", () => {
    assert.deepEqual(closingKeywordTargets("Closes rickylabs/harness#20", REPO), [20]);
    assert.deepEqual(
      closingKeywordTargets("Fixes https://github.com/rickylabs/harness/issues/21", REPO),
      [21],
    );
  });

  it("drops a reference qualified with another repository", () => {
    // Not this board's problem, and a row it could never clear.
    assert.deepEqual(closingKeywordTargets("Closes rickylabs/netscript#20", REPO), []);
    assert.deepEqual(
      closingKeywordTargets("Fixes https://github.com/other/repo/issues/21", REPO),
      [],
    );
  });

  it("does not treat a bare reference as a close", () => {
    // The distinction the whole rule rests on: `Part of #39` is how you point at an umbrella.
    assert.deepEqual(closingKeywordTargets("Part of #39\nSee also #40", REPO), []);
  });

  it("reports a keyword written about the past, because GitHub will act on it anyway", () => {
    // A body describing this very incident still instructs GitHub to close #39 on merge. Calling
    // that a false positive would mean disagreeing with the parser this module exists to predict.
    const body = "PR #105 wrongly closed #39, the epic, instead of the task it implemented.";
    assert.deepEqual(closingKeywordTargets(body, REPO), [39]);
  });

  it("deduplicates and sorts ascending", () => {
    assert.deepEqual(closingKeywordTargets("Closes #9\nFixes #2\nResolves #9", REPO), [2, 9]);
  });

  it("returns the same answer twice for the same body", () => {
    // The module-level pattern carries `g`. Read with `exec` in a loop it would keep `lastIndex`
    // between calls and answer differently the second time.
    const body = "Closes #7";
    assert.deepEqual(closingKeywordTargets(body, REPO), closingKeywordTargets(body, REPO));
  });

  it("matches the repository case-insensitively", () => {
    assert.deepEqual(closingKeywordTargets("Closes RickyLabs/Harness#3", REPO), [3]);
  });

  it("ignores a keyword that is only part of a longer word", () => {
    assert.deepEqual(closingKeywordTargets("This unfixes #4 and discloses #5", REPO), []);
  });
});
