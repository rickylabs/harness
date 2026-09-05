import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkedIssuesOf, sumUsage, type RunUsage } from "./model.js";

describe("sumUsage", () => {
  it("does not report a field nobody reported", () => {
    // The distinction this package exists for: an absent count and a zero count are different
    // claims. A rendered "0 tokens" for a seam that never reports cost is a lie about the seam.
    const summed = sumUsage([{ inputTokens: 5 }, { inputTokens: 7 }]);
    assert.deepEqual(summed, { inputTokens: 12 });
    assert.equal("costUsd" in summed, false);
  });

  it("reports a genuine zero, because that is a measurement", () => {
    const summed = sumUsage([{ outputTokens: 0 }]);
    assert.deepEqual(summed, { outputTokens: 0 });
  });

  it("skips a non-finite value rather than poisoning the total", () => {
    // One NaN from one malformed transcript would otherwise make every number on the screen NaN.
    const bad = { inputTokens: Number.NaN, outputTokens: 3 } as RunUsage;
    assert.deepEqual(sumUsage([bad, { inputTokens: 4 }]), { inputTokens: 4, outputTokens: 3 });
  });

  it("totals an empty list to an empty usage, not to zeroes", () => {
    assert.deepEqual(sumUsage([]), {});
  });
});

describe("linkedIssuesOf", () => {
  it("reads the issue number the dispatcher put in the branch name", () => {
    assert.deepEqual(linkedIssuesOf("orch/divybot-99", null), [99]);
    assert.deepEqual(linkedIssuesOf("issue-42", null), [42]);
    assert.deepEqual(linkedIssuesOf("feat/issue/7-telemetry", null), [7]);
  });

  it("ignores a bare number in a branch, which is usually not an issue", () => {
    assert.deepEqual(linkedIssuesOf("release/2.1.0", null), []);
    assert.deepEqual(linkedIssuesOf("feat/telemetry-sink", null), []);
  });

  it("reads only explicit #NN out of a title, because a bare number is a version", () => {
    assert.deepEqual(linkedIssuesOf(null, "review: PR #98 (forge)"), [98]);
    assert.deepEqual(linkedIssuesOf(null, "bump node 24"), []);
  });

  it("merges both sources and returns them sorted and deduplicated", () => {
    // Sorted matters downstream: attribution takes the first number that resolves to an item, so
    // an unstable order would make the same run land under different epics between snapshots.
    assert.deepEqual(linkedIssuesOf("orch/divybot-39", "closes #101 and #39"), [39, 101]);
  });

  it("is not left holding lastIndex between calls", () => {
    // The patterns are module-level and /g. Without a reset, the second call starts mid-string and
    // silently under-reports — the kind of defect that only shows up under a full scan.
    const first = linkedIssuesOf(null, "#5 #6 #7");
    const second = linkedIssuesOf(null, "#5 #6 #7");
    assert.deepEqual(first, second);
    assert.deepEqual(second, [5, 6, 7]);
  });

  it("takes neither source when both are absent", () => {
    assert.deepEqual(linkedIssuesOf(null, null), []);
  });
});
