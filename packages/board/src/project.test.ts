import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_LIFECYCLE,
  phaseOf,
  statusLabelsOf,
  unknownStatusLabels,
  violatesSingleStatus,
} from "./lifecycle.js";
import {
  isAbandoned,
  isDeliveryUnknown,
  isShipped,
  labelValue,
  labelValues,
  sourceSaysDelivered,
} from "./model.js";
import type { SourceIssue } from "./model.js";
import { EPIC_LABEL } from "./labels.js";
import { isEpicLabels, projectBoard, slugOfEpicTitle } from "./project.js";

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
    assert.deepEqual(statusLabelsOf(["status-quo", "statusline", "status:plan"]), ["status:plan"]);
  });

  it("returns an empty list when there are none", () => {
    assert.deepEqual(statusLabelsOf(["type:bug", "priority:p1"]), []);
  });
});

describe("phaseOf", () => {
  it("reads the phase from the label", () => {
    assert.equal(phaseOf(["status:impl"])?.name, "impl");
  });

  it("returns null with no status label", () => {
    assert.equal(phaseOf(["type:bug"]), null);
  });

  it("returns null for a status label outside the lifecycle", () => {
    assert.equal(phaseOf(["status:invented"]), null);
  });

  it("takes the earliest phase when an item claims several, under-stating rather than flattering", () => {
    const phase = phaseOf(["status:shipped", "status:impl"]);
    assert.equal(phase?.name, "impl");
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
    assert.equal(violatesSingleStatus(["status:plan"]), false);
  });

  it("is true for two", () => {
    assert.equal(violatesSingleStatus(["status:plan", "status:shipped"]), true);
  });

  it("is not fooled by a near-miss label", () => {
    assert.equal(violatesSingleStatus(["status:plan", "status-quo"]), false);
  });
});

describe("unknownStatusLabels", () => {
  it("reports status labels the lifecycle does not define", () => {
    assert.deepEqual(unknownStatusLabels(["status:plan", "status:invented"]), ["status:invented"]);
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
      issue({ number: 1, labels: ["status:plan"] }),
      issue({ number: 2, labels: ["status:impl"] }),
    ]);
    const ready = snapshot.columns.find((c) => c.phase.name === "plan");
    assert.deepEqual(ready?.items.map((i) => i.source.number), [1]);
  });

  it("is deterministic: the same input projects to an identical snapshot", () => {
    const issues = [
      issue({ number: 3, labels: ["status:plan", "priority:p2"] }),
      issue({ number: 1, labels: ["status:plan", "priority:p0"] }),
      issue({ number: 2, labels: ["status:plan"] }),
    ];
    assert.deepEqual(project(issues), project(issues));
    assert.equal(JSON.stringify(project(issues)), JSON.stringify(project(issues)));
  });

  it("does not depend on input order", () => {
    const a = [issue({ number: 1, labels: ["status:plan"] }), issue({ number: 2, labels: ["status:plan"] })];
    const b = [...a].reverse();
    assert.equal(JSON.stringify(project(a).items), JSON.stringify(project(b).items));
  });

  it("orders by priority, then by number", () => {
    const snapshot = project([
      issue({ number: 5, labels: ["status:plan", "priority:p3"] }),
      issue({ number: 4, labels: ["status:plan", "priority:p0"] }),
      issue({ number: 9, labels: ["status:plan", "priority:p0"] }),
      issue({ number: 1, labels: ["status:plan"] }),
    ]);
    assert.deepEqual(snapshot.items.map((i) => i.source.number), [4, 9, 5, 1]);
  });

  it("collects items with no status label as unphased rather than dropping them", () => {
    const snapshot = project([issue({ number: 7, labels: ["type:bug"] })]);
    assert.deepEqual(snapshot.unphased.map((i) => i.source.number), [7]);
    assert.ok(snapshot.columns.every((c) => c.items.length === 0));
  });

  it("reports an item carrying two status labels", () => {
    const snapshot = project([issue({ number: 1, labels: ["status:plan", "status:shipped"] })]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "multiple-status");
    assert.ok(anomaly, "expected a multiple-status anomaly");
    assert.equal(anomaly?.item, 1);
  });

  it("reports a closed item still sitting in a non-terminal column", () => {
    const snapshot = project([issue({ number: 1, state: "closed", labels: ["status:impl"] })]);
    assert.ok(snapshot.anomalies.some((a) => a.kind === "closed-but-unshipped"));
  });

  it("reports an open item sitting in the terminal column", () => {
    const snapshot = project([issue({ number: 1, state: "open", labels: ["status:shipped"] })]);
    assert.ok(snapshot.anomalies.some((a) => a.kind === "shipped-but-open"));
  });

  it("does not report no-status for a closed item, whatever else it reports", () => {
    // `no-status` is scoped to open work on purpose — the advice it gives ("triage this") is
    // wrong for anything already closed. What happens to *delivered* closed work instead is
    // `closed-without-status`, below.
    const snapshot = project([issue({ number: 1, state: "closed", labels: [] })]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "no-status"));
  });

  it("reports an epic label that no epic issue claims", () => {
    const snapshot = project([issue({ number: 1, labels: ["status:plan", "epic:ghost"] })]);
    assert.ok(snapshot.anomalies.some((a) => a.kind === "epic-not-found"));
  });

  it("does not report an epic label that an epic issue does claim", () => {
    const snapshot = project([
      issue({ number: 30, title: "E6 — Coordinator", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:plan", "epic:e6"] }),
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

describe("isEpicLabels", () => {
  it("reads the bare epic label", () => {
    assert.equal(isEpicLabels([EPIC_LABEL]), true);
    assert.equal(isEpicLabels(["status:impl", "epic", "epic:e6"]), true);
  });

  it("is not fooled by a label that merely starts with epic", () => {
    // `epic:e6` declares which epic an item belongs to. An item carrying only that is a child.
    assert.equal(isEpicLabels(["epic:e6"]), false);
    assert.equal(isEpicLabels(["epically-hard"]), false);
  });

  it("does not accept type:umbrella", () => {
    // `forge` used to search for `{epic, type:umbrella}` while this file accepted `{epic,
    // type:epic}`, so an item carrying one and not the other was an epic to one package and a
    // child to the other (#202). The two agree now, and they agree on the bare label: an epic is
    // a board object with its own `epic:` slug family, not a kind of change.
    assert.equal(isEpicLabels(["type:umbrella"]), false);
  });

  it("does not accept type:epic, a label that has never existed", () => {
    // This was the second alternative here, and it never once evaluated true against a real
    // repository: `forge`'s taxonomy has never created it. It survived because a fixture invented
    // it, giving a dead branch a passing test to stand behind.
    assert.equal(isEpicLabels(["type:epic"]), false);
  });

  it("keeps an umbrella PR under its epic instead of making it a rival epic", () => {
    // The concrete item this decision was checked against: #182 carries `type:umbrella` *and*
    // `epic:e0`, and #30 already owns the `e0` slug. Accepting `type:umbrella` as an epic marker
    // would promote it to an epic whose slug its parent holds — manufacturing the very
    // `duplicate-epic-slug` anomaly the predicate was being fixed to avoid.
    const snapshot = project([
      issue({ number: 30, title: "E0 — Roadmap", labels: ["epic", "epic:e0"] }),
      issue({ number: 182, labels: ["type:umbrella", "epic:e0", "status:impl"] }),
    ]);
    assert.equal(snapshot.items.find((i) => i.source.number === 182)?.isEpic, false);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "duplicate-epic-slug"));
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

  it("neither ships nor abandons a pull request whose merge state was never reported", () => {
    // Absent is not false, and it is not true. This assertion used to require `isShipped`, which
    // made a gap in the input indistinguishable from a delivery — the two claims a progress report
    // exists to keep apart.
    const item = itemOf({ number: 1, kind: "pull-request", labels: ["status:shipped"] });
    assert.ok(item !== undefined);
    assert.ok(!isShipped(item), "no evidence it landed");
    assert.ok(!isAbandoned(item), "no evidence it did not");
    assert.ok(isDeliveryUnknown(item), "reported as the gap it is");
  });

  it("says nothing is unknown when the merge state was reported either way", () => {
    for (const merged of [true, false]) {
      const item = itemOf({ number: 1, kind: "pull-request", merged, labels: ["status:shipped"] });
      assert.ok(item !== undefined && !isDeliveryUnknown(item), `merged: ${merged}`);
    }
  });

  it("never calls an issue abandoned: only a pull request can fail to merge", () => {
    const item = itemOf({ number: 1, state: "closed", labels: ["status:shipped"] });
    assert.ok(item !== undefined && isShipped(item));
    assert.ok(item !== undefined && !isAbandoned(item));
  });

  it("does not call a non-terminal item shipped", () => {
    const item = itemOf({ number: 1, labels: ["status:impl"] });
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

  it("says nothing about a pull request that was abandoned the way the process asks", () => {
    // Closed, unmerged, no phase label is the ending the board-process skill prescribes for a
    // wontfix. If that reads as an anomaly, the correct outcome is a permanent finding and the
    // check can never go green — so nobody runs it, and the anomalies that do matter go unread.
    for (const labels of [[], ["type:docs"], ["status:impl-eval"]]) {
      const snapshot = project([
        issue({ number: 1, kind: "pull-request", state: "closed", merged: false, labels }),
      ]);
      assert.ok(
        !snapshot.anomalies.some((a) => a.kind === "closed-unmerged"),
        `labels: ${JSON.stringify(labels)}`,
      );
    }
  });

  it("still reports a closed-unmerged pull request that a non-terminal column left behind", () => {
    // The one rule that does fire here is the stale-column one, and it fires once, not twice.
    const snapshot = project([
      issue({
        number: 1,
        kind: "pull-request",
        state: "closed",
        merged: false,
        labels: ["status:impl-eval"],
      }),
    ]);
    assert.deepEqual(
      snapshot.anomalies.filter((a) => a.item === 1).map((a) => a.kind),
      ["closed-but-unshipped"],
    );
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
      issue({ number: 40, labels: ["status:plan", "epic:e6"], milestone: "W2" }),
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
      issue({ number: 40, labels: ["status:plan", "epic:e6"] }),
    ]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "epic-milestone-conflict"));
  });

  it("reports two labels of one single-value family", () => {
    const snapshot = project([issue({ number: 1, labels: ["status:plan", "epic:a", "epic:b"] })]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "duplicate-label");
    assert.ok(anomaly, "expected a duplicate-label anomaly");
    assert.match(anomaly?.detail ?? "", /epic:a/);
    assert.match(anomaly?.detail ?? "", /epic:b/);
    assert.match(anomaly?.detail ?? "", /reads epic:a/);
  });

  it("reports a duplicated label in the configured lane family too", () => {
    const snapshot = projectBoard(
      [issue({ number: 1, labels: ["status:plan", "orchestrator:a", "orchestrator:b"] })],
      { repo: "o/r", generatedAt: AT, lanePrefix: "orchestrator" },
    );
    assert.ok(snapshot.anomalies.some((a) => a.kind === "duplicate-label"));
  });

  it("does not report the lane family twice when it is one of the defaults", () => {
    const snapshot = projectBoard([issue({ number: 1, labels: ["status:plan", "type:a", "type:b"] })], {
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
    const snapshot = projectBoard([issue({ number: 1, labels: ["status:plan"] })], {
      repo: "o/r",
      generatedAt: AT,
      completeness: { limit: 500, capped: [] },
    });
    assert.deepEqual(snapshot.completeness, { limit: 500, capped: [] });
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "incomplete-fetch"));
  });

  it("raises a board-level anomaly when a kind came back at the cap", () => {
    const snapshot = projectBoard([issue({ number: 1, labels: ["status:plan"] })], {
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

/**
 * The shape of a real incident, kept as a test because that is the case the check got wrong.
 *
 * PR #105 implemented E9.1 (#83) and its body's closing keyword named #39, the E9 *epic*. GitHub
 * honoured it. Six children were open, four unstarted, and the board reported the epic as done.
 */
const E9_EPIC = issue({
  number: 39,
  title: 'E9 — Telemetry: the "status ?" killer',
  state: "closed",
  labels: ["epic", "epic:e9", "status:impl"],
});
const E9_CHILDREN = [83, 84, 85, 86, 87, 88].map((number) =>
  issue({ number, labels: ["epic:e9", "status:triage"] }),
);

describe("sourceSaysDelivered", () => {
  it("believes a merged pull request and nothing weaker", () => {
    const closed = { kind: "pull-request" as const, state: "closed" as const };
    assert.equal(sourceSaysDelivered(issue({ number: 1, ...closed, merged: true })), true);
    assert.equal(sourceSaysDelivered(issue({ number: 1, ...closed, merged: false })), false);
    // Unknown is not merged — the same rule `isDeliveryUnknown` exists to keep.
    assert.equal(sourceSaysDelivered(issue({ number: 1, ...closed })), false);
  });

  it("believes an issue closed as completed and nothing weaker", () => {
    const closed = { state: "closed" as const };
    assert.equal(
      sourceSaysDelivered(issue({ number: 1, ...closed, closedBecause: "completed" })),
      true,
    );
    assert.equal(
      sourceSaysDelivered(issue({ number: 1, ...closed, closedBecause: "not-planned" })),
      false,
    );
    // No reason reported is not a reason. An item GitHub said nothing about must not be accused
    // of having lost a label it may never have needed.
    assert.equal(sourceSaysDelivered(issue({ number: 1, ...closed, closedBecause: null })), false);
    assert.equal(sourceSaysDelivered(issue({ number: 1, ...closed })), false);
  });

  it("is false for anything still open, however it is labelled", () => {
    assert.equal(
      sourceSaysDelivered(issue({ number: 1, kind: "pull-request", merged: true })),
      false,
    );
    assert.equal(sourceSaysDelivered(issue({ number: 1, closedBecause: "completed" })), false);
  });
});

describe("closed-without-status", () => {
  it("reports a merged pull request that carries no status label", () => {
    // The defect this rule was written for. `no-status` asks for `state === "open"`, so on the
    // real board fourteen merged pull requests sat in no column while `check` exited 0 — the
    // board silently failing at the one claim it exists to make.
    const snapshot = project([
      issue({ number: 1, kind: "pull-request", state: "closed", merged: true, labels: [] }),
    ]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "closed-without-status");
    assert.ok(anomaly, "expected a closed-without-status anomaly");
    assert.equal(anomaly?.item, 1);
    assert.match(anomaly?.detail ?? "", /merged/);
  });

  it("reports an issue closed as completed that carries no status label", () => {
    const snapshot = project([
      issue({ number: 2, state: "closed", closedBecause: "completed", labels: [] }),
    ]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "closed-without-status");
    assert.ok(anomaly, "expected a closed-without-status anomaly");
    assert.match(anomaly?.detail ?? "", /closed as completed/);
  });

  it("stays silent on every ending that is supposed to carry no status label", () => {
    // A pull request closed unmerged, an issue closed as not-planned, and an issue GitHub gave
    // no reason for. Reporting these would make the correct outcome a permanent finding, and a
    // check that cannot reach zero is one nobody runs — the rule `closed-unmerged` already keeps.
    for (const source of [
      issue({ number: 1, kind: "pull-request", state: "closed", merged: false, labels: [] }),
      issue({ number: 2, state: "closed", closedBecause: "not-planned", labels: [] }),
      issue({ number: 3, state: "closed", closedBecause: null, labels: [] }),
      issue({ number: 4, state: "closed", labels: [] }),
    ]) {
      const snapshot = project([source]);
      assert.ok(
        !snapshot.anomalies.some((a) => a.kind === "closed-without-status"),
        `#${source.number} was reported, but its shape is the prescribed one`,
      );
    }
  });

  it("stays silent once the label is on, which is what makes it closable", () => {
    const snapshot = project([
      issue({
        number: 1,
        kind: "pull-request",
        state: "closed",
        merged: true,
        labels: ["status:shipped"],
      }),
      issue({ number: 2, state: "closed", closedBecause: "completed", labels: ["status:shipped"] }),
    ]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "closed-without-status"));
  });

  it("does not double-report work that is merely open", () => {
    // `no-status` owns open work. One item must never raise both, or the same repair gets filed
    // twice and the count stops meaning anything.
    const snapshot = project([issue({ number: 1, labels: [] })]);
    assert.deepEqual(
      snapshot.anomalies.filter((a) => a.item === 1).map((a) => a.kind),
      ["no-status"],
    );
  });
});

describe("epic-closed-by-child", () => {
  it("fires when an umbrella is closed with children still open", () => {
    const snapshot = project([E9_EPIC, ...E9_CHILDREN]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "epic-closed-by-child");
    assert.ok(anomaly, "expected an epic-closed-by-child anomaly");
    assert.equal(anomaly?.item, 39);
    assert.match(anomaly?.detail ?? "", /6 open children/);
  });

  it("names the open children, so the reader can tell which side is stale", () => {
    const snapshot = project([E9_EPIC, ...E9_CHILDREN]);
    const detail = snapshot.anomalies.find((a) => a.kind === "epic-closed-by-child")?.detail ?? "";
    for (const number of [83, 84, 85, 86, 87, 88]) assert.match(detail, new RegExp(`#${number}\\b`));
  });

  it("prescribes reopening, not relabelling", () => {
    const snapshot = project([E9_EPIC, ...E9_CHILDREN]);
    const detail = snapshot.anomalies.find((a) => a.kind === "epic-closed-by-child")?.detail ?? "";
    assert.match(detail, /reopen it, do not relabel it/);
  });

  it("suppresses closed-but-unshipped on the same item", () => {
    // Both would otherwise fire — the epic is closed and sits in a non-terminal column. Offering
    // two contradictory repairs means the reader takes the cheap one, and the cheap one moves an
    // epic with unstarted children into a terminal column.
    const snapshot = project([E9_EPIC, ...E9_CHILDREN]);
    assert.deepEqual(
      snapshot.anomalies.filter((a) => a.item === 39).map((a) => a.kind),
      ["epic-closed-by-child"],
    );
  });

  it("still fires when the epic sits in a terminal column, where nothing else would", () => {
    // The worst version: the board asserts delivery, every other check agrees, and only the
    // children know otherwise.
    const shipped = { ...E9_EPIC, labels: ["epic", "epic:e9", "status:shipped"] };
    const snapshot = project([shipped, ...E9_CHILDREN]);
    assert.deepEqual(
      snapshot.anomalies.filter((a) => a.item === 39).map((a) => a.kind),
      ["epic-closed-by-child"],
    );
  });

  it("does not fire when every child is closed", () => {
    const closed = E9_CHILDREN.map((c) => ({
      ...c,
      state: "closed" as const,
      labels: ["epic:e9", "status:shipped"],
    }));
    const snapshot = project([{ ...E9_EPIC, labels: ["epic", "epic:e9", "status:shipped"] }, ...closed]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "epic-closed-by-child"));
  });

  it("does not fire for an open umbrella", () => {
    const snapshot = project([{ ...E9_EPIC, state: "open" as const }, ...E9_CHILDREN]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "epic-closed-by-child"));
  });

  it("ignores an open pull request under the epic", () => {
    // A PR in flight has its own ending — merge it or close it. Reopening the epic is not the
    // repair, so it must not be the report either.
    const pr = issue({
      number: 111,
      kind: "pull-request",
      merged: false,
      labels: ["epic:e9", "status:impl-eval"],
    });
    const closedChildren = E9_CHILDREN.map((c) => ({ ...c, state: "closed" as const, labels: ["epic:e9", "status:shipped"] }));
    const snapshot = project([{ ...E9_EPIC, labels: ["epic", "epic:e9", "status:shipped"] }, ...closedChildren, pr]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "epic-closed-by-child"));
  });

  it("does not count an epic as its own child", () => {
    // The epic carries `epic:e9` to declare its slug. Read naively that makes it a child of
    // itself, and a closed epic would hold itself open forever.
    const snapshot = project([{ ...E9_EPIC, state: "open" as const }]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "epic-closed-by-child"));
    const closedAlone = project([E9_EPIC]);
    assert.ok(!closedAlone.anomalies.some((a) => a.kind === "epic-closed-by-child"));
  });

  it("caps the listed children and says how many it withheld", () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      issue({ number: 200 + i, labels: ["epic:e9", "status:triage"] }),
    );
    const snapshot = project([E9_EPIC, ...many]);
    const detail = snapshot.anomalies.find((a) => a.kind === "epic-closed-by-child")?.detail ?? "";
    assert.match(detail, /13 open children/);
    assert.match(detail, /\+3 more/);
  });
});

describe("closing-keyword-targets-epic", () => {
  const OPEN_EPIC = issue({ number: 39, title: "E9 — Telemetry", labels: ["epic", "epic:e9"] });

  const pr = (body: string, over: Partial<SourceIssue> = {}) =>
    issue({ number: 105, kind: "pull-request", body, labels: ["epic:e9"], ...over });

  it("catches the keyword before the merge that would honour it", () => {
    const snapshot = project([OPEN_EPIC, pr("## Scope\n\nCloses #39\n")]);
    const anomaly = snapshot.anomalies.find((a) => a.kind === "closing-keyword-targets-epic");
    assert.ok(anomaly, "expected a closing-keyword-targets-epic anomaly");
    assert.equal(anomaly?.item, 105);
    assert.match(anomaly?.detail ?? "", /Part of #39/);
  });

  it("accepts a keyword aimed at an ordinary task", () => {
    const task = issue({ number: 83, labels: ["epic:e9", "status:impl"] });
    const snapshot = project([OPEN_EPIC, task, pr("Closes #83\nPart of #39\n")]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "closing-keyword-targets-epic"));
  });

  it("does not fire on a merged pull request", () => {
    // #105's body still says what it said. Reporting merged PRs would put a permanent row in the
    // check for every historical mistake, and a check that cannot reach zero is one nobody runs.
    const merged = pr("Closes #39\n", { state: "closed", merged: true, labels: ["epic:e9", "status:shipped"] });
    const snapshot = project([OPEN_EPIC, merged]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "closing-keyword-targets-epic"));
  });

  it("does not fire when the target is not on this board", () => {
    const snapshot = project([pr("Closes #999\n")]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "closing-keyword-targets-epic"));
  });

  it("says nothing about a pull request with no body", () => {
    const snapshot = project([OPEN_EPIC, issue({ number: 106, kind: "pull-request", labels: [] })]);
    assert.ok(!snapshot.anomalies.some((a) => a.kind === "closing-keyword-targets-epic"));
  });

  it("reports once per targeted epic, not once per mention", () => {
    const snapshot = project([OPEN_EPIC, pr("Closes #39\n\nAlso closes #39.\n")]);
    assert.equal(
      snapshot.anomalies.filter((a) => a.kind === "closing-keyword-targets-epic").length,
      1,
    );
  });
});
