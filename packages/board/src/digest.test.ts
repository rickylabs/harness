import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { latestActivity, renderDigest } from "./digest.js";
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

const snapshotOf = (issues: readonly SourceIssue[]) =>
  projectBoard(issues, { repo: "o/r", generatedAt: AT });

const digestOf = (issues: readonly SourceIssue[]): string => {
  const snapshot = snapshotOf(issues);
  return renderDigest(snapshot, buildHierarchy(snapshot));
};

/**
 * Just the one section, from its heading to the next.
 *
 * Slicing to the end of the document instead would sweep in the embedded tree, which lists every
 * item on the board — so an assertion that a section *omits* something would pass on the tree and
 * never test the section at all.
 */
function sectionOf(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `no section headed ${heading}`);
  const next = text.indexOf("\n## ", start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

describe("latestActivity", () => {
  it("is null for a board with nothing on it", () => {
    assert.equal(latestActivity([]), null);
  });

  it("finds the newest timestamp regardless of the order it arrived in", () => {
    const items = snapshotOf([
      issue({ number: 1, updatedAt: "2026-01-01T00:00:00.000Z" }),
      issue({ number: 2, updatedAt: "2026-09-01T00:00:00.000Z" }),
      issue({ number: 3, updatedAt: "2026-03-01T00:00:00.000Z" }),
    ]).items;
    assert.equal(latestActivity(items), "2026-09-01T00:00:00.000Z");
  });
});

describe("renderDigest", () => {
  it("is deterministic — the same snapshot renders to the same bytes", () => {
    // The page is committed by a scheduled workflow. A render that varies on identical input
    // commits on every run, and the commits where the board actually moved stop being findable.
    const issues = [
      issue({ number: 1, labels: ["status:impl"] }),
      issue({ number: 2, labels: ["status:triage"] }),
      issue({ number: 3, labels: ["status:ci-fail"] }),
    ];
    assert.equal(digestOf(issues), digestOf(issues));
  });

  it("carries no timestamp of its own, only the board's latest activity", () => {
    // `generatedAt` is the clock; `updatedAt` is the work. Only the second belongs on a file that
    // is rewritten every half hour.
    const text = digestOf([issue({ number: 1, updatedAt: "2026-08-08T12:00:00.000Z" })]);
    assert.match(text, /Latest board activity: 2026-08-08T12:00:00\.000Z/);
    assert.ok(!text.includes(AT), "the generation stamp must not reach the page");
  });

  it("says so plainly when there is nothing on the board", () => {
    const text = digestOf([]);
    assert.match(text, /Nothing on the board yet/);
    assert.ok(!text.includes("Latest board activity"));
  });

  it("renders empty sections as no section at all", () => {
    // A standing "Stuck" heading over a blank space trains the reader to skip that heading, which
    // is the one outcome a page about what needs attention cannot afford.
    const text = digestOf([issue({ number: 1, labels: ["status:impl"] })]);
    assert.match(text, /## Moving now \(1\)/);
    assert.ok(!text.includes("## Stuck"), "nothing is blocked");
    assert.ok(!text.includes("## Not on the board"), "nothing is unlabelled");
    assert.ok(!text.includes("## Anomalies"), "the board agrees with itself");
  });

  it("puts a blocked item under Stuck and not under Moving now", () => {
    const text = digestOf([issue({ number: 9, labels: ["status:ci-fail"] })]);
    assert.match(text, /## Stuck \(1\)/);
    assert.ok(!text.includes("## Moving now"), "a blocked item is not moving");
  });

  it("puts what is waiting on the reader above everything else on the page", () => {
    // Everything below this heading is a report. This is the only part addressed to the person
    // reading, and it is the half of "status ?" that waiting longer will never answer — so it goes
    // above even what is running, which is the section it was carved out of.
    const text = digestOf([
      issue({ number: 1, labels: ["status:impl"] }),
      issue({ number: 62, labels: ["status:plan-eval", "flag:owner-decision"] }),
    ]);
    assert.match(text, /## Waiting on you \(1\)/);
    assert.ok(
      text.indexOf("## Waiting on you") < text.indexOf("## Moving now"),
      "the decision the reader owes comes before the work they do not",
    );
    assert.match(sectionOf(text, "## Waiting on you"), /#62 item 62/);
  });

  it("keeps a flagged item out of Moving now, whatever column it is in", () => {
    const text = digestOf([issue({ number: 62, labels: ["status:impl", "flag:owner-decision"] })]);
    assert.ok(!text.includes("## Moving now"), "nothing is acting on work that needs a decision");
  });

  it("splits the blocked bucket in two, so no item is listed under both reasons", () => {
    const text = digestOf([
      issue({ number: 1, labels: ["status:ci-fail"] }),
      issue({ number: 62, labels: ["status:impl", "flag:owner-decision"] }),
    ]);
    assert.match(text, /## Waiting on you \(1\)/);
    assert.match(text, /## Stuck \(1\)/);
    assert.ok(!sectionOf(text, "## Stuck").includes("#62 "), "a decision is not a red build");
    assert.ok(!sectionOf(text, "## Waiting on you").includes("#1 "), "a red build is not a decision");
  });

  it("lists an epic here, against the population rule the rest of the page keeps", () => {
    // Every other section answers "how much is there", where matching the header's population is
    // worth more than the row it leaves out. This one answers "what is being asked of you", where a
    // row left out is a request the owner never sees — and a decision about direction is most of
    // what an epic is made of.
    const text = digestOf([
      issue({ number: 39, title: "E9 — Telemetry", labels: ["epic", "status:impl", "flag:owner-decision"] }),
    ]);
    assert.match(sectionOf(text, "## Waiting on you"), /#39 E9 — Telemetry/);
  });

  it("omits the section entirely when nothing is waiting on the reader", () => {
    assert.ok(!digestOf([issue({ number: 1, labels: ["status:impl"] })]).includes("Waiting on you"));
  });

  it("lists open unlabelled work, and leaves closed unlabelled work alone", () => {
    // A closed item with no status label is the prescribed shape for abandoned work. Putting it
    // on a list headed "needs attention" nags about the correct outcome.
    const text = digestOf([
      issue({ number: 1 }),
      issue({ number: 2, state: "closed", kind: "pull-request", merged: false }),
    ]);
    assert.match(text, /## Not on the board \(1\)/);
    const section = sectionOf(text, "## Not on the board");
    assert.match(section, /#1 item 1/);
    assert.ok(!section.includes("PR2 "), "an abandoned pull request is not lost work");
  });

  it("neutralises a pipe in a title so the table row cannot break", () => {
    const text = digestOf([issue({ number: 4, title: "feat: a | b", labels: ["status:impl"] })]);
    assert.match(text, /feat: a \\\| b/);
    const row = text.split("\n").find((l) => l.includes("#4 ")) ?? "";
    // The row still has to read as three columns. Counting *unescaped* pipes is the whole point:
    // the escaped one is a character in the title, not a column break.
    const breaks = row.replace(/\\\|/g, "").split("|").length - 1;
    assert.equal(breaks, 4, `row split by an unescaped pipe: ${row}`);
  });

  it("neutralises a newline in a title, which would end the row outright", () => {
    const text = digestOf([issue({ number: 4, title: "a\nb", labels: ["status:impl"] })]);
    const row = text.split("\n").find((l) => l.includes("#4 ")) ?? "";
    assert.match(row, /#4 a b/);
  });

  it("links every listed item to its own URL", () => {
    const text = digestOf([issue({ number: 4, labels: ["status:impl"] })]);
    assert.match(text, /\[#4 item 4\]\(https:\/\/example\.invalid\/4\)/);
  });

  it("names anomalies, grouped by kind, and says where they are repaired", () => {
    const text = digestOf([issue({ number: 5, labels: ["status:plan", "status:shipped"] })]);
    assert.match(text, /## Anomalies \(1\)/);
    assert.match(text, /\*\*`multiple-status`\*\*/);
    assert.match(text, /\*\*#5\*\*/);
    assert.match(text, /repaired on the issue, never here/);
  });

  it("raises the incomplete-fetch banner as a blockquote", () => {
    // The JSON carries `completeness` and the terminal gets a banner. A page that dropped it would
    // present a truncated board as the whole board.
    const snapshot = projectBoard([issue({ number: 1, labels: ["status:impl"] })], {
      repo: "o/r",
      generatedAt: AT,
      completeness: { limit: 1, capped: ["issue"] },
    });
    const text = renderDigest(snapshot, buildHierarchy(snapshot));
    assert.match(text, /^> !! INCOMPLETE/m);
  });

  it("embeds the tree without its own generated stamp", () => {
    const text = digestOf([issue({ number: 1, labels: ["status:impl"] })]);
    assert.match(text, /## The tree/);
    assert.ok(!text.includes("generated "), "the embedded tree must not restate the clock");
  });

  it("folds the queued column away rather than leading with it", () => {
    // On a young board this is the largest group and the least urgent. Above the fold it buries
    // the three items something is actually working on.
    const text = digestOf([
      issue({ number: 1, labels: ["status:triage"] }),
      issue({ number: 2, labels: ["status:impl"] }),
    ]);
    assert.ok(
      text.indexOf("## Moving now") < text.indexOf("## Waiting to start"),
      "what is moving comes before what has not started",
    );
    assert.match(text, /<summary>1 filed, nothing started<\/summary>/);
  });

  it("omits the queued section entirely when nothing is waiting", () => {
    assert.ok(!digestOf([issue({ number: 1, labels: ["status:impl"] })]).includes("Waiting to start"));
  });

  it("restates no count of its own — the header ratio is the projection's", () => {
    const snapshot = snapshotOf([
      issue({ number: 1, labels: ["status:shipped"] }),
      issue({ number: 2, labels: ["status:impl"] }),
    ]);
    const hierarchy = buildHierarchy(snapshot);
    const text = renderDigest(snapshot, hierarchy);
    assert.equal(hierarchy.progress.shipped, 1);
    assert.match(text, /1\/2 done · 1 running/);
  });

  it("counts the sections over the same population as the header ratio", () => {
    // The bug this pins: `Progress` counts tasks and not the epic issues containing them, so a
    // section that swept epics in headed a list of ten under a header that said four. Two numbers
    // on one page that do not reconcile is worse than either one alone.
    const snapshot = snapshotOf([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "status:impl"] }),
      issue({ number: 1, labels: ["status:impl", "epic:e6"] }),
    ]);
    const hierarchy = buildHierarchy(snapshot);
    const text = renderDigest(snapshot, hierarchy);
    assert.equal(hierarchy.progress.inFlight, 1);
    assert.match(text, /## Moving now \(1\)/);
    const section = sectionOf(text, "## Moving now");
    assert.ok(!section.includes("#36 "), "an epic is a container, not work in flight");
  });

  it("rolls each epic up with its own bar, progress and column", () => {
    const text = digestOf([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic", "status:impl"] }),
      issue({ number: 1, labels: ["status:shipped", "epic:e6"] }),
      issue({ number: 2, labels: ["status:triage", "epic:e6"] }),
    ]);
    const section = sectionOf(text, "## Epics");
    assert.match(section, /\[E6 — Coordinator\]\(https:\/\/example\.invalid\/36\)/);
    assert.match(section, /1\/2 done · 1 queued/);
    assert.match(section, /`impl`/);
  });

  it("says when an epic slug has no issue behind it, rather than linking nothing", () => {
    const section = sectionOf(digestOf([issue({ number: 1, labels: ["status:plan", "epic:ghost"] })]), "## Epics");
    assert.match(section, /no issue claims `ghost`/);
    assert.match(section, /`no status`/);
  });

  it("groups epics under their milestone, with the milestone's own roll-up", () => {
    const text = digestOf([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "M1" }),
      issue({ number: 1, labels: ["status:impl", "epic:e6"], milestone: "M1" }),
    ]);
    assert.match(text, /### M1\n\n`\[[#-]{12}\]` 0\/1 done · 1 running/);
  });

  it("gives a milestone's epic-less tasks a row, so the rows account for its total", () => {
    // A milestone reading 2/3 over rows adding to 1/1 leaves the reader unable to tell whether the
    // rest is hidden or miscounted.
    const text = digestOf([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "M1" }),
      issue({ number: 1, labels: ["status:shipped", "epic:e6"], milestone: "M1" }),
      issue({ number: 2, labels: ["status:shipped"], milestone: "M1" }),
      issue({ number: 3, labels: ["status:impl"], milestone: "M1" }),
    ]);
    const section = sectionOf(text, "## Epics");
    assert.match(section, /\| _\(no epic\)_ \| `\[[#-]{12}\]` 1\/2 done · 1 running \| — \|/);
    assert.match(section, /2\/3 done · 1 running/);
  });

  it("skips a milestone that has no epics, rather than heading a table with none", () => {
    const text = digestOf([
      issue({ number: 36, title: "E6 — Coordinator", labels: ["epic"], milestone: "M1" }),
      issue({ number: 1, labels: ["status:impl", "epic:e6"], milestone: "M1" }),
      issue({ number: 2, labels: ["status:impl"], milestone: "M2" }),
    ]);
    const section = sectionOf(text, "## Epics");
    assert.match(section, /### M1/);
    assert.ok(!section.includes("### M2"), "a milestone with no epics has no epic roll-up");
  });

  it("omits the epic roll-up entirely on a board with no epics", () => {
    assert.ok(!digestOf([issue({ number: 1, labels: ["status:impl"] })]).includes("## Epics"));
  });

  it("puts the anomaly warning above the roll-up it would undermine", () => {
    const text = digestOf([
      issue({ number: 36, title: "E6", labels: ["epic"] }),
      issue({ number: 1, labels: ["status:plan", "status:shipped", "epic:e6"] }),
    ]);
    assert.ok(text.indexOf("## Anomalies") < text.indexOf("## Epics"));
  });

  it("warns that edits to the file are overwritten", () => {
    assert.match(digestOf([]), /^<!-- Generated by `dsh-board digest`\. Edits here are overwritten\. -->/);
  });

  it("ends with a newline, so the committed file is not missing one", () => {
    assert.ok(digestOf([]).endsWith("\n"));
  });
});
