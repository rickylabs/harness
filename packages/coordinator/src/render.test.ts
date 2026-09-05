import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectEvaluator, type Actor, type Candidate } from "./independence.js";
import { planOf, type StepState } from "./plan.js";
import { renderDecision, renderPlan, renderWorkflow } from "./render.js";
import { checkWorkflow, MILESTONE_WORKFLOW, type Workflow } from "./workflow.js";

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

describe("renderWorkflow", () => {
  it("leads with the verdict, then the steps", () => {
    const text = renderWorkflow(MILESTONE_WORKFLOW, checkWorkflow(MILESTONE_WORKFLOW));
    assert.match(text.split("\n")[0] ?? "", /^workflow: milestone — 11 step\(s\), no problems$/);
  });

  it("says INVALID first when the definition does not hold up", () => {
    const broken: Workflow = {
      name: "broken",
      steps: [
        { id: "look", stage: "decompose", kind: "read", needs: [], evidence: [], describe: "look" },
        { id: "write", stage: "decompose", kind: "effect", needs: ["look"], evidence: [], describe: "write" },
      ],
    };
    const text = renderWorkflow(broken, checkWorkflow(broken));
    assert.match(text.split("\n")[0] ?? "", /^INVALID/);
    assert.match(text, /write  ungated-effect/);
  });
});

describe("renderPlan", () => {
  const stateOf = (...states: readonly StepState[]): readonly StepState[] => states;
  const doneStep = (id: string): StepState => ({ id, outcome: "done", citations: {}, note: null });

  it("puts the fork on line one, ahead of everything else", () => {
    // A run waiting on a person is not merely stalled — it is stalled on somebody who does not know
    // it yet, and that has to be the first thing anybody reads.
    const plan = planOf(
      MILESTONE_WORKFLOW,
      stateOf(doneStep("read-milestone"), doneStep("propose-tasks"), {
        id: "gate-decomposition",
        outcome: "forked",
        citations: {},
        note: "which repo holds the memory store?",
      }),
    );
    const text = renderPlan(plan);
    assert.match(text.split("\n")[0] ?? "", /^FORKED — 1 owner decision\(s\) waiting/);
    assert.match(text, /forks \(1\) — for the owner, not for the coordinator:/);
  });

  it("says a repeated reason once, so one fork does not print eight times", () => {
    const plan = planOf(
      MILESTONE_WORKFLOW,
      stateOf(doneStep("read-milestone"), doneStep("propose-tasks"), {
        id: "gate-decomposition",
        outcome: "forked",
        citations: {},
        note: "which repo holds the memory store?",
      }),
    );
    const text = renderPlan(plan);
    assert.equal(text.split("which repo holds the memory store?").length - 1, 2);
    assert.match(text, /\(as above\)/);
  });

  it("leads with the runnable count when there is work to do", () => {
    const plan = planOf(MILESTONE_WORKFLOW, []);
    assert.match(renderPlan(plan).split("\n")[0] ?? "", /^plan: 1 step\(s\) runnable — 0 of 11 done$/);
  });

  it("says complete when everything is done", () => {
    const plan = planOf(MILESTONE_WORKFLOW, MILESTONE_WORKFLOW.steps.map((s) => doneStep(s.id)));
    assert.match(renderPlan(plan).split("\n")[0] ?? "", /^plan: complete — all 11 step\(s\) done$/);
  });

  it("ends without a trailing newline", () => {
    assert.equal(renderPlan(planOf(MILESTONE_WORKFLOW, [])).endsWith("\n"), false);
  });
});
