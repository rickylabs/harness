import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalJson } from "./canonical.js";
import {
  admit,
  parseStates,
  planOf,
  readStates,
  runnable,
  settle,
  statesOf,
  STATE_NOTE_CAP,
  type StepState,
} from "./plan.js";
import {
  MILESTONE_WORKFLOW,
  evidenceKind,
  evidenceName,
  type EvidenceSpec,
  type Step,
  type Workflow,
} from "./workflow.js";

function step(
  id: string,
  kind: Step["kind"],
  needs: readonly string[],
  evidence: readonly EvidenceSpec[] = [],
): Step {
  return { id, stage: "dispatch", kind, needs, evidence, describe: id };
}

/**
 * A citation that satisfies what the spec asks for.
 *
 * Written as a function of the spec rather than a constant, so it stays correct when a step pins a
 * kind — and so a workflow that declared a kind nothing could satisfy would fail here rather than
 * quietly never being exercised.
 */
function citationFor(spec: EvidenceSpec): string {
  switch (evidenceKind(spec)) {
    case "url":
      return `https://example.invalid/${evidenceName(spec)}`;
    case "run":
      return `run:${evidenceName(spec)}`;
    case "sha":
      return "3c232190";
    case "issue":
      return "#69";
    default:
      return `evidence/${evidenceName(spec)}.md`;
  }
}

/** look → gate → write(effect, cites a receipt). The smallest thing with a gate in front of an effect. */
const SMALL: Workflow = {
  name: "small",
  steps: [
    step("look", "read", [], ["source"]),
    step("gate", "gate", ["look"], ["verdict"]),
    step("write", "effect", ["gate"], ["receipt"]),
  ],
};

function done(id: string, citations: Readonly<Record<string, string>> = {}): StepState {
  return { id, outcome: "done", citations, note: null };
}

function halted(id: string, outcome: "blocked" | "forked", note: string): StepState {
  return { id, outcome, citations: {}, note };
}

/** Everything in the milestone workflow done except the named steps. */
function allDoneExcept(...except: readonly string[]): readonly StepState[] {
  return MILESTONE_WORKFLOW.steps
    .filter((s) => !except.includes(s.id))
    .map((s) => done(s.id, Object.fromEntries(s.evidence.map((spec) => [evidenceName(spec), citationFor(spec)]))));
}

describe("statesOf", () => {
  it("gives every step a state, defaulting to pending", () => {
    const states = statesOf(SMALL, []);
    assert.deepEqual(
      states.map((s) => [s.id, s.outcome]),
      [
        ["look", "pending"],
        ["gate", "pending"],
        ["write", "pending"],
      ],
    );
  });

  it("returns declaration order, not the order the file happened to use", () => {
    // Two state files listing the same facts in a different sequence must plan identically, or the
    // journal reports a difference every time somebody re-serialises their state.
    const forward = statesOf(SMALL, [done("look"), done("gate")]);
    const backward = statesOf(SMALL, [done("gate"), done("look")]);
    assert.equal(canonicalJson(forward), canonicalJson(backward));
  });

  it("drops a state for a step that is not in the workflow", () => {
    const states = statesOf(SMALL, [done("look"), done("removed-last-month")]);
    assert.equal(states.length, 3);
    assert.equal(
      states.find((s) => s.id === "removed-last-month"),
      undefined,
    );
  });
});

describe("admit", () => {
  it("admits a step whose needs are all done", () => {
    const admission = admit(SMALL, [done("look")], "gate");
    assert.equal(admission.admitted, true);
  });

  it("refuses a step that is not in the workflow", () => {
    const admission = admit(SMALL, [], "ghost");
    assert.equal(admission.admitted, false);
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "unknown-step");
  });

  it("refuses a step that has already settled", () => {
    const admission = admit(SMALL, [done("look")], "look");
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "already-settled");
  });

  it("refuses while a prerequisite is not done", () => {
    const admission = admit(SMALL, [], "gate");
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "needs-unmet");
    assert.equal(admission.detail, "look is not done");
  });

  it("refuses an effect whose gate has not passed", () => {
    const admission = admit(SMALL, [done("look")], "write");
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "ungated-effect");
    assert.match(admission.detail, /nothing mutates before the gate/);
  });

  it("refuses an effect whose gate is upstream but not adjacent — the hand-edited-state case", () => {
    // This is the rule doing the work no other check does. dispatch-run's own two needs are done, so
    // a coordinator that looked only at direct needs would dispatch. gate-decomposition sits further
    // up and never passed, which means write-tasks mutated the world before its gate — exactly what a
    // hand-edited state file, or a crash halfway through, produces.
    const states = allDoneExcept("gate-decomposition", "dispatch-run");
    const admission = admit(MILESTONE_WORKFLOW, states, "dispatch-run");
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "ungated-effect");
    assert.match(admission.detail, /^gate-decomposition has not passed/);
  });

  it("refuses everything downstream of an owner fork, and says whose fork", () => {
    const states = [done("look"), halted("gate", "forked", "which repo holds the memory store?")];
    const admission = admit(SMALL, states, "write");
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "upstream-forked");
    assert.match(admission.detail, /which repo holds the memory store\?/);
  });

  it("refuses everything downstream of a blocker", () => {
    const states = [done("look"), halted("gate", "blocked", "coverage is short two acceptance items")];
    const admission = admit(SMALL, states, "write");
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "upstream-blocked");
  });

  it("reports a fork ahead of a blocker when both are upstream", () => {
    // A fork needs a person; a blocker needs a fix. Telling a caller about the fixable one first
    // sends them off to fix something that still will not unblock the run.
    const states = [halted("look", "blocked", "no milestone"), halted("gate", "forked", "ask the owner")];
    const admission = admit(SMALL, states, "write");
    if (admission.admitted) throw new Error("expected a refusal");
    assert.equal(admission.rule, "upstream-forked");
  });
});

describe("runnable", () => {
  it("lists only what may run, in declaration order", () => {
    assert.deepEqual(runnable(SMALL, []), ["look"]);
    assert.deepEqual(runnable(SMALL, [done("look")]), ["gate"]);
    assert.deepEqual(runnable(SMALL, [done("look"), done("gate")]), ["write"]);
  });

  it("is empty once everything has settled", () => {
    assert.deepEqual(runnable(SMALL, [done("look"), done("gate"), done("write")]), []);
  });
});

describe("settle", () => {
  it("records a done step with its citations", () => {
    const result = settle(SMALL, [], "look", { outcome: "done", citations: { source: "#69" } });
    if (!result.settled) throw new Error(`expected a settlement, got ${result.rule}`);
    assert.deepEqual(result.states[0], { id: "look", outcome: "done", citations: { source: "#69" }, note: null });
  });

  it("refuses to record done without a citation for every declared piece of evidence", () => {
    // Principle 3, as a refusal rather than a convention. A step that declares evidence and produces
    // none has made a claim nobody can check, which is the thing the principle forbids.
    const result = settle(SMALL, [], "look", { outcome: "done", citations: {} });
    if (result.settled) throw new Error("expected a refusal");
    assert.equal(result.rule, "uncited");
    assert.match(result.detail, /cites no source/);
  });

  it("names every missing citation, not just the first", () => {
    const states = allDoneExcept("gate-admission", "select-evaluator", "dispatch-run", "collect-evidence",
      "gate-review", "gate-land", "land");
    const result = settle(MILESTONE_WORKFLOW, states, "gate-admission", { outcome: "done", citations: {} });
    if (result.settled) throw new Error("expected a refusal");
    assert.match(result.detail, /cites no regime, allowance/);
  });

  it("treats a blank citation as no citation", () => {
    const result = settle(SMALL, [], "look", { outcome: "done", citations: { source: "   " } });
    if (result.settled) throw new Error("expected a refusal");
    assert.equal(result.rule, "uncited");
  });

  it("records a fork with its reason", () => {
    const result = settle(SMALL, [done("look")], "gate", { outcome: "forked", note: "  owner call  " });
    if (!result.settled) throw new Error("expected a settlement");
    assert.deepEqual(result.states[1], { id: "gate", outcome: "forked", citations: {}, note: "owner call" });
  });

  it("refuses a refusal with no reason", () => {
    // An unexplained blocker is indistinguishable from a crash, and gets treated as one.
    const result = settle(SMALL, [done("look")], "gate", { outcome: "blocked", note: "   " });
    if (result.settled) throw new Error("expected a refusal");
    assert.equal(result.rule, "unexplained-refusal");
  });

  it("refuses to settle a step that was not admitted in the first place", () => {
    const result = settle(SMALL, [done("look")], "write", { outcome: "done", citations: { receipt: "3c232190" } });
    if (result.settled) throw new Error("expected a refusal");
    assert.equal(result.rule, "ungated-effect");
  });

  it("does not mutate the states it was given", () => {
    const before: readonly StepState[] = [];
    const result = settle(SMALL, before, "look", { outcome: "done", citations: { source: "#69" } });
    assert.ok(result.settled);
    assert.deepEqual(before, []);
  });

  it("refuses a citation that refers to nothing, however non-empty it is", () => {
    // #203, in one line. `{ source: "x" }` satisfied the old gate — it checked that a citation was
    // present, not that it pointed at anything — so "cited" meant "the field was filled in".
    const result = settle(SMALL, [], "look", { outcome: "done", citations: { source: "x" } });
    if (result.settled) throw new Error("expected a refusal");
    assert.equal(result.rule, "unreferenced");
    assert.match(result.detail, /refers to nothing a reader could follow/);
    // The refusal quotes what was written and says what would have counted, because an agent that is
    // told only "no" writes "x2".
    assert.match(result.detail, /"x"/);
    assert.match(result.detail, /owner\/repo#123/);
  });

  it("refuses prose that reads like evidence to a human and is not", () => {
    for (const prose of ["see the PR", "verified locally", "done", "TODO"]) {
      const result = settle(SMALL, [], "look", { outcome: "done", citations: { source: prose } });
      if (result.settled) throw new Error(`expected a refusal for ${JSON.stringify(prose)}`);
      assert.equal(result.rule, "unreferenced");
    }
  });

  it("refuses a reference of the wrong kind where the step pins one", () => {
    // `land` must cite the commit. A pull request URL is what somebody cites when they mean it was
    // approved; only the merge commit says it actually landed — and a URL is a perfectly good
    // citation, so nothing but the pinned kind catches this.
    const states = allDoneExcept("land");
    const result = settle(MILESTONE_WORKFLOW, states, "land", {
      outcome: "done",
      citations: { "merge-commit": "https://github.com/rickylabs/harness/pull/232" },
    });
    if (result.settled) throw new Error("expected a refusal");
    assert.equal(result.rule, "miscited");
    assert.match(result.detail, /wanted a sha, got a url/);
  });

  it("accepts the pinned kind", () => {
    const states = allDoneExcept("land");
    const result = settle(MILESTONE_WORKFLOW, states, "land", {
      outcome: "done",
      citations: { "merge-commit": "3c23219" },
    });
    if (!result.settled) throw new Error(`expected a settlement, got ${result.rule}: ${result.detail}`);
  });

  it("reports nothing-cited before wrong-kind, so the fixes come in the order they must happen", () => {
    // `dispatch-run` owes a run id and a payload. Here the run id is the wrong kind and the payload
    // is absent; being told about the kind first sends an agent to fix the citation it did write.
    const states = allDoneExcept("dispatch-run");
    const result = settle(MILESTONE_WORKFLOW, states, "dispatch-run", {
      outcome: "done",
      citations: { "run-id": "#12" },
    });
    if (result.settled) throw new Error("expected a refusal");
    assert.equal(result.rule, "uncited");
    assert.match(result.detail, /cites no payload/);
  });

  it("satisfies every step of the real workflow with a citation of the kind it declares", () => {
    // The guard on the fixtures themselves: a step could pin a kind that nothing in this suite ever
    // supplies, and the pin would then never be exercised. Settling the whole workflow proves each
    // declared kind is satisfiable, and `allDoneExcept` above is only trustworthy because of it.
    let states: readonly StepState[] = [];
    for (const s of MILESTONE_WORKFLOW.steps) {
      const citations = Object.fromEntries(s.evidence.map((spec) => [evidenceName(spec), citationFor(spec)]));
      const result = settle(MILESTONE_WORKFLOW, states, s.id, { outcome: "done", citations });
      if (!result.settled) throw new Error(`${s.id} refused: ${result.rule} — ${result.detail}`);
      states = result.states;
    }
    assert.equal(planOf(MILESTONE_WORKFLOW, states).complete, true);
  });
});

describe("planOf", () => {
  it("is the same value for the same inputs", () => {
    // The whole reason this is a pure function: it goes in the journal, and a planner that returned
    // an equal-but-differently-shaped value would report drift on every replay.
    const states = [done("look", { source: "#69" })];
    assert.equal(canonicalJson(planOf(SMALL, states)), canonicalJson(planOf(SMALL, states)));
  });

  it("reports what is runnable and what is waiting on what", () => {
    const plan = planOf(SMALL, [done("look", { source: "#69" })]);
    assert.equal(plan.complete, false);
    assert.deepEqual(plan.done, ["look"]);
    assert.deepEqual(plan.runnable, ["gate"]);
    assert.deepEqual(
      plan.waiting.map((w) => [w.id, w.rule]),
      [["write", "ungated-effect"]],
    );
  });

  it("is complete only when every step is done", () => {
    const plan = planOf(SMALL, [done("look"), done("gate"), done("write")]);
    assert.equal(plan.complete, true);
    assert.deepEqual(plan.runnable, []);
  });

  it("surfaces forks separately from things that are merely waiting", () => {
    const plan = planOf(SMALL, [done("look"), halted("gate", "forked", "ask the owner")]);
    assert.deepEqual(plan.forks, [{ id: "gate", note: "ask the owner" }]);
    assert.equal(plan.complete, false);
    // The fork is raised, not resolved: nothing downstream became runnable.
    assert.deepEqual(plan.runnable, []);
  });

  it("keeps blocked steps out of done, however many citations they carry", () => {
    const plan = planOf(SMALL, [halted("look", "blocked", "no source")]);
    assert.deepEqual(plan.done, []);
    assert.deepEqual(plan.blocked, [{ id: "look", note: "no source" }]);
  });

  it("plans a fresh run of the real workflow as one runnable step", () => {
    const plan = planOf(MILESTONE_WORKFLOW, []);
    assert.deepEqual(plan.runnable, ["read-milestone"]);
    assert.equal(plan.waiting.length, MILESTONE_WORKFLOW.steps.length - 1);
  });
});

describe("parseStates", () => {
  it("reads a state document", () => {
    const parsed = parseStates(
      JSON.stringify({ steps: [{ id: "look", outcome: "done", citations: { source: "#69" } }] }),
    );
    assert.deepEqual(parsed.notes, []);
    assert.deepEqual(parsed.states, [{ id: "look", outcome: "done", citations: { source: "#69" }, note: null }]);
  });

  it("says so when the file is not JSON", () => {
    const parsed = parseStates("{ nope");
    assert.deepEqual(parsed.states, []);
    assert.match(parsed.notes[0] ?? "", /^state is not JSON/);
  });

  it("says so when there is no steps array", () => {
    assert.match(parseStates('{"workflow":"milestone"}').notes[0] ?? "", /no "steps" array/);
  });

  it("drops an entry with an unknown outcome and names the outcome", () => {
    // An unread step is pending, so a bad entry makes less run, never more. That is the direction a
    // reader can afford to be wrong in.
    const parsed = parseStates(JSON.stringify({ steps: [{ id: "look", outcome: "finished" }] }));
    assert.deepEqual(parsed.states, []);
    assert.match(parsed.notes[0] ?? "", /has outcome "finished"/);
  });

  it("keeps the first of a duplicated id and says which it dropped", () => {
    const parsed = parseStates(
      JSON.stringify({ steps: [{ id: "look", outcome: "done" }, { id: "look", outcome: "blocked", note: "x" }] }),
    );
    assert.equal(parsed.states.length, 1);
    assert.equal(parsed.states[0]?.outcome, "done");
    assert.match(parsed.notes[0] ?? "", /duplicate id look/);
  });

  it("drops citations that are not non-empty strings", () => {
    // A number or a null is a malformed file, not a citation somebody wrote badly, and it goes. The
    // string that merely refers to nothing is the case that is kept and noted — see `readStates`.
    const parsed = parseStates(
      JSON.stringify({ steps: [{ id: "look", outcome: "done", citations: { a: "#1", b: "", c: 7, d: null } }] }),
    );
    assert.deepEqual(parsed.states[0]?.citations, { a: "#1" });
    assert.deepEqual(parsed.notes, []);
  });

  it("names the first few dropped entries and then counts the rest", () => {
    const steps = Array.from({ length: STATE_NOTE_CAP + 3 }, (_, i) => ({ id: `s${i}`, outcome: "nope" }));
    const parsed = parseStates(JSON.stringify({ steps }));
    assert.equal(parsed.notes.length, STATE_NOTE_CAP + 1);
    assert.equal(parsed.notes[STATE_NOTE_CAP], `${STATE_NOTE_CAP + 3} step(s) dropped in total`);
  });

  it("reads an empty run without complaining", () => {
    assert.deepEqual(parseStates('{"steps":[]}'), { states: [], notes: [] });
  });
});

describe("readStates", () => {
  it("reads an already-parsed value, so replay does not round-trip through a string", () => {
    const parsed = readStates({ steps: [{ id: "look", outcome: "done", citations: { source: "#69" } }] });
    assert.deepEqual(parsed.states.map((s) => s.id), ["look"]);
  });

  it("rejects a value that is not an object", () => {
    assert.match(readStates([1, 2, 3]).notes[0] ?? "", /not a JSON object/);
  });

  it("keeps a citation that refers to nothing, and says so", () => {
    // The parity rule for state written before #203, or by hand. `settle` refuses "see the PR" going
    // in; a file that already contains it is history, and this reader does not get to improve it.
    // Dropping the value would leave the step recorded done with no citation at all — which reads
    // exactly like a clean run, and is the more dangerous of the two wrong answers.
    const parsed = readStates({
      steps: [{ id: "look", outcome: "done", citations: { source: "see the PR" } }],
    });
    assert.deepEqual(parsed.states[0]?.citations, { source: "see the PR" });
    assert.equal(parsed.states[0]?.outcome, "done");
    assert.match(parsed.notes[0] ?? "", /kept but unreferenced: look\.source cites "see the PR"/);
  });

  it("says nothing about a file whose citations all refer to something", () => {
    const parsed = readStates({
      steps: [
        { id: "look", outcome: "done", citations: { source: "#69" } },
        { id: "gate", outcome: "done", citations: { verdict: "evidence/verdict.md" } },
        { id: "write", outcome: "done", citations: { receipt: "3c23219" } },
      ],
    });
    assert.deepEqual(parsed.notes, []);
    assert.equal(parsed.states.length, 3);
  });

  it("names the first few unreferenced citations and then counts the rest", () => {
    // The same cap the dropped-entry notes use, for the same reason: a file written by a tool that
    // cited nothing correctly should produce a readable complaint, not one note per step.
    const steps = Array.from({ length: STATE_NOTE_CAP + 2 }, (_, i) => ({
      id: `s${i}`,
      outcome: "done",
      citations: { source: "nope" },
    }));
    const parsed = readStates({ steps });
    assert.equal(parsed.states.length, STATE_NOTE_CAP + 2);
    const kept = parsed.notes.filter((n) => n.startsWith("kept but unreferenced:"));
    assert.equal(kept.length, STATE_NOTE_CAP);
    assert.equal(parsed.notes[parsed.notes.length - 1], `${STATE_NOTE_CAP + 2} citation(s) refer to nothing in total`);
  });

  it("puts the dropped-entry tally before the citation notes", () => {
    // `parseStates` promises dropped entries first and then their count; adding a second class of
    // note must not reorder the first, or a caller reading notes[0] gets a different kind of thing.
    const parsed = readStates({
      steps: [
        { id: "bad", outcome: "finished" },
        { id: "look", outcome: "done", citations: { source: "nope" } },
      ],
    });
    assert.match(parsed.notes[0] ?? "", /^step 0 dropped/);
    assert.match(parsed.notes[1] ?? "", /^kept but unreferenced/);
  });

});
