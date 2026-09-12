/**
 * The route gate over UHP: a substitution must be refused, not shrugged at.
 *
 * Spike S11, issue #289, fail-closed requirements B and C. Run artifacts:
 * `.llm/runs/uhp-stream-adapter--s11/`.
 *
 * ## The two defects these tests exist to exclude
 *
 * **B.** A gate keyed on `evidence.status === "mismatch"` never fires over UHP, because `unknown`
 * outranks `mismatch` in `compareRouteIdentity` and three of the four route fields are never reported.
 * It reads correctly and never fires. The signal survives in `evidence.mismatches`.
 *
 * **C.** The refusal ladder in `packages/provider-codex/src/protocol.ts` checks `unknown` before
 * `mismatch`. In the codex dialect all four fields are observable, both branches are reachable, and the
 * ordering is right. Transplanted to UHP the first branch always wins, the second is dead code, and a
 * substituted model is reported as "we could not tell" instead of "the server contradicted the request".
 *
 * Both defective implementations are written below, named and commented as wrong, and run on the same
 * evidence as the correct one. That is the only way to assert the distinction rather than assert around
 * it: `assert(!accepted)` and `assert(!verified)` are true of the correct gate AND of both defects,
 * because `refused` and `unknown` are both "not accepted". Three people wrote that assertion today.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideUhpRoute, uhpRouteNegatives, uhpRouteVerdict } from "./uhp-gate.js";
import {
  compareRouteIdentity,
  isRouteEvidenceVerified,
  type RouteIdentityEvidence,
} from "./route.js";
import { UHP_FIXTURES, UHP_REQUESTED, observeUhpRoute } from "./uhp-mock.js";
import type { DispatchVerdict } from "./provider.js";

/**
 * DEFECT C, transcribed. The codex ladder's shape: unknown first, mismatch second.
 *
 * Correct where all four fields are observable. Over UHP the second branch is unreachable, so this
 * function cannot ever return `refused` for a UHP route however badly the server behaved.
 */
function verdictByCodexLadder(evidence: RouteIdentityEvidence): DispatchVerdict {
  if (evidence.status === "unknown") return "unknown";
  if (evidence.status === "mismatch") return "refused";
  return "accepted";
}

/**
 * DEFECT B, transcribed. A gate that asks the status whether a substitution happened.
 *
 * Over UHP it answers "no" every time, including when the server has said in writing that it
 * substituted the model.
 */
function substitutionDetectedByStatus(evidence: RouteIdentityEvidence): boolean {
  return evidence.status === "mismatch";
}

/** The correct question: did the wire report a value that differs from what was asked for? */
function substitutionDetectedByMismatches(evidence: RouteIdentityEvidence): boolean {
  return evidence.mismatches.length > 0;
}

/** A UHP observation of the conformant response: model reported, three fields silent. */
const benign = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(UHP_FIXTURES.conformant), "uhp");

/** A UHP observation of the substitution Tasks §1.3 describes: the server ran a different model. */
const substituted = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(UHP_FIXTURES.modelSubstituted), "uhp");

describe("the UHP route gate — B: the signal is in mismatches, not in status", () => {
  it("shows the two evidence sets are indistinguishable by status", () => {
    // The precondition for both defects, pinned first so the rest of the suite is about consequences.
    assert.equal(benign.status, "unknown");
    assert.equal(substituted.status, "unknown");
    assert.equal(benign.status, substituted.status);
    // And distinguishable by mismatches.
    assert.deepEqual(benign.mismatches, []);
    assert.deepEqual(substituted.mismatches, ["model"]);
    assert.notDeepEqual(benign.mismatches, substituted.mismatches);
  });

  it("demonstrates that the status-keyed detector never fires, on evidence where it must", () => {
    // Defect B, executed. The server told us it substituted the model; the status-keyed gate says no
    // substitution happened. Both halves are asserted, because "the correct one fires" alone would pass
    // even if the defective one fired too, and the whole finding is that it does not.
    assert.equal(substitutionDetectedByStatus(substituted), false);
    assert.equal(substitutionDetectedByMismatches(substituted), true);
    assert.notEqual(
      substitutionDetectedByStatus(substituted),
      substitutionDetectedByMismatches(substituted),
    );
    // On the benign route both agree, which is why the defect survives review: it is wrong only where
    // it matters.
    assert.equal(substitutionDetectedByStatus(benign), false);
    assert.equal(substitutionDetectedByMismatches(benign), false);
  });

  it("reads the negatives from mismatches and from the observed side of invalid", () => {
    const negatives = uhpRouteNegatives(substituted);
    assert.deepEqual(negatives.contradicted, ["model"]);
    assert.deepEqual(negatives.unreported, ["provider", "effort", "cwd"]);
    assert.equal(negatives.unverified, true);

    // The three fields S10 read as unreportable are kept as readers that return null, not deleted. A
    // reader returning null costs nothing; re-adding one after someone concluded the field was dead
    // costs a spike. This assertion is what would fail if a future edit removed them.
    assert.equal(benign.observed.provider.value, null);
    assert.equal(benign.observed.effort.value, null);
    assert.equal(benign.observed.cwd.value, null);
    assert.deepEqual(uhpRouteNegatives(benign).unreported, ["provider", "effort", "cwd"]);
  });
});

describe("the UHP route gate — C: the verdict comes from the strongest negative, not from a ladder", () => {
  it("refuses a substitution where the codex ladder would report unknown", () => {
    // The central assertion of this suite, and the one that goes red if the ladder is copied.
    const ours = decideUhpRoute(substituted).verdict;
    const theirs = verdictByCodexLadder(substituted);

    assert.equal(ours, "refused");
    assert.equal(theirs, "unknown");
    assert.notEqual(ours, theirs);
  });

  it("separates a contradicted route from a silent one, which the ladder cannot", () => {
    const contradicted = decideUhpRoute(substituted);
    const silent = decideUhpRoute(benign);

    assert.equal(contradicted.verdict, "refused");
    assert.equal(silent.verdict, "unknown");
    assert.notEqual(contradicted.verdict, silent.verdict);

    // The ladder collapses them, which is the defect stated as an equality.
    assert.equal(verdictByCodexLadder(substituted), verdictByCodexLadder(benign));
  });

  it("shows why the weak assertions everyone writes are not coverage", () => {
    // Both of these hold for the correct gate and for both defects. They are written out so that a
    // future reader who is tempted by them can see them pass while the distinction above is broken.
    for (const evidence of [benign, substituted]) {
      assert.notEqual(decideUhpRoute(evidence).verdict, "accepted");
      assert.equal(isRouteEvidenceVerified(evidence), false);
    }
    // And the assertion that actually discriminates.
    assert.notEqual(decideUhpRoute(substituted).verdict, decideUhpRoute(benign).verdict);
  });

  it("derives the verdict from negatives that do not include a status", () => {
    // Requirement C expressed on the seam between the two functions: `uhpRouteVerdict` is handed the
    // negatives only. A contradiction outranks an incomplete comparison, whatever the status was.
    assert.equal(
      uhpRouteVerdict({ contradicted: ["model"], unreported: ["provider", "effort", "cwd"], unverified: true }),
      "refused",
    );
    assert.equal(
      uhpRouteVerdict({ contradicted: [], unreported: ["provider", "effort", "cwd"], unverified: true }),
      "unknown",
    );
    assert.equal(uhpRouteVerdict({ contradicted: [], unreported: [], unverified: true }), "unknown");
    assert.equal(uhpRouteVerdict({ contradicted: [], unreported: [], unverified: false }), "accepted");
    // Reversing the order inside `uhpRouteVerdict` breaks exactly this pair and nothing else, which is
    // what makes the mutation detectable.
    assert.notEqual(
      uhpRouteVerdict({ contradicted: ["model"], unreported: ["provider"], unverified: true }),
      uhpRouteVerdict({ contradicted: [], unreported: ["provider"], unverified: true }),
    );
  });

  it("carries the status as an explanation and never as the decision", () => {
    const refused = decideUhpRoute(substituted);
    // The status is `unknown` on a `refused` verdict. That combination is the finding, and a consumer
    // rendering the status instead of the verdict is the bug this field exists to make visible.
    assert.equal(refused.status, "unknown");
    assert.equal(refused.verdict, "refused");
    assert.match(refused.detail, /contradicted the requested route on model/);
    assert.match(refused.detail, /the comparison status is "unknown"/);
    assert.match(refused.detail, /provider, effort, cwd/);
    assert.match(refused.detail, /claude-sonnet-5/);

    const silent = decideUhpRoute(benign);
    assert.equal(silent.status, "unknown");
    assert.doesNotMatch(silent.detail, /contradicted/);
    assert.match(silent.detail, /no useful turn is permitted/);
    assert.notEqual(refused.detail, silent.detail);
  });

  it("is still correct in the codex dialect, where all four fields are observable", () => {
    // The finding is about the dialect, not about the ladder being nonsense. With every field reported,
    // a model difference produces `status: "mismatch"`, and the ladder and this gate agree.
    const codexLike = compareRouteIdentity(UHP_REQUESTED, { ...UHP_REQUESTED, model: "claude-sonnet-5" });
    assert.equal(codexLike.status, "mismatch");
    assert.equal(decideUhpRoute(codexLike).verdict, "refused");
    assert.equal(verdictByCodexLadder(codexLike), "refused");
    assert.equal(decideUhpRoute(codexLike).verdict, verdictByCodexLadder(codexLike));
    // And the status-keyed detector fires there too, which is why nobody noticed.
    assert.equal(substitutionDetectedByStatus(codexLike), true);
  });

  it("accepts only a route where every field was reported and agreed", () => {
    const verified = compareRouteIdentity(UHP_REQUESTED, UHP_REQUESTED);
    const decision = decideUhpRoute(verified);
    assert.equal(decision.verdict, "accepted");
    assert.deepEqual(decision.contradicted, []);
    assert.deepEqual(decision.unreported, []);
    assert.equal(decision.status, "known");
    // Which, per S10's reading of the specification, no UHP route can currently reach. That reading is
    // an unevaluated generator verdict awaiting a non-Claude evaluator, so the capability stays.
    assert.equal(decideUhpRoute(benign).verdict, "unknown");
  });

  it("treats absent evidence as unknown rather than as agreement", () => {
    const decision = decideUhpRoute(undefined);
    assert.equal(decision.verdict, "unknown");
    assert.equal(decision.status, "absent");
    assert.deepEqual(decision.unreported, ["provider", "model", "effort", "cwd"]);
    assert.notEqual(decision.verdict, "accepted");
  });

  it("refuses the extension-field fixtures without inventing a contradiction", () => {
    // S10's fabricated-agreement fixtures, run through the gate. A server volunteering `provider`,
    // `effort` and `cwd` in `metadata` — which no clause of UHP defines — must move nothing: not to
    // accepted, and not to refused either, because an undefined key can no more contradict than agree.
    for (const fixture of [UHP_FIXTURES.allThreeAgreeingExtended, UHP_FIXTURES.effortContradictingExtended]) {
      const decision = decideUhpRoute(compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(fixture), "uhp"));
      assert.equal(decision.verdict, "unknown");
      assert.deepEqual(decision.contradicted, []);
    }
    // And the one real contradiction the wire can report still refuses, so the check above is not a
    // blanket "everything is unknown".
    assert.equal(decideUhpRoute(substituted).verdict, "refused");
  });

  it("refuses a substitution the same way when the model is absent rather than different", () => {
    // A response with no `model` violates `Response.required`. There is nothing to contradict, so it is
    // unknown — a different fact from a substitution, and the two must not converge.
    const absent = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(UHP_FIXTURES.modelAbsent), "uhp");
    assert.equal(decideUhpRoute(absent).verdict, "unknown");
    assert.notEqual(decideUhpRoute(absent).verdict, decideUhpRoute(substituted).verdict);
    assert.deepEqual(uhpRouteNegatives(absent).unreported, ["provider", "model", "effort", "cwd"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The dialect labels explain; the values decide
 * ---------------------------------------------------------------------------------------------- */

describe("the UHP route gate — a provenance label never changes a verdict", () => {
  // #287 relabelled every UHP observation. The gate must be indifferent to that: a verdict that moved
  // because a label moved would mean provenance had become a decision input, which is exactly the
  // fabricated-agreement shape this module refuses. Asserted on both fixtures, in both dialects.

  for (const [name, fixture, expected] of [
    ["a conformant response", UHP_FIXTURES.conformant, "unknown"],
    ["a substituted model", UHP_FIXTURES.modelSubstituted, "refused"],
  ] as const) {
    it(`decides ${name} identically under either labelling`, () => {
      const asUhp = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(fixture), "uhp");
      const asCodex = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(fixture), "codex");

      assert.equal(decideUhpRoute(asUhp).verdict, expected);
      assert.equal(decideUhpRoute(asCodex).verdict, expected);
      assert.deepEqual(uhpRouteNegatives(asUhp).contradicted, uhpRouteNegatives(asCodex).contradicted);
      assert.deepEqual(uhpRouteNegatives(asUhp).unreported, uhpRouteNegatives(asCodex).unreported);
      assert.equal(uhpRouteNegatives(asUhp).unverified, uhpRouteNegatives(asCodex).unverified);

      // The control that keeps the assertions above from being about one object compared to itself: the
      // two really are labelled differently, and the two fixtures really do decide differently.
      assert.notEqual(asUhp.observed.model.source, asCodex.observed.model.source);
      assert.notEqual(decideUhpRoute(asUhp).verdict, expected === "unknown" ? "refused" : "unknown");
    });
  }
});
