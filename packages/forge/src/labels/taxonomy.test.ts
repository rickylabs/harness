import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORE_TAXONOMY,
  STATUS_LABELS,
  STATUS_LIFECYCLE,
  STATUS_OVERRIDE,
  STATUS_TERMINAL,
  slugify,
  normalizeColor,
  violatesSingleStatus,
} from "./taxonomy.js";

describe("core taxonomy", () => {
  it("names nothing repo-specific, so it is safe to install anywhere", () => {
    for (const spec of CORE_TAXONOMY) {
      assert.equal(spec.origin, "core", `${spec.name} is not portable`);
      assert.ok(
        !["area", "gate", "ci", "epic", "lane", "wave"].includes(spec.family),
        `${spec.name} belongs to a derived family and must not ship in the core`,
      );
    }
  });

  it("has no duplicate names", () => {
    const names = CORE_TAXONOMY.map((s) => s.name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });

  it("gives every label a wire-format color and a description", () => {
    for (const spec of CORE_TAXONOMY) {
      assert.match(spec.color, /^[0-9a-f]{6}$/, `${spec.name} has a non-wire color`);
      assert.ok(spec.description.length > 0, `${spec.name} has no description`);
    }
  });

  it("covers the whole lifecycle, plus the terminal and override states", () => {
    const declared = new Set(STATUS_LABELS.map((s) => s.name));
    for (const phase of STATUS_LIFECYCLE) assert.ok(declared.has(phase), `${phase} has no label`);
    assert.ok(declared.has(STATUS_TERMINAL));
    assert.ok(declared.has(STATUS_OVERRIDE));
    assert.equal(declared.size, STATUS_LIFECYCLE.length + 2);
  });

  it("keeps the terminal and override states out of the lifecycle", () => {
    assert.ok(!(STATUS_LIFECYCLE as readonly string[]).includes(STATUS_TERMINAL));
    assert.ok(!(STATUS_LIFECYCLE as readonly string[]).includes(STATUS_OVERRIDE));
  });
});

describe("violatesSingleStatus", () => {
  it("passes an item with exactly one status", () => {
    assert.deepEqual(violatesSingleStatus(["type:feat", "status:impl", "priority:p1"]), []);
  });

  it("passes an item with none — invisible, but not contradictory", () => {
    assert.deepEqual(violatesSingleStatus(["type:feat"]), []);
  });

  it("returns the offenders when the board column is a lie", () => {
    assert.deepEqual(violatesSingleStatus(["status:impl", "type:fix", "status:ready-merge"]), [
      "status:impl",
      "status:ready-merge",
    ]);
  });
});

describe("slugify", () => {
  it("strips an npm scope, so @scope/forge becomes forge", () => {
    assert.equal(slugify("@rickylabs/forge"), "forge");
  });

  it("collapses punctuation and trims the edges", () => {
    assert.equal(slugify("  W0 · Docs & Internals!  "), "w0-docs-internals");
  });

  it("bounds the length, because GitHub labels are not a place for prose", () => {
    assert.ok(slugify("x".repeat(200)).length <= 40);
  });
});

describe("normalizeColor", () => {
  it("accepts either wire format", () => {
    assert.equal(normalizeColor("#AABBCC"), "aabbcc");
    assert.equal(normalizeColor("aabbcc"), "aabbcc");
  });
});
