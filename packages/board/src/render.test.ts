import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHierarchy } from "./hierarchy.js";
import type { SourceIssue } from "./model.js";
import { projectBoard } from "./project.js";
import { renderAnomalies, renderBar, renderColumns, renderHierarchy, renderProgress } from "./render.js";

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
    assert.equal(renderBar({ total: 4, shipped: 0, inFlight: 4, blocked: 0, invisible: 0 }, 4), "[----]");
  });

  it("is full only when everything is shipped", () => {
    assert.equal(renderBar({ total: 4, shipped: 4, inFlight: 0, blocked: 0, invisible: 0 }, 4), "[####]");
  });

  it("never rounds an incomplete set up to full", () => {
    // 19/20 must not draw as done. A bar that reaches the end while work remains is a lie the
    // eye believes faster than the number next to it.
    const bar = renderBar({ total: 20, shipped: 19, inFlight: 1, blocked: 0, invisible: 0 }, 20);
    assert.ok(bar.includes("-"), `expected an unfilled cell, got ${bar}`);
  });

  it("renders an empty set as an empty bar rather than dividing by zero", () => {
    assert.equal(renderBar({ total: 0, shipped: 0, inFlight: 0, blocked: 0, invisible: 0 }, 4), "[    ]");
  });
});

describe("renderProgress", () => {
  it("always states the ratio, and omits zero categories", () => {
    assert.equal(
      renderProgress({ total: 3, shipped: 1, inFlight: 2, blocked: 0, invisible: 0 }),
      "1/3 done · 2 running",
    );
  });

  it("names blocked and invisible work when there is any", () => {
    const text = renderProgress({ total: 4, shipped: 1, inFlight: 1, blocked: 1, invisible: 1 });
    assert.match(text, /1 blocked/);
    assert.match(text, /1 invisible/);
  });
});

describe("renderColumns", () => {
  it("omits empty columns but never omits unphased work", () => {
    const text = renderColumns(snapshotOf([issue({ number: 1, labels: [] })]));
    assert.ok(!text.includes("## ready"), "empty column should be omitted");
    assert.match(text, /no status label \(1\)/);
    assert.match(text, /The board cannot see them/);
  });

  it("lists an item under the column its label names", () => {
    const text = renderColumns(snapshotOf([issue({ number: 42, labels: ["status:in-progress"] })]));
    assert.match(text, /## in-progress \(1\)/);
    assert.match(text, /#42 item 42/);
  });

  it("marks draft pull requests", () => {
    const text = renderColumns(
      snapshotOf([issue({ number: 7, kind: "pull-request", draft: true, labels: ["status:in-review"] })]),
    );
    assert.match(text, /\(draft\)/);
  });

  it("is deterministic", () => {
    const issues = [issue({ number: 2, labels: ["status:ready"] }), issue({ number: 1, labels: ["status:ready"] })];
    assert.equal(renderColumns(snapshotOf(issues)), renderColumns(snapshotOf([...issues].reverse())));
  });
});

describe("renderHierarchy", () => {
  it("shows the epic, its bar, and its tasks", () => {
    const text = renderHierarchy(
      buildHierarchy(
        snapshotOf([
          issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "status:in-progress"] }),
          issue({ number: 1, labels: ["status:shipped", "epic:e6"] }),
        ]),
      ),
    );
    assert.match(text, /E6 — Coordinator #36/);
    assert.match(text, /1\/1 done/);
    assert.match(text, /shipped/);
  });

  it("names the unassigned milestone rather than printing null", () => {
    const text = renderHierarchy(buildHierarchy(snapshotOf([issue({ number: 1, labels: ["status:ready"] })])));
    assert.match(text, /\(no milestone\)/);
    assert.ok(!text.includes("null"), "a null milestone must not reach the output");
  });

  it("says so when an epic slug has no issue behind it", () => {
    const text = renderHierarchy(
      buildHierarchy(snapshotOf([issue({ number: 1, labels: ["status:ready", "epic:ghost"] })])),
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
      snapshotOf([issue({ number: 5, labels: ["status:ready", "status:shipped"] })]),
    );
    assert.match(text, /## multiple-status/);
    assert.match(text, /#5:/);
  });
});
