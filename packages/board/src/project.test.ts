import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_LIFECYCLE,
  phaseOf,
  statusLabelsOf,
  unknownStatusLabels,
  violatesSingleStatus,
} from "./lifecycle.js";
import { isAbandoned, isShipped, labelValue, labelValues } from "./model.js";
import type { SourceIssue } from "./model.js";
import { projectBoard, slugOfEpicTitle } from "./project.js";

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

const project = (issues: readonly SourceIssue[]) =>
  projectBoard(issues, { repo: "o/r", generatedAt: AT });

describe("statusLabelsOf", () => {
  it("matches only on the prefix boundary", () => {
    // `status-quo` and `statusline` are not status labels. Treating them as one would move an
    // item into a column nobody asked for.
    assert.deepEqual(statusLabelsOf(["status-quo", "statusline", "status:ready"]), ["status:ready"]);
  });

  it("returns an empty list when there are none", () => {
    assert.deepEqual(statusLabelsOf(["type:bug", "priority:p1"]), []);
  });
});

describe("phaseOf", () => {
  it("reads the phase from the label", () => {
    assert.equal(phaseOf(["status:in-progress"])?.name, "in-progress");
  });

  it("returns null with no status label", () => {
    assert.equal(phaseOf(["type:bug"]), null);
  });

  it("returns null for a status label outside the lifecycle", () => {
    assert.equal(phaseOf(["status:invented"]), null);
  });

  it("takes the earliest phase when an item claims several, under-stating rather than flattering", () => {
    const phase = phaseOf(["status:shipped", "status:in-progress"]);
    assert.equal(phase?.name, "in-progress");
  });

  it("marks only shipped as terminal", () => {
    for (const p of DEFAULT_LIFECYCLE.phases) {
      assert.equal(p.terminal, p.name === "shipped", `${p.name} terminality`);
    }
  });
});

describe("violatesSingleStatus", () => {
  it("is false for zero and one", () => {
    assert.equal(violatesSingleStatus([]), false);
    assert.equal(violatesSingleStatus(["status:ready"]), false);
  });

  it("is true for two", () => {
    assert.equal(violatesSingleStatus(["status:ready", "status:shipped"]), true);
  });

  it("is not fooled by a near-miss label", () => {
    assert.equal(violatesSingleStatus(["status:ready", "status-quo"]), false);
  });
});

describe("unknownStatusLabels", () => {
  it("reports status labels the lifecycle does not define", () => {
    assert.deepEqual(unknownStatusLabels(["status:ready", "status:invented"]), ["status:invented"]);
  });
});

describe("labelValue", () => {
  it("reads a family value", () => {
    assert.equal(labelValue(["epic:e6", "type:bug"], "epic"), "e6");
  });

  it("ignores a bare family label with no value", () => {
    assert.equal(labelValue(["epic:"], "epic"), null);
  });

  it("returns null when absent", () => {
    assert.equal(labelValue(["type:bug"], "epic"), null);
  });
});

describe("projectBoard", () => {
  it("places items in the column their label names", () => {
    const snapshot = project([
      issue({ number: 1, labels: ["status:ready"] }),
      issue({ number: 2, labels: ["status:in-progress"] }),
    ]);
    const ready = snapshot.columns.find((c) => c.phase.name === "ready");
    assert.deepEqual(ready?.items.map((i) => i.source.number), [1]);
  });

  it("is deterministic: the same input projects to an identical snapshot", () => {
    const issues = [
      issue({ number: 3, labels: ["status:ready", "priority:p2"] }),
      issue({ number: 1, labels: ["status:ready", "priority:p0"] }),
      issue({ number: 2, labels: ["status:ready"] }),
    ];
    assert.deepEqual(project(issues), project(issues));
    assert.equal(JSON.stringify(project(issues)), JSON.stringify(project(issues)));
  });

  it("does not depend on input order", () => {
    const a = [issue({ number: 1, labels: ["status:ready"] }), issue({ number: 2, labels: ["status:ready"] })];
    const b = [...a].reverse();
    assert.equal(JSON.stringify(project(a).items), JSON.stringify(project(b).items));
  });

  it("orders by priority, then by number", () => {
    const snapshot = project([
      issue({ number: 5, labels: ["status:ready", "priority:p3"] }),
      issue({ number: 4, labels: ["status:ready", "priority:p0"] }),
      issue({ number: 9, labels: ["status:ready", "priority:p0"] }),
      issue({ number: 1, labels: ["status:ready"] }),
    ]);
    assert.deepEqual(snapshot.items.map((i) => i.source.number), [4, 9, 5, 1]);
  });

  it("collects items with no status label as unphased rather than dropping them", () => {
    const snapshot = project([issue({ number: 7, labels: ["type:bug"] })]);
    assert.deepEqual(snapshot.unphased.map((i) => i.source.number), [7]);
    assert.ok(snapshot.columns.every((c) => c.items.length === 0));
  });

  it("reports an item carrying two status labels", () => {
    const snapshot = project([issue({ number: 1, labels: ["status:ready", "status:shipped"] })]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "multiple-status");
    assert.ok(anomaly, "expected a multiple-status anomaly");
    assert.equal(anomaly?.item, 1);
  });

  it("reports a closed item still sitting in a non-terminal column", () => {
    const snapshot = project([issue({ number: 1, state: "closed", labels: ["status:in-progress"] })]);
    assert.ok(snapshot.anomalies.some((a) => a.kind === "closed-but-unshipped"));
  });

  it("reports an open item sitting in the terminal column", () => {
    const snapshot = project([issue({ number: 1, state: "open", labels: ["status:shipped"] })]);
    assert.ok(snapshot.anomalies.some((a) => a.kind === "shipped-but-open"));
  });

  it("does not report no-status for closed items, which are allowed to be unlabelled", () => {
    const snapshot = project([issue({ number: 1, state: "closed", labels: [] })]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "no-status"));
  });

  it("reports an epic label that no epic issue claims", () => {
    const snapshot = project([issue({ number: 1, labels: ["status:ready", "epic:ghost"] })]);
    assert.ok(snapshot.anomalies.some((a) => a.kind === "epic-not-found"));
  });

  it("does not report an epic label that an epic issue does claim", () => {
    const snapshot = project([
      issue({ number: 30, title: "E6 — Coordinator", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:ready", "epic:e6"] }),
    ]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "epic-not-found"));
  });

  it("honours a custom lane prefix", () => {
    const snapshot = projectBoard([issue({ number: 1, labels: ["orchestrator:arch"] })], {
      repo: "o/r",
      generatedAt: AT,
      lanePrefix: "orchestrator",
    });
    assert.equal(snapshot.items[0]?.lane, "arch");
  });

  it("records generatedAt from the argument, never from the clock", () => {
    assert.equal(project([]).generatedAt, AT);
  });

  it("projects an empty repository without inventing anything", () => {
    const snapshot = project([]);
    assert.deepEqual(snapshot.items, []);
    assert.deepEqual(snapshot.anomalies, []);
    assert.equal(snapshot.columns.length, DEFAULT_LIFECYCLE.phases.length);
  });
});

describe("slugOfEpicTitle", () => {
  it("reads the identifier from a real epic title", () => {
    assert.equal(slugOfEpicTitle("E6 — Coordinator: workflows, task DAG, board projection"), "e6");
    assert.equal(slugOfEpicTitle("E0 — Roadmap: harness as the deterministic coordinator layer"), "e0");
  });

  it("strips an Epic: prefix before reading", () => {
    assert.equal(slugOfEpicTitle("Epic: W3 — something"), "w3");
  });

  it("returns null when there is no identifier", () => {
    assert.equal(slugOfEpicTitle("Coordinator work"), null);
  });
});

describe("labelValues", () => {
  it("reads every value of a family, not just the first", () => {
    assert.deepEqual(labelValues(["epic:e6", "epic:e9", "type:bug"], "epic"), ["e6", "e9"]);
  });

  it("agrees with labelValue on the value that will be acted on", () => {
    const labels = ["epic:e6", "epic:e9"];
    assert.equal(labelValue(labels, "epic"), labelValues(labels, "epic")[0]);
  });

  it("matches on the family boundary, not on a prefix", () => {
    assert.deepEqual(labelValues(["epically:no", "epic:yes"], "epic"), ["yes"]);
  });
});

describe("isShipped and isAbandoned", () => {
  const itemOf = (over: Partial<SourceIssue> & { number: number }) =>
    project([issue(over)]).items[0];

  it("treats a merged pull request in the terminal column as shipped", () => {
    const item = itemOf({
      number: 1,
      kind: "pull-request",
      state: "closed",
      merged: true,
      labels: ["status:shipped"],
    });
    assert.ok(item !== undefined && isShipped(item));
    assert.ok(item !== undefined && !isAbandoned(item));
  });

  it("does not treat a closed-unmerged pull request as shipped, whatever its column says", () => {
    const item = itemOf({
      number: 1,
      kind: "pull-request",
      state: "closed",
      merged: false,
      labels: ["status:shipped"],
    });
    assert.ok(item !== undefined && !isShipped(item));
    assert.ok(item !== undefined && isAbandoned(item));
  });

  it("does not demote a pull request whose merge state was never reported", () => {
    // Absent is not false. Demoting on missing evidence would mark every hand-built snapshot as
    // abandoned work.
    const item = itemOf({ number: 1, kind: "pull-request", labels: ["status:shipped"] });
    assert.ok(item !== undefined && isShipped(item));
    assert.ok(item !== undefined && !isAbandoned(item));
  });

  it("never calls an issue abandoned: only a pull request can fail to merge", () => {
    const item = itemOf({ number: 1, state: "closed", labels: ["status:shipped"] });
    assert.ok(item !== undefined && isShipped(item));
    assert.ok(item !== undefined && !isAbandoned(item));
  });

  it("does not call a non-terminal item shipped", () => {
    const item = itemOf({ number: 1, labels: ["status:in-progress"] });
    assert.ok(item !== undefined && !isShipped(item));
  });
});

describe("projectBoard, on contradictions it has to resolve", () => {
  it("reports a pull request closed without merging", () => {
    const snapshot = project([
      issue({
        number: 1,
        kind: "pull-request",
        state: "closed",
        merged: false,
        labels: ["status:shipped"],
      }),
    ]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "closed-unmerged");
    assert.ok(anomaly, "expected a closed-unmerged anomaly");
    assert.equal(anomaly?.item, 1);
    assert.match(anomaly?.detail ?? "", /did not ship/);
  });

  it("does not report closed-unmerged for a merged pull request", () => {
    const snapshot = project([
      issue({
        number: 1,
        kind: "pull-request",
        state: "closed",
        merged: true,
        labels: ["status:shipped"],
      }),
    ]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "closed-unmerged"));
  });

  it("reports two epic issues claiming one slug, and names the one that wins", () => {
    const snapshot = project([
      issue({ number: 41, title: "E6 — the newer one", labels: ["epic", "epic:e6"] }),
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "epic:e6"] }),
    ]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "duplicate-epic-slug");
    assert.ok(anomaly, "expected a duplicate-epic-slug anomaly");
    // Reported against the winner, because that is the issue the board will act as though owns it.
    assert.equal(anomaly?.item, 36);
    assert.match(anomaly?.detail ?? "", /#41/);
  });

  it("does not report a duplicate slug when only one issue claims it", () => {
    const snapshot = project([issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"] })]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "duplicate-epic-slug"));
  });

  it("reports a task filed in a different milestone from its epic", () => {
    const snapshot = project([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "W1" }),
      issue({ number: 40, labels: ["status:ready", "epic:e6"], milestone: "W2" }),
    ]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "epic-milestone-conflict");
    assert.ok(anomaly, "expected an epic-milestone-conflict anomaly");
    assert.equal(anomaly?.item, 40);
    assert.match(anomaly?.detail ?? "", /W1/);
    assert.match(anomaly?.detail ?? "", /W2/);
  });

  it("does not report a milestone conflict when both are unassigned", () => {
    const snapshot = project([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"] }),
      issue({ number: 40, labels: ["status:ready", "epic:e6"] }),
    ]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "epic-milestone-conflict"));
  });

  it("reports two labels of one single-value family", () => {
    const snapshot = project([issue({ number: 1, labels: ["status:ready", "epic:a", "epic:b"] })]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "duplicate-label");
    assert.ok(anomaly, "expected a duplicate-label anomaly");
    assert.match(anomaly?.detail ?? "", /epic:a/);
    assert.match(anomaly?.detail ?? "", /epic:b/);
    assert.match(anomaly?.detail ?? "", /reads epic:a/);
  });

  it("reports a duplicated label in the configured lane family too", () => {
    const snapshot = projectBoard(
      [issue({ number: 1, labels: ["status:ready", "orchestrator:a", "orchestrator:b"] })],
      { repo: "o/r", generatedAt: AT, lanePrefix: "orchestrator" },
    );
    assert.ok(snapshot.anomalies.some((a) => a.kind === "duplicate-label"));
  });

  it("does not report the lane family twice when it is one of the defaults", () => {
    const snapshot = projectBoard([issue({ number: 1, labels: ["status:ready", "type:a", "type:b"] })], {
      repo: "o/r",
      generatedAt: AT,
      lanePrefix: "type",
    });
    assert.equal(snapshot.anomalies.filter((a) => a.kind === "duplicate-label").length, 1);
  });
});

describe("projectBoard, on how much of the board it actually saw", () => {
  it("makes no claim when the caller made none", () => {
    // Not "complete". A hand-assembled list has no fetch behind it to have been capped.
    assert.equal(project([]).completeness, null);
    assert.ok(!project([]).anomalies.some((a) => a.kind === "incomplete-fetch"));
  });

  it("carries an uncapped fetch through without raising anything", () => {
    const snapshot = projectBoard([issue({ number: 1, labels: ["status:ready"] })], {
      repo: "o/r",
      generatedAt: AT,
      completeness: { limit: 500, capped: [] },
    });
    assert.deepEqual(snapshot.completeness, { limit: 500, capped: [] });
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "incomplete-fetch"));
  });

  it("raises a board-level anomaly when a kind came back at the cap", () => {
    const snapshot = projectBoard([issue({ number: 1, labels: ["status:ready"] })], {
      repo: "o/r",
      generatedAt: AT,
      completeness: { limit: 1, capped: ["issue"] },
    });
    const anomaly = snapshot.anomalies.find((a) => a.kind === "incomplete-fetch");
    assert.ok(anomaly, "expected an incomplete-fetch anomaly");
    // No item: the fetch is not any one issue's fault, and blaming one would be a false claim.
    assert.equal(anomaly?.item, null);
    assert.match(anomaly?.detail ?? "", /--limit/);
  });

  it("puts the board-level anomaly first, above the item detail it qualifies", () => {
    const snapshot = projectBoard(
      [issue({ number: 1, labels: [] }), issue({ number: 2, labels: [] })],
      { repo: "o/r", generatedAt: AT, completeness: { limit: 2, capped: ["issue", "pull-request"] } },
    );
    assert.equal(snapshot.anomalies[0]?.kind, "incomplete-fetch");
  });
});
