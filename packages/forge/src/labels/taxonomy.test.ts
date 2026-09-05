import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORE_TAXONOMY,
  STATUS_LABELS,
  STATUS_LIFECYCLE,
  STATUS_OVERRIDE,
  STATUS_TERMINAL,
  classifyStatus,
  isValidColor,
  normalizeColor,
  slugify,
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

describe("classifyStatus", () => {
  it("passes an item with exactly one status", () => {
    assert.deepEqual(classifyStatus(["type:feat", "status:impl", "priority:p1"]), {
      kind: "ok",
      status: "status:impl",
    });
  });

  it("calls no status `missing`, not `ok` — an invisible item is not a well-formed one", () => {
    assert.deepEqual(classifyStatus(["type:feat"]), { kind: "missing" });
  });

  it("returns the offenders when the board column is a lie", () => {
    assert.deepEqual(classifyStatus(["status:impl", "type:fix", "status:ready-merge"]), {
      kind: "multiple",
      statuses: ["status:impl", "status:ready-merge"],
    });
  });

  it("matches case-insensitively, the way GitHub matches label names", () => {
    // A case-sensitive filter reports this pair as a single status, which is worse than reporting
    // nothing: the item looks well-formed while sitting in two columns.
    assert.deepEqual(classifyStatus(["Status:impl", "status:ready-merge"]), {
      kind: "multiple",
      statuses: ["Status:impl", "status:ready-merge"],
    });
  });

  it("does not claim a label that merely starts with the word status", () => {
    assert.deepEqual(classifyStatus(["statuspage:outage", "type:fix"]), { kind: "missing" });
    assert.deepEqual(classifyStatus(["status"]), { kind: "missing" });
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

  it("keeps distinct long titles distinct", () => {
    // Truncation alone is not injective. Two epics sharing a long prefix collapsing to one slug
    // does not fail loudly — it merges the epics and loses the second one's tasks.
    const a = `${"a".repeat(40)}-first-epic`;
    const b = `${"a".repeat(40)}-second-epic`;
    assert.notEqual(slugify(a), slugify(b));
    assert.ok(slugify(a).length <= 40 && slugify(b).length <= 40);
  });

  it("is a pure function of its input", () => {
    const title = `${"board projection ".repeat(6)}tail`;
    assert.equal(slugify(title), slugify(title));
  });
});

describe("normalizeColor / isValidColor", () => {
  it("accepts either wire format", () => {
    assert.equal(normalizeColor("#AABBCC"), "aabbcc");
    assert.equal(normalizeColor("aabbcc"), "aabbcc");
  });

  it("rejects anything that is not six hex digits", () => {
    // The type promises six hex digits; a string parsed out of a file has made no such promise.
    // Without this, `not-a-color` reaches a POST body and the apply fails partway through.
    for (const good of ["#FBCA04", "FBCA04", "fbca04"]) assert.ok(isValidColor(good), good);
    for (const bad of ["not-a-color", "", "#fff", "fbca0", "fbca045", "#gggggg"]) {
      assert.ok(!isValidColor(bad), JSON.stringify(bad));
    }
  });

  it("holds for every color this package ships", () => {
    for (const spec of CORE_TAXONOMY) assert.ok(isValidColor(spec.color), `${spec.name} ${spec.color}`);
  });
});
