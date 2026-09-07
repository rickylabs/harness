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
    assert.match(text, /in no column \(1\)/);
    assert.match(text, /Real work the board cannot see/);
  });

  it("separates work the board lost from work that was correctly dropped", () => {
    // One heading used to cover both, reading "the board cannot see them" over rows where
    // nothing was wrong. That is how fourteen merged pull requests hid in plain sight: the
    // section was mostly noise, so it was read as entirely noise.
    const text = renderColumns(
      snapshotOf([
        issue({ number: 1, kind: "pull-request", state: "closed", merged: true, labels: [] }),
        issue({ number: 2, kind: "pull-request", state: "closed", merged: false, labels: [] }),
      ]),
    );
    assert.match(text, /## in no column \(1\)/);
    assert.match(text, /## closed without shipping \(1\)/);
    // The merged one is the one that needs a label; the abandoned one needs nothing.
    const lost = text.slice(text.indexOf("## in no column"), text.indexOf("## closed without"));
    assert.match(lost, /PR1 /);
    assert.ok(!lost.includes("PR2 "), "an abandoned pull request is not lost work");
  });

  it("files an open untriaged item as lost, not as dropped", () => {
    // The first draft of the split tested `sourceSaysDelivered` alone, which put every open,
    // unlabelled issue under "closed without shipping — nothing to do". The largest group on a
    // young board, filed under the heading that says to ignore it.
    const text = renderColumns(snapshotOf([issue({ number: 3, labels: [] })]));
    assert.match(text, /## in no column \(1\)/);
    assert.ok(!text.includes("closed without shipping"), "an open item has not closed");
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

  it("marks an item that is waiting on the owner", () => {
    // The column views group by phase, and this deliberately is not one — so without the mark the
    // fact appears nowhere in them, and an item nobody can move reads exactly like its neighbours.
    const text = renderColumns(
      snapshotOf([issue({ number: 8, labels: ["status:impl", "flag:owner-decision"] })]),
    );
    assert.match(text, /## impl \(1\)/);
    assert.match(text, /#8 item 8 \(waiting on owner\)/);
  });

  it("keeps the marks in one order when an item carries several", () => {
    const text = renderColumns(
      snapshotOf([
        issue({
          number: 9,
          kind: "pull-request",
          draft: true,
          labels: ["status:impl-eval", "priority:p1", "flag:owner-decision"],
        }),
      ]),
    );
    assert.match(text, /\(draft, p1, waiting on owner\)/);
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

  it("stamps the generation time by default", () => {
    const text = renderHierarchy(buildHierarchy(snapshotOf([issue({ number: 1, labels: ["status:plan"] })])));
    assert.match(text, new RegExp(`generated ${AT}`));
  });

  it("omits the stamp when the caller's output is committed", () => {
    // The digest embeds this tree in a file rewritten every half hour. A stamp that moves on every
    // render would make every scheduled run a commit and bury the runs where the board moved.
    const hierarchy = buildHierarchy(snapshotOf([issue({ number: 1, labels: ["status:plan"] })]));
    const text = renderHierarchy(hierarchy, { stamp: false });
    assert.ok(!text.includes("generated "), text.split("\n").slice(0, 2).join(" / "));
    // Everything else is unchanged: one line short, same content.
    assert.equal(
      text.split("\n").length,
      renderHierarchy(hierarchy).split("\n").length - 1,
    );
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

/**
 * The rule these pin: a view that prints a phase must also print that the phase is disputed.
 *
 * An item carrying two `status:` labels resolves to whichever came first, silently. `columns` and
 * `status` used to render that pick as a settled column and exit 0, while `digest` showed the same
 * board as broken — so the two surfaces a person types to ask "status ?" were the two that answered
 * wrongly without saying so. See #218.
 */
describe("the views a person types, on a board that contradicts itself", () => {
  const contested = () =>
    snapshotOf([
      issue({ number: 5, labels: ["status:plan", "status:shipped"] }),
      issue({ number: 6, labels: ["status:plan"] }),
    ]);

  it("warns above the columns, and marks the row that is disputed", () => {
    const text = renderColumns(contested());
    assert.match(text, /^!! ANOMALIES \(1\)/m);
    assert.match(text, /^! #5 item 5$/m);
    // The clean item in the same column stays unmarked, or the mark means nothing.
    assert.match(text, /^ {2}#6 item 6$/m);
  });

  it("warns above the tree, and marks the task that is disputed", () => {
    const text = renderHierarchy(buildHierarchy(contested()));
    assert.match(text, /^!! ANOMALIES \(1\)/m);
    assert.match(text, /^ {2}! plan +#5 item 5$/m);
    assert.match(text, /^ {4}plan +#6 item 6$/m);
  });

  it("keeps the gutter two characters wide, so a mark never shifts the row beside it", () => {
    const lines = renderColumns(contested()).split("\n");
    const marked = lines.find((l) => l.startsWith("! ")) ?? "";
    const clean = lines.find((l) => /^ {2}#6/.test(l)) ?? "";
    assert.equal(marked.indexOf("#"), clean.indexOf("#"), `${marked} / ${clean}`);
  });

  it("says nothing at all when the board agrees with itself", () => {
    // The warning has to be absent on a clean board, not merely quiet. A banner that is always
    // there is a banner nobody reads, which is the state this whole change is trying to leave.
    for (const text of [
      renderColumns(snapshotOf([issue({ number: 1, labels: ["status:plan"] })])),
      renderHierarchy(buildHierarchy(snapshotOf([issue({ number: 1, labels: ["status:plan"] })]))),
    ]) {
      assert.ok(!text.includes("ANOMALIES"), text);
      assert.ok(!text.includes("!"), text);
    }
  });

  it("counts a board-level anomaly without promising a mark that is not there", () => {
    // A truncated fetch is a statement about the projection, not about any one issue. Sending the
    // reader to look for `!` would send them hunting for something no row carries.
    const snapshot = projectBoard([issue({ number: 5, labels: ["status:plan"] })], {
      repo: "o/r",
      generatedAt: AT,
      completeness: { limit: 1, capped: ["issue"] },
    });
    const text = renderColumns(snapshot);
    assert.match(text, /^!! ANOMALIES \(1\)/m);
    assert.ok(!text.includes("! marks an affected item"), text);
    assert.ok(!/^! /m.test(text), text);
  });

  it("counts one anomaly as an anomaly", () => {
    assert.match(renderColumns(contested()), /ANOMALIES \(1\)/);
    assert.match(renderAnomalies(contested()), /^1 anomaly$/m);
    assert.match(
      renderAnomalies(snapshotOf([issue({ number: 5, labels: ["status:plan", "status:shipped"] }), issue({ number: 6, labels: [] })])),
      /^2 anomalies$/m,
    );
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
