import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHierarchy } from "./hierarchy.js";
import type { Progress } from "./hierarchy.js";
import type { SourceIssue } from "./model.js";
import { projectBoard } from "./project.js";
import {
  renderAnomalies,
  renderBar,
  renderColumns,
  renderCompleteness,
  renderHierarchy,
  renderProgress,
} from "./render.js";


/**
 * A `Progress` with every bucket at zero, overridden by `over`.
 *
 * These fixtures used to spell out all six buckets each time, so adding a seventh broke eight
 * assertions that had no opinion about it. A new bucket should force a decision in the counter,
 * not in every test that ever mentioned one.
 */
const progress = (over: Partial<Progress> = {}): Progress => ({
  total: 0,
  shipped: 0,
  inFlight: 0,
  queued: 0,
  blocked: 0,
  invisible: 0,
  abandoned: 0,
  unknown: 0,
  ...over,
});

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

const snapshotOf = (issues: readonly SourceIssue[]) =>
  projectBoard(issues, { repo: "o/r", generatedAt: AT });

describe("renderBar", () => {
  it("is empty at zero", () => {
    assert.equal(renderBar(progress({ total: 4, inFlight: 4 }), 4), "[----]");
  });

  it("is full only when everything is shipped", () => {
    assert.equal(renderBar(progress({ total: 4, shipped: 4 }), 4), "[####]");
  });

  it("never rounds an incomplete set up to full", () => {
    // 19/20 must not draw as done. A bar that reaches the end while work remains is a lie the
    // eye believes faster than the number next to it.
    const bar = renderBar(progress({ total: 20, shipped: 19, inFlight: 1 }), 20);
    assert.ok(bar.includes("-"), `expected an unfilled cell, got ${bar}`);
  });

  it("renders an empty set as an empty bar rather than dividing by zero", () => {
    assert.equal(renderBar(progress(), 4), "[    ]");
  });
});

describe("renderProgress", () => {
  it("always states the ratio, and omits zero categories", () => {
    assert.equal(
      renderProgress(progress({ total: 3, shipped: 1, inFlight: 2 })),
      "1/3 done · 2 running",
    );
  });

  it("names blocked and invisible work when there is any", () => {
    const text = renderProgress(progress({ total: 4, shipped: 1, inFlight: 1, blocked: 1, invisible: 1 }));
    assert.match(text, /1 blocked/);
    assert.match(text, /1 invisible/);
  });
});

describe("renderColumns", () => {
  it("omits empty columns but never omits unphased work", () => {
    const text = renderColumns(snapshotOf([issue({ number: 1, labels: [] })]));
    assert.ok(!text.includes("## plan"), "empty column should be omitted");
    assert.match(text, /no status label \(1\)/);
    assert.match(text, /The board cannot see them/);
  });

  it("lists an item under the column its label names", () => {
    const text = renderColumns(snapshotOf([issue({ number: 42, labels: ["status:impl"] })]));
    assert.match(text, /## impl \(1\)/);
    assert.match(text, /#42 item 42/);
  });

  it("marks draft pull requests", () => {
    const text = renderColumns(
      snapshotOf([issue({ number: 7, kind: "pull-request", draft: true, labels: ["status:impl-eval"] })]),
    );
    assert.match(text, /\(draft\)/);
  });

  it("is deterministic", () => {
    const issues = [issue({ number: 2, labels: ["status:plan"] }), issue({ number: 1, labels: ["status:plan"] })];
    assert.equal(renderColumns(snapshotOf(issues)), renderColumns(snapshotOf([...issues].reverse())));
  });
});

describe("renderHierarchy", () => {
  it("shows the epic, its bar, and its tasks", () => {
    const text = renderHierarchy(
      buildHierarchy(
        snapshotOf([
          issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "status:impl"] }),
          issue({ number: 1, labels: ["status:shipped", "epic:e6"] }),
        ]),
      ),
    );
    assert.match(text, /E6 — Coordinator #36/);
    assert.match(text, /1\/1 done/);
    assert.match(text, /shipped/);
  });

  it("names the unassigned milestone rather than printing null", () => {
    const text = renderHierarchy(buildHierarchy(snapshotOf([issue({ number: 1, labels: ["status:plan"] })])));
    assert.match(text, /\(no milestone\)/);
    assert.ok(!text.includes("null"), "a null milestone must not reach the output");
  });

  it("says so when an epic slug has no issue behind it", () => {
    const text = renderHierarchy(
      buildHierarchy(snapshotOf([issue({ number: 1, labels: ["status:plan", "epic:ghost"] })])),
    );
    assert.match(text, /no epic issue claims the slug ghost/);
  });
});

describe("renderAnomalies", () => {
  it("says so plainly when there are none", () => {
    assert.match(renderAnomalies(snapshotOf([])), /no anomalies/);
  });

  it("groups by kind and names the offending item", () => {
    const text = renderAnomalies(
      snapshotOf([issue({ number: 5, labels: ["status:plan", "status:shipped"] })]),
    );
    assert.match(text, /## multiple-status/);
    assert.match(text, /#5:/);
  });
});

describe("renderProgress, on work that stopped without landing", () => {
  it("names abandoned work separately from done and from running", () => {
    const text = renderProgress(progress({ total: 3, shipped: 1, inFlight: 1, abandoned: 1 }));
    assert.equal(text, "1/3 done · 1 running · 1 abandoned");
  });

  it("still omits the category when there is none", () => {
    assert.ok(
      !renderProgress(progress({ total: 1, shipped: 1 })).includes("abandoned"),
    );
  });
});

describe("renderCompleteness", () => {
  it("is silent when nothing was capped", () => {
    assert.equal(renderCompleteness(null), null);
    assert.equal(renderCompleteness({ limit: 500, capped: [] }), null);
  });

  it("says which kinds were cut off and at what limit", () => {
    const text = renderCompleteness({ limit: 30, capped: ["issue"] });
    assert.match(text ?? "", /INCOMPLETE/);
    assert.match(text ?? "", /issues came back at the --limit of 30/);
    assert.match(text ?? "", /may simply not have been fetched/);
  });

  it("names both kinds when both were capped", () => {
    assert.match(
      renderCompleteness({ limit: 1, capped: ["issue", "pull-request"] }) ?? "",
      /issues and pull requests/,
    );
  });
});

describe("renderHierarchy, on a board that contradicts itself", () => {
  it("counts a closed-unmerged pull request as abandoned, not as done", () => {
    const text = renderHierarchy(
      buildHierarchy(
        snapshotOf([
          issue({
            number: 9,
            kind: "pull-request",
            state: "closed",
            merged: false,
            labels: ["status:shipped"],
          }),
        ]),
      ),
    );
    assert.match(text, /0\/1 done/);
    assert.match(text, /1 abandoned/);
  });

  it("says where an epic really lives when it is drawn under another milestone", () => {
    // The task is filed in W2, the epic in W1. The epic has to appear in W2 or the task loses its
    // parent — but it must not read as a second epic that happens to share a title.
    const text = renderHierarchy(
      buildHierarchy(
        snapshotOf([
          issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "W1" }),
          issue({ number: 40, labels: ["status:plan", "epic:e6"], milestone: "W2" }),
        ]),
      ),
    );
    assert.match(text, /\(epic is in W1\)/);
  });

  it("does not add the note when the epic is under its own milestone", () => {
    const text = renderHierarchy(
      buildHierarchy(
        snapshotOf([
          issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "W1" }),
          issue({ number: 40, labels: ["status:plan", "epic:e6"], milestone: "W1" }),
        ]),
      ),
    );
    assert.ok(!text.includes("epic is in"));
  });
});

describe("renderAnomalies, on anomalies that belong to no item", () => {
  it("omits the issue prefix rather than blaming an arbitrary issue", () => {
    const snapshot = projectBoard([issue({ number: 5, labels: ["status:plan"] })], {
      repo: "o/r",
      generatedAt: AT,
      completeness: { limit: 1, capped: ["issue"] },
    });
    const text = renderAnomalies(snapshot);
    assert.match(text, /## incomplete-fetch/);
    const line = text.split("\n").find((l) => l.includes("--limit")) ?? "";
    assert.ok(!/#\d+:/.test(line), `board-level anomaly must not name an item: ${line}`);
  });

  it("orders kinds identically whatever the host locale", () => {
    const snapshot = snapshotOf([
      issue({ number: 5, labels: ["status:plan", "status:shipped"] }),
      issue({ number: 6, labels: ["status:nonsense"] }),
    ]);
    const kinds = renderAnomalies(snapshot)
      .split("\n")
      .filter((l) => l.startsWith("## "));
    assert.deepEqual(kinds, [...kinds].sort());
  });
});
