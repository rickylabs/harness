import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BoardItemRef, QuotaReading, RunRecord, TelemetrySnapshot } from "./model.js";
import {
  humanAge,
  humanTokens,
  renderItemState,
  renderLiveness,
  renderNotes,
  renderQuota,
  renderSnapshot,
  renderTree,
  RENDER_CAPS,
} from "./render.js";
import { buildSnapshot } from "./snapshot.js";
import { buildTree } from "./tree.js";
import { parseGovernanceObservation, unavailableGovernance } from "./observations.js";

const NOW = "2026-09-04T22:00:00.000Z";

const run = (over: Partial<RunRecord> & { id: string }): RunRecord => ({
  source: "codex",
  parentId: null,
  startedAt: "2026-09-04T20:00:00.000Z",
  updatedAt: "2026-09-04T21:00:00.000Z",
  branch: null,
  identity: { model: "gpt-5.6-sol", effort: "xhigh", provider: "openai", profile: null },
  usage: { inputTokens: 12_000, outputTokens: 900 },
  outcome: "running",
  linkedIssues: [],
  origin: "o",
  quota: [],
  ...over,
});

const empty: TelemetrySnapshot = {
  generatedAt: NOW,
  epics: [],
  unattributed: [],
  quota: [],
  governance: unavailableGovernance("no --observations supplied"),
  notes: [],
};

function observed(over: Readonly<Record<string, unknown>> = {}) {
  return parseGovernanceObservation({
    observedAt: "2026-09-04T21:55:00.000Z",
    validUntil: "2026-09-04T22:05:00.000Z",
    provenance: "synthetic:test",
    state: {
      generatedAt: "2026-09-04T21:55:00.000Z",
      regimes: [
        {
          regime: "subscription",
          state: "throttle",
          accounts: [{
            seam: "codex",
            account: "primary",
            state: "throttle",
            windows: [{ label: "5h", windowMinutes: 300, usedPercent: 63, resetsAt: "2026-09-04T23:00:00.000Z", binding: true }],
            observedAt: "2026-09-04T21:55:00.000Z",
          }],
          note: "paced against binding window",
        },
        {
          regime: "metered",
          state: "allow",
          providers: [{ provider: "openrouter", spentUsd: 12.5, ceilingUsd: 50, windowLabel: "monthly", observedAt: "2026-09-04T21:55:00.000Z" }],
          note: null,
        },
        {
          regime: "capacity",
          state: "allow",
          hosts: [{ host: "n5-fixture", vramUsedBytes: 8 * 1024 ** 3, vramTotalBytes: 24 * 1024 ** 3, ramUsedBytes: 32 * 1024 ** 3, ramTotalBytes: 128 * 1024 ** 3, observedAt: "2026-09-04T21:55:00.000Z" }],
          note: null,
        },
      ],
      pending: [],
      notes: [],
    },
    admissions: [{
      item: { number: 205 },
      regime: "subscription",
      state: "throttle",
      observedAt: "2026-09-04T21:54:00.000Z",
      validUntil: "2026-09-04T22:01:00.000Z",
      provenance: "synthetic:dispatcher",
      outcome: { accepted: false, reason: "quota-paced", detail: "waiting for the next subscription slot" },
    }],
    ...over,
  }, NOW);
}

describe("humanTokens", () => {
  it("distinguishes a missing count from a zero", () => {
    assert.equal(humanTokens(undefined), "—");
    assert.equal(humanTokens(0), "0");
  });

  it("compacts once the digits stop carrying meaning", () => {
    assert.equal(humanTokens(999), "999");
    assert.equal(humanTokens(12_400), "12.4k");
    assert.equal(humanTokens(2_500_000), "2.5M");
  });
});

describe("humanAge", () => {
  it("reads in whole units an operator can act on", () => {
    assert.equal(humanAge("2026-09-04T21:59:30.000Z", NOW), "under a minute");
    assert.equal(humanAge("2026-09-04T21:36:00.000Z", NOW), "24m");
    assert.equal(humanAge("2026-09-04T18:48:00.000Z", NOW), "3h 12m");
    assert.equal(humanAge("2026-09-02T20:00:00.000Z", NOW), "2d 2h");
  });

  it("says it does not know rather than printing NaN", () => {
    assert.equal(humanAge("not a date", NOW), "?");
  });

  it("reads as a length of time in every slot that uses it", () => {
    // The bug this pins: the callers supply the direction, so a value that names a moment lands as
    // "updated just now ago". Whatever the interval, the phrase has to survive being wrapped.
    for (const from of ["2026-09-04T21:59:30.000Z", "2026-09-04T18:48:00.000Z"]) {
      const age = humanAge(from, NOW);
      assert.doesNotMatch(`updated ${age} ago`, /\bnow ago\b/, age);
      assert.doesNotMatch(`resets in ${age}`, /\bin just\b/, age);
    }
  });
});

describe("renderQuota", () => {
  it("states the window position, the reset and the age of the reading", () => {
    const reading: QuotaReading = {
      source: "codex",
      observedAt: "2026-09-04T21:30:00.000Z",
      limitId: "primary-5h",
      usedPercent: 63,
      windowMinutes: 300,
      resetsAt: "2026-09-04T23:00:00.000Z",
      planType: "pro",
      creditBalance: null,
    };
    const line = renderQuota(reading, NOW);
    assert.match(line, /63% used of a 5h window/);
    assert.match(line, /resets in 1h 0m/);
    assert.match(line, /\[pro\]/);
    // The age is not decoration: a reading is only as fresh as the run that happened to observe it.
    assert.match(line, /\(read 30m ago\)/);
  });
});

describe("renderSnapshot", () => {
  it("puts governance above the work, not in a footer", () => {
    // "Why is nothing running" is a status question. Today it has no answer at all, and an answer
    // below the fold is one nobody scrolls to.
    const snapshot = buildSnapshot({
      generatedAt: NOW,
      runs: [run({ id: "a", quota: [{ source: "codex", observedAt: "2026-09-04T21:00:00.000Z", limitId: "primary-5h", usedPercent: 90, windowMinutes: 300, resetsAt: null, planType: "pro", creditBalance: null }] })],
      items: [],
    });
    const text = renderSnapshot(snapshot, NOW);
    const governance = text.indexOf("governance");
    const work = text.indexOf("run(s) across");
    assert.ok(governance > -1 && work > -1);
    assert.ok(governance < work, "governance rendered below the work");
  });

  it("says out loud that governance is unavailable, instead of showing nothing", () => {
    // A missing governance section reads as "all clear", which is the one thing it does not mean.
    assert.match(renderSnapshot(empty, NOW), /governance: UNKNOWN\/UNAVAILABLE — no --observations supplied/);
  });

  it("shows quota, spend, headroom, and the actual admission reason before progress", () => {
    const text = renderSnapshot({ ...empty, governance: observed() }, NOW);
    assert.match(text, /codex\/primary \[throttle\]/);
    assert.match(text, /binding 5h: 63% used/);
    assert.match(text, /openrouter: \$12\.50 spent \/ \$50\.00 ceiling/);
    assert.match(text, /VRAM 8\.0 GiB used \/ 24\.0 GiB total · 16\.0 GiB headroom/);
    assert.match(text, /#205 throttle \[subscription\] — quota-paced: waiting for the next subscription slot/);
    assert.ok(text.indexOf("#205 throttle") < text.indexOf("run(s) across"));
  });

  it("marks a stale refusal independently of fresh regime readings", () => {
    const base = observed();
    assert.notEqual(base.availability, "unavailable");
    if (base.availability === "unavailable") return;
    const governance = observed({
      admissions: base.admissions.map(({ availability: _availability, ...admission }) => ({
        ...admission,
        validUntil: "2026-09-04T21:59:00.000Z",
      })),
    });
    const text = renderSnapshot({ ...empty, governance }, NOW);
    assert.match(text, /governance: FRESH/);
    assert.match(text, /#205 STALE throttle/);
  });

  it("renders null leaf measurements and timestamps as unknown and never read", () => {
    const base = observed();
    assert.notEqual(base.availability, "unavailable");
    if (base.availability === "unavailable") return;
    const state = {
      ...base.state,
      regimes: base.state.regimes.map((entry) => entry.regime === "capacity"
        ? {
            ...entry,
            hosts: entry.hosts.map((host) => ({
              ...host,
              vramUsedBytes: null,
              vramTotalBytes: null,
              observedAt: null,
            })),
          }
        : entry),
    };
    const text = renderSnapshot({ ...empty, governance: observed({ state }) }, NOW);
    assert.match(text, /n5-fixture · never read/);
    assert.match(text, /VRAM used\/total\/headroom unknown/);
    assert.doesNotMatch(text, /100% free|healthy/);
  });

  it("never drops a note", () => {
    const snapshot = { ...empty, notes: ["codex: no store configured — skipped, not empty"] };
    const text = renderSnapshot(snapshot, NOW);
    assert.match(text, /notes:/);
    assert.match(text, /codex: no store configured/);
  });

  it("shows an unattributed run as work the board cannot see", () => {
    const snapshot = buildSnapshot({ generatedAt: NOW, runs: [run({ id: "a" })], items: [] });
    const text = renderSnapshot(snapshot, NOW);
    assert.match(text, /unattributed — 1 run\(s\) the board cannot see/);
    assert.match(text, /gpt-5\.6-sol\/xhigh/);
  });

  it("names an unattributed run by its session id, which is what `why` takes", () => {
    // It used to be named by its title — the operator's first prompt. The id is both safe to print
    // and more useful: the line a reader is looking at now tells them what to type next.
    const snapshot = buildSnapshot({ generatedAt: NOW, runs: [run({ id: "01997e0c-2f4a" })], items: [] });
    assert.match(renderSnapshot(snapshot, NOW), /01997e0c/);
  });

  it("marks the outcome and the launch identity on every run line", () => {
    const snapshot = buildSnapshot({
      generatedAt: NOW,
      runs: [
        run({
          id: "a",
          outcome: "failed",
          identity: { model: null, effort: null, provider: null, profile: null },
        }),
      ],
      items: [],
    });
    const text = renderSnapshot(snapshot, NOW);
    assert.match(text, /✗/);
    // A run that cannot say what it ran under says so; it does not borrow a default from the matrix.
    assert.match(text, /model unrecorded/);
  });

  it("emits no colour or cursor control, because this gets pasted into issues", () => {
    const snapshot = buildSnapshot({ generatedAt: NOW, runs: [run({ id: "a" })], items: [], notes: ["n"] });
    const text = renderSnapshot(snapshot, NOW);
    // Written as an escape, not as a literal control byte: a raw ESC in a source file is
    // invisible in review and does not survive an editor that trims control characters.
    assert.equal(text.includes("\u001b"), false, "output carries an escape sequence");
    assert.equal(text.includes("\r"), false, "output carries a carriage return");
  });

  it("renders the same text twice for the same snapshot", () => {
    const snapshot = buildSnapshot({ generatedAt: NOW, runs: [run({ id: "a" }), run({ id: "b" })], items: [] });
    assert.equal(renderSnapshot(snapshot, NOW), renderSnapshot(snapshot, NOW));
  });
});

describe("renderNotes", () => {
  it("collapses a note repeated by the scan into one line carrying the count", () => {
    // Measured on the real board: one line printed 128 times, and every other note in the scan was
    // below it. Identical notes are one fact observed more than once.
    const lines = renderNotes([...Array.from({ length: 128 }, () => "run x appears under itself"), "codex: no store"]);
    assert.equal(lines.filter((l) => l.includes("appears under itself")).length, 1);
    assert.ok(lines.some((l) => l.includes("(×128)")));
    assert.ok(lines.some((l) => l.includes("codex: no store")));
  });

  it("caps the distinct notes and says how many it did not print", () => {
    const many = Array.from({ length: RENDER_CAPS.notes + 5 }, (_, i) => `note ${i}`);
    const lines = renderNotes(many);
    assert.ok(lines.some((l) => l.includes("5 further distinct note(s)")));
    // The heading and the tail are not notes, so the printed notes are exactly the cap.
    assert.equal(lines.filter((l) => /^ {2}note \d+$/.test(l)).length, RENDER_CAPS.notes);
  });

  it("renders nothing at all when there is nothing to say", () => {
    assert.deepEqual(renderNotes([]), []);
  });

  it("does not append a count to a note seen once", () => {
    assert.deepEqual(renderNotes(["only once"]), ["", "notes:", "  only once"]);
  });
});

const item = (
  number: number,
  epic: string | null,
  over: Partial<BoardItemRef> = {},
): BoardItemRef => ({
  number,
  title: `item ${number}`,
  epic,
  milestone: "M1",
  phase: "impl",
  ...over,
});

const treeOf = (
  items: readonly BoardItemRef[],
  runs: readonly RunRecord[] = [],
): ReturnType<typeof buildTree> =>
  buildTree({ snapshot: buildSnapshot({ generatedAt: NOW, runs, items }), items, now: NOW });

describe("renderItemState", () => {
  it("spells out a pull request that was closed without landing", () => {
    // The board's `closed-unmerged` anomaly. Collapsed to "closed" it reads as done to anyone
    // skimming, which is the reading that loses a day of work.
    assert.match(
      renderItemState(item(90, "e9", { kind: "pull-request", state: "closed", merged: false })),
      /pull closed, not merged/,
    );
    assert.match(
      renderItemState(item(91, "e9", { kind: "pull-request", state: "closed", merged: true })),
      /pull merged/,
    );
  });

  it("says the state is unknown rather than assuming open", () => {
    assert.match(renderItemState(item(85, "e9")), /item state unknown/);
    assert.match(renderItemState(item(85, "e9", { phase: null })), /no column/);
  });
});

describe("renderLiveness", () => {
  it("names the evidence, not only the verdict", () => {
    // `live (turn)` is an agent working. `live (item)` may be nothing but a label somebody changed.
    // A reader who cannot tell them apart cannot weigh the answer.
    const t = treeOf([item(85, "e9", { updatedAt: "2026-09-04T21:58:00.000Z" })]);
    const node = t.milestones[0]?.epics[0]?.tasks[0];
    assert.ok(node);
    assert.match(renderLiveness(node.liveness, NOW), /live \(item, 2m ago\)/);
  });

  it("does not print an age it does not have", () => {
    assert.equal(
      renderLiveness({ state: "quiet", evidence: "none", at: null, ageMs: null }, NOW),
      "quiet (nothing recorded)",
    );
  });
});

describe("renderTree", () => {
  it("draws all four levels, with an untouched task still on the page", () => {
    const text = renderTree(
      treeOf([item(85, "e9"), item(86, "e9")], [run({ id: "a", linkedIssues: [{ number: 85, from: "path" }] })]),
      NOW,
    );
    assert.match(text, /M1/);
    assert.match(text, /epic:e9/);
    assert.match(text, /#85/);
    assert.match(text, /#86/);
  });

  it("puts the stalled nodes where they cannot be scrolled past", () => {
    const text = renderTree(
      treeOf(
        [item(85, "e9")],
        [run({ id: "a", outcome: "running", updatedAt: "2026-09-04T14:00:00.000Z", linkedIssues: [{ number: 85, from: "path" }] })],
      ),
      NOW,
    );
    assert.match(text, /1 stalled — a run says it is working and nothing has grown/);
    // Above the first milestone heading: this is the only state on the screen that means something
    // is wrong right now rather than merely unfinished.
    assert.ok(text.indexOf("stalled —") < text.indexOf("epic:e9"));
  });

  it("names an unclaimed pull request for what it is", () => {
    const text = renderTree(treeOf([item(85, "e9"), item(91, "e9", { kind: "pull-request" })]), NOW);
    assert.match(text, /pull requests naming no task:/);
  });

  it("answers the governance question first, because it explains an idle board", () => {
    const text = renderTree(treeOf([item(85, "e9")]), NOW);
    assert.ok(text.indexOf("governance") < text.indexOf("node(s) across"));
  });

  it("emits no colour or cursor control, because this gets pasted into issues", () => {
    const text = renderTree(treeOf([item(85, "e9")], [run({ id: "a" })]), NOW);
    assert.equal(text.includes("\u001b"), false, "output carries an escape sequence");
    assert.equal(text.includes("\r"), false, "output carries a carriage return");
  });

  it("caps the unattributed list and keeps the true count on the heading", () => {
    // The real board has 361 of these. Printed in full they were two thirds of the output, and the
    // board itself — the thing the command exists to show — scrolled off the top.
    const runs = Array.from({ length: RENDER_CAPS.runs + 12 }, (_, i) => run({ id: `r${i}` }));
    const text = renderTree(treeOf([item(85, "e9")], runs), NOW);
    assert.match(text, /unattributed — 32 run\(s\)/);
    assert.match(text, /… 12 more — read them with --json/);
  });

  it("renders the same text twice for the same tree", () => {
    const t = treeOf([item(85, "e9"), item(2, "e6")], [run({ id: "a" })]);
    assert.equal(renderTree(t, NOW), renderTree(t, NOW));
  });
});
