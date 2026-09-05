import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPPOSITE_FAMILY,
  SEAM_OR_FAMILY,
  selectEvaluator,
  type Actor,
  type Candidate,
} from "./independence.js";

const author: Actor = {
  id: "run-author",
  seam: "subscription",
  family: "anthropic",
  model: "opus-5",
  effort: "medium",
};

const candidate = (over: Partial<Candidate> & { readonly id: string }): Candidate => ({
  seam: "subscription",
  family: "openai",
  model: "gpt-5.6-sol",
  effort: "xhigh",
  openWeights: false,
  blockedBy: null,
  ...over,
});

/** The rule that must never be selected: the same family as the author. */
const sameFamily = candidate({ id: "run-sibling", family: "anthropic", model: "fable-5" });

/** The relay seam, open-weights, legal but off the author's seam. */
const relayOpen = candidate({
  id: "run-relay",
  seam: "relay",
  family: "open",
  model: "z-ai/glm-5.3-flash",
  openWeights: true,
});

const ruleFor = (
  decision: ReturnType<typeof selectEvaluator>,
  id: string,
): string | undefined => decision.rejected.find((r) => r.candidate === id)?.rule;

describe("selectEvaluator", () => {
  it("picks the opposite family, and prefers the author's own seam", () => {
    const decision = selectEvaluator(author, [candidate({ id: "run-codex" }), relayOpen]);
    assert.equal(decision.kind, "selected");
    assert.equal(decision.kind === "selected" ? decision.evaluator.id : null, "run-codex");
    assert.match(
      decision.because,
      /author's own subscription seam/,
      "the reason must say why the cheaper seam was preferred",
    );
  });

  it("never lets a session evaluate itself, even when the roster offers it", () => {
    const self: Candidate = { ...author, openWeights: false, blockedBy: null };
    const decision = selectEvaluator(author, [self]);
    assert.equal(decision.kind, "blocked");
    assert.equal(ruleFor(decision, author.id), "same-session");
  });

  it("rejects the author's own family under the default policy", () => {
    const decision = selectEvaluator(author, [sameFamily]);
    assert.equal(decision.kind, "blocked");
    assert.equal(ruleFor(decision, sameFamily.id), "same-family");
  });

  it("accepts the same family on a different seam under seam-or-family", () => {
    const crossSeam = candidate({
      id: "run-sibling-relay",
      seam: "relay",
      family: "anthropic",
      openWeights: true,
    });
    const decision = selectEvaluator(author, [crossSeam], SEAM_OR_FAMILY);
    assert.equal(decision.kind, "selected");
    assert.equal(decision.kind === "selected" ? decision.evaluator.id : null, "run-sibling-relay");
  });

  it("still rejects the same family on the same seam under seam-or-family", () => {
    const decision = selectEvaluator(author, [sameFamily], SEAM_OR_FAMILY);
    assert.equal(decision.kind, "blocked");
    assert.equal(ruleFor(decision, sameFamily.id), "same-seam-and-family");
  });

  it("refuses a closed model reached over the relay seam", () => {
    const closedRelay = candidate({ id: "run-closed-relay", seam: "relay", openWeights: false });
    const decision = selectEvaluator(author, [closedRelay]);
    assert.equal(decision.kind, "blocked");
    assert.equal(ruleFor(decision, closedRelay.id), "relay-not-open");
  });

  it("accepts an open-weights model over the relay seam", () => {
    const decision = selectEvaluator(author, [relayOpen]);
    assert.equal(decision.kind, "selected");
    assert.equal(decision.kind === "selected" ? decision.evaluator.id : null, "run-relay");
  });

  it("quotes governance's own reason when a candidate cannot run", () => {
    const busy = candidate({ id: "run-busy", blockedBy: "quota window exhausted until 00:00" });
    const decision = selectEvaluator(author, [busy]);
    assert.equal(decision.kind, "blocked");
    assert.equal(
      decision.rejected.find((r) => r.candidate === "run-busy")?.detail,
      "quota window exhausted until 00:00",
    );
  });

  it("reports the permanent reason, not the transient one, when both apply", () => {
    // A same-family candidate that is also rate-limited must not be reported as merely unavailable:
    // that reads as "try again later" for a candidate that must never be used.
    const both = candidate({ ...sameFamily, blockedBy: "rate limited" });
    const decision = selectEvaluator(author, [both]);
    assert.equal(ruleFor(decision, both.id), "same-family");
    assert.equal(decision.kind === "blocked" ? decision.transient : null, false);
  });

  it("says waiting will help when the only legal evaluator is busy", () => {
    const busy = candidate({ id: "run-busy", blockedBy: "quota window exhausted" });
    const decision = selectEvaluator(author, [busy, sameFamily]);
    assert.equal(decision.kind, "blocked");
    assert.equal(decision.kind === "blocked" ? decision.transient : null, true);
    assert.match(decision.because, /1 of 2 were legal/);
  });

  it("says waiting will not help when no candidate could ever be legal", () => {
    const decision = selectEvaluator(author, [sameFamily]);
    assert.equal(decision.kind === "blocked" ? decision.transient : null, false);
    assert.match(decision.because, /roster gap, not a wait/);
  });

  it("blocks on an empty roster rather than returning nothing", () => {
    const decision = selectEvaluator(author, []);
    assert.equal(decision.kind, "blocked");
    assert.equal(decision.kind === "blocked" ? decision.transient : null, false);
    assert.match(decision.because, /roster is empty/);
  });

  it("scarcity is never permission: one same-family candidate is still a blocker", () => {
    // The property the whole gate rests on. If this ever returns "selected", the rule only binds
    // when it costs nothing.
    const decision = selectEvaluator(author, [
      sameFamily,
      candidate({ id: "run-sibling-2", family: "anthropic", model: "haiku-4-5" }),
    ]);
    assert.equal(decision.kind, "blocked");
  });

  it("gives the same answer whatever order the roster was written in", () => {
    const roster = [
      candidate({ id: "run-c", family: "openai", model: "gpt-5.6-sol" }),
      candidate({ id: "run-a", family: "openai", model: "gpt-5.6-sol" }),
      relayOpen,
      sameFamily,
      candidate({ id: "run-b", family: "openai", model: "gpt-5.6-sol" }),
    ];
    const forward = selectEvaluator(author, roster);
    const backward = selectEvaluator(author, [...roster].reverse());
    assert.equal(forward.kind, "selected");
    assert.equal(
      forward.kind === "selected" ? forward.evaluator.id : null,
      backward.kind === "selected" ? backward.evaluator.id : null,
    );
    assert.equal(forward.kind === "selected" ? forward.evaluator.id : null, "run-a");
  });

  it("crosses to the metered seam only when no same-seam candidate is legal, and says so", () => {
    const decision = selectEvaluator(author, [sameFamily, relayOpen]);
    assert.equal(decision.kind, "selected");
    assert.equal(decision.kind === "selected" ? decision.evaluator.seam : null, "relay");
    assert.match(decision.because, /moving to the relay seam because no same-seam candidate was legal/);
  });

  it("accounts for every candidate it turned down, and never for the one it chose", () => {
    const chosen = candidate({ id: "run-codex" });
    const decision = selectEvaluator(author, [chosen, sameFamily, relayOpen]);
    assert.equal(decision.kind, "selected");
    // Sorted by candidate, not roster order, so the record is a function of the roster as a set.
    assert.deepEqual(decision.rejected.map((r) => r.candidate), ["run-relay", "run-sibling"]);
    assert.deepEqual(decision.rejected.map((r) => r.rule), ["not-preferred", "same-family"]);
    assert.ok(
      !decision.rejected.some((r) => r.candidate === chosen.id),
      "the chosen evaluator is not in its own rejection list",
    );
  });

  it("shows that a legal alternative existed, rather than implying there was none", () => {
    // Without this, a roster with three legal evaluators records identically to a roster with one,
    // and "there was no alternative" becomes an unfalsifiable claim.
    const decision = selectEvaluator(author, [candidate({ id: "run-codex" }), relayOpen]);
    const alternative = decision.rejected.find((r) => r.candidate === "run-relay");
    assert.equal(alternative?.rule, "not-preferred");
    assert.equal(alternative?.detail, "legal, but run-codex keeps the review on the author's own subscription seam");
  });

  it("records the same rejections whatever order the roster arrived in", () => {
    const roster = [candidate({ id: "run-codex" }), sameFamily, relayOpen];
    assert.deepEqual(
      selectEvaluator(author, roster).rejected,
      selectEvaluator(author, [...roster].reverse()).rejected,
    );
  });

  it("names the policy that was in force", () => {
    assert.equal(selectEvaluator(author, [], OPPOSITE_FAMILY).policy, "opposite-family");
    assert.equal(selectEvaluator(author, [], SEAM_OR_FAMILY).policy, "seam-or-family");
  });
});
