import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLOSE_GATE_OVERRIDE,
  CORE_TAXONOMY,
  RETIRED_CLOSE_GATE_STATUS,
  RETIRED_LABELS,
  STATUS_LABELS,
  STATUS_LIFECYCLE,
  STATUS_TERMINAL,
  classifyStatus,
  isRetired,
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

  it("covers the whole lifecycle plus the terminal state, and nothing else", () => {
    const declared = new Set(STATUS_LABELS.map((s) => s.name));
    for (const phase of STATUS_LIFECYCLE) assert.ok(declared.has(phase), `${phase} has no label`);
    assert.ok(declared.has(STATUS_TERMINAL));
    // The exact count, not a lower bound. `dsh-board` mirrors this list as its columns, and a
    // status label the projector has no column for makes every item carrying it read as "no
    // status" — invisible, which is the failure `scripts/check-lifecycle.mjs` exists to catch.
    assert.equal(declared.size, STATUS_LIFECYCLE.length + 1);
  });

  it("keeps the terminal state out of the lifecycle", () => {
    assert.ok(!(STATUS_LIFECYCLE as readonly string[]).includes(STATUS_TERMINAL));
  });

  it("carries the close-gate override as a flag, so it never occupies the board column", () => {
    const flag = CORE_TAXONOMY.find((s) => s.name === CLOSE_GATE_OVERRIDE);
    assert.ok(flag, `${CLOSE_GATE_OVERRIDE} is not in the core taxonomy`);
    assert.equal(flag.family, "flag");
    // The point of the move: a flag is additive, so it can sit beside the item's real phase.
    assert.ok(!CLOSE_GATE_OVERRIDE.startsWith("status:"));
  });
});

describe("retired labels", () => {
  it("retires the old close-gate status instead of deleting it", () => {
    const spec = RETIRED_LABELS.find((s) => s.name === RETIRED_CLOSE_GATE_STATUS);
    assert.ok(spec, `${RETIRED_CLOSE_GATE_STATUS} is not retired anywhere`);
    assert.ok(isRetired(spec));
    assert.equal(spec.supersededBy, CLOSE_GATE_OVERRIDE);
    // Deleting it would strip it off every item it ever audited, taking the record with it. The
    // description is the only notice a person browsing the label list gets, so it names the
    // successor — and GitHub truncates a label description past 100 characters.
    assert.ok(spec.description.includes(CLOSE_GATE_OVERRIDE));
    assert.ok(spec.description.length <= 100, `${spec.description.length} chars`);
  });

  it("never proposes a retired label for installation", () => {
    const core = new Set(CORE_TAXONOMY.map((s) => s.name.toLowerCase()));
    for (const spec of RETIRED_LABELS) {
      assert.ok(!core.has(spec.name.toLowerCase()), `${spec.name} is both retired and installed`);
    }
  });

  it("gives every retired label a successor and a wire-format color", () => {
    for (const spec of RETIRED_LABELS) {
      assert.ok(isRetired(spec), `${spec.name} is in RETIRED_LABELS without a successor`);
      assert.ok(isValidColor(spec.color), `${spec.name} ${spec.color}`);
      assert.ok(spec.description.length > 0, `${spec.name} has no description`);
    }
  });

  it("leaves a live label unretired", () => {
    // `exactOptionalPropertyTypes` keeps `supersededBy` absent rather than `undefined`; if that
    // ever slipped, every core label would read as retired and the taxonomy would install nothing.
    for (const spec of CORE_TAXONOMY) assert.ok(!isRetired(spec), `${spec.name} reads as retired`);
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
