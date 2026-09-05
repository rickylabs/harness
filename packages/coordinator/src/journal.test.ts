import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareJournals,
  decisionOf,
  journalLine,
  parseJournal,
  planDigest,
  JOURNAL_NOTE_CAP,
  type PersistedDecision,
} from "./journal.js";

const AT = "2026-09-05T09:00:00.000Z";
const LATER = "2026-09-06T17:30:00.000Z";

function entry(id: string, inputs: Readonly<Record<string, unknown>>, output: unknown, at = AT): PersistedDecision {
  return decisionOf(id, "evaluator", at, inputs, output);
}

describe("decisionOf", () => {
  it("digests the inputs and the output separately", () => {
    const decision = entry("d1", { policy: "opposite-family" }, { chose: "run-codex" });
    assert.notEqual(decision.inputDigest, decision.outputDigest);
    assert.match(decision.inputDigest, /^sha256:[0-9a-f]{16}$/);
  });

  it("leaves the timestamp out of both digests", () => {
    // A replay an hour later is still the same decision. A journal whose digests move with the clock
    // reports drift every time it is checked, and is switched off within a week.
    const early = entry("d1", { policy: "opposite-family" }, { chose: "run-codex" }, AT);
    const late = entry("d1", { policy: "opposite-family" }, { chose: "run-codex" }, LATER);
    assert.notEqual(early.at, late.at);
    assert.equal(early.inputDigest, late.inputDigest);
    assert.equal(early.outputDigest, late.outputDigest);
  });

  it("digests inputs that differ only in key order the same", () => {
    const a = entry("d1", { policy: "p", roster: { author: "x" } }, null);
    const b = entry("d1", { roster: { author: "x" }, policy: "p" }, null);
    assert.equal(a.inputDigest, b.inputDigest);
  });
});

describe("planDigest", () => {
  it("changes when the decisions are reordered", () => {
    const a = entry("d1", { n: 1 }, "a");
    const b = entry("d2", { n: 2 }, "b");
    assert.notEqual(planDigest([a, b]), planDigest([b, a]));
  });

  it("does not change when only the timestamps move", () => {
    const before = [entry("d1", { n: 1 }, "a", AT), entry("d2", { n: 2 }, "b", AT)];
    const after = [entry("d1", { n: 1 }, "a", LATER), entry("d2", { n: 2 }, "b", LATER)];
    assert.equal(planDigest(before), planDigest(after));
  });

  it("is stable for the empty plan", () => {
    assert.equal(planDigest([]), planDigest([]));
  });
});

describe("journalLine", () => {
  it("is exactly one line, so the file stays JSONL", () => {
    const line = journalLine(entry("d1", { note: "a\nb" }, { text: "c\nd" }));
    assert.equal(line.includes("\n"), false);
  });

  it("round-trips through parseJournal", () => {
    const decision = entry("evaluator:run-42", { policy: "opposite-family", n: 1 }, { chose: "run-codex" });
    const parsed = parseJournal(`${journalLine(decision)}\n`);
    assert.deepEqual(parsed.notes, []);
    assert.equal(parsed.decisions.length, 1);
    assert.deepEqual(parsed.decisions[0], decision);
  });
});

describe("parseJournal", () => {
  it("skips blank lines without complaining about them", () => {
    const text = `\n${journalLine(entry("d1", { n: 1 }, "a"))}\n\n`;
    const parsed = parseJournal(text);
    assert.equal(parsed.decisions.length, 1);
    assert.deepEqual(parsed.notes, []);
  });

  it("recomputes the digests instead of trusting the ones in the file", () => {
    // A journal is a file, and files are edited. A determinism check that believes a digest it was
    // handed can be made to pass by editing it.
    const forged = JSON.stringify({
      id: "d1",
      kind: "evaluator",
      at: AT,
      inputs: { n: 1 },
      output: "a",
      inputDigest: "sha256:0000000000000000",
      outputDigest: "sha256:0000000000000000",
    });
    const parsed = parseJournal(forged);
    const honest = entry("d1", { n: 1 }, "a");
    assert.equal(parsed.decisions[0]?.inputDigest, honest.inputDigest);
    assert.notEqual(parsed.decisions[0]?.inputDigest, "sha256:0000000000000000");
  });

  it("drops a malformed line by line number and keeps the rest", () => {
    const text = [journalLine(entry("d1", { n: 1 }, "a")), "{ not json", journalLine(entry("d2", { n: 2 }, "b"))].join(
      "\n",
    );
    const parsed = parseJournal(text);
    assert.equal(parsed.decisions.length, 2);
    assert.equal(parsed.notes.length, 1);
    assert.match(parsed.notes[0] ?? "", /^line 2 dropped: not JSON/);
  });

  it("names the missing field on a line that is JSON but not a decision", () => {
    const parsed = parseJournal(JSON.stringify({ kind: "evaluator", inputs: {} }));
    assert.deepEqual(parsed.decisions, []);
    assert.deepEqual(parsed.notes, ["line 1 dropped: no id"]);
  });

  it("requires an inputs object, because an outcome without its inputs cannot be replayed", () => {
    const parsed = parseJournal(JSON.stringify({ id: "d1", kind: "evaluator", output: "a" }));
    assert.deepEqual(parsed.notes, ["line 1 dropped: no inputs object"]);
  });

  it("names at most JOURNAL_NOTE_CAP bad lines, then counts the rest", () => {
    const text = Array.from({ length: JOURNAL_NOTE_CAP + 3 }, () => "{ not json").join("\n");
    const parsed = parseJournal(text);
    assert.equal(parsed.notes.length, JOURNAL_NOTE_CAP + 1);
    assert.equal(
      parsed.notes[parsed.notes.length - 1],
      `${String(JOURNAL_NOTE_CAP + 3)} line(s) dropped in total`,
    );
  });

  it("says when an id repeats, because a diff cannot join on it", () => {
    const text = [journalLine(entry("d1", { n: 1 }, "a")), journalLine(entry("d1", { n: 2 }, "b"))].join("\n");
    const parsed = parseJournal(text);
    assert.equal(parsed.decisions.length, 2);
    assert.match(parsed.notes[0] ?? "", /decision id d1 appears more than once/);
  });
});

describe("compareJournals", () => {
  it("calls two identical journals identical, with no changes", () => {
    const journal = [entry("d1", { n: 1 }, "a"), entry("d2", { n: 2 }, "b")];
    const comparison = compareJournals(journal, journal);
    assert.equal(comparison.identical, true);
    assert.deepEqual(comparison.changes, []);
    assert.equal(comparison.unexplained, 0);
    assert.equal(comparison.planBefore, comparison.planAfter);
  });

  it("ignores a changed timestamp", () => {
    const before = [entry("d1", { n: 1 }, "a", AT)];
    const after = [entry("d1", { n: 1 }, "a", LATER)];
    assert.equal(compareJournals(before, after).identical, true);
  });

  it("attributes a changed output to the named input that changed", () => {
    // Acceptance item 3 of #71, in one assertion.
    const before = [entry("d1", { roster: { candidates: [{ blockedBy: null }] } }, "run-fable")];
    const after = [entry("d1", { roster: { candidates: [{ blockedBy: "quota" }] } }, "run-codex")];
    const comparison = compareJournals(before, after);
    assert.equal(comparison.identical, false);
    assert.equal(comparison.unexplained, 0);
    const change = comparison.changes[0];
    assert.equal(change?.kind, "explained");
    if (change?.kind !== "explained") throw new Error("expected an explained change");
    assert.deepEqual(change.inputs, ["roster.candidates[0].blockedBy"]);
    assert.equal(change.outputChanged, true);
  });

  it("reports an unchanged output under a changed input as explained, not silent", () => {
    const before = [entry("d1", { note: "one" }, "same")];
    const after = [entry("d1", { note: "two" }, "same")];
    const change = compareJournals(before, after).changes[0];
    if (change?.kind !== "explained") throw new Error("expected an explained change");
    assert.equal(change.outputChanged, false);
    assert.deepEqual(change.inputs, ["note"]);
  });

  it("calls a changed output with identical inputs unexplained, not a plan change", () => {
    // The finding this whole comparison exists for. It means the code is wrong, not that the world
    // moved on, and it must never be reported as an ordinary diff line.
    const before = [entry("d1", { n: 1 }, { chose: "run-codex" })];
    const after = [entry("d1", { n: 1 }, { chose: "run-sibling" })];
    const comparison = compareJournals(before, after);
    assert.equal(comparison.unexplained, 1);
    const change = comparison.changes[0];
    if (change?.kind !== "unexplained") throw new Error("expected an unexplained change");
    assert.deepEqual(change.output, ["chose"]);
  });

  it("reports decisions that appeared and disappeared", () => {
    const before = [entry("d1", { n: 1 }, "a")];
    const after = [entry("d2", { n: 2 }, "b")];
    const kinds = compareJournals(before, after).changes.map((c) => `${c.kind}:${c.id}`);
    assert.deepEqual(kinds.sort(), ["added:d2", "removed:d1"]);
  });

  it("reports a decision that moved, with both positions", () => {
    const a = entry("d1", { n: 1 }, "a");
    const b = entry("d2", { n: 2 }, "b");
    const comparison = compareJournals([a, b], [b, a]);
    const moved = comparison.changes.filter((c) => c.kind === "moved");
    assert.equal(moved.length, 2);
    const first = moved[0];
    if (first?.kind !== "moved") throw new Error("expected a moved change");
    assert.equal(first.id, "d1");
    assert.equal(first.from, 0);
    assert.equal(first.to, 1);
  });

  it("orders changes by id so two runs of the same comparison read the same", () => {
    const before = [entry("z", { n: 1 }, "a"), entry("a", { n: 1 }, "a")];
    const after = [entry("z", { n: 2 }, "a"), entry("a", { n: 2 }, "a")];
    const ids = compareJournals(before, after).changes.map((c) => c.id);
    assert.deepEqual(ids, [...ids].sort());
  });
});
