import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QuotaReading, RunRecord, TelemetrySnapshot } from "./model.js";
import { humanAge, humanTokens, renderQuota, renderSnapshot } from "./render.js";
import { buildSnapshot } from "./snapshot.js";

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
  notes: [],
};

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
    assert.equal(humanAge("2026-09-04T21:59:30.000Z", NOW), "just now");
    assert.equal(humanAge("2026-09-04T21:36:00.000Z", NOW), "24m");
    assert.equal(humanAge("2026-09-04T18:48:00.000Z", NOW), "3h 12m");
    assert.equal(humanAge("2026-09-02T20:00:00.000Z", NOW), "2d 2h");
  });

  it("says it does not know rather than printing NaN", () => {
    assert.equal(humanAge("not a date", NOW), "?");
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

  it("says out loud that no seam reported a quota, instead of showing nothing", () => {
    // A missing governance section reads as "all clear", which is the one thing it does not mean.
    assert.match(renderSnapshot(empty, NOW), /governance: no seam reported a quota window in this scan/);
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
