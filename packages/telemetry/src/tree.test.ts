import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BoardItemRef, IssueLink, RunRecord } from "./model.js";
import { buildSnapshot } from "./snapshot.js";
import { buildTree, type EpicNode, type ItemNode, type MilestoneNode } from "./tree.js";

const NOW = "2026-09-05T12:00:00.000Z";

const ago = (minutes: number): string =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

const at = (...ns: readonly number[]): readonly IssueLink[] =>
  ns.map((number) => ({ number, from: "path" as const }));

const said = (...ns: readonly number[]): readonly IssueLink[] =>
  ns.map((number) => ({ number, from: "prose" as const }));

const run = (over: Partial<RunRecord> & { id: string }): RunRecord => ({
  source: "opencode",
  parentId: null,
  startedAt: ago(120),
  updatedAt: ago(60),
  branch: null,
  identity: { model: null, effort: null, provider: null, profile: null },
  usage: {},
  outcome: "unknown",
  linkedIssues: [],
  origin: "o",
  quota: [],
  ...over,
});

const item = (
  number: number,
  epic: string | null,
  over: Partial<BoardItemRef> = {},
): BoardItemRef => ({
  number,
  title: `item ${number}`,
  epic,
  milestone: "M1",
  phase: null,
  ...over,
});

/** Build the tree the way the CLI does: one snapshot, the same items handed over twice. */
const tree = (
  items: readonly BoardItemRef[],
  runs: readonly RunRecord[] = [],
  now: string = NOW,
): ReturnType<typeof buildTree> =>
  buildTree({
    snapshot: buildSnapshot({ generatedAt: now, runs, items }),
    items,
    now,
  });

const milestone = (t: ReturnType<typeof buildTree>, name: string | null): MilestoneNode => {
  const found = t.milestones.find((m) => m.milestone === name);
  assert.ok(found, `no milestone ${String(name)}`);
  return found;
};

const epicOf = (m: MilestoneNode, name: string | null): EpicNode => {
  const found = m.epics.find((e) => e.epic === name);
  assert.ok(found, `no epic ${String(name)}`);
  return found;
};

const numbersOf = (nodes: readonly ItemNode[]): readonly number[] =>
  nodes.map((node) => node.item.number);

describe("buildTree", () => {
  it("shows a task nobody has worked on", () => {
    // The property the flat snapshot cannot have. `buildSnapshot` groups *runs*, so an untouched
    // item is simply absent from it — which reads as "no such task" rather than "not started". On a
    // board whose largest column is triage, that is most of the board.
    const t = tree([item(85, "e9"), item(86, "e9")], [run({ id: "a", linkedIssues: at(85) })]);
    const e9 = epicOf(milestone(t, "M1"), "e9");
    assert.deepEqual(numbersOf(e9.tasks), [85, 86]);
    assert.equal(e9.tasks[1]?.runs.length, 0);
    assert.equal(e9.tasks[1]?.liveness.state, "quiet");
  });

  it("nests milestone → epic → task, sorted so two runs of the same board agree", () => {
    const t = tree([
      item(3, "e9", { milestone: "M2" }),
      item(2, "e6"),
      item(1, "e9"),
      item(4, "e9"),
    ]);
    assert.deepEqual(
      t.milestones.map((m) => m.milestone),
      ["M1", "M2"],
    );
    assert.deepEqual(
      milestone(t, "M1").epics.map((e) => e.epic),
      ["e6", "e9"],
    );
    assert.deepEqual(numbersOf(epicOf(milestone(t, "M1"), "e9").tasks), [1, 4]);
  });

  it("files an item with no epic under the null epic rather than calling it invisible", () => {
    // `buildSnapshot` groups by epic, so a run on an epic-less item lands in its `unattributed`
    // list, which renders as "runs the board cannot see". The board can see it perfectly well.
    const t = tree([item(50, null)], [run({ id: "a", linkedIssues: at(50) })]);
    assert.deepEqual(t.unattributed, []);
    const orphanEpic = epicOf(milestone(t, "M1"), null);
    assert.deepEqual(numbersOf(orphanEpic.tasks), [50]);
    assert.equal(orphanEpic.tasks[0]?.runs.length, 1);
  });

  it("keeps unattributed for what the word means: no board item at all", () => {
    const t = tree([item(85, "e9")], [run({ id: "ghost", linkedIssues: at(9999) })]);
    assert.deepEqual(
      t.unattributed.map((a) => a.run.id),
      ["ghost"],
    );
  });

  it("groups items with no milestone under their own heading instead of dropping them", () => {
    const t = tree([item(85, "e9", { milestone: null })]);
    assert.deepEqual(numbersOf(epicOf(milestone(t, null), "e9").tasks), [85]);
  });

  it("hangs the epic's own issue on the epic, not under itself as a task", () => {
    const t = tree([item(39, "e9", { isEpic: true }), item(85, "e9")]);
    const e9 = epicOf(milestone(t, "M1"), "e9");
    assert.equal(e9.item?.number, 39);
    assert.deepEqual(numbersOf(e9.tasks), [85]);
  });

  it("reports two issues claiming one epic instead of silently picking", () => {
    // The board's own `duplicate-epic-slug` anomaly arriving here. This view does not get to decide
    // which epic issue is the real one, so it says what it did.
    const t = tree([item(39, "e9", { isEpic: true }), item(40, "e9", { isEpic: true })]);
    assert.equal(epicOf(milestone(t, "M1"), "e9").item?.number, 39);
    assert.ok(t.notes.some((n) => n.includes("2 epic issues") && n.includes("#39")));
  });

  it("resolves every linked number against the feed, state included", () => {
    // Acceptance item 3: linked issue and PR state on every node. Before this, the attributed item
    // got a title and every other linked number printed bare.
    const t = tree(
      [item(85, "e9"), item(90, "e9", { kind: "pull-request", state: "closed", merged: true })],
      [run({ id: "a", linkedIssues: [...at(85), ...said(90)] })],
    );
    const node = epicOf(milestone(t, "M1"), "e9").tasks[0];
    assert.equal(node?.item.number, 85);
    assert.deepEqual(node?.links.map((l) => l.number), [90]);
    assert.equal(node?.links[0]?.item?.merged, true);
  });

  it("says so when a linked number is not on the board", () => {
    // Either a capped fetch or a reference to another repository, and an operator wants to know
    // which before trusting the screen.
    const t = tree([item(85, "e9")], [run({ id: "a", linkedIssues: [...at(85), ...said(4242)] })]);
    const node = epicOf(milestone(t, "M1"), "e9").tasks[0];
    assert.deepEqual(node?.links, [{ number: 4242, from: "prose", item: null }]);
  });

  it("keeps the strongest origin for a number and never links a node to itself", () => {
    const t = tree(
      [item(85, "e9"), item(90, "e9", { kind: "pull-request", closes: [85] })],
      [run({ id: "a", linkedIssues: [...at(85), ...said(85), ...said(90)] })],
    );
    const node = epicOf(milestone(t, "M1"), "e9").tasks[0];
    assert.deepEqual(
      node?.links.map((l) => ({ number: l.number, from: l.from })),
      [{ number: 90, from: "closes" }],
    );
    assert.equal(node?.links[0]?.item?.number, 90);
  });

  it("files a pull request under the task it says it closes", () => {
    const t = tree([item(85, "e9"), item(90, "e9", { kind: "pull-request", closes: [85] })]);
    const e9 = epicOf(milestone(t, "M1"), "e9");
    assert.deepEqual(numbersOf(e9.tasks), [85]);
    assert.deepEqual(e9.pulls, []);
  });

  it("lists a pull request that names no task one level up, rather than guessing", () => {
    // The visible edge of a seam: the projection does not emit `closes` yet, and inventing the link
    // from a branch name would attach the wrong PR to the wrong task on the busiest epics.
    const t = tree([item(85, "e9"), item(91, "e9", { kind: "pull-request" })]);
    const e9 = epicOf(milestone(t, "M1"), "e9");
    assert.deepEqual(numbersOf(e9.tasks), [85]);
    assert.deepEqual(numbersOf(e9.pulls), [91]);
  });

  it("ignores a closes pointing at a number the feed does not contain", () => {
    const t = tree([item(90, "e9", { kind: "pull-request", closes: [4242] })]);
    assert.deepEqual(numbersOf(epicOf(milestone(t, "M1"), "e9").pulls), [90]);
  });

  it("counts a subagent turn as evidence for the task above it", () => {
    const t = tree(
      [item(85, "e9")],
      [
        run({ id: "parent", linkedIssues: at(85), updatedAt: ago(300) }),
        run({ id: "child", parentId: "parent", linkedIssues: at(85), updatedAt: ago(2) }),
      ],
    );
    const node = epicOf(milestone(t, "M1"), "e9").tasks[0];
    assert.equal(node?.liveness.state, "live");
    assert.equal(node?.liveness.evidence, "turn");
  });

  it("rolls liveness up: one live task makes its epic and milestone live", () => {
    const t = tree(
      [item(85, "e9"), item(86, "e9"), item(2, "e6")],
      [run({ id: "a", linkedIssues: at(85), updatedAt: ago(1) })],
    );
    const m = milestone(t, "M1");
    assert.equal(m.liveness.state, "live");
    assert.equal(epicOf(m, "e9").liveness.state, "live");
    assert.equal(epicOf(m, "e6").liveness.state, "quiet");
  });

  it("propagates a stalled subagent all the way to the milestone", () => {
    // The exact case an open-socket check reports as healthy, and the one a status screen exists to
    // put in front of a person.
    const t = tree(
      [item(85, "e9", { updatedAt: ago(90) })],
      [run({ id: "a", linkedIssues: at(85), outcome: "running", updatedAt: ago(6 * 60) })],
    );
    assert.equal(milestone(t, "M1").liveness.state, "stalled");
  });

  it("uses the item's own mtime when no run has touched it", () => {
    const t = tree([item(85, "e9", { updatedAt: ago(30) })]);
    const node = epicOf(milestone(t, "M1"), "e9").tasks[0];
    assert.equal(node?.liveness.evidence, "item");
    assert.equal(node?.liveness.state, "recent");
  });

  it("carries the snapshot's notes and quota through, and states the time it used", () => {
    const items = [item(85, "e9")];
    const snapshot = buildSnapshot({
      generatedAt: ago(5),
      runs: [],
      items,
      notes: ["a store could not be read"],
    });
    const t = buildTree({ snapshot, items });
    assert.deepEqual(t.notes, ["a store could not be read"]);
    assert.equal(t.generatedAt, ago(5));
    // `now` defaults to the snapshot's own time, so a tree built from a saved snapshot ages its
    // nodes against when the snapshot was taken rather than against this afternoon.
    assert.equal(t.now, ago(5));
  });

  it("is deterministic: the same inputs build the same tree", () => {
    const items = [item(86, "e9"), item(2, "e6"), item(85, "e9")];
    const runs = [run({ id: "a", linkedIssues: at(85) })];
    assert.deepEqual(tree(items, runs), tree(items, runs));
  });
});
