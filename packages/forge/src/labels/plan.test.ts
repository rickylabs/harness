import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isClean, planLabels } from "./plan.js";
import type { ExistingLabel } from "./github.js";
import { CORE_TAXONOMY, RETIRED_LABELS, type LabelSpec } from "./taxonomy.js";

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
    const second = planLabels(CORE_TAXONOMY, asExisting, { retired: RETIRED_LABELS });
    assert.equal(second.counts.create, 0);
    assert.equal(second.counts.update, 0);
    assert.equal(second.counts.conflict, 0);
    assert.equal(second.counts.retire, 0);
    assert.equal(second.counts.keep, CORE_TAXONOMY.length);
  });
});

describe("retiring a label", () => {
  const gone = (name: string, description = "Retired — use type:feat."): LabelSpec => ({
    ...spec(name, "aabbcc", description),
    supersededBy: "type:feat",
  });

  it("rewrites the description in place and never emits a delete", () => {
    const plan = planLabels([], [existing("type:old", "aabbcc", "The old wording")], {
      retired: [gone("type:old")],
    });
    assert.deepEqual(
      plan.actions.map((a) => a.kind),
      ["retire"],
    );
    // The label keeps its name, so every item carrying it keeps carrying it. That is the whole
    // difference between retiring and deleting, and it is the reason this action exists.
    assert.equal(plan.actions[0]?.spec.name, "type:old");
    assert.match(plan.actions[0]?.reason ?? "", /superseded by type:feat/);
  });

  it("does not create a label the repository never had", () => {
    // Installing this taxonomy into a fresh repository must not seed it with history it never had.
    const plan = planLabels([], [], { retired: [gone("type:old")] });
    assert.deepEqual(plan.actions, []);
    assert.equal(plan.counts.create, 0);
  });

  it("does not need --force to replace an authored description", () => {
    // Unlike `update`, the label's *meaning* is what changed; deferring to the old wording would
    // leave the picker recommending a label nothing should stamp again.
    const plan = planLabels([], [existing("type:old", "aabbcc", "Something a human wrote")], {
      retired: [gone("type:old")],
    });
    assert.equal(plan.counts.retire, 1);
    assert.equal(plan.counts.conflict, 0);
  });

  it("is idempotent once the repository carries the retirement notice", () => {
    const plan = planLabels([], [existing("type:old", "aabbcc", "Retired — use type:feat.")], {
      retired: [gone("type:old")],
    });
    assert.equal(plan.counts.retire, 0);
    assert.equal(plan.counts.keep, 1);
  });

  it("wins over the desired list when a label is somehow both", () => {
    // A taxonomy that lists a label it has also retired is a bug in the taxonomy. The conservative
    // reading is the safe one: the mistake stops the label being stamped rather than resurrects it.
    const plan = planLabels([spec("type:old", "aabbcc", "live wording")], [], {
      retired: [gone("type:old")],
    });
    assert.deepEqual(plan.actions, []);
  });

  it("counts an outstanding retirement as drift", () => {
    // The label picker is where people learn the taxonomy. One still advertising a retired label as
    // live keeps producing items the board then has to explain.
    const plan = planLabels([], [existing("type:old", "aabbcc", "The old wording")], {
      retired: [gone("type:old")],
    });
    assert.equal(isClean(plan), false);
  });

  it("leaves a retired label out of `unmanaged`, which would read as untouched", () => {
    const plan = planLabels([], [existing("type:old", "aabbcc", "The old wording")], {
      retired: [gone("type:old")],
    });
    assert.deepEqual(plan.unmanaged, []);
  });
});
