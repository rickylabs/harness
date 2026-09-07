import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_LANE_PREFIX,
  DEFAULT_PRIORITY_ORDER,
  ENUMERATED_FAMILIES,
  EPIC_LABEL,
  LABEL_USES,
  SINGLE_VALUE_FAMILIES,
  type LabelUse,
} from "./labels.js";

/**
 * These tests do not check the registry against the taxonomy — they cannot. `board` must not depend
 * on `forge`, so that comparison lives in `scripts/check-label-registry.mjs`, which is the only
 * place that can import both. What is checkable here is everything the script assumes about the
 * shape of this side: that the registry covers the constants the projector reads, that every entry
 * carries the context a failure has to print, and that a use cannot be described in a way the
 * comparison would silently skip.
 *
 * That last one is the point. Every invariant below has a failure mode where the check keeps
 * exiting 0 while comparing less than it claims to — a value entry with no family, a literal that
 * already contains the separator, an enumerated family nobody enumerated. A registry that is
 * quietly incomplete is the same defect as the dead branch it exists to catch, one level up.
 */

const find = (kind: LabelUse["kind"], literal: string): LabelUse | undefined =>
  LABEL_USES.find((use) => use.kind === kind && use.literal === literal);

describe("label registry", () => {
  it("is not empty", () => {
    // An empty registry passes every comparison the check makes. Asserting this here as well as in
    // the script is deliberate: the two failures point at different files.
    assert.ok(LABEL_USES.length > 0);
  });

  it("gives every entry the context a failure message needs", () => {
    for (const use of LABEL_USES) {
      assert.ok(use.literal.length > 0, `empty literal in ${use.site}`);
      assert.ok(use.site.length > 0, `no site for ${use.literal}`);
      assert.ok(use.reads.length > 0, `no gloss for ${use.literal}`);
      assert.ok(
        use.site.startsWith("packages/"),
        `site ${use.site} is not a repository-relative path, so a failure names a file nobody can open`,
      );
    }
  });

  it("reads as a clause, because the failure message embeds it in one", () => {
    // The script prints "`x` is read as a family in <site> — <reads> —", so a gloss that starts
    // with a capital or ends in a period turns the sentence into two half-sentences.
    for (const use of LABEL_USES) {
      assert.ok(!use.reads.endsWith("."), `gloss for ${use.literal} ends in a period`);
      assert.equal(
        use.reads[0],
        use.reads[0]?.toLowerCase(),
        `gloss for ${use.literal} starts mid-sentence with a capital`,
      );
    }
  });

  it("keeps the separator out of every literal", () => {
    // A `family` literal is a prefix and a `value` literal is what follows one, so a colon in
    // either means the comparison is splitting a string that was already split — and the script
    // would look it up under a family that does not exist and report the wrong side as at fault.
    for (const use of LABEL_USES) {
      if (use.kind === "name") continue;
      assert.ok(!use.literal.includes(":"), `${use.kind} literal ${use.literal} contains a colon`);
    }
  });

  it("attaches a family to values and to nothing else", () => {
    for (const use of LABEL_USES) {
      if (use.kind === "value") {
        assert.ok(use.family !== null, `value ${use.literal} names no family to look it up under`);
      } else {
        assert.equal(use.family, null, `${use.kind} ${use.literal} carries a family it cannot use`);
      }
    }
  });

  it("describes exactly one use of each literal", () => {
    const seen = new Set<string>();
    for (const use of LABEL_USES) {
      const key = `${use.kind}:${use.family ?? ""}:${use.literal}`;
      assert.ok(!seen.has(key), `${key} is declared twice`);
      seen.add(key);
    }
  });

  it("covers the constants the projection actually branches on", () => {
    assert.ok(find("name", EPIC_LABEL), "the epic marker is not in the registry");
    for (const family of SINGLE_VALUE_FAMILIES) {
      assert.ok(find("family", family), `single-value family ${family} is not in the registry`);
    }
    assert.ok(find("family", DEFAULT_LANE_PREFIX), "the lane family is not in the registry");
    for (const value of DEFAULT_PRIORITY_ORDER) {
      const use = find("value", value);
      assert.ok(use, `priority ${value} is not in the registry`);
      assert.equal(use.family, "priority");
    }
  });

  it("marks the lane family configurable and the rest not", () => {
    // `configurable` softens what the check asserts, so a family that got it by accident would be
    // exempted from a comparison nobody meant to exempt it from.
    for (const use of LABEL_USES) {
      const expected = use.kind === "family" && use.literal === DEFAULT_LANE_PREFIX;
      assert.equal(use.configurable === true, expected, `${use.literal} is marked wrongly`);
    }
  });

  it("enumerates exactly the families it declares values for", () => {
    const withValues = new Set(
      LABEL_USES.filter((use) => use.kind === "value").map((use) => use.family),
    );
    assert.deepEqual([...ENUMERATED_FAMILIES].sort(), [...withValues].sort());
  });

  it("declares every enumerated family as a family in its own right", () => {
    // The reverse check reads `family:value` names out of the taxonomy for each enumerated family.
    // A family enumerated but never declared would have its values checked and its own existence
    // taken on trust.
    for (const family of ENUMERATED_FAMILIES) {
      assert.ok(find("family", family), `${family} is enumerated but never declared as a family`);
    }
  });

  it("keeps the priority ordering and its registry entries in the same order", () => {
    // The gloss on each entry names a rank, and the rank is the index. If the two lists ever fall
    // out of step the failure message would name the wrong position — which is worse than none,
    // because it reads as authoritative.
    const values = LABEL_USES.filter((use) => use.family === "priority").map((use) => use.literal);
    assert.deepEqual(values, [...DEFAULT_PRIORITY_ORDER]);
  });
});
