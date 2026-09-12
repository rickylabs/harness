/**
 * The pinned console manifest, and the drift check that refuses a dispatch when the console has moved.
 *
 * Issue #286, fail-closed requirement F1. Run artifacts: `.llm/runs/provider-uhp--e37/`.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 *
 * They prove what this repository does with a given manifest and a given harness listing. They prove
 * nothing about what any HarnessRouter console contains: the listings below are written from the
 * Harnesses chapter of UHP `2026-08-11`, and the checked-in manifest has never been reconciled against a
 * deployment. The tests that matter most here are the ones asserting that an unreconciled manifest
 * refuses rather than guesses.
 *
 * Every control is paired. A test that only asserted "drift was detected" would pass for an
 * implementation that reports drift on everything, so each one also asserts that the same comparison with
 * the drifted field repaired reports **no** drift on identical input.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PINNED_HARNESSES_PATH,
  describeHarnessDrift,
  detectHarnessDrift,
  isManifestReconciled,
  loadPinnedHarnesses,
  manifestHarnesses,
  parseHarnessManifest,
  pinnedHarness,
  readUhpHarness,
  readUhpHarnessList,
  type HarnessManifest,
} from "./uhp-harnesses.js";
import { HARNESSES } from "./dispatch.js";
import type { UhpHarness } from "./uhp-wire.js";

/** A reconciled manifest, so the tests below are about drift rather than about being unreconciled. */
const PINNED = {
  version: 1,
  protocol: "2026-08-11",
  reconciledAt: "2026-09-12T09:00:00.000Z",
  reconciledAgainst: "a fictional loopback deployment, for tests only",
  harnesses: [
    { harness: "claude", id: "chrn_aaa", base: "claude-code", defaultModel: "claude-opus-5" },
    { harness: "codex", id: "chrn_bbb", base: "codex", defaultModel: null },
  ],
} as const;

function manifest(): HarnessManifest {
  const parsed = parseHarnessManifest(PINNED);
  assert.equal(parsed.ok, true, "the fixture manifest must parse, or every test below is about the wrong thing");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.manifest;
}

/** The console listing that agrees with `PINNED` on every compared field. */
const AGREEING: readonly UhpHarness[] = [
  { id: "chrn_aaa", object: "harness", name: "Research agent", base: "claude-code", defaultModel: "claude-opus-5", createdAt: 1 },
  { id: "chrn_bbb", object: "harness", name: "Codex", base: "codex", createdAt: 2 },
];

describe("the pinned manifest — a file that cannot be half right", () => {
  it("parses a well-formed manifest and reports what it can dispatch", () => {
    const pinned = manifest();
    assert.deepEqual(manifestHarnesses(pinned), ["claude", "codex"]);
    assert.equal(pinnedHarness(pinned, "claude")?.id, "chrn_aaa");
    // A word the manifest does not pin is not dispatchable, and the absence is `null` rather than a
    // default. A default here would send a task with no harness id and let the server choose.
    assert.equal(pinnedHarness(pinned, "opencode"), null);
    assert.equal(isManifestReconciled(pinned), true);
  });

  it("refuses every way a hand-edited entry goes wrong, and names each one", () => {
    const cases: readonly { readonly entry: unknown; readonly problem: string }[] = [
      { entry: { harness: "claude", id: "not_a_chrn_id", base: "claude-code" }, problem: "unpinned-id" },
      { entry: { harness: "claude", id: "", base: "claude-code" }, problem: "unpinned-id" },
      { entry: { harness: "nonesuch", id: "chrn_aaa", base: "claude-code" }, problem: "unknown-harness" },
      { entry: { harness: "claude", id: "chrn_aaa", base: "" }, problem: "blank-base" },
      { entry: { harness: "claude", id: "chrn_aaa", base: "claude-code", defaultModel: "  " }, problem: "blank-default-model" },
      { entry: "not an object", problem: "unreadable" },
    ];
    for (const { entry, problem } of cases) {
      const parsed = parseHarnessManifest({ ...PINNED, harnesses: [entry] });
      assert.equal(parsed.ok, false, `${problem} must not parse`);
      if (parsed.ok) continue;
      assert.ok(
        parsed.faults.some((item) => item.problem === problem),
        `expected ${problem}, got ${parsed.faults.map((item) => item.problem).join(", ")}`,
      );
    }
    // The positive control on the same shape: with the damage repaired, the entry parses. Without this,
    // the loop above would pass for a parser that refuses everything.
    const repaired = parseHarnessManifest({ ...PINNED, harnesses: [PINNED.harnesses[0]] });
    assert.equal(repaired.ok, true);
  });

  it("refuses a duplicate word and a duplicate id, which are different mistakes", () => {
    const twoWords = parseHarnessManifest({
      ...PINNED,
      harnesses: [PINNED.harnesses[0], { ...PINNED.harnesses[0], id: "chrn_ccc" }],
    });
    assert.equal(twoWords.ok, false);
    if (!twoWords.ok) assert.ok(twoWords.faults.some((item) => item.problem === "duplicate-harness"));

    const twoIds = parseHarnessManifest({
      ...PINNED,
      harnesses: [PINNED.harnesses[0], { ...PINNED.harnesses[1], id: "chrn_aaa" }],
    });
    assert.equal(twoIds.ok, false);
    if (!twoIds.ok) assert.ok(twoIds.faults.some((item) => item.problem === "duplicate-id"));
  });

  it("refuses a manifest pinned under another protocol version", () => {
    const parsed = parseHarnessManifest({ ...PINNED, protocol: "2025-01-01" });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.ok(parsed.faults.some((item) => item.problem === "protocol-mismatch"));
    // Positive control: the same manifest at the version this adapter speaks parses.
    assert.equal(parseHarnessManifest(PINNED).ok, true);
  });

  it("refuses a reconciledAt that is neither null nor an instant, rather than ignoring it", () => {
    const parsed = parseHarnessManifest({ ...PINNED, reconciledAt: "last tuesday" });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.ok(parsed.faults.some((item) => item.problem === "unreadable-reconciled-at"));
    // null is legitimate and means "never reconciled", which is a fact rather than a fault.
    const never = parseHarnessManifest({ ...PINNED, reconciledAt: null });
    assert.equal(never.ok, true);
    if (never.ok) assert.equal(isManifestReconciled(never.manifest), false);
  });
});

describe("reading a console listing", () => {
  it("requires the three fields the schema requires, and keeps defaultModel optional", () => {
    assert.deepEqual(readUhpHarness({ id: "chrn_a", name: "n", base: "b" }), { id: "chrn_a", name: "n", base: "b" });
    assert.equal(readUhpHarness({ id: "chrn_a", name: "n" }), null);
    assert.equal(readUhpHarness({ id: "chrn_a", base: "b" }), null);
    assert.equal(readUhpHarness({ name: "n", base: "b" }), null);
    assert.equal(readUhpHarness("harness"), null);
    assert.equal(readUhpHarness({ id: "chrn_a", name: "n", base: "b", defaultModel: "m" })?.defaultModel, "m");
  });

  it("distinguishes an empty console from an unreadable one", () => {
    // Harnesses §1: "The list MAY be empty — a server with no configured harnesses is valid".
    assert.deepEqual(readUhpHarnessList({ harnesses: [] }), []);
    assert.equal(readUhpHarnessList({}), null);
    assert.equal(readUhpHarnessList({ harnesses: {} }), null);
    assert.equal(readUhpHarnessList({ harnesses: [{ id: "chrn_a" }] }), null);
    assert.equal(readUhpHarnessList("[]"), null);
  });
});

describe("console drift — every difference refuses, and agreement does not", () => {
  it("reports no drift when the console agrees on every compared field", () => {
    assert.deepEqual(detectHarnessDrift(manifest(), AGREEING), []);
  });

  it("does not treat a rename as drift, because name is not an identifier", () => {
    const renamed = AGREEING.map((entry) => ({ ...entry, name: `${entry.name} (renamed)` }));
    assert.deepEqual(detectHarnessDrift(manifest(), renamed), []);
  });

  it("reports an absent pinned id, and only for the entry that is absent", () => {
    const drift = detectHarnessDrift(manifest(), [AGREEING[1] as UhpHarness]);
    assert.deepEqual(drift.map((item) => item.kind), ["harness-absent"]);
    assert.equal(drift[0]?.harness, "claude");
    // Paired control: the same manifest against the full listing reports nothing.
    assert.deepEqual(detectHarnessDrift(manifest(), AGREEING), []);
  });

  it("reports a changed base, which the specification forbids on an existing object", () => {
    const rebased = AGREEING.map((entry) => (entry.id === "chrn_aaa" ? { ...entry, base: "codex" } : entry));
    const drift = detectHarnessDrift(manifest(), rebased);
    assert.deepEqual(drift.map((item) => item.kind), ["base-changed"]);
    assert.ok(drift[0]?.detail.includes("claude-code"));
  });

  it("reports a changed default model in both directions", () => {
    const changed = AGREEING.map((entry) => (entry.id === "chrn_aaa" ? { ...entry, defaultModel: "claude-sonnet-5" } : entry));
    assert.deepEqual(detectHarnessDrift(manifest(), changed).map((item) => item.kind), ["default-model-changed"]);

    // The console dropping a default this manifest pins is the same fact from the other side: every task
    // that omits a model would now run on something neither side names.
    const dropped = AGREEING.map((entry) => {
      if (entry.id !== "chrn_aaa") return entry;
      const { defaultModel: _dropped, ...rest } = entry;
      return rest as UhpHarness;
    });
    assert.deepEqual(detectHarnessDrift(manifest(), dropped).map((item) => item.kind), ["default-model-changed"]);

    // And a console that volunteers a default where the manifest pins none.
    const volunteered = AGREEING.map((entry) => (entry.id === "chrn_bbb" ? { ...entry, defaultModel: "gpt-5.4" } : entry));
    assert.deepEqual(detectHarnessDrift(manifest(), volunteered).map((item) => item.kind), ["default-model-changed"]);
  });

  it("reports one id naming two objects rather than picking one", () => {
    const duplicated = [...AGREEING, { ...(AGREEING[0] as UhpHarness), name: "Impostor" }];
    const drift = detectHarnessDrift(manifest(), duplicated);
    assert.deepEqual(drift.map((item) => item.kind), ["id-duplicated"]);
  });

  it("treats an unreadable listing as drift, not as agreement", () => {
    // The distinction this asserts: `null` in, drift out. An implementation that returned `[]` for an
    // unreadable listing would dispatch on a console it never read, and every assertion above would
    // still pass.
    const drift = detectHarnessDrift(manifest(), null);
    assert.deepEqual(drift.map((item) => item.kind), ["listing-unreadable"]);
    assert.equal(drift[0]?.harness, null);
    assert.deepEqual(detectHarnessDrift(manifest(), []).map((item) => item.kind), ["harness-absent", "harness-absent"]);
  });

  it("says in the refusal whether the manifest was ever reconciled", () => {
    const drift = detectHarnessDrift(manifest(), null);
    assert.ok(describeHarnessDrift(manifest(), drift).includes("reconciled at 2026-09-12T09:00:00.000Z"));

    const unreconciled = parseHarnessManifest({ ...PINNED, reconciledAt: null, reconciledAgainst: null });
    assert.equal(unreconciled.ok, true);
    if (!unreconciled.ok) return;
    const described = describeHarnessDrift(unreconciled.manifest, detectHarnessDrift(unreconciled.manifest, null));
    assert.ok(described.includes("never been reconciled"));
    // The two descriptions are different strings for the two different facts, which is the point: an
    // operator reading a refusal needs to know whether the ids were ever checked.
    assert.notEqual(described, describeHarnessDrift(manifest(), drift));
  });
});

describe("the checked-in manifest", () => {
  it("parses, pins the five harnesses #286 requires, and admits it is unreconciled", async () => {
    const loaded = await loadPinnedHarnesses();
    assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.faults));
    if (!loaded.ok) return;
    assert.deepEqual(manifestHarnesses(loaded.manifest), ["claude", "codex", "codex-run", "opencode", "opencode-run"]);
    // `agy` is in this repository's vocabulary and has no UHP harness object, so it is deliberately not
    // pinned: the capability list is derived from this file and must not claim it.
    assert.ok(HARNESSES.includes("agy"));
    assert.equal(pinnedHarness(loaded.manifest, "agy"), null);

    // The honest half. No console has been read into this file, so nothing it says about a server is
    // evidence, and the first live listing will refuse every dispatch through it.
    assert.equal(isManifestReconciled(loaded.manifest), false);
    assert.equal(loaded.manifest.reconciledAt, null);
    const drift = detectHarnessDrift(loaded.manifest, []);
    assert.equal(drift.length, 5);
    assert.ok(drift.every((item) => item.kind === "harness-absent"));
  });

  it("reports an unreadable manifest as a fault rather than throwing", async () => {
    const missing = await loadPinnedHarnesses(`${PINNED_HARNESSES_PATH}.nonesuch`);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.deepEqual(missing.faults.map((item) => item.problem), ["unreadable"]);
  });
});
