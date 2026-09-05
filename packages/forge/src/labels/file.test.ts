import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { familyOf, parseLabelsFile, renderLabelsFile } from "./file.js";
import { CORE_TAXONOMY, RETIRED_LABELS, areaLabel } from "./taxonomy.js";

describe("labels.yml round trip", () => {
  it("survives eject then parse without losing a label", () => {
    const specs = [...CORE_TAXONOMY, areaLabel("forge", "packages/forge")];
    const parsed = parseLabelsFile(renderLabelsFile(specs, "owner/repo"));

    assert.deepEqual(parsed.issues, []);
    assert.deepEqual(
      parsed.labels.map((l) => l.name),
      specs.map((s) => s.name),
    );
    assert.deepEqual(
      parsed.labels.map((l) => l.description),
      specs.map((s) => s.description),
    );
  });

  it("keeps the rules in the header, where a reviewer will read them", () => {
    const text = renderLabelsFile(CORE_TAXONOMY, "owner/repo");
    assert.match(text, /Exactly ONE `status:` label/);
    assert.match(text, /Never delete a label/);
    // The header promises retirement as the alternative to deleting. A promise the file format
    // cannot keep is worse than no promise: it sends the reader looking for a section that is not
    // there, and the label gets deleted anyway.
    assert.match(text, /superseded_by:/);
  });

  it("round-trips descriptions containing quotes and backslashes", () => {
    const specs = [
      { ...areaLabel("odd", 'a "quoted" path\\with\\slashes'), name: "area:odd" },
    ];
    const parsed = parseLabelsFile(renderLabelsFile(specs, "owner/repo"));
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.labels[0]?.description, 'a "quoted" path\\with\\slashes');
  });

  it("defaults a hand-written row that gives only a name", () => {
    const parsed = parseLabelsFile(["- name: wave:v1"].join("\n"));
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.labels[0]?.name, "wave:v1");
    assert.equal(parsed.labels[0]?.color, "ededed");
    assert.equal(parsed.labels[0]?.family, "wave");
  });

  it("reports a line it cannot read instead of silently dropping it", () => {
    const parsed = parseLabelsFile(["- name: ok", "  aliases: [a, b]", "!!! nonsense"].join("\n"));
    assert.equal(parsed.labels.length, 1);
    assert.equal(parsed.issues.length, 2);
    assert.match(parsed.issues[0]?.message ?? "", /aliases/);
    assert.match(parsed.issues[1]?.message ?? "", /unrecognized/);
  });

  it("tolerates a top-level `labels:` header and comments", () => {
    const parsed = parseLabelsFile(
      ["# a comment", "labels:", "  - name: type:feat", "    color: c5def5"].join("\n"),
    );
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.labels.length, 1);
    assert.equal(parsed.labels[0]?.color, "c5def5");
  });

  it("normalizes a color written with a leading #", () => {
    const parsed = parseLabelsFile(["- name: x", '  color: "#AABBCC"'].join("\n"));
    assert.equal(parsed.labels[0]?.color, "aabbcc");
  });

  it("records a color it cannot use instead of passing it through", () => {
    // Without this the string reaches a POST body: the apply fails partway, having already
    // created every label ahead of the bad row.
    for (const bad of ["not-a-color", '""', '"#fff"']) {
      const parsed = parseLabelsFile(["- name: x", `  color: ${bad}`].join("\n"));
      assert.deepEqual(parsed.labels, [], `${bad} produced a label`);
      assert.equal(parsed.issues.length, 1, `${bad} produced no issue`);
      assert.match(parsed.issues[0]?.message ?? "", /not six hex digits/);
    }
  });

  it("still defaults a missing color, which was never the broken case", () => {
    const parsed = parseLabelsFile(["- name: x"].join("\n"));
    assert.equal(parsed.labels[0]?.color, "ededed");
    assert.deepEqual(parsed.issues, []);
  });
});

describe("retired rows", () => {
  it("round-trips a retirement through eject and parse", () => {
    const retired = [{ ...RETIRED_LABELS[0]! }];
    const parsed = parseLabelsFile(renderLabelsFile(CORE_TAXONOMY, "owner/repo", retired));

    assert.deepEqual(parsed.issues, []);
    assert.deepEqual(
      parsed.retired.map((l) => l.name),
      retired.map((s) => s.name),
    );
    assert.equal(parsed.retired[0]?.supersededBy, retired[0]?.supersededBy);
  });

  it("keeps a retired row out of `labels`, which is the set the next apply installs", () => {
    // A retired row left in that list is a row the next apply puts back onto the repository as
    // live — the one outcome retiring exists to prevent.
    const text = renderLabelsFile(CORE_TAXONOMY, "owner/repo", [{ ...RETIRED_LABELS[0]! }]);
    const parsed = parseLabelsFile(text);
    const names = new Set(parsed.labels.map((l) => l.name));
    assert.ok(!names.has(RETIRED_LABELS[0]!.name));
    assert.equal(parsed.labels.length, CORE_TAXONOMY.length);
  });

  it("emits nothing at all when there is nothing retired", () => {
    // A heading over an empty list reads as a warning about a hazard this repository does not have.
    const text = renderLabelsFile(CORE_TAXONOMY, "owner/repo");
    assert.ok(!text.includes("── retired"));
  });

  it("treats an empty `superseded_by` as a half-finished edit, not a retirement", () => {
    // Reading it as one would silently stop stamping a label the author still wanted.
    const parsed = parseLabelsFile(["- name: type:old", '  superseded_by: ""'].join("\n"));
    assert.equal(parsed.retired.length, 0);
    assert.equal(parsed.labels.length, 1);
    assert.match(parsed.issues[0]?.message ?? "", /superseded_by/);
  });
});

describe("familyOf", () => {
  it("recovers the family from the name so a hand-edited file needs no extra field", () => {
    assert.equal(familyOf("type:feat", "lane"), "type");
    assert.equal(familyOf("status:impl", "lane"), "status");
    assert.equal(familyOf("wave:v1", "lane"), "wave");
    assert.equal(familyOf("breaking", "lane"), "flag");
  });

  it("resolves the lane family under whichever prefix the repo uses", () => {
    assert.equal(familyOf("topic:docs", "topic"), "lane");
    assert.equal(familyOf("topic:docs", "orchestrator"), "flag");
    assert.equal(familyOf("orchestrator:w0", "orchestrator"), "lane");
  });
});
