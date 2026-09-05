import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BoardItemRef, IssueLink, QuotaReading, RunRecord } from "./model.js";
import { attributeTo, buildSnapshot, countRuns, flatten, latestQuota } from "./snapshot.js";

/** Issue links as the dispatcher's own naming produces them — the strong evidence class. */
const at = (...ns: readonly number[]): readonly IssueLink[] =>
  ns.map((number) => ({ number, from: "path" as const }));

/** The same numbers as something a person typed, which is the weak class. */
const said = (...ns: readonly number[]): readonly IssueLink[] =>
  ns.map((number) => ({ number, from: "prose" as const }));

const run = (over: Partial<RunRecord> & { id: string }): RunRecord => ({
  source: "opencode",
  parentId: null,
  startedAt: "2026-09-04T20:00:00.000Z",
  updatedAt: "2026-09-04T21:00:00.000Z",
  branch: null,
  identity: { model: null, effort: null, provider: null, profile: null },
  usage: {},
  outcome: "unknown",
  linkedIssues: [],
  origin: "o",
  quota: [],
  ...over,
});

const item = (number: number, epic: string | null, over: Partial<BoardItemRef> = {}): BoardItemRef => ({
  number,
  title: `item ${number}`,
  epic,
  milestone: "W2",
  phase: null,
  ...over,
});

const reading = (over: Partial<QuotaReading> = {}): QuotaReading => ({
  source: "codex",
  observedAt: "2026-09-04T21:00:00.000Z",
  limitId: "primary-5h",
  usedPercent: 20,
  windowMinutes: 300,
  resetsAt: null,
  planType: "pro",
  creditBalance: null,
  ...over,
});

describe("buildSnapshot", () => {
  it("groups runs under the epic of the item they link to", () => {
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "a", linkedIssues: at(39) }), run({ id: "b", linkedIssues: at(36) })],
      items: [item(39, "E9"), item(36, "E6")],
    });
    assert.deepEqual(
      snapshot.epics.map((e) => e.epic),
      ["E6", "E9"],
    );
    assert.deepEqual(snapshot.unattributed, []);
  });

  it("puts a run that joins to nothing in front of the operator, not out of sight", () => {
    // Work the board cannot see is the single most useful thing a status view can surface: it is
    // either an unlabelled task or an agent doing something nobody asked for.
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "a", linkedIssues: at(999) })],
      items: [item(39, "E9")],
    });
    assert.equal(snapshot.epics.length, 0);
    assert.deepEqual(
      snapshot.unattributed.map((a) => a.run.id),
      ["a"],
    );
  });

  it("treats an item with no epic as unattributed rather than inventing a bucket", () => {
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "a", linkedIssues: at(7) })],
      items: [item(7, null)],
    });
    assert.equal(snapshot.unattributed.length, 1);
    assert.equal(snapshot.unattributed[0]?.item?.number, 7);
  });

  it("nests subagents under the run that spawned them", () => {
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [
        run({ id: "root", linkedIssues: at(39) }),
        run({ id: "kid2", parentId: "root", startedAt: "2026-09-04T20:30:00.000Z" }),
        run({ id: "kid1", parentId: "root", startedAt: "2026-09-04T20:10:00.000Z" }),
      ],
      items: [item(39, "E9")],
    });
    const root = snapshot.epics[0]?.runs[0];
    assert.equal(root?.run.id, "root");
    assert.deepEqual(
      root?.children.map((c) => c.run.id),
      ["kid1", "kid2"],
    );
    assert.equal(countRuns(snapshot.epics[0]?.runs ?? []), 3);
  });

  it("reports an orphaned subagent as a root and says why", () => {
    // Hiding it would be the worst option: an orphan is exactly the run an operator is hunting for
    // when a parent died and its children kept spending tokens.
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "orphan", parentId: "gone" })],
      items: [],
    });
    assert.equal(snapshot.unattributed.length, 1);
    assert.match(snapshot.notes.join("\n"), /orphan names parent gone, which is not in this scan/);
  });

  it("truncates a parent cycle instead of hanging the status command", () => {
    // A store written by a live process is not a place to assume acyclicity, and a status command
    // that hangs is worse than one that admits a malformed record.
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "x", parentId: "y" }), run({ id: "y", parentId: "x" })],
      items: [],
    });
    assert.ok(snapshot.unattributed.length > 0);
    assert.match(snapshot.notes.join("\n"), /appears under itself — subagent tree truncated/);
  });

  it("does not mistake two records sharing an id for a cycle, and keeps both attributed", () => {
    // Measured on the real board: a run id is a session id, and a Claude session that was resumed or
    // compacted is written to more than one transcript, so one id arrives once per transcript. The
    // old guard was a single reached-set, so the second record was reported as a loop and returned
    // with `item: null` — its attribution thrown away on a diagnosis that was not true.
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [
        run({ id: "dup", linkedIssues: [{ number: 85, from: "path" }] }),
        run({ id: "dup", linkedIssues: [{ number: 85, from: "path" }], updatedAt: "2026-09-04T19:00:00.000Z" }),
      ],
      items: [{ number: 85, title: "task", epic: "e9", milestone: "M1", phase: null }],
    });
    assert.equal(snapshot.unattributed.length, 0);
    assert.equal(snapshot.epics[0]?.runs.length, 2);
    assert.doesNotMatch(snapshot.notes.join("\n"), /appears under itself/);
  });

  it("reports repeated ids once for the whole scan, with the count", () => {
    // 128 copies of one sentence is how the real board buried every other note in the snapshot.
    const runs = Array.from({ length: 40 }, () => run({ id: "dup" }));
    const snapshot = buildSnapshot({ generatedAt: "2026-09-04T22:00:00.000Z", runs, items: [] });
    const repeated = snapshot.notes.filter((n) => n.includes("name more than one record"));
    assert.equal(repeated.length, 1);
    assert.match(repeated[0] ?? "", /^1 run id\(s\) name more than one record/);
    assert.match(repeated[0] ?? "", /dup ×40/);
    // Nothing was dropped: every record is still a run on the snapshot.
    assert.equal(snapshot.unattributed.length, 40);
  });

  it("still walks a subagent tree once when the same id is also a root elsewhere", () => {
    // The second occurrence is not expanded again — its children were placed under the first — so a
    // repeated id inflates the run count by exactly the records that exist, never by a subtree.
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "dup" }), run({ id: "dup" }), run({ id: "kid", parentId: "dup" })],
      items: [],
    });
    assert.equal(countRuns(snapshot.unattributed), 3);
  });

  it("puts an ambiguous run in front of the operator, with the reason on the same screen", () => {
    // The note has to survive the walk, not just `attributeTo`: an operator who cannot see why a
    // run went unattributed cannot fix the branch name that would have attributed it.
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "r1", linkedIssues: said(36, 39) })],
      items: [item(39, "E9"), item(36, "E6")],
    });
    assert.equal(snapshot.epics.length, 0);
    assert.deepEqual(
      snapshot.unattributed.map((a) => a.run.id),
      ["r1"],
    );
    assert.match(snapshot.notes.join("\n"), /run r1 mentions #36, #39/);
  });

  it("carries backfill notes through, so one screen reports every gap", () => {
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [],
      items: [],
      notes: ["codex: no store configured — skipped, not empty"],
    });
    assert.deepEqual(snapshot.notes, ["codex: no store configured — skipped, not empty"]);
  });

  it("produces the same snapshot from the same inputs in a different order", () => {
    // Determinism is the reason two people reading the board see the same board.
    const runs = [
      run({ id: "b", linkedIssues: at(39), updatedAt: "2026-09-04T21:00:00.000Z" }),
      run({ id: "a", linkedIssues: at(39), updatedAt: "2026-09-04T21:00:00.000Z" }),
      run({ id: "c", linkedIssues: at(36), updatedAt: "2026-09-04T20:00:00.000Z" }),
    ];
    const items = [item(39, "E9"), item(36, "E6")];
    const first = buildSnapshot({ generatedAt: "t", runs, items });
    const second = buildSnapshot({ generatedAt: "t", runs: [...runs].reverse(), items: [...items].reverse() });
    assert.deepEqual(second, first);
  });
});

describe("latestQuota", () => {
  it("keeps only the most recent reading per seam and limit", () => {
    // A stale quota is worse than none: it has the shape of an answer, so nobody rechecks it.
    const runs = [
      run({ id: "a", quota: [reading({ usedPercent: 10, observedAt: "2026-09-04T19:00:00.000Z" })] }),
      run({ id: "b", quota: [reading({ usedPercent: 88, observedAt: "2026-09-04T21:30:00.000Z" })] }),
    ];
    const latest = latestQuota(runs);
    assert.equal(latest.length, 1);
    assert.equal(latest[0]?.usedPercent, 88);
  });

  it("keeps separate windows apart", () => {
    const latest = latestQuota([
      run({ id: "a", quota: [reading({ limitId: "primary-5h" }), reading({ limitId: "weekly" })] }),
    ]);
    assert.equal(latest.length, 2);
  });
});

describe("flatten", () => {
  it("returns parents before their children", () => {
    const snapshot = buildSnapshot({
      generatedAt: "t",
      runs: [run({ id: "root" }), run({ id: "kid", parentId: "root" })],
      items: [],
    });
    assert.deepEqual(
      flatten(snapshot.unattributed).map((a) => a.run.id),
      ["root", "kid"],
    );
  });
});

describe("attributeTo", () => {
  const items = new Map<number, BoardItemRef>([
    [39, item(39, "E9")],
    [105, item(105, "E-review")],
  ]);

  it("takes the one item the run resolves to", () => {
    const chosen = attributeTo(run({ id: "a", linkedIssues: at(39) }), items);
    assert.equal(chosen.item?.number, 39);
    assert.equal(chosen.note, null);
  });

  it("prefers the branch the dispatcher named over a number someone typed", () => {
    // This is the precedence contract, and it is why the evidence class travels with the number.
    const chosen = attributeTo(
      run({ id: "a", linkedIssues: [...at(39), ...said(105)] }),
      items,
    );
    assert.equal(chosen.item?.number, 39);
    assert.equal(chosen.note, null);
  });

  it("refuses to choose between two items of the same evidence class", () => {
    // It used to take the first number that resolved, so this run landed under E9 with nothing on
    // screen to say a choice had been made — a guess wearing the clothes of a fact (F-8 on #105).
    const chosen = attributeTo(run({ id: "r1", linkedIssues: said(39, 105) }), items);
    assert.equal(chosen.item, null);
    assert.match(chosen.note ?? "", /run r1 mentions #39, #105/);
  });

  it("refuses on two branches too, rather than trusting the lower number", () => {
    const chosen = attributeTo(run({ id: "r2", linkedIssues: at(39, 105) }), items);
    assert.equal(chosen.item, null);
    assert.match(chosen.note ?? "", /run r2 was launched against #39, #105/);
  });

  it("ignores a number this board has never heard of", () => {
    // Two mentions, one item: that is not ambiguous, it is one candidate and one irrelevance.
    const chosen = attributeTo(run({ id: "a", linkedIssues: said(39, 999) }), items);
    assert.equal(chosen.item?.number, 39);
    assert.equal(chosen.note, null);
  });

  it("says nothing at all about a run with no board evidence", () => {
    // Unattributed is the normal state of half the runs on this machine. A note per run would be
    // noise, and the run is already visible under `unattributed`.
    const chosen = attributeTo(run({ id: "a" }), items);
    assert.equal(chosen.item, null);
    assert.equal(chosen.note, null);
  });
});

describe("buildSnapshot, on the host it happens to run on", () => {
  it("orders epics by code unit rather than by the host's collation", () => {
    // Finding F-6 on #105: the reviewer's counterexample was two epic keys and identical runs. The
    // same call produced ["ä","z"] under en_US.UTF-8 and ["z","ä"] under sv_SE.UTF-8 — different
    // snapshot bytes from the same arguments, which is exactly the property this package claims.
    const snapshot = buildSnapshot({
      generatedAt: "2026-09-04T22:00:00.000Z",
      runs: [run({ id: "a", linkedIssues: at(1) }), run({ id: "b", linkedIssues: at(2) })],
      items: [item(1, "ä"), item(2, "z")],
    });
    assert.deepEqual(
      snapshot.epics.map((e) => e.epic),
      ["z", "ä"],
    );
  });

  it("orders quota readings by code unit too", () => {
    // Same defect, different sort. Seam names are ASCII today, which is precisely why this one
    // would never have failed on anyone's machine until a seam arrived that was not.
    const readings = latestQuota([
      run({ id: "a", quota: [reading({ source: "opencode", limitId: "x" })] }),
      run({ id: "b", quota: [reading({ source: "claude", limitId: "y" })] }),
      run({ id: "c", quota: [reading({ source: "codex", limitId: "z" })] }),
    ]);
    assert.deepEqual(
      readings.map((r) => r.source),
      ["claude", "codex", "opencode"],
    );
  });
});
