import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normaliseItems, parseItems, toRef } from "./items.js";

/**
 * One item exactly as `dsh-board snapshot` emits it.
 *
 * Written out longhand rather than imported, because importing it would mean depending on
 * `@rickylabs/board` — which is the dependency this package does not take, and the reason the
 * mismatch this module fixes went unnoticed in the first place. Longhand means the fixture can go
 * stale, so `board/src/model.ts` is the thing to check when this test starts disagreeing with
 * reality: `source` holds the GitHub fields, `epic`/`isEpic`/`phase` sit at the top level, and
 * `phase` is an object.
 */
const projected = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  source: {
    number: 85,
    title: "E9.3 — the hierarchy view",
    state: "open",
    labels: ["epic:e9", "status:triage"],
    url: "https://github.com/rickylabs/harness/issues/85",
    assignees: [],
    milestone: "M1 — dsh coordinator foundation",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-04T18:00:00.000Z",
    kind: "issue",
  },
  phase: { label: "status:triage", name: "triage", terminal: false, queued: true },
  epic: "e9",
  lane: null,
  priority: "p1",
  type: "feat",
  isEpic: false,
  ...over,
});

describe("toRef", () => {
  it("reads a projection item, whose fields are nested under source", () => {
    // The exact failure this module exists to prevent: before it, `number` came back undefined for
    // every item in a `dsh-board snapshot`, every run went unattributed, and the board looked idle.
    const ref = toRef(projected());
    assert.equal(ref?.number, 85);
    assert.equal(ref?.title, "E9.3 — the hierarchy view");
    assert.equal(ref?.milestone, "M1 — dsh coordinator foundation");
    assert.equal(ref?.epic, "e9");
    assert.equal(ref?.state, "open");
    assert.equal(ref?.kind, "issue");
    assert.equal(ref?.updatedAt, "2026-09-04T18:00:00.000Z");
  });

  it("flattens the phase object to the column name a reader would say out loud", () => {
    assert.equal(toRef(projected())?.phase, "triage");
    // A hand-written feed carries the same fact as a string, and both are the item's column.
    assert.equal(toRef({ number: 1, phase: "impl-eval" })?.phase, "impl-eval");
    // Only a label, no name: still better than dropping the column entirely.
    assert.equal(toRef({ number: 1, phase: { label: "status:impl" } })?.phase, "status:impl");
    assert.equal(toRef({ number: 1, phase: null })?.phase, null);
  });

  it("reads a flat hand-written ref, which is what the documented --items format is", () => {
    const ref = toRef({ number: 39, title: "E9", epic: "e9", milestone: "M1", phase: null });
    assert.equal(ref?.number, 39);
    assert.equal(ref?.title, "E9");
  });

  it("keeps a top-level field over the nested one, so an adapted feed can override", () => {
    const ref = toRef(projected({ title: "renamed by the producer" }));
    assert.equal(ref?.title, "renamed by the producer");
  });

  it("refuses anything without a usable item number", () => {
    assert.equal(toRef({ title: "no number" }), null);
    assert.equal(toRef({ number: "85" }), null);
    assert.equal(toRef({ number: 0 }), null);
    assert.equal(toRef({ number: -1 }), null);
    assert.equal(toRef({ number: 1.5 }), null);
    assert.equal(toRef(null), null);
    assert.equal(toRef([1, 2]), null);
    assert.equal(toRef("85"), null);
  });

  it("leaves unsaid fields absent rather than defaulting them", () => {
    // A defaulted `state: "open"` on an item nobody described reads exactly like a fact. The
    // distinction is load-bearing: `state === undefined` means unknown, and never means open.
    const ref = toRef({ number: 7 });
    assert.ok(ref !== null);
    assert.ok(!("state" in ref));
    assert.ok(!("kind" in ref));
    assert.ok(!("merged" in ref));
    assert.ok(!("updatedAt" in ref));
    assert.equal(ref.title, "");
    assert.equal(ref.epic, null);
  });

  it("drops values of the wrong type instead of carrying them through", () => {
    const ref = toRef({ number: 7, state: "half-open", kind: "epic", merged: "yes", title: 12 });
    assert.ok(ref !== null);
    assert.ok(!("state" in ref));
    assert.ok(!("kind" in ref));
    assert.ok(!("merged" in ref));
    assert.equal(ref.title, "");
  });

  it("reads closes as the seam it is: numbers only, empty means nobody said", () => {
    assert.deepEqual(toRef({ number: 90, closes: [85, 85, "x", 0, 39] })?.closes, [85, 39]);
    assert.ok(!("closes" in (toRef({ number: 90, closes: [] }) ?? {})));
    assert.ok(!("closes" in (toRef({ number: 90, closes: "85" }) ?? {})));
  });
});

describe("normaliseItems", () => {
  it("accepts the board snapshot envelope, not only a bare array", () => {
    // `dsh-board snapshot` writes `{ items: [...] }`. The old loader required an array, so piping
    // one command into the other produced "is not a JSON array" — or worse, silence.
    const loaded = normaliseItems({ items: [projected()], anomalies: [] }, "board.json");
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.notes, []);
    assert.deepEqual(
      loaded.items.map((i) => i.number),
      [85],
    );
  });

  it("accepts a bare array too", () => {
    const loaded = normaliseItems([{ number: 1 }, { number: 2 }], "items.json");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.items.length, 2);
  });

  it("refuses a shape that is neither, and says which file", () => {
    const loaded = normaliseItems({ columns: [] }, "board.json");
    assert.equal(loaded.ok, false);
    assert.deepEqual(loaded.items, []);
    assert.match(loaded.notes[0] ?? "", /board\.json/);
  });

  it("drops an unreadable entry, keeps the rest, and names the index", () => {
    // Partial is fine; quiet is not. A feed that half-parsed and said so is usable evidence.
    const loaded = normaliseItems([{ number: 1 }, { title: "?" }, { number: 3 }], "items.json");
    assert.equal(loaded.ok, false);
    assert.deepEqual(
      loaded.items.map((i) => i.number),
      [1, 3],
    );
    assert.ok(loaded.notes.some((n) => n.includes("entry 1")));
  });

  it("keeps the first of a repeated number and reports the collision", () => {
    const loaded = normaliseItems(
      [
        { number: 85, title: "first" },
        { number: 85, title: "second" },
      ],
      "items.json",
    );
    assert.equal(loaded.ok, false);
    assert.deepEqual(
      loaded.items.map((i) => i.title),
      ["first"],
    );
    assert.ok(loaded.notes.some((n) => n.includes("#85") && n.includes("kept the first")));
  });

  it("caps the notes, because four thousand notes is the same as none", () => {
    const loaded = normaliseItems(Array.from({ length: 40 }, () => ({})), "items.json");
    assert.equal(loaded.ok, false);
    assert.ok(loaded.notes.length <= 7);
    assert.ok(loaded.notes.some((n) => n.includes("further entries")));
    // The summary still carries the real count, so the cap loses detail and never loses the scale.
    assert.ok(loaded.notes.some((n) => n.includes("40 entries unreadable")));
  });
});

describe("parseItems", () => {
  it("turns a file that is not JSON into a note rather than a crash", () => {
    const loaded = parseItems("not json", "items.json");
    assert.equal(loaded.ok, false);
    assert.deepEqual(loaded.items, []);
    assert.match(loaded.notes[0] ?? "", /items\.json is not valid JSON/);
  });

  it("round-trips a serialised board snapshot", () => {
    const loaded = parseItems(JSON.stringify({ items: [projected()] }), "board.json");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.items[0]?.number, 85);
  });
});
