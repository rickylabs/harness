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
  describeUnrelatedHarnessDrift,
  detectHarnessDrift,
  isManifestReconciled,
  loadPinnedHarnesses,
  manifestHarnesses,
  parseHarnessManifest,
  pinnedHarness,
  readUhpHarness,
  readUhpHarnessList,
  selectHarnessDrift,
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

/* -------------------------------------------------------------------------------------------------
 * The owner decision of 2026-09-12: a dispatch refuses only for the harness it selected
 * ---------------------------------------------------------------------------------------------- */

describe("console drift — narrowed to the selected harness, and still visible when it is not", () => {
  /** Both rows disagree: one is the harness under dispatch in each test below, one never is. */
  const claudeRebased = AGREEING.map((entry) => (entry.id === "chrn_aaa" ? { ...entry, base: "codex" } : entry));
  const codexRebased = AGREEING.map((entry) => (entry.id === "chrn_bbb" ? { ...entry, base: "codex-next" } : entry));

  it("blocks on drift for the selected harness and not on drift for another row", () => {
    const drift = detectHarnessDrift(manifest(), codexRebased);
    assert.deepEqual(drift.map((item) => item.harness), ["codex"]);

    // Dispatching to codex: the same drift blocks.
    const selectingCodex = selectHarnessDrift(drift, "codex");
    assert.deepEqual(selectingCodex.blocking.map((item) => item.kind), ["base-changed"]);
    assert.deepEqual(selectingCodex.unrelated, []);

    // Dispatching to claude: the same drift does not block, and does not vanish. Same input, two selections,
    // opposite answers — which is the decision, stated as the only assertion that can distinguish it from
    // both a manifest-wide refusal and a narrowing that dropped the row.
    const selectingClaude = selectHarnessDrift(drift, "claude");
    assert.deepEqual(selectingClaude.blocking, []);
    assert.deepEqual(selectingClaude.unrelated.map((item) => item.harness), ["codex"]);
    assert.notDeepEqual(selectingCodex.blocking, selectingClaude.blocking);
  });

  it("blocks an unreadable listing for every harness, because it cleared no id at all", () => {
    // The exception that must not be narrowed away. `listing-unreadable` carries `harness: null`, and reading
    // that as "concerns no harness, therefore not this one" would turn an unreachable console into an
    // agreeing one — the inversion this whole vocabulary exists to prevent.
    const drift = detectHarnessDrift(manifest(), null);
    assert.deepEqual(drift.map((item) => item.harness), [null]);
    for (const harness of ["claude", "codex"] as const) {
      const selection = selectHarnessDrift(drift, harness);
      assert.deepEqual(selection.blocking.map((item) => item.kind), ["listing-unreadable"]);
      assert.deepEqual(selection.unrelated, []);
    }
    // Paired control on the same function: a row-level drift on another harness is not blocking, so the
    // assertion above is about the null arm and not about a selector that blocks on everything.
    assert.deepEqual(selectHarnessDrift(detectHarnessDrift(manifest(), codexRebased), "claude").blocking, []);
  });

  it("names every unrelated row, not the first one and a count", () => {
    // Two drifted rows, one dispatch. A signal that named one of them would read as complete and leave the
    // other invisible, which is the same failure as no signal at all with better manners.
    const parsedThree = parseHarnessManifest({
      ...PINNED,
      harnesses: [...PINNED.harnesses, { harness: "opencode", id: "chrn_ccc", base: "opencode", defaultModel: null }],
    });
    assert.equal(parsedThree.ok, true);
    if (!parsedThree.ok) return;
    const listing = [AGREEING[0] as UhpHarness];
    const unrelated = selectHarnessDrift(detectHarnessDrift(parsedThree.manifest, listing), "claude").unrelated;
    const described = describeUnrelatedHarnessDrift(parsedThree.manifest, unrelated);
    assert.ok(described?.includes("codex (harness-absent)"), described ?? "");
    assert.ok(described?.includes("opencode (harness-absent)"), described ?? "");
    assert.ok(described?.includes("2 harness(es)"), described ?? "");
  });

  it("partitions a mixed listing without losing a row", () => {
    const both = AGREEING.map((entry) =>
      entry.id === "chrn_aaa" ? { ...entry, base: "codex" } : { ...entry, base: "codex-next" }
    );
    const drift = detectHarnessDrift(manifest(), both);
    assert.equal(drift.length, 2);
    const selection = selectHarnessDrift(drift, "claude");
    assert.deepEqual(selection.blocking.map((item) => item.harness), ["claude"]);
    assert.deepEqual(selection.unrelated.map((item) => item.harness), ["codex"]);
    // Nothing is dropped and nothing is counted twice: the two halves reconstruct the input.
    assert.equal(selection.blocking.length + selection.unrelated.length, drift.length);
  });

  it("names the unrelated rows in prose an operator can act on, and says nothing when there is nothing", () => {
    const unrelated = selectHarnessDrift(detectHarnessDrift(manifest(), codexRebased), "claude").unrelated;
    const described = describeUnrelatedHarnessDrift(manifest(), unrelated);
    assert.notEqual(described, null);
    // The row summary, asserted in the form it is written rather than as two substrings that also appear in
    // the per-row detail further along the same sentence. A mutation replacing the summary with a count left
    // those substrings intact and killed nothing, which is what this assertion exists to have caught.
    assert.ok(described?.includes("codex (base-changed)"), described ?? "");
    assert.ok(described?.includes("did not select"), described ?? "");
    // It is a different string from the refusal wording, because it is a different event: this dispatch went
    // ahead. A reader who sees refusal prose on a dispatch that proceeded learns to distrust both.
    assert.notEqual(described, describeHarnessDrift(manifest(), unrelated));
    assert.equal(describeUnrelatedHarnessDrift(manifest(), []), null);
    // And it still says whether the ids were ever checked at all.
    assert.ok(described?.includes("reconciled at 2026-09-12T09:00:00.000Z"), described ?? "");
  });

  it("keeps the manifest-wide answer available for the reconciliation path", () => {
    // Narrowing is a property of a dispatch, not of the check. #294 has to see every stale row to repair the
    // file, so `detectHarnessDrift` still reports all of them on the same listing that blocks only one.
    const drift = detectHarnessDrift(manifest(), [claudeRebased[0] as UhpHarness]);
    assert.deepEqual(drift.map((item) => item.kind), ["base-changed", "harness-absent"]);
    assert.deepEqual(selectHarnessDrift(drift, "claude").blocking.map((item) => item.kind), ["base-changed"]);
    assert.equal(drift.length, 2);
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
