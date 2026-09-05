import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHierarchy } from "./hierarchy.js";
import type { SourceIssue } from "./model.js";
import { projectBoard } from "./project.js";

const AT = "2026-09-05T00:00:00.000Z";

function issue(over: Partial<SourceIssue> & { number: number }): SourceIssue {
  return {
    title: `item ${over.number}`,
    state: "open",
    labels: [],
    url: `https://example.invalid/${over.number}`,
    assignees: [],
    milestone: null,
    createdAt: AT,
    updatedAt: AT,
    kind: "issue",
    ...over,
  };
}

const tree = (issues: readonly SourceIssue[]) =>
  buildHierarchy(projectBoard(issues, { repo: "o/r", generatedAt: AT }));

describe("buildHierarchy", () => {
  it("groups tasks under the epic they are labelled into", () => {
    const h = tree([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:plan", "epic:e6"] }),
      issue({ number: 2, labels: ["status:shipped", "epic:e6"] }),
    ]);
    const epic = h.milestones[0]?.epics[0];
    assert.equal(epic?.slug, "e6");
    assert.deepEqual(epic?.tasks.map((t) => t.source.number), [1, 2]);
  });

  it("does not count an epic issue among its own tasks", () => {
    // Otherwise every epic inflates its own denominator and every board looks busier than it is.
    const h = tree([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "status:impl"] }),
      issue({ number: 1, labels: ["status:shipped", "epic:e6"] }),
    ]);
    const epic = h.milestones[0]?.epics[0];
    assert.equal(epic?.progress.total, 1);
    assert.equal(epic?.progress.shipped, 1);
    assert.ok(!epic?.tasks.some((t) => t.source.number === 36));
  });

  it("shows an epic with no tasks yet rather than hiding it", () => {
    const h = tree([issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"] })]);
    assert.equal(h.milestones[0]?.epics.length, 1);
    assert.equal(h.milestones[0]?.epics[0]?.progress.total, 0);
  });

  it("keeps a task whose epic issue does not exist, under the slug it claims", () => {
    const h = tree([issue({ number: 1, labels: ["status:plan", "epic:ghost"] })]);
    const epic = h.milestones[0]?.epics[0];
    assert.equal(epic?.slug, "ghost");
    assert.equal(epic?.issue, null);
    assert.equal(epic?.tasks.length, 1);
  });

  it("puts tasks with no epic in looseTasks, not in a fabricated one", () => {
    const h = tree([issue({ number: 1, labels: ["status:plan"] })]);
    assert.deepEqual(h.milestones[0]?.looseTasks.map((t) => t.source.number), [1]);
    assert.deepEqual(h.milestones[0]?.epics, []);
  });

  it("counts every item exactly once across the tree", () => {
    const h = tree([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:plan", "epic:e6"] }),
      issue({ number: 2, labels: ["status:plan"] }),
      issue({ number: 3, labels: ["status:plan"], milestone: "M1" }),
    ]);
    const seen = new Set<number>();
    let count = 0;
    for (const m of h.milestones) {
      for (const e of m.epics) for (const t of e.tasks) { seen.add(t.source.number); count += 1; }
      for (const t of m.looseTasks) { seen.add(t.source.number); count += 1; }
    }
    assert.equal(count, seen.size, "an item appeared twice in the tree");
    assert.equal(seen.size, 3, "every non-epic item should appear once");
  });

  it("sorts the unassigned milestone last", () => {
    const h = tree([
      issue({ number: 1, labels: ["status:plan"] }),
      issue({ number: 2, labels: ["status:plan"], milestone: "M2" }),
      issue({ number: 3, labels: ["status:plan"], milestone: "M1" }),
    ]);
    assert.deepEqual(h.milestones.map((m) => m.name), ["M1", "M2", null]);
  });

  it("rolls progress up from epics to milestone to repository", () => {
    const h = tree([
      issue({ number: 36, title: "E6 — X", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:shipped", "epic:e6"] }),
      issue({ number: 2, labels: ["status:ci-fail", "epic:e6"] }),
      issue({ number: 3, labels: ["status:impl"] }),
      issue({ number: 4, labels: [] }),
    ]);
    assert.deepEqual(h.progress, {
      total: 4,
      shipped: 1,
      inFlight: 1,
      queued: 0,
      blocked: 1,
      invisible: 1,
      abandoned: 0,
      unknown: 0,
    });
  });

  it("counts ci-fail as blocked, not as in flight", () => {
    const h = tree([issue({ number: 1, labels: ["status:ci-fail"] })]);
    assert.equal(h.progress.blocked, 1);
    assert.equal(h.progress.inFlight, 0);
  });

  it("is deterministic", () => {
    const issues = [
      issue({ number: 2, labels: ["status:plan", "epic:e6"] }),
      issue({ number: 36, title: "E6 — X", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:plan", "epic:e6"] }),
    ];
    assert.equal(JSON.stringify(tree(issues)), JSON.stringify(tree([...issues].reverse())));
  });

  it("handles an empty repository", () => {
    const h = tree([]);
    assert.deepEqual(h.milestones, []);
    assert.equal(h.progress.total, 0);
  });
});

describe("buildHierarchy, on work that stopped without landing", () => {
  it("counts a closed-unmerged pull request as abandoned rather than shipped", () => {
    const h = tree([
      issue({
        number: 9,
        kind: "pull-request",
        state: "closed",
        merged: false,
        labels: ["status:shipped"],
      }),
    ]);
    assert.equal(h.progress.abandoned, 1);
    assert.equal(h.progress.shipped, 0);
    assert.equal(h.progress.inFlight, 0, "abandoned work is not in flight either");
  });

  it("counts a merged pull request as shipped", () => {
    const h = tree([
      issue({
        number: 9,
        kind: "pull-request",
        state: "closed",
        merged: true,
        labels: ["status:shipped"],
      }),
    ]);
    assert.equal(h.progress.shipped, 1);
    assert.equal(h.progress.abandoned, 0);
  });

  it("counts a pull request whose merge state is unknown as neither", () => {
    // `merged` absent is missing evidence. It is not evidence of abandonment, and it is not
    // evidence of delivery either — which is what this assertion used to say, by counting it
    // shipped. A bucket of its own is the only reading that does not invent a fact.
    const h = tree([issue({ number: 9, kind: "pull-request", labels: ["status:shipped"] })]);
    assert.equal(h.progress.unknown, 1);
    assert.equal(h.progress.shipped, 0);
    assert.equal(h.progress.abandoned, 0);
    assert.equal(h.progress.inFlight, 0, "nor is it work in progress");
  });

  it("counts a freshly triaged issue as queued rather than running", () => {
    // The board once reported `60 running` with two agents alive, because everything the counter
    // had no bucket for became the in-flight remainder.
    const h = tree([
      issue({ number: 1, labels: ["status:triage"] }),
      issue({ number: 2, labels: ["status:impl"] }),
    ]);
    assert.equal(h.progress.queued, 1);
    assert.equal(h.progress.inFlight, 1);
  });

  it("keeps the categories disjoint and summing to the total", () => {
    const h = tree([
      issue({ number: 1, labels: ["status:shipped"] }),
      issue({ number: 2, labels: ["status:ci-fail"] }),
      issue({ number: 3, labels: ["status:impl"] }),
      issue({ number: 4, labels: [] }),
      issue({ number: 5, kind: "pull-request", state: "closed", merged: false, labels: ["status:shipped"] }),
      issue({ number: 6, labels: ["status:triage"] }),
      issue({ number: 7, kind: "pull-request", labels: ["status:shipped"] }),
    ]);
    const p = h.progress;
    assert.equal(
      p.shipped + p.blocked + p.inFlight + p.queued + p.invisible + p.abandoned + p.unknown,
      p.total,
      "every item belongs to exactly one bucket",
    );
    assert.equal(p.total, 7);
    // Named individually as well as summed: a sum can be right while two buckets are swapped.
    assert.deepEqual(
      { s: p.shipped, b: p.blocked, f: p.inFlight, q: p.queued, i: p.invisible, a: p.abandoned, u: p.unknown },
      { s: 1, b: 1, f: 1, q: 1, i: 1, a: 1, u: 1 },
    );
  });
});

describe("buildHierarchy, when two epic issues claim one slug", () => {
  const conflicting = [
    issue({ number: 41, title: "E6 — the newer one", labels: ["epic", "epic:e6"] }),
    issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "epic:e6"] }),
    issue({ number: 1, labels: ["status:plan", "epic:e6"] }),
  ];

  it("gives the slug to the lowest issue number, whatever the fetch order", () => {
    for (const order of [conflicting, [...conflicting].reverse()]) {
      const h = tree(order);
      const winner = h.milestones[0]?.epics.find((e) => e.slug === "e6");
      assert.equal(winner?.issue?.source.number, 36);
      assert.deepEqual(winner?.tasks.map((t) => t.source.number), [1]);
    }
  });

  it("still draws the loser, qualified by its number, rather than dropping it", () => {
    // An epic that vanishes from the board while staying open on GitHub is the worse failure:
    // nothing on screen says the work exists at all.
    const h = tree(conflicting);
    const loser = h.milestones[0]?.epics.find((e) => e.slug === "e6#41");
    assert.equal(loser?.issue?.source.number, 41);
    assert.equal(loser?.tasks.length, 0);
  });

  it("is deterministic across fetch order even with the conflict present", () => {
    assert.equal(
      JSON.stringify(tree(conflicting)),
      JSON.stringify(tree([...conflicting].reverse())),
    );
  });
});

describe("buildHierarchy, across milestone boundaries", () => {
  it("records where an epic really lives when a task pulls it into another milestone", () => {
    const h = tree([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "W1" }),
      issue({ number: 40, labels: ["status:plan", "epic:e6"], milestone: "W2" }),
    ]);
    const w2 = h.milestones.find((m) => m.name === "W2");
    const borrowed = w2?.epics.find((e) => e.slug === "e6");
    assert.equal(borrowed?.homeMilestone, "W1");
    assert.deepEqual(borrowed?.tasks.map((t) => t.source.number), [40]);

    const w1 = h.milestones.find((m) => m.name === "W1");
    assert.equal(w1?.epics.find((e) => e.slug === "e6")?.homeMilestone, "W1");
  });

  it("reports no home milestone as null rather than inventing one", () => {
    const h = tree([issue({ number: 36, title: "E6 — X", labels: ["epic"] })]);
    assert.equal(h.milestones[0]?.epics[0]?.homeMilestone, null);
  });

  it("counts the task once, in the milestone it is filed in", () => {
    const h = tree([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "W1" }),
      issue({ number: 40, labels: ["status:plan", "epic:e6"], milestone: "W2" }),
    ]);
    assert.equal(h.progress.total, 1);
    assert.equal(h.milestones.find((m) => m.name === "W1")?.progress.total, 0);
    assert.equal(h.milestones.find((m) => m.name === "W2")?.progress.total, 1);
  });
});

describe("buildHierarchy ordering does not depend on the host", () => {
  // `localeCompare` with no locale reads the environment: under en-US "ä" sorts before "z", under
  // sv-SE after it. A projection whose bytes depend on LANG is not the deterministic artefact #36
  // asks for, and the difference never shows up on the machine that wrote the test.
  const accented = [
    issue({ number: 1, labels: ["status:plan"], milestone: "zebra" }),
    issue({ number: 2, labels: ["status:plan"], milestone: "ärger" }),
    issue({ number: 3, labels: ["status:plan"], milestone: "Zebra" }),
  ];

  it("orders milestones by code unit, so uppercase sorts before lowercase", () => {
    // Under en-US collation this is ["ärger", "zebra", "Zebra"]; under sv-SE, ["zebra", "Zebra",
    // "ärger"]. Code units give one answer on every host, which is the only one worth committing.
    assert.deepEqual(tree(accented).milestones.map((m) => m.name), ["Zebra", "zebra", "ärger"]);
  });

  it("still sorts the unassigned milestone last, after every named one", () => {
    const withUnassigned = [...accented, issue({ number: 4, labels: ["status:plan"] })];
    assert.deepEqual(tree(withUnassigned).milestones.map((m) => m.name), [
      "Zebra",
      "zebra",
      "ärger",
      null,
    ]);
  });

  it("orders epic slugs by code unit too", () => {
    const h = tree([
      issue({ number: 1, labels: ["status:plan", "epic:zeta"] }),
      issue({ number: 2, labels: ["status:plan", "epic:ärger"] }),
      issue({ number: 3, labels: ["status:plan", "epic:Alpha"] }),
    ]);
    assert.deepEqual(h.milestones[0]?.epics.map((e) => e.slug), ["Alpha", "zeta", "ärger"]);
  });
});
