import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { familyOf, parseLabelsFile, renderLabelsFile } from "./file.js";
import { CORE_TAXONOMY, areaLabel } from "./taxonomy.js";

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
