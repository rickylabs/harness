import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPPOSITE_FAMILY,
  SEAM_OR_FAMILY,
  selectEvaluator,
  type Actor,
  type Candidate,
} from "./independence.js";
import { decisionOf, journalLine, parseJournal, type PersistedDecision } from "./journal.js";
import { evaluatorEntry, replayJournal, type Decider } from "./replay.js";
import type { Roster } from "./roster.js";

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
const glm: Candidate = {
  id: "run-glm",
  seam: "relay",
  family: "zhipu",
  model: "z-ai/glm-5.3-flash",
  effort: "max",
  openWeights: true,
  blockedBy: null,
};

const AT = "2026-09-05T09:00:00.000Z";

function roster(candidates: readonly Candidate[]): Roster {
  return { author, candidates };
}

function entryFor(candidates: readonly Candidate[], policy = OPPOSITE_FAMILY): PersistedDecision {
  const r = roster(candidates);
  return evaluatorEntry("evaluator:run-42", AT, r, policy, selectEvaluator(r.author, r.candidates, policy));
}

describe("evaluatorEntry", () => {
  it("persists the arguments the decision was made from, and nothing else", () => {
    const entry = entryFor([codex, sibling]);
    assert.deepEqual(Object.keys(entry.inputs).sort(), ["policy", "roster"]);
    assert.equal(entry.inputs["policy"], "opposite-family");
  });

  it("keeps the run id and the timestamp out of the inputs", () => {
    // The same fleet on Tuesday chooses what it chose on Monday. Inputs that carried a clock or a
    // run id would make every replay a diff of the calendar.
    const entry = entryFor([codex, sibling]);
    assert.equal(JSON.stringify(entry.inputs).includes("run-42"), false);
    assert.equal(JSON.stringify(entry.inputs).includes(AT), false);
    assert.equal(entry.at, AT);
    assert.equal(entry.id, "evaluator:run-42");
  });

  it("persists the decision itself, not a record wrapped around it", () => {
    const entry = entryFor([codex, sibling]);
    const output = entry.output as Record<string, unknown>;
    assert.equal(output["kind"], "selected");
    assert.equal("runId" in output, false);
    assert.equal("at" in output, false);
  });
});

describe("replayJournal", () => {
  it("re-runs a selection from its own inputs and gets the same answer", () => {
    const parsed = parseJournal(`${journalLine(entryFor([codex, sibling]))}\n`);
    const result = replayJournal(parsed.decisions);
    assert.equal(result.verdict, "identical");
    assert.equal(result.checked, 1);
    assert.equal(result.total, 1);
    assert.deepEqual(result.divergent, []);
    assert.deepEqual(result.unreplayable, []);
  });

  it("re-runs a blocked decision too — a refusal is a decision", () => {
    const entry = entryFor([sibling]);
    const output = entry.output as Record<string, unknown>;
    assert.equal(output["kind"], "blocked");
    const parsed = parseJournal(`${journalLine(entry)}\n`);
    assert.equal(replayJournal(parsed.decisions).verdict, "identical");
  });

  it("re-runs several entries, under whichever policy each one was decided by", () => {
    const text = [
      journalLine(entryFor([codex, sibling], OPPOSITE_FAMILY)),
      journalLine(evaluatorEntry(
        "evaluator:run-43",
        AT,
        roster([glm]),
        SEAM_OR_FAMILY,
        selectEvaluator(author, [glm], SEAM_OR_FAMILY),
      )),
    ].join("\n");
    const result = replayJournal(parseJournal(text).decisions);
    assert.equal(result.verdict, "identical");
    assert.equal(result.checked, 2);
  });

  it("survives the JSON round trip that a file forces on it", () => {
    // The roster leaves as data and comes back as data. If the reader and the writer disagreed
    // about a single field, this is where it would show up as a divergence.
    const entry = entryFor([codex, sibling, glm]);
    const rerun = replayJournal(parseJournal(journalLine(entry)).decisions);
    assert.deepEqual(rerun.divergent, []);
    assert.equal(rerun.checked, 1);
  });

  it("names an entry it cannot re-run, and does not count it as checked", () => {
    const unknown = decisionOf("d1", "decompose", AT, { n: 1 }, "a");
    const result = replayJournal([entryFor([codex, sibling]), unknown]);
    assert.equal(result.verdict, "identical");
    assert.equal(result.checked, 1);
    assert.equal(result.total, 2);
    assert.equal(result.unreplayable.length, 1);
    assert.equal(result.unreplayable[0]?.id, "d1");
    assert.match(result.unreplayable[0]?.why ?? "", /no decider registered for "decompose"/);
  });

  it("returns unchecked, never identical, when nothing could be re-run", () => {
    // A determinism check that returns clean for a journal it could not read is worse than no
    // check, because somebody will cite it. This is the same distinction check-lifecycle.mjs makes.
    const result = replayJournal([decisionOf("d1", "decompose", AT, { n: 1 }, "a")]);
    assert.equal(result.verdict, "unchecked");
    assert.equal(result.checked, 0);
    assert.equal(result.total, 1);
  });

  it("returns unchecked for an empty journal", () => {
    assert.equal(replayJournal([]).verdict, "unchecked");
  });

  it("refuses to replay an entry whose policy it does not know", () => {
    const entry = decisionOf("d1", "evaluator", AT, { policy: "whatever", roster: roster([codex]) }, null);
    const result = replayJournal([entry]);
    assert.equal(result.verdict, "unchecked");
    assert.match(result.unreplayable[0]?.why ?? "", /unknown policy "whatever"/);
  });

  it("refuses to replay an entry whose roster cannot be read", () => {
    const entry = decisionOf("d1", "evaluator", AT, { policy: "opposite-family", roster: { author: {} } }, null);
    const result = replayJournal([entry]);
    assert.equal(result.verdict, "unchecked");
    assert.equal(result.unreplayable[0]?.kind, "evaluator");
    assert.match(result.unreplayable[0]?.why ?? "", /author is unreadable/);
  });

  it("reports a decider that answers differently as divergent, and says where", () => {
    const flaky: Decider = { kind: "flaky", rerun: () => ({ output: { chose: "run-sibling" } }) };
    const entry = decisionOf("d1", "flaky", AT, { n: 1 }, { chose: "run-codex" });
    const result = replayJournal([entry], [flaky]);
    assert.equal(result.verdict, "divergent");
    assert.equal(result.checked, 1);
    assert.equal(result.divergent.length, 1);
    assert.equal(result.divergent[0]?.id, "d1");
    assert.deepEqual(result.divergent[0]?.at, ["chose"]);
  });

  it("prefers the divergent verdict over unchecked when both apply", () => {
    const flaky: Decider = { kind: "flaky", rerun: () => ({ output: "b" }) };
    const result = replayJournal(
      [decisionOf("d1", "flaky", AT, {}, "a"), decisionOf("d2", "decompose", AT, {}, "a")],
      [flaky],
    );
    assert.equal(result.verdict, "divergent");
    assert.equal(result.unreplayable.length, 1);
  });

  it("does not count an entry the decider declined as checked", () => {
    const refusing: Decider = { kind: "flaky", rerun: () => ({ unreadable: "the stub declined" }) };
    const result = replayJournal([decisionOf("d1", "flaky", AT, {}, "a")], [refusing]);
    assert.equal(result.checked, 0);
    assert.equal(result.verdict, "unchecked");
    assert.equal(result.unreplayable[0]?.why, "the stub declined");
  });
});
