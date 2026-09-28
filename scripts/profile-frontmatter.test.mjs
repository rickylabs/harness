import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateProfileMarkdown } from "./profile-frontmatter.mjs";

const valid = `---
name: fixture
title: Fixture teammate
role: implementation
description: Delivers a scoped change.
skills:
  - use harness
permissions:
  - Read assigned repository files.
guardrails:
  - Never self-certify.
---
# Profile: fixture
| Field | Value |
| --- | --- |
| \`routing\` | matrix \`implementation\` row; evaluator \`implementation_evaluation\` |
`;
const codes = source => validateProfileMarkdown("fixture.md", source).problems.map(x => `${x.field}:${x.code}`);

test("the three real profiles have a validated, model-free manifest", () => {
  for (const name of ["leaf", "rfc", "milestone-coordinator"]) {
    const source = readFileSync(new URL(`../profiles/${name}.md`, import.meta.url), "utf8");
    const result = validateProfileMarkdown(`${name}.md`, source);
    assert.deepEqual(result.problems, [], `${name}: ${JSON.stringify(result.problems)}`);
    assert.equal(result.value.name, name);
    for (const forbidden of ["model", "effort", "transport", "fallback", "budget"]) {
      assert.equal(Object.hasOwn(result.value, forbidden), false);
    }
  }
});

test("fields are reported separately and rejected without echoing their values", () => {
  const source = valid.replace("title: Fixture teammate", "title: ''")
    .replace("description: Delivers a scoped change.", "description: ''")
    .replace("  - Read assigned repository files.", "  - ''")
    .replace("role: implementation", "role: invented_role");
  const result = validateProfileMarkdown("fixture.md", source);
  assert.deepEqual(result.problems.map(x => x.field).sort(),
    ["description", "permissions[0]", "role", "title"]);
  assert.equal(result.value, null);
  assert.equal(JSON.stringify(result.problems).includes("invented_role"), false);
});

test("metadata cannot smuggle a model or replace the pinned routing row", () => {
  assert.ok(codes(valid.replace("role: implementation", "role: plan")).includes("role:routing_mismatch"));
  assert.ok(codes(valid.replace("title: Fixture teammate", "model: gpt-fixture\ntitle: Fixture teammate"))
    .includes("model:unknown_field"));
  assert.ok(codes(valid.replace("| \`routing\`", "| \`other\`")).includes("routing:row_count"));
  assert.ok(codes(valid.replace("| \`routing\`", "| \`routing\`").replace("# Profile: fixture",
    "| \`routing\` | matrix \`implementation\` row |\n# Profile: fixture")).includes("routing:row_count"));
});

test("malformed YAML, duplicate fields and filename mismatch are rejected", () => {
  assert.ok(codes(valid.replace("title: Fixture teammate", "title: [unclosed")).includes("frontmatter:yaml_invalid"));
  assert.ok(codes(valid.replace("title: Fixture teammate", "title: One\ntitle: Two")).includes("frontmatter:yaml_invalid"));
  assert.ok(codes(valid.replace("name: fixture", "name: other")).includes("name:filename_mismatch"));
  assert.ok(codes(valid.replace("  - Never self-certify.", "  - Never self-certify.\n  - Never self-certify."))
    .includes("guardrails[1]:duplicate"));
});

test("coordinator scope must match its dedicated routing row", () => {
  const coordinator = valid.replace("role: implementation", "role: coordinator")
    .replace("matrix \`implementation\` row; evaluator \`implementation_evaluation\`",
      "coordinator matrix at \`milestone\` scope");
  assert.deepEqual(codes(coordinator), []);
  assert.ok(codes(coordinator.replace("\`milestone\`", "\`project\` and \`framework\`"))
    .includes("role:routing_mismatch"));
  assert.ok(codes(coordinator.replace("coordinator matrix", "matrix"))
    .includes("role:routing_mismatch"));
});
