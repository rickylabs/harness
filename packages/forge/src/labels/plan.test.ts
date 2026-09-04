import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isClean, planLabels } from "./plan.js";
import type { ExistingLabel } from "./github.js";
import { CORE_TAXONOMY, type LabelSpec } from "./taxonomy.js";

const spec = (name: string, color = "aabbcc", description = "desc"): LabelSpec => ({
  name,
  color,
  description,
  family: "type",
  origin: "core",
});

const existing = (name: string, color = "aabbcc", description = "desc"): ExistingLabel => ({
  name,
  color,
  description,
});

describe("planLabels", () => {
  it("never emits a delete, however many unmanaged labels the repo has", () => {
    const plan = planLabels(
      [spec("type:feat")],
      [existing("type:feat"), existing("wontfix"), existing("area:legacy")],
    );
    assert.deepEqual(
      plan.actions.map((a) => a.kind),
      ["keep"],
    );
    assert.deepEqual(
      plan.unmanaged.map((l) => l.name),
      ["wontfix", "area:legacy"],
    );
  });

  it("creates what is absent and keeps what already matches", () => {
    const plan = planLabels([spec("type:feat"), spec("type:fix")], [existing("type:feat")]);
    assert.equal(plan.counts.create, 1);
    assert.equal(plan.counts.keep, 1);
    assert.equal(plan.actions.find((a) => a.kind === "create")?.spec.name, "type:fix");
  });

  it("matches existing labels case-insensitively, the way GitHub does", () => {
    const plan = planLabels([spec("type:feat")], [existing("Type:Feat")]);
    assert.equal(plan.counts.keep, 1);
    assert.equal(plan.counts.create, 0);
  });

  it("refuses to overwrite an authored description without --force", () => {
    const plan = planLabels(
      [spec("type:feat", "aabbcc", "New feature or capability")],
      [existing("type:feat", "aabbcc", "Our own carefully worded description")],
    );
    assert.equal(plan.counts.conflict, 1);
    assert.match(plan.actions[0]?.reason ?? "", /--force/);
  });

  it("takes the taxonomy's wording under --force", () => {
    const plan = planLabels(
      [spec("type:feat", "aabbcc", "New feature or capability")],
      [existing("type:feat", "aabbcc", "Our own carefully worded description")],
      { force: true },
    );
    assert.equal(plan.counts.update, 1);
    assert.equal(plan.counts.conflict, 0);
  });

  it("overwrites GitHub's stock descriptions without calling them a conflict", () => {
    const plan = planLabels(
      [spec("type:fix", "aabbcc", "Bug fix")],
      [existing("type:fix", "d73a4a", "Something isn't working")],
    );
    assert.equal(plan.counts.update, 1);
    assert.equal(plan.counts.conflict, 0);
  });

  it("treats color as presentation: reconciles by default, leaves it alone when told to", () => {
    const desired = [spec("type:feat", "112233", "desc")];
    const repo = [existing("type:feat", "#AABBCC", "desc")];

    assert.equal(planLabels(desired, repo).counts.update, 1);

    const kept = planLabels(desired, repo, { reconcileColor: false });
    assert.equal(kept.counts.keep, 1);
    assert.equal(kept.counts.update, 0);
  });

  it("keeps the first spec when two sources propose the same label", () => {
    const plan = planLabels([spec("area:forge", "111111"), spec("area:forge", "222222")], []);
    assert.equal(plan.counts.create, 1);
    assert.equal(plan.actions[0]?.spec.color, "111111");
  });

  it("is clean only when nothing would change", () => {
    assert.equal(isClean(planLabels([spec("type:feat")], [existing("type:feat")])), true);
    assert.equal(isClean(planLabels([spec("type:feat")], [])), false);
  });

  it("is idempotent: applying the core taxonomy twice is a no-op the second time", () => {
    const asExisting = CORE_TAXONOMY.map((s) => existing(s.name, s.color, s.description));
    const second = planLabels(CORE_TAXONOMY, asExisting);
    assert.equal(second.counts.create, 0);
    assert.equal(second.counts.update, 0);
    assert.equal(second.counts.conflict, 0);
    assert.equal(second.counts.keep, CORE_TAXONOMY.length);
  });
});
