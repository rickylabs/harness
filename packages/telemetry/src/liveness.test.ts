import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classify, liveness, newest, DEFAULT_WINDOWS, type Evidence } from "./liveness.js";

const NOW = "2026-09-05T12:00:00.000Z";

/** `minutes` before `NOW`, so every case below reads as an age rather than as a clock. */
const ago = (minutes: number): string =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

const turn = (minutes: number, claimsRunning = false): Evidence => ({
  at: ago(minutes),
  kind: "turn",
  claimsRunning,
});

const item = (minutes: number): Evidence => ({ at: ago(minutes), kind: "item", claimsRunning: false });

describe("newest", () => {
  it("takes the most recent piece, not the strongest kind", () => {
    // A four-hour-old turn does not make a node more alive than a label edit two minutes ago. It
    // makes it a node whose last activity was a label edit, and the reader is entitled to know that.
    const best = newest([turn(240), item(2)]);
    assert.equal(best.kind, "item");
    assert.equal(best.at, ago(2));
  });

  it("carries a running claim from any piece, however old", () => {
    const best = newest([turn(600, true), item(1)]);
    assert.equal(best.kind, "item");
    assert.equal(best.claimsRunning, true);
  });

  it("ignores undatable evidence instead of poisoning the comparison", () => {
    const best = newest([{ at: "whenever", kind: "turn", claimsRunning: false }, turn(30)]);
    assert.equal(best.at, ago(30));
  });

  it("reports nothing as nothing", () => {
    assert.deepEqual(newest([]), { at: null, kind: "none", claimsRunning: false });
  });
});

describe("classify", () => {
  it("is live on a fresh turn", () => {
    const state = classify(turn(3), NOW);
    assert.equal(state.state, "live");
    assert.equal(state.evidence, "turn");
    assert.equal(state.ageMs, 3 * 60_000);
  });

  it("is recent inside the day window and quiet outside it", () => {
    assert.equal(classify(turn(60), NOW).state, "recent");
    assert.equal(classify(turn(60 * 30), NOW).state, "quiet");
  });

  /**
   * The assertion this whole module exists for, quoted from #85: *liveness is not progress — a node
   * is green on a growing artifact, a new commit or a live turn, never on an open socket.*
   *
   * A held session is exactly what "still running" means here, and it is the signal that produced
   * the problem the repository exists to solve: a coordinator answering "yes, it's running" about a
   * board where nothing has moved for six hours.
   */
  it("never greens a run that claims to be running but has produced no recent turn", () => {
    const state = classify(turn(6 * 60, true), NOW);
    assert.equal(state.state, "stalled");
    assert.notEqual(state.state, "live");
  });

  it("downgrades rather than upgrades: a claim turns recent and quiet into stalled", () => {
    assert.equal(classify(turn(60), NOW).state, "recent");
    assert.equal(classify(turn(60, true), NOW).state, "stalled");
    assert.equal(classify(turn(60 * 30), NOW).state, "quiet");
    assert.equal(classify(turn(60 * 30, true), NOW).state, "stalled");
  });

  it("still greens a genuinely fresh run that also claims to be running", () => {
    // The claim is a downgrade signal, not a disqualification: real work says both things at once.
    assert.equal(classify(turn(1, true), NOW).state, "live");
  });

  it("treats the window boundaries as inclusive", () => {
    assert.equal(classify(turn(DEFAULT_WINDOWS.liveMs / 60_000), NOW).state, "live");
    assert.equal(classify(turn(DEFAULT_WINDOWS.liveMs / 60_000 + 1), NOW).state, "recent");
    assert.equal(classify(turn(DEFAULT_WINDOWS.recentMs / 60_000), NOW).state, "recent");
    assert.equal(classify(turn(DEFAULT_WINDOWS.recentMs / 60_000 + 1), NOW).state, "quiet");
  });

  it("takes the windows it is given, so tests never sleep", () => {
    const windows = { liveMs: 1000, recentMs: 5000 };
    assert.equal(classify(turn(0.01), NOW, windows).state, "live");
    assert.equal(classify(turn(0.05), NOW, windows).state, "recent");
    assert.equal(classify(turn(1), NOW, windows).state, "quiet");
  });

  it("clamps a future timestamp to zero rather than rendering a node updated tomorrow", () => {
    // A box whose clock runs ahead is common and harmless. A negative age is neither.
    const state = classify(turn(-30), NOW);
    assert.equal(state.state, "live");
    assert.equal(state.ageMs, 0);
  });

  it("says `none` when nothing was datable, whatever kind the caller passed", () => {
    // `quiet (turn)` would claim a turn was seen. An unparseable timestamp is not weaker evidence
    // of a turn; it is no evidence at all.
    const state = classify({ at: "soon", kind: "turn", claimsRunning: false }, NOW);
    assert.deepEqual(state, { state: "quiet", evidence: "none", at: null, ageMs: null });
  });

  it("still surfaces an undatable running claim as stalled", () => {
    const state = classify({ at: null, kind: "none", claimsRunning: true }, NOW);
    assert.equal(state.state, "stalled");
  });
});

describe("liveness", () => {
  it("combines and classifies in one step", () => {
    assert.equal(liveness([turn(300), item(4)], NOW).state, "live");
    assert.equal(liveness([turn(300), item(4)], NOW).evidence, "item");
  });

  it("reports an empty node as quiet with nothing behind it", () => {
    assert.deepEqual(liveness([], NOW), {
      state: "quiet",
      evidence: "none",
      at: null,
      ageMs: null,
    });
  });

  it("keeps a stale running claim visible even when a newer edit looks calm", () => {
    // The rollup case that matters: one wedged subagent under an epic whose issues were relabelled
    // an hour ago. Without the carried claim the epic reads `recent` and nobody opens it.
    assert.equal(liveness([turn(6 * 60, true), item(60)], NOW).state, "stalled");
  });
});
