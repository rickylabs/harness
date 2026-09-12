/**
 * The route gate over UHP: a substitution must be refused, not shrugged at.
 *
 * Spike S11, issue #289, fail-closed requirements B and C. Run artifacts:
 * `.llm/runs/uhp-stream-adapter--s11/`, and `.llm/runs/provider-uhp-relax--e37/` for the owner risk
 * ruling of 2026-09-12 that made the accepted path reachable.
 *
 * ## The line the ruling drew, and the three assertions that pin it
 *
 * An unattested `provider`, `effort` and `cwd` no longer block a turn (#286, owner risk ruling of
 * 2026-09-12), so a conformant UHP response is now `accepted`. That moves a lot of weight onto assertions
 * that used to be interchangeable, because `unknown` used to absorb every case:
 *
 * 1. a contradiction is still `refused`, and still checked first — unchanged, and the pair below that
 *    reverses order is what goes red if it moves;
 * 2. an agreeing `model` with three silent fields is `accepted`;
 * 3. an unreported `model`, a request that named no model, or evidence that cannot be correlated at all is
 *    still `unknown`.
 *
 * Note what `assert(!isRouteEvidenceVerified(...))` is worth here now: it holds for the refusal **and** for
 * the acceptance, because no UHP route is ever verified. It was a weak assertion before the ruling and it
 * is a weaker one after it, which is why every test below asserts the verdict it means.
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

import { decideUhpRoute, uhpRouteAttestation, uhpRouteNegatives, uhpRouteVerdict } from "./uhp-gate.js";
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

/**
 * THE GATE AS IT SHIPPED BEFORE THE RULING, transcribed. Correct on 2026-09-11, refuses everything now.
 *
 * It blocks on `unverified` and on any unreported field. Both are true of every conformant UHP response,
 * so it cannot reach `accepted` over this transport whatever the server does. Run on the same evidence as
 * the real gate, it is what proves the new accepted path is actually exercised rather than asserted about.
 */
function verdictBeforeTheRuling(evidence: RouteIdentityEvidence): DispatchVerdict {
  const negatives = uhpRouteNegatives(evidence);
  if (negatives.contradicted.length > 0) return "refused";
  if (negatives.unverified || negatives.unreported.length > 0) return "unknown";
  return "accepted";
}

/**
 * DEFECT: the ruling applied one bullet too far — absence swept into acceptance.
 *
 * "Unattested effort is not blocking" is not "nothing is blocking". This version accepts anything that was
 * not contradicted, so a response with no `model` at all — nothing to compare, nothing attesting what ran —
 * is reported as a route that agreed. It is the failure mode the third bullet of the ruling exists to
 * exclude, and it is one deleted condition away from the correct gate.
 */
function verdictIgnoringModel(evidence: RouteIdentityEvidence): DispatchVerdict {
  const negatives = uhpRouteNegatives(evidence);
  if (negatives.contradicted.length > 0) return "refused";
  return "accepted";
}

/** A UHP observation of the conformant response: model reported, three fields silent. */
const benign = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(UHP_FIXTURES.conformant));

/** A UHP observation of the substitution Tasks §1.3 describes: the server ran a different model. */
const substituted = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(UHP_FIXTURES.modelSubstituted));

/** A non-conformant response with no `model`: nothing on the wire says what ran. */
const modelAbsent = compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(UHP_FIXTURES.modelAbsent));

/**
 * The same conformant response, compared against a request that never named a model.
 *
 * The vacuous-agreement case. There is no mismatch — nothing was asked for, so nothing can differ — and the
 * wire did report a model, so neither the `contradicted` nor the `unreported` list says anything is wrong.
 * A gate reading only those two would call this an agreement between a request and an answer that were
 * never compared.
 */
const modelUnrequested = compareRouteIdentity(
  { ...UHP_REQUESTED, model: null },
  observeUhpRoute(UHP_FIXTURES.conformant),
);

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
    // A contradicted field is also an unattested one: a server that says it ran something else has
    // attested nothing about the route that was asked for.
    assert.deepEqual(negatives.unattested, ["provider", "model", "effort", "cwd"]);
    assert.equal(uhpRouteAttestation(negatives), "none");

    // The three fields S10 read as unreportable are kept as readers that return null, not deleted. A
    // reader returning null costs nothing; re-adding one after someone concluded the field was dead
    // costs a spike. This assertion is what would fail if a future edit removed them.
    assert.equal(benign.observed.provider.value, null);
    assert.equal(benign.observed.effort.value, null);
    assert.equal(benign.observed.cwd.value, null);
    assert.deepEqual(uhpRouteNegatives(benign).unreported, ["provider", "effort", "cwd"]);
    // The same three, unattested — and `model` is not among them, which is the whole hinge of the ruling.
    assert.deepEqual(uhpRouteNegatives(benign).unattested, ["provider", "effort", "cwd"]);
    assert.equal(uhpRouteNegatives(benign).unattested.includes("model"), false);
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
    const uncorrelated = decideUhpRoute(modelAbsent);

    // Three inputs, three verdicts. Before the ruling the last two were both `unknown`; the whole point of
    // asserting all three here is that no two of them may collapse into each other again.
    assert.equal(contradicted.verdict, "refused");
    assert.equal(silent.verdict, "accepted");
    assert.equal(uncorrelated.verdict, "unknown");
    assert.notEqual(contradicted.verdict, silent.verdict);
    assert.notEqual(silent.verdict, uncorrelated.verdict);
    assert.notEqual(contradicted.verdict, uncorrelated.verdict);

    // The ladder collapses the first two, which is the defect stated as an equality.
    assert.equal(verdictByCodexLadder(substituted), verdictByCodexLadder(benign));
  });

  it("shows why the weak assertions everyone writes are not coverage", () => {
    // `!verified` holds for all three verdicts over UHP, because no UHP route is ever verified. It is
    // written out so a future reader tempted by it can watch it pass while every distinction is broken.
    for (const evidence of [benign, substituted, modelAbsent]) {
      assert.equal(isRouteEvidenceVerified(evidence), false);
    }
    // `!accepted` used to be the other tempting one. It now discriminates the refusal and the unknown from
    // the acceptance — and still says nothing about which of the two it got.
    assert.notEqual(decideUhpRoute(substituted).verdict, "accepted");
    assert.notEqual(decideUhpRoute(modelAbsent).verdict, "accepted");
    // And the assertions that actually discriminate.
    assert.notEqual(decideUhpRoute(substituted).verdict, decideUhpRoute(modelAbsent).verdict);
    assert.notEqual(decideUhpRoute(benign).verdict, decideUhpRoute(modelAbsent).verdict);
  });

  it("derives the verdict from negatives that do not include a status", () => {
    // Requirement C expressed on the seam between the two functions: `uhpRouteVerdict` is handed the
    // negatives only. A contradiction outranks an incomplete comparison, whatever the status was.
    const uhpShaped = { unreported: ["provider", "effort", "cwd"], unverified: true } as const;
    assert.equal(
      uhpRouteVerdict({ ...uhpShaped, contradicted: ["model"], unattested: ["provider", "model", "effort", "cwd"] }),
      "refused",
    );
    // The ruling of 2026-09-12, at the seam: three unreported fields and an agreeing model is accepted,
    // even though `unverified` is true — which it is for every conformant response over this transport.
    assert.equal(
      uhpRouteVerdict({ ...uhpShaped, contradicted: [], unattested: ["provider", "effort", "cwd"] }),
      "accepted",
    );
    // And its third bullet: an unattested model is still unknown, whatever else was attested.
    assert.equal(
      uhpRouteVerdict({ ...uhpShaped, contradicted: [], unattested: ["provider", "model", "effort", "cwd"] }),
      "unknown",
    );
    assert.equal(uhpRouteVerdict({ contradicted: [], unreported: [], unattested: ["model"], unverified: true }), "unknown");
    assert.equal(uhpRouteVerdict({ contradicted: [], unreported: [], unattested: [], unverified: false }), "accepted");
    // Reversing the order inside `uhpRouteVerdict` breaks exactly this pair and nothing else, which is
    // what makes the mutation detectable: both inputs have an unattested model, so an absence-first ladder
    // answers `unknown` to both and loses the contradiction.
    assert.notEqual(
      uhpRouteVerdict({ contradicted: ["model"], unreported: ["provider"], unattested: ["provider", "model"], unverified: true }),
      uhpRouteVerdict({ contradicted: [], unreported: ["provider"], unattested: ["provider", "model"], unverified: true }),
    );
    assert.equal(
      uhpRouteVerdict({ contradicted: ["model"], unreported: ["provider"], unattested: ["provider", "model"], unverified: true }),
      "refused",
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

    // The accepted case makes the same point from the other side: the comparison status is `unknown` on a
    // verdict of `accepted`. A consumer rendering the status instead of the verdict now reads "we could not
    // tell" about a turn that was permitted, which is the reason this field is carried and never consulted.
    const silent = decideUhpRoute(benign);
    assert.equal(silent.status, "unknown");
    assert.equal(silent.verdict, "accepted");
    assert.doesNotMatch(silent.detail, /contradicted/);
    assert.notEqual(refused.detail, silent.detail);

    // The grounds travel with the acceptance. An unattested route accepted without saying why reads, to the
    // next person, as a route that was checked.
    assert.match(silent.detail, /model and it agreed/);
    assert.match(silent.detail, /provider, effort, cwd could not be attested/);
    assert.match(silent.detail, /owner risk ruling of 2026-09-12/);
    assert.match(silent.detail, /not because the risk was shown to be absent/);
    assert.match(silent.detail, /certifying use remains barred/);

    // And the unknown case says what it could not read, rather than borrowing either of the above.
    const uncorrelated = decideUhpRoute(modelAbsent);
    assert.equal(uncorrelated.verdict, "unknown");
    assert.match(uncorrelated.detail, /nothing about model that could be compared/);
    assert.match(uncorrelated.detail, /no useful turn is permitted/);
    assert.doesNotMatch(uncorrelated.detail, /owner risk ruling/);
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

  it("grades a complete route apart from an unattested one, though both are accepted", () => {
    const verified = compareRouteIdentity(UHP_REQUESTED, UHP_REQUESTED);
    const complete = decideUhpRoute(verified);
    assert.equal(complete.verdict, "accepted");
    assert.deepEqual(complete.contradicted, []);
    assert.deepEqual(complete.unreported, []);
    assert.deepEqual(complete.unattested, []);
    assert.equal(complete.attestation, "complete");
    assert.equal(complete.status, "known");

    // The UHP case reaches the same verdict on strictly less evidence, which is what the ruling decided.
    // The verdicts being equal is exactly why the grades must not be: this is the distinction `unknown` used
    // to carry and `DispatchVerdict` cannot state.
    const unattested = decideUhpRoute(benign);
    assert.equal(unattested.verdict, "accepted");
    assert.equal(unattested.attestation, "partial");
    assert.equal(unattested.verdict, complete.verdict);
    assert.notEqual(unattested.attestation, complete.attestation);
    assert.notEqual(unattested.detail, complete.detail);
    // Neither is verified route evidence unless every field was there, which is what still bars F2's
    // certifying use over UHP while permitting the turn.
    assert.equal(isRouteEvidenceVerified(verified), true);
    assert.equal(isRouteEvidenceVerified(benign), false);
  });

  it("treats absent evidence as unknown rather than as agreement", () => {
    const decision = decideUhpRoute(undefined);
    assert.equal(decision.verdict, "unknown");
    assert.equal(decision.status, "absent");
    assert.deepEqual(decision.unreported, ["provider", "model", "effort", "cwd"]);
    assert.deepEqual(decision.unattested, ["provider", "model", "effort", "cwd"]);
    assert.equal(decision.attestation, "none");
    assert.notEqual(decision.verdict, "accepted");
    // Paired positive control on the same gate: evidence that does report a model is accepted, so the
    // assertion above is about absent evidence and not about a gate that refuses everything.
    assert.equal(decideUhpRoute(benign).verdict, "accepted");
  });

  it("lets the extension-field fixtures move nothing at all", () => {
    // S10's fabricated-agreement fixtures, run through the gate. A server volunteering `provider`, `effort`
    // and `cwd` in `metadata` — which no clause of UHP defines — must move nothing in either direction: it
    // can no more attest a field than contradict one, so the decision must be identical to the conformant
    // response that volunteered nothing. Asserting the whole decision rather than the verdict is what makes
    // this a test about the extension keys, now that the verdict alone would also pass for a gate that read
    // them and believed them.
    for (const fixture of [UHP_FIXTURES.allThreeAgreeingExtended, UHP_FIXTURES.effortContradictingExtended]) {
      const decision = decideUhpRoute(compareRouteIdentity(UHP_REQUESTED, observeUhpRoute(fixture)));
      assert.deepEqual(decision, decideUhpRoute(benign));
      assert.deepEqual(decision.contradicted, []);
      assert.deepEqual(decision.unattested, ["provider", "effort", "cwd"]);
      assert.equal(decision.attestation, "partial");
    }
    // And the one real contradiction the wire can report still refuses, so the check above is not a blanket
    // "everything is accepted".
    assert.equal(decideUhpRoute(substituted).verdict, "refused");
  });

  it("refuses a substitution the same way when the model is absent rather than different", () => {
    // A response with no `model` violates `Response.required`. There is nothing to contradict, so it is
    // unknown — a different fact from a substitution, and the two must not converge.
    assert.equal(decideUhpRoute(modelAbsent).verdict, "unknown");
    assert.notEqual(decideUhpRoute(modelAbsent).verdict, decideUhpRoute(substituted).verdict);
    assert.deepEqual(uhpRouteNegatives(modelAbsent).unreported, ["provider", "model", "effort", "cwd"]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The owner risk ruling of 2026-09-12: an unattested effort does not block a turn
 * ---------------------------------------------------------------------------------------------- */

describe("the UHP route gate — the ruling that made the accepted path reachable", () => {
  it("accepts a conformant response, where the gate as it shipped yesterday said unknown", () => {
    // The central assertion of the change. Same evidence, two implementations, two answers: this is what
    // distinguishes "the ruling is implemented" from "a test was written next to it".
    const ours = decideUhpRoute(benign).verdict;
    const before = verdictBeforeTheRuling(benign);

    assert.equal(ours, "accepted");
    assert.equal(before, "unknown");
    assert.notEqual(ours, before);
    // And the reason the old gate could never get there: `unverified` is true here and always will be.
    assert.equal(uhpRouteNegatives(benign).unverified, true);
    assert.equal(uhpRouteNegatives(benign).unreported.length, 3);
  });

  it("still says unknown when the model itself is unreported, where the over-relaxed gate accepts", () => {
    // The third bullet of the ruling, with the defect that swallows it executed on the same input. A gate
    // that dropped the model condition answers `accepted` to a response that does not say what ran.
    const ours = decideUhpRoute(modelAbsent).verdict;
    const tooFar = verdictIgnoringModel(modelAbsent);

    assert.equal(ours, "unknown");
    assert.equal(tooFar, "accepted");
    assert.notEqual(ours, tooFar);
    assert.equal(decideUhpRoute(modelAbsent).attestation, "none");

    // Paired positive control on the same gate and the same requested route: the response that *does* report
    // an agreeing model is accepted. Without it, the assertion above would also hold for a gate that refused
    // every UHP response, which is the state this change exists to leave.
    assert.equal(decideUhpRoute(benign).verdict, "accepted");
    // The two fixtures differ in exactly one field, so nothing else can be producing the difference.
    assert.equal(UHP_FIXTURES.conformant.model, "claude-opus-5");
    assert.equal("model" in UHP_FIXTURES.modelAbsent, false);
  });

  it("does not read an agreement off a model that was never requested", () => {
    // The vacuous-agreement hole. `contradicted` and `unreported` are both empty here — there is nothing to
    // differ from and the wire did report a model — so a gate that asked only those two questions would
    // accept a comparison that never happened. `unattested` covers the requested side, which is why it
    // exists rather than being derived at the call site.
    const negatives = uhpRouteNegatives(modelUnrequested);
    assert.deepEqual(negatives.contradicted, []);
    assert.equal(negatives.unreported.includes("model"), false);
    assert.equal(negatives.unattested.includes("model"), true);
    assert.equal(decideUhpRoute(modelUnrequested).verdict, "unknown");
    assert.equal(verdictIgnoringModel(modelUnrequested), "accepted");
    // Paired positive control: the identical response compared against a request that did name the model.
    assert.equal(decideUhpRoute(benign).verdict, "accepted");
  });

  it("never lets a fabricated status decide the acceptance either", () => {
    // The acceptance path is new, so requirement B is worth re-pinning against it: a hand-built evidence
    // object claiming `status: "known"` while the wire reported no model must not be accepted. The values
    // decide; the status explains.
    const fabricated: RouteIdentityEvidence = { ...modelAbsent, status: "known" };
    assert.equal(decideUhpRoute(fabricated).verdict, "unknown");
    assert.equal(decideUhpRoute(fabricated).status, "known");
    assert.equal(verdictByCodexLadder(fabricated), "accepted");
    assert.notEqual(decideUhpRoute(fabricated).verdict, verdictByCodexLadder(fabricated));
  });

  it("keeps a contradiction refused even now that silence is accepted", () => {
    // The half of the board that did not move. Both rulings are in force at once: the contradicted set is
    // checked first, so an acceptance for absence cannot become an acceptance for a substitution.
    assert.equal(decideUhpRoute(substituted).verdict, "refused");
    assert.equal(verdictBeforeTheRuling(substituted), "refused");
    assert.equal(decideUhpRoute(substituted).verdict, verdictBeforeTheRuling(substituted));
    // A substitution attests nothing, so it cannot be graded as a partially attested route.
    assert.equal(decideUhpRoute(substituted).attestation, "none");
    assert.notEqual(decideUhpRoute(substituted).attestation, decideUhpRoute(benign).attestation);
  });
});
