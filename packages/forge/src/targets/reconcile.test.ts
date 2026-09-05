import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SourceIssue } from "@rickylabs/board";

import type { Target, TargetTable } from "./model.js";
import { reconcileBridge, tallyBridge, type BridgeSource } from "./reconcile.js";
import { renderBridge, renderTable } from "./render.js";

const target = (over: Partial<Target> = {}): Target => ({
  label: "harness",
  repo: "rickylabs/harness",
  agents: ["claude"],
  automerge: false,
  priority: 0,
  disabled: false,
  ...over,
});

const table = (over: Partial<TargetTable> = {}): TargetTable => ({
  inbox: "rickylabs/harness",
  botLogin: "divybot",
  branchPrefix: "orch/divybot-",
  pollInterval: "30s",
  targets: [target()],
  memory: { enabled: false, repo: "rickylabs/harness", branch: "main", dir: "memory", interval: "5m" },
  ...over,
});

const issue = (number: number, over: Partial<SourceIssue> = {}): SourceIssue => ({
  number,
  title: `issue ${String(number)}`,
  state: "open",
  labels: ["harness"],
  url: `https://github.com/rickylabs/harness/issues/${String(number)}`,
  assignees: [],
  milestone: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  kind: "issue",
  ...over,
});

const pr = (number: number, over: Partial<SourceIssue> = {}): SourceIssue => ({
  ...issue(number, { labels: [] }),
  kind: "pull-request",
  draft: false,
  merged: false,
  ...over,
});

const inbox = (items: readonly SourceIssue[]): BridgeSource => ({ repo: "rickylabs/harness", items });

describe("dispositions", () => {
  it("claims an open issue whose label names a live target", () => {
    const snapshot = reconcileBridge(table(), [inbox([issue(142)])]);
    assert.equal(snapshot.items[0]?.disposition, "claimed");
    assert.equal(snapshot.items[0]?.target?.repo, "rickylabs/harness");
    assert.equal(snapshot.items[0]?.branch, "orch/divybot-142");
  });

  it("ignores an issue no target's label is on", () => {
    const snapshot = reconcileBridge(table(), [inbox([issue(142, { labels: ["type:feat"] })])]);
    assert.equal(snapshot.items[0]?.disposition, "ignored");
    assert.equal(snapshot.items[0]?.target, null);
    assert.equal(snapshot.items[0]?.branch, null);
  });

  it("holds an issue whose target is paused, and still says which repository it belongs to", () => {
    const snapshot = reconcileBridge(table({ targets: [target({ disabled: true })] }), [inbox([issue(142)])]);
    assert.equal(snapshot.items[0]?.disposition, "held");
    assert.equal(snapshot.items[0]?.target?.repo, "rickylabs/harness");
  });

  it("settles a closed issue but keeps reporting its target", () => {
    // "Which repository did this go to" stays a live question long after the issue closes, and
    // dropping the settled rows answers only the uninteresting half of what the bridge is for.
    const snapshot = reconcileBridge(table(), [inbox([issue(142, { state: "closed" })])]);
    assert.equal(snapshot.items[0]?.disposition, "settled");
    assert.equal(snapshot.items[0]?.target?.repo, "rickylabs/harness");
  });

  it("ignores a closed issue no target's label is on, rather than settling it", () => {
    // The order `dispositionOf` checks in, and the reason it is that way round. Run against this
    // repository's own board with closed checked first, `settled` came out at 67 — about half of
    // them issues the dispatcher had never been pointed at. `settled` has to mean "the dispatcher
    // is done here", not "this issue is closed", or the group stops being worth opening.
    const snapshot = reconcileBridge(table(), [
      inbox([issue(1, { state: "closed", labels: ["type:feat"] })]),
    ]);
    assert.equal(snapshot.items[0]?.disposition, "ignored");
    assert.deepEqual(tallyBridge(snapshot), {
      claimed: 0,
      held: 0,
      settled: 0,
      ignored: 1,
      inFlight: 0,
      landed: 0,
    });
  });

  it("does not treat a pull request in the inbox as an inbox item", () => {
    const snapshot = reconcileBridge(table(), [inbox([issue(1), pr(2, { labels: ["harness"] })])]);
    assert.deepEqual(
      snapshot.items.map((item) => item.issue),
      [1],
    );
  });

  it("surfaces the rows a match hides", () => {
    const snapshot = reconcileBridge(
      table({ targets: [target(), target({ label: "deno", repo: "denoland/deno" })] }),
      [inbox([issue(142, { labels: ["harness", "deno"] })])],
    );
    assert.deepEqual(
      snapshot.items[0]?.shadowed.map((t) => t.repo),
      ["denoland/deno"],
    );
  });
});

describe("linking a delivery back", () => {
  it("links by branch across a repository boundary", () => {
    // The case closing keywords cannot serve: GitHub closes nothing across repositories, so a PR in
    // the target repo has no way to reference the inbox issue except the dispatcher's own branch.
    const snapshot = reconcileBridge(table({ targets: [target({ label: "deno", repo: "denoland/deno" })] }), [
      inbox([issue(142, { labels: ["deno"] })]),
      {
        repo: "denoland/deno",
        items: [pr(9, { headRef: "orch/divybot-142", body: "fixes #7" })],
      },
    ]);
    const [delivery] = snapshot.items[0]?.deliveries ?? [];
    assert.equal(delivery?.repo, "denoland/deno");
    assert.equal(delivery?.number, 9);
    assert.equal(delivery?.link, "branch");
  });

  it("ignores a closing keyword in a repository that is not the inbox", () => {
    // `fixes #7` in `denoland/deno` closes denoland/deno#7, not an inbox issue. Honouring it would
    // attach somebody else's pull request to an unrelated inbox number.
    const snapshot = reconcileBridge(table(), [
      inbox([issue(7)]),
      { repo: "denoland/deno", items: [pr(9, { body: "fixes #7" })] },
    ]);
    assert.deepEqual(snapshot.items[0]?.deliveries, []);
    assert.deepEqual(snapshot.orphans, []);
  });

  it("links by closing keyword inside the inbox, which is how a human's own branch claims an issue", () => {
    const snapshot = reconcileBridge(table(), [
      inbox([issue(142), pr(9, { headRef: "feat/142-thing", body: "Closes #142." })]),
    ]);
    const [delivery] = snapshot.items[0]?.deliveries ?? [];
    assert.equal(delivery?.number, 9);
    assert.equal(delivery?.link, "closes");
  });

  it("records the branch once when both mechanisms agree", () => {
    const snapshot = reconcileBridge(table(), [
      inbox([issue(142), pr(9, { headRef: "orch/divybot-142", body: "Closes #142." })]),
    ]);
    assert.equal(snapshot.items[0]?.deliveries.length, 1);
    assert.equal(snapshot.items[0]?.deliveries[0]?.link, "branch");
  });

  it("attaches one pull request to every issue it closes", () => {
    const snapshot = reconcileBridge(table(), [
      inbox([issue(1), issue(2), pr(9, { body: "Closes #1, fixes #2" })]),
    ]);
    assert.equal(snapshot.items[0]?.deliveries.length, 1);
    assert.equal(snapshot.items[1]?.deliveries.length, 1);
  });

  it("drops a closing keyword that names a pull request, not an issue", () => {
    // GitHub numbers issues and pull requests from one sequence, so a re-land PR writing
    // `Closes #9` about the PR it re-lands is ordinary and valid. Three such references were in
    // this repository's history the first time the bridge ran, each surfacing as an orphan
    // reported "no such issue" — true, and useless: nothing was missing.
    const snapshot = reconcileBridge(table(), [
      inbox([issue(1), pr(9, { body: "Closes #1" }), pr(10, { body: "Re-lands the revert. Closes #9" })]),
    ]);
    assert.deepEqual(
      snapshot.items[0]?.deliveries.map((d) => d.number),
      [9],
    );
    assert.deepEqual(snapshot.orphans, []);
  });

  it("keeps a delivery whose issue is not in the projection rather than discarding it", () => {
    const snapshot = reconcileBridge(table(), [
      inbox([issue(142), pr(9, { headRef: "orch/divybot-900" })]),
    ]);
    assert.deepEqual(
      snapshot.orphans.map((o) => o.issue),
      [900],
    );
  });
});

describe("coverage", () => {
  it("names a target repository nothing was supplied for", () => {
    // The distinction that has to survive: "the run produced nothing yet" and "nobody handed me
    // that repository" want opposite reactions, and both render as an empty delivery list.
    const snapshot = reconcileBridge(table({ targets: [target({ label: "deno", repo: "denoland/deno" })] }), [
      inbox([issue(142, { labels: ["deno"] })]),
    ]);
    assert.deepEqual(snapshot.coverage.missing, ["denoland/deno"]);
    assert.deepEqual(snapshot.coverage.seen, []);
    assert.equal(snapshot.coverage.inboxSeen, true);
    assert.match(renderBridge(snapshot), /unknown, not absent/);
  });

  it("wants a disabled target's repository too", () => {
    // Pausing new spawns does not retire the work already out there — and the deliveries from
    // before the pause are exactly what someone pausing a target is looking for.
    const snapshot = reconcileBridge(
      table({ targets: [target({ label: "deno", repo: "denoland/deno", disabled: true })] }),
      [inbox([])],
    );
    assert.deepEqual(snapshot.coverage.wanted, ["denoland/deno"]);
  });

  it("says so when the inbox itself was not supplied", () => {
    const snapshot = reconcileBridge(table(), [{ repo: "denoland/deno", items: [] }]);
    assert.equal(snapshot.coverage.inboxSeen, false);
    assert.deepEqual(snapshot.items, []);
    assert.match(renderBridge(snapshot), /nothing below is computable/);
  });
});

describe("tally", () => {
  it("counts landed over in-flight, and neither twice", () => {
    const snapshot = reconcileBridge(table(), [
      inbox([
        issue(1),
        issue(2),
        issue(3, { state: "closed" }),
        issue(4, { labels: [] }),
        pr(10, { headRef: "orch/divybot-1", merged: true }),
        pr(11, { headRef: "orch/divybot-2" }),
      ]),
    ]);
    const tally = tallyBridge(snapshot);
    assert.deepEqual(tally, { claimed: 2, held: 0, settled: 1, ignored: 1, inFlight: 1, landed: 1 });
  });

  it("does not credit the dispatcher with a merge on an issue it was never given", () => {
    // Same failure as the disposition ordering, one line further down: these two numbers sit in a
    // header under the dispatcher's name. Untargeted, this repository read `47 landed` against the
    // nine issues it had actually been handed. The delivery still prints on the item.
    const snapshot = reconcileBridge(table(), [
      inbox([issue(1, { labels: ["type:feat"], state: "closed" }), pr(9, { body: "Closes #1", merged: true })]),
    ]);
    assert.equal(snapshot.items[0]?.disposition, "ignored");
    assert.equal(snapshot.items[0]?.deliveries.length, 1);
    assert.equal(tallyBridge(snapshot).landed, 0);
  });

  it("does not count a draft as in flight", () => {
    const snapshot = reconcileBridge(table(), [
      inbox([issue(1), pr(10, { headRef: "orch/divybot-1", draft: true })]),
    ]);
    assert.equal(tallyBridge(snapshot).inFlight, 0);
  });
});

describe("rendering", () => {
  it("prints the table in resolution order, never sorted", () => {
    const text = renderTable(
      table({ targets: [target({ label: "zeta", repo: "o/z" }), target({ label: "alpha", repo: "o/a" })] }),
    );
    assert.ok(text.indexOf("zeta") < text.indexOf("alpha"));
  });

  it("says the memory store is off rather than printing a store nobody runs", () => {
    assert.match(renderTable(table()), /memory {3}off/);
  });

  it("counts the ignored items without listing them", () => {
    // On a busy inbox they are almost everything, and printing them buries the rows the operator
    // opened this for.
    const items = [issue(1)];
    for (let n = 2; n <= 40; n += 1) items.push(issue(n, { labels: ["type:feat"] }));
    const text = renderBridge(reconcileBridge(table(), [inbox(items)]));
    assert.match(text, /39 ignored/);
    assert.doesNotMatch(text, /#40/);
  });

  it("reports the table's own problems alongside the bridge", () => {
    const snapshot = reconcileBridge(table({ targets: [target({ automerge: true })] }), [inbox([issue(1)])]);
    assert.match(renderBridge(snapshot), /automerge-enabled/);
  });
});
