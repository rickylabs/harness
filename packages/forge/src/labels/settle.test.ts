import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENDINGS, isEnding, settleEvent, settleStatus } from "./settle.js";
import { STATUS_LIFECYCLE, STATUS_TERMINAL, statusLabelsOf } from "./taxonomy.js";

/** The labels an item ends up carrying, so a test can assert on the shape rather than the diff. */
function apply(labels: readonly string[], ending: Parameters<typeof settleStatus>[1]): string[] {
  const { add, remove } = settleStatus(labels, ending);
  const gone = new Set(remove);
  return [...labels.filter((n) => !gone.has(n)), ...add];
}

describe("settleStatus, on a completed ending", () => {
  it("replaces the phase label with the terminal one", () => {
    const s = settleStatus(["type:fix", "status:impl-eval"], "completed");
    assert.deepEqual(s.add, [STATUS_TERMINAL]);
    assert.deepEqual(s.remove, ["status:impl-eval"]);
    assert.equal(s.changed, true);
  });

  it("leaves every label outside the status family alone", () => {
    // The dispatch label lives in this set on this repository. Stripping it on a close would
    // re-trigger an agent run on re-application, which is the one mutation that is not idempotent.
    const kept = apply(["harness", "type:feat", "epic:e6", "status:impl"], "completed");
    assert.deepEqual(kept, ["harness", "type:feat", "epic:e6", STATUS_TERMINAL]);
  });

  it("adds the terminal label to work that carried no status at all", () => {
    // This is the fourteen merged pull requests, as a unit test.
    const s = settleStatus(["type:fix"], "completed");
    assert.deepEqual(s.add, [STATUS_TERMINAL]);
    assert.deepEqual(s.remove, []);
  });

  it("does nothing to an item already settled", () => {
    const s = settleStatus(["type:fix", STATUS_TERMINAL], "completed");
    assert.equal(s.changed, false);
    assert.deepEqual(s.add, []);
    assert.deepEqual(s.remove, []);
    assert.match(s.note, /already/);
  });

  it("counts a differently-cased terminal label as the terminal label", () => {
    // Label names are unique case-insensitively on GitHub, so `Status:Shipped` *is* the label.
    // Removing it to add the lowercase spelling would be churn that reads like an event.
    const s = settleStatus(["Status:Shipped"], "completed");
    assert.equal(s.changed, false);
  });

  it("settles every phase in the lifecycle, and leaves exactly one status behind", () => {
    for (const phase of STATUS_LIFECYCLE) {
      const after = apply(["type:feat", phase], "completed");
      assert.deepEqual(statusLabelsOf(after), [STATUS_TERMINAL], `phase ${phase}`);
    }
  });

  it("collapses a multiple-status item to one label rather than adding a second", () => {
    const after = apply(["status:impl", "status:ci-fail"], "completed");
    assert.deepEqual(statusLabelsOf(after), [STATUS_TERMINAL]);
  });
});

describe("settleStatus, on a not-planned ending", () => {
  it("strips every status label and adds none", () => {
    const s = settleStatus(["type:feat", "status:impl"], "not-planned");
    assert.deepEqual(s.add, []);
    assert.deepEqual(s.remove, ["status:impl"]);
    assert.deepEqual(apply(["type:feat", "status:impl"], "not-planned"), ["type:feat"]);
  });

  it("strips a terminal label too, because abandoned work never shipped", () => {
    // A pull request closed unmerged after someone marked it ready is exactly the case the board
    // reports as `closed-unmerged`. Leaving the label on would leave the board reporting it forever.
    assert.deepEqual(settleStatus([STATUS_TERMINAL], "not-planned").remove, [STATUS_TERMINAL]);
  });

  it("is silent on an item that already carries no status", () => {
    const s = settleStatus(["type:chore"], "not-planned");
    assert.equal(s.changed, false);
    assert.match(s.note, /no status label/);
  });
});

describe("settleStatus, on a reopened item", () => {
  it("takes off the terminal label and names no replacement", () => {
    // Which phase the work resumes in is a judgement about the work. Guessing `status:impl` here
    // would put a wrong answer on the board, where a missing one gets a person to give the right.
    const s = settleStatus(["type:feat", STATUS_TERMINAL], "reopened");
    assert.deepEqual(s.remove, [STATUS_TERMINAL]);
    assert.deepEqual(s.add, []);
    assert.match(s.note, /name the phase/);
  });

  it("leaves a phase label in place — reopening mid-flight settles nothing", () => {
    const s = settleStatus(["status:impl"], "reopened");
    assert.equal(s.changed, false);
    assert.deepEqual(s.remove, []);
  });
});

describe("settleStatus, applied twice", () => {
  it("is idempotent for every ending", () => {
    for (const ending of ENDINGS) {
      const once = apply(["type:feat", "status:impl", "epic:e6"], ending);
      assert.equal(settleStatus(once, ending).changed, false, `${ending} settled twice`);
    }
  });
});

/** A `pull_request` webhook payload, cut down to the fields `settleEvent` is allowed to read. */
const prEvent = (over: {
  action?: string;
  merged?: boolean | null;
  labels?: readonly string[];
}): unknown => ({
  action: over.action ?? "closed",
  number: 158,
  pull_request: {
    number: 158,
    labels: (over.labels ?? ["status:impl-eval"]).map((name) => ({ id: 1, name, color: "fbca04" })),
    ...(over.merged === null ? {} : { merged: over.merged ?? true }),
  },
});

/** An `issues` webhook payload, likewise. `state_reason` is `null` on an issue nobody classified. */
const issueEvent = (over: {
  action?: string;
  reason?: string | null;
  labels?: readonly string[];
}): unknown => ({
  action: over.action ?? "closed",
  issue: {
    number: 157,
    labels: (over.labels ?? ["status:impl"]).map((name) => ({ id: 1, name, color: "fbca04" })),
    state_reason: over.reason === undefined ? "completed" : over.reason,
  },
});

describe("settleEvent, on a pull request", () => {
  it("reads a merged close as completed, and names the item gh will be asked to edit", () => {
    const s = settleEvent(prEvent({ merged: true }));
    assert.ok(s);
    assert.equal(s.kind, "pr");
    assert.equal(s.number, 158);
    assert.equal(s.ending, "completed");
    assert.deepEqual(s.add, [STATUS_TERMINAL]);
    assert.deepEqual(s.remove, ["status:impl-eval"]);
  });

  it("reads an unmerged close as not-planned", () => {
    const s = settleEvent(prEvent({ merged: false }));
    assert.equal(s?.ending, "not-planned");
    assert.deepEqual(s?.add, []);
  });

  it("refuses to classify a payload with no merged field rather than assuming false", () => {
    // Absent and false are not the same claim, and only one of them strips a label. If GitHub ever
    // changes the shape, this stops — it does not quietly un-ship every merged pull request.
    const s = settleEvent(prEvent({ merged: null }));
    assert.equal(s?.ending, null);
    assert.equal(s?.changed, false);
  });

  it("reads a reopen as a reopen, whatever merged says", () => {
    assert.equal(settleEvent(prEvent({ action: "reopened", merged: false }))?.ending, "reopened");
  });
});

describe("settleEvent, on an issue", () => {
  it("reads state_reason completed as completed", () => {
    const s = settleEvent(issueEvent({ reason: "completed" }));
    assert.equal(s?.kind, "issue");
    assert.equal(s?.number, 157);
    assert.deepEqual(s?.add, [STATUS_TERMINAL]);
  });

  it("reads not_planned and duplicate as the same, unlabelled ending", () => {
    for (const reason of ["not_planned", "duplicate"]) {
      const s = settleEvent(issueEvent({ reason }));
      assert.equal(s?.ending, "not-planned", reason);
      assert.deepEqual(s?.add, [], reason);
    }
  });

  it("stays out of the way when GitHub named no reason at all", () => {
    // `dsh-board` maps an unrecognised stateReason to null rather than to not-planned, for the same
    // reason: a close nobody classified is a question for a person, not a label for a robot.
    for (const reason of [null, "", "something_new"]) {
      const s = settleEvent(issueEvent({ reason }));
      assert.equal(s?.ending, null, String(reason));
      assert.equal(s?.changed, false, String(reason));
      assert.match(s?.note ?? "", /leaving it to a person/);
    }
  });
});

describe("settleEvent, on a payload it should not have been given", () => {
  it("says so rather than reporting a no-op, so a bad on: block is visible", () => {
    for (const junk of [{}, { action: "closed" }, null, "closed", 7]) {
      assert.equal(settleEvent(junk), null, JSON.stringify(junk));
    }
  });

  it("survives labels that are not the shape the schema promises", () => {
    const s = settleEvent({
      action: "closed",
      issue: { number: 3, state_reason: "completed", labels: [null, { name: 4 }, "status:impl"] },
    });
    assert.deepEqual(s?.remove, []);
    assert.deepEqual(s?.add, [STATUS_TERMINAL]);
  });

  it("prefers the pull request when a payload somehow carries both", () => {
    const s = settleEvent({
      action: "closed",
      pull_request: { number: 1, merged: true, labels: [] },
      issue: { number: 2, state_reason: "not_planned", labels: [] },
    });
    assert.equal(s?.kind, "pr");
    assert.equal(s?.number, 1);
  });
});

describe("isEnding", () => {
  it("accepts exactly the published endings", () => {
    for (const ending of ENDINGS) assert.equal(isEnding(ending), true, ending);
  });

  it("rejects GitHub's own vocabulary, which the caller has to translate", () => {
    // `merged` and `not_planned` are what the event payload says. The translation belongs at the
    // edge that reads the payload; accepting both spellings here would put it in two places.
    for (const wrong of ["merged", "not_planned", "closed", "shipped", ""]) {
      assert.equal(isEnding(wrong), false, wrong);
    }
  });
});
