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
      issue({ number: 1, labels: ["status:ready", "epic:e6"] }),
      issue({ number: 2, labels: ["status:shipped", "epic:e6"] }),
    ]);
    const epic = h.milestones[0]?.epics[0];
    assert.equal(epic?.slug, "e6");
    assert.deepEqual(epic?.tasks.map((t) => t.source.number), [1, 2]);
  });

  it("does not count an epic issue among its own tasks", () => {
    // Otherwise every epic inflates its own denominator and every board looks busier than it is.
    const h = tree([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "status:in-progress"] }),
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
    const h = tree([issue({ number: 1, labels: ["status:ready", "epic:ghost"] })]);
    const epic = h.milestones[0]?.epics[0];
    assert.equal(epic?.slug, "ghost");
    assert.equal(epic?.issue, null);
    assert.equal(epic?.tasks.length, 1);
  });

  it("puts tasks with no epic in looseTasks, not in a fabricated one", () => {
    const h = tree([issue({ number: 1, labels: ["status:ready"] })]);
    assert.deepEqual(h.milestones[0]?.looseTasks.map((t) => t.source.number), [1]);
    assert.deepEqual(h.milestones[0]?.epics, []);
  });

  it("counts every item exactly once across the tree", () => {
    const h = tree([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:ready", "epic:e6"] }),
      issue({ number: 2, labels: ["status:ready"] }),
      issue({ number: 3, labels: ["status:ready"], milestone: "M1" }),
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
      issue({ number: 1, labels: ["status:ready"] }),
      issue({ number: 2, labels: ["status:ready"], milestone: "M2" }),
      issue({ number: 3, labels: ["status:ready"], milestone: "M1" }),
    ]);
    assert.deepEqual(h.milestones.map((m) => m.name), ["M1", "M2", null]);
  });

  it("rolls progress up from epics to milestone to repository", () => {
    const h = tree([
      issue({ number: 36, title: "E6 — X", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:shipped", "epic:e6"] }),
      issue({ number: 2, labels: ["status:blocked", "epic:e6"] }),
      issue({ number: 3, labels: ["status:in-progress"] }),
      issue({ number: 4, labels: [] }),
    ]);
    assert.deepEqual(h.progress, {
      total: 4,
      shipped: 1,
      inFlight: 1,
      blocked: 1,
      invisible: 1,
    });
  });

  it("counts changes-requested as blocked, not as in flight", () => {
    const h = tree([issue({ number: 1, labels: ["status:changes-requested"] })]);
    assert.equal(h.progress.blocked, 1);
    assert.equal(h.progress.inFlight, 0);
  });

  it("is deterministic", () => {
    const issues = [
      issue({ number: 2, labels: ["status:ready", "epic:e6"] }),
      issue({ number: 36, title: "E6 — X", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:ready", "epic:e6"] }),
    ];
    assert.equal(JSON.stringify(tree(issues)), JSON.stringify(tree([...issues].reverse())));
  });

  it("handles an empty repository", () => {
    const h = tree([]);
    assert.deepEqual(h.milestones, []);
    assert.equal(h.progress.total, 0);
  });
});
