/**
 * The publication boundary: no path crosses it, and the three route statuses survive it.
 *
 * Issue #286, "Redact `detail` before it crosses the boundary" and "Route status must survive as three
 * values, not two". Run artifacts: `.llm/runs/provider-uhp--e37/`.
 *
 * ## Why each test here is built the way it is
 *
 * The requirement warns twice that the obvious assertion does not cover the thing it is near:
 * "Asserting that `observed.cwd.value` is redacted does not cover this […] it passes while the bug is
 * present", because the leak is in a free-form `detail` under no particular key. So the check here is a
 * **value** check over every string at any depth, and every case that asserts a clean result is paired
 * with an assertion that the *unredacted* form of the same input is dirty. Without that pair, a fixture
 * that never contained a path in the first place would produce a green test and no coverage — the
 * fixture-introduced second path to the same outcome #286 names as the usual cause of a control that
 * fires on nothing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CWD_PRESENT,
  CWD_REDUCED_TO_PRESENCE,
  REDACTED_PATH,
  isRedactedRouteEvidence,
  pathShapedStrings,
  redactPaths,
  redactRouteEvidence,
} from "./uhp-redact.js";
import { compareRouteIdentity, describeRouteEvidence, isRouteEvidenceVerified, type RouteIdentityInput } from "./route.js";
import { observeUhpRoute } from "./uhp-gate.js";
import { UHP_FIXTURES, UHP_REQUESTED } from "./uhp-mock.js";

/** The cwd every fixture below uses. An absolute path, because that is what leaks. */
const CWD = "/home/agent/projects/harness/.llm/runs/provider-uhp--e37";

const REQUESTED: RouteIdentityInput = { ...UHP_REQUESTED, cwd: CWD };

/** All four fields reported and agreeing: `compareRouteIdentity` calls this `known`. */
const OBSERVED_AGREEING: RouteIdentityInput = { ...REQUESTED };

/** All four reported, the model contradicting: `compareRouteIdentity` calls this `mismatch`. */
const OBSERVED_SUBSTITUTED: RouteIdentityInput = { ...REQUESTED, model: "claude-sonnet-5" };

describe("the fence — every string, any depth, any key", () => {
  it("finds a path under an arbitrary key and inside free-form prose", () => {
    const found = pathShapedStrings({
      verdict: "refused",
      nested: [{ anythingAtAll: `route mismatch: cwd requested "${CWD}" (provider.cwd)` }],
    });
    assert.equal(found.length, 1);
    assert.ok(found[0]?.includes(CWD));
    // A key-name fence would not have fired on either of those, which is the whole point of the shape of
    // this function: nobody banned `anythingAtAll`, and `detail` is not a path field.
  });

  it("does not fire on the things a diagnostic legitimately carries", () => {
    const clean = {
      model: "claude-opus-5",
      effort: "xhigh",
      harnessId: "chrn_08dae611630d467ab3e67ed792570ae5",
      session: "hsess7e78",
      response: "resp_s10",
      url: "https://unifiedharnessprotocol.org/spec/2026-08-11/tasks",
      base: "claude-code",
      single: "/v1",
      count: 3,
      nothing: null,
    };
    assert.deepEqual(pathShapedStrings(clean), []);
  });

  it("finds the other three shapes a path arrives in", () => {
    // Counted as "at least one": the shapes overlap on purpose — a `file://` url is also a POSIX path
    // once the scheme is stripped — and a fence that had to agree on *which* rule fired would be a fence
    // with a tie to break. What matters is that each shape is found and that each one is then removed.
    for (const dirty of ["C:\\Users\\agent\\work", "\\\\fileserver\\share\\run", "file:///work/harness", "~/projects/harness"]) {
      assert.ok(pathShapedStrings(dirty).length >= 1, `${dirty} was not seen as a path`);
      assert.deepEqual(pathShapedStrings(redactPaths(dirty)), [], `${dirty} survived redaction`);
    }
  });
});

describe("the redactor — and the control that proves the input was dirty", () => {
  it("removes a path from prose and leaves the rest readable", () => {
    const dirty = `route mismatch: cwd requested "${CWD}" (provider.cwd), observed "" (thread/start.result.cwd)`;
    // The control. If this assertion ever fails, the test below is passing on an input with no path in it.
    assert.equal(pathShapedStrings(dirty).length, 1);

    const clean = redactPaths(dirty);
    assert.deepEqual(pathShapedStrings(clean), []);
    assert.ok(clean.includes(REDACTED_PATH));
    // The diagnostic is still a diagnostic: what was compared, and against what source.
    assert.ok(clean.includes("route mismatch"));
    assert.ok(clean.includes("provider.cwd"));
  });

  it("leaves an https url intact while removing a path beside it", () => {
    const dirty = `see https://unifiedharnessprotocol.org/spec/2026-08-11/sessions about ${CWD}`;
    const clean = redactPaths(dirty);
    assert.ok(clean.includes("https://unifiedharnessprotocol.org/spec/2026-08-11/sessions"));
    assert.deepEqual(pathShapedStrings(clean), []);
  });

  it("leaves no tail when two shapes overlap on the same run of characters", () => {
    // Found by reading the redactor rather than by a test failing: the shapes overlap — `/a/b:/c/d` is a
    // POSIX match that stops at the colon and a drive-letter match that starts before it — and a rewriter
    // that skipped the second span because it began inside the first would emit `<path redacted>:/c/d`.
    // The fence would catch that remainder and the whole diagnostic would be withheld, which is
    // fail-closed and still a diagnostic lost to an off-by-one. Spans are merged instead.
    for (const dirty of ["/a/b:/c/d", "prefix /home/agent/x:/var/tmp/y suffix", "C:/users/a/b:/c/d"]) {
      const clean = redactPaths(dirty);
      assert.deepEqual(pathShapedStrings(clean), [], `${dirty} left a tail: ${clean}`);
    }
    // The assertion that separates merging from skipping, which the fence alone does not: a recognised
    // shape is removed **whole**. Skipping the overlapping span leaves `<path redacted>:/c` — a fragment
    // short enough that the fence, which ignores single segments, would not report it.
    assert.equal(redactPaths("/a/b:/c"), REDACTED_PATH);
  });

  it("is idempotent, so a detail that passes through twice is not mangled", () => {
    const once = redactPaths(`cwd "${CWD}"`);
    assert.equal(redactPaths(once), once);
  });
});

describe("route evidence, published — the leak on the success path", () => {
  it("carries a path on the known branch before redaction, and none after", () => {
    const evidence = compareRouteIdentity(REQUESTED, OBSERVED_AGREEING);
    assert.equal(evidence.status, "known");

    // The control that makes this suite worth having: `describeRouteEvidence` embeds every field value on
    // the success path, so the unredacted diagnostic of a verified route carries the working directory.
    // This is the defect #286 describes, demonstrated rather than asserted about.
    assert.equal(pathShapedStrings(describeRouteEvidence(evidence)).length >= 1, true);
    assert.ok(evidence.detail.includes(CWD));

    const published = redactRouteEvidence(evidence);
    assert.deepEqual(pathShapedStrings(published), []);
    // Still says what it said: a verified route, with its provenance.
    assert.ok(published.detail.includes("route verified"));
    assert.ok(published.detail.includes("provider.cwd"));
    assert.equal(published.requested.cwd.value, CWD_PRESENT);
    assert.equal(published.observed.cwd.value, CWD_PRESENT);
    assert.equal(published.redaction, CWD_REDUCED_TO_PRESENCE);
  });

  it("carries a path on the mismatch branch before redaction, and none after", () => {
    const evidence = compareRouteIdentity({ ...REQUESTED }, { ...OBSERVED_SUBSTITUTED, cwd: "/var/tmp/other" });
    assert.equal(evidence.status, "mismatch");
    assert.equal(pathShapedStrings(evidence.detail).length >= 1, true);

    const published = redactRouteEvidence(evidence);
    assert.deepEqual(pathShapedStrings(published), []);
    assert.ok(published.detail.includes("route mismatch"));
    // The fields that disagreed are still named. A redaction that dropped them would trade a leak for the
    // collapse the rest of this file is about.
    assert.deepEqual([...published.mismatches].sort(), ["cwd", "model"]);
  });

  it("carries the verification fact, because redaction makes it unrecomputable", () => {
    // The trap #286 names: "A branch that encodes 'provider is uhp, therefore unverified' keeps working
    // today and silently never accepts a `known` after S10 widens `RouteSource`." Reducing `cwd` to
    // presence has the same effect on any consumer that re-derives verification from published values —
    // `isRouteEvidenceVerified` requires an absolute cwd and an exact match, and a presence token is
    // neither. So the fact is measured before redaction and carried.
    const verified = compareRouteIdentity(REQUESTED, OBSERVED_AGREEING);
    assert.equal(isRouteEvidenceVerified(verified), true);

    const published = redactRouteEvidence(verified);
    assert.equal(published.verifiedBeforeRedaction, true);
    // And the re-derivation a consumer might reach for answers the other way, which is the whole reason
    // the field exists. Both halves are asserted: the fail-closed direction is correct and is not the fact.
    assert.equal(isRouteEvidenceVerified(published), false);
    assert.notEqual(published.verifiedBeforeRedaction, isRouteEvidenceVerified(published));

    // The UHP case, where both are false and agree: a route missing three fields was never verified.
    const overUhp = redactRouteEvidence(compareRouteIdentity(REQUESTED, observeUhpRoute(UHP_FIXTURES.conformant)));
    assert.equal(overUhp.verifiedBeforeRedaction, false);
    assert.equal(isRouteEvidenceVerified(overUhp), false);
    // A contradiction is not verified either, and is still distinguishable from the silence above.
    const contradicted = redactRouteEvidence(compareRouteIdentity(REQUESTED, OBSERVED_SUBSTITUTED));
    assert.equal(contradicted.verifiedBeforeRedaction, false);
    assert.notEqual(contradicted.status, overUhp.status);
  });

  it("keeps an absent cwd absent rather than claiming presence", () => {
    const evidence = compareRouteIdentity({ ...REQUESTED, cwd: "" }, OBSERVED_AGREEING);
    const published = redactRouteEvidence(evidence);
    assert.equal(published.requested.cwd.value, null);
    assert.notEqual(published.requested.cwd.value, CWD_PRESENT);
  });
});

describe("three statuses, not two — through serialisation", () => {
  /** The two evidence sets a UHP transport actually produces: a silence and a contradiction. */
  const benign = compareRouteIdentity(REQUESTED, observeUhpRoute(UHP_FIXTURES.conformant));
  const substituted = compareRouteIdentity(REQUESTED, observeUhpRoute(UHP_FIXTURES.modelSubstituted));

  it("preserves status, mismatches and invalid through redaction", () => {
    for (const evidence of [
      benign,
      substituted,
      compareRouteIdentity(REQUESTED, OBSERVED_AGREEING),
      compareRouteIdentity(REQUESTED, OBSERVED_SUBSTITUTED),
    ]) {
      const published = redactRouteEvidence(evidence);
      assert.equal(published.status, evidence.status);
      assert.deepEqual(published.mismatches, evidence.mismatches);
      assert.deepEqual(published.invalid, evidence.invalid);
    }
  });

  it("does not let a mismatch serialise as an unknown", () => {
    const mismatch = redactRouteEvidence(compareRouteIdentity(REQUESTED, OBSERVED_SUBSTITUTED));
    const unknown = redactRouteEvidence(benign);
    assert.equal(mismatch.status, "mismatch");
    assert.equal(unknown.status, "unknown");

    // Through JSON, which is how it reaches anything durable. The assertion is the distinction itself: not
    // that either value is "not verified" — both are — but that the two do not arrive as the same word.
    const asMismatch = JSON.parse(JSON.stringify(mismatch)) as { status: string; detail: string };
    const asUnknown = JSON.parse(JSON.stringify(unknown)) as { status: string; detail: string };
    assert.equal(asMismatch.status, "mismatch");
    assert.equal(asUnknown.status, "unknown");
    assert.notEqual(asMismatch.status, asUnknown.status);
    // And in the prose an operator reads, which is a separate channel and can be broken separately.
    assert.ok(asMismatch.detail.startsWith("route mismatch"));
    assert.ok(asUnknown.detail.startsWith("route unknown"));
    assert.notEqual(asMismatch.detail, asUnknown.detail);
  });

  it("keeps the substitution visible over a transport where the status cannot carry it", () => {
    // Over UHP both are `unknown`, so the status is not the channel. `mismatches` is.
    const publishedBenign = redactRouteEvidence(benign);
    const publishedSubstituted = redactRouteEvidence(substituted);
    assert.equal(publishedBenign.status, publishedSubstituted.status);
    assert.deepEqual(publishedBenign.mismatches, []);
    assert.deepEqual(publishedSubstituted.mismatches, ["model"]);
    assert.notDeepEqual(publishedBenign.mismatches, publishedSubstituted.mismatches);
    // Through JSON as well: a projection that reads `mismatches` still sees the substitution.
    const round = JSON.parse(JSON.stringify(publishedSubstituted)) as { mismatches: string[] };
    assert.deepEqual(round.mismatches, ["model"]);
  });
});

describe("the marker is checked against the thing it claims", () => {
  it("refuses evidence that is marked redacted and is not", () => {
    const evidence = compareRouteIdentity(REQUESTED, OBSERVED_AGREEING);
    const lying = { ...evidence, redaction: CWD_REDUCED_TO_PRESENCE };
    assert.equal(isRedactedRouteEvidence(lying), false);
    assert.equal(isRedactedRouteEvidence(redactRouteEvidence(evidence)), true);
    // Unmarked evidence is not redacted, whatever it happens to contain.
    assert.equal(isRedactedRouteEvidence(evidence), false);
  });
});
