import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectEvaluator, type Actor, type Candidate } from "./independence.js";
import { renderDecision } from "./render.js";

const author: Actor = {
  id: "run-author",
  seam: "subscription",
  family: "anthropic",
  model: "opus-5",
  effort: "medium",
};

const codex: Candidate = {
  id: "run-codex",
  seam: "subscription",
  family: "openai",
  model: "gpt-5.6-sol",
  effort: "xhigh",
  openWeights: false,
  blockedBy: null,
};

const sibling: Candidate = { ...codex, id: "run-sibling", family: "anthropic", model: "fable-5" };

const lines = (candidates: readonly Candidate[]): readonly string[] =>
  renderDecision(selectEvaluator(author, candidates)).split("\n");

describe("renderDecision", () => {
  it("puts the verdict on line one", () => {
    // Principle 10. A reader who stops after one line has still read the answer.
    assert.equal(lines([codex])[0], "evaluator: run-codex  (openai · subscription · gpt-5.6-sol · xhigh)");
  });

  it("puts the refusal on line one too, in a word that cannot be skimmed past", () => {
    assert.equal(lines([sibling])[0], "BLOCKED — no independent evaluator");
  });

  it("says whether waiting will help", () => {
    const busy = renderDecision(selectEvaluator(author, [{ ...codex, blockedBy: "quota window exhausted" }]));
    assert.match(busy, /clears on its own when a quota window resets/);

    const permanent = renderDecision(selectEvaluator(author, [sibling]));
    assert.match(permanent, /waiting will not help/);
    assert.equal(permanent.includes("clears on its own"), false);
  });

  it("names the policy and the author under the verdict", () => {
    const text = renderDecision(selectEvaluator(author, [codex]));
    assert.match(text, /\n {2}policy: {2}opposite-family\n/);
    assert.match(text, /\n {2}author: {2}run-author {2}\(anthropic · subscription · opus-5 · medium\)\n/);
  });

  it("prints every rejection in full, one per line, and counts them", () => {
    // Summarising them ("3 candidates rejected") is precisely the form in which a wrong rule hides.
    const relay: Candidate = {
      ...codex,
      id: "run-relay",
      seam: "relay",
      family: "open",
      model: "z-ai/glm-5.3-flash",
      openWeights: true,
    };
    const text = renderDecision(selectEvaluator(author, [codex, sibling, relay]));
    assert.match(text, /\n {2}not chosen \(2\):\n/);
    assert.match(text, /\n {4}run-relay {4}not-preferred {2}legal, but run-codex keeps the review/);
    assert.match(text, /\n {4}run-sibling {2}same-family {4}same family as the author \(anthropic\)/);
  });

  it("leaves out the rejection block entirely when there is nothing to report", () => {
    assert.equal(renderDecision(selectEvaluator(author, [codex])).includes("not chosen"), false);
  });

  it("omits an effort that was never stated rather than printing null", () => {
    assert.match(lines([{ ...codex, effort: null }])[0] ?? "", /\(openai · subscription · gpt-5\.6-sol\)$/);
  });

  it("ends without a trailing newline, so the caller decides how it is written", () => {
    assert.equal(renderDecision(selectEvaluator(author, [codex])).endsWith("\n"), false);
  });
});
