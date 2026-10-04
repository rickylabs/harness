import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { validateProfileMarkdown, validateProfileCollection } from "./profile-frontmatter.mjs";
import routing from "../packages/routing/config/routing.fleet.v2.json" with { type: "json" };

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

const primaryRoles = {
  planner: "plan", "plan-evaluator": "plan_evaluation", leaf: "implementation",
  "implementation-evaluator": "implementation_evaluation", researcher: "deep_research",
  docs: "documentation", "ui-ux": "ui_ux", "vision-evaluator": "vision_evaluation",
};
const profileDirectory = new URL("../profiles/", import.meta.url);
const documents = () => readdirSync(profileDirectory).filter(name => name.endsWith(".md") && name !== "README.md")
  .map(path => ({ path, markdown: readFileSync(new URL(path, profileDirectory), "utf8") }));

test("every matrix role has its canonical model-free profile and a populated default", () => {
  assert.deepEqual(Object.values(primaryRoles).sort(), Object.keys(routing.roles).sort());
  assert.deepEqual(validateProfileCollection(documents()), []);
  for (const name of [...Object.keys(primaryRoles), "rfc", "milestone-coordinator"]) {
    const source = readFileSync(new URL(`../profiles/${name}.md`, import.meta.url), "utf8");
    const result = validateProfileMarkdown(`${name}.md`, source);
    assert.deepEqual(result.problems, [], `${name}: ${JSON.stringify(result.problems)}`);
    assert.equal(result.value.name, name);
    if (Object.hasOwn(primaryRoles, name) || name === "rfc") {
      assert.equal(result.value.role, primaryRoles[name] ?? "deep_research");
      assert.equal(result.value.defaultTier, "feature");
    } else assert.equal(Object.hasOwn(result.value, "defaultTier"), false);
    if (name === "leaf") assert.equal(result.value.title, "Single agent: one change, one PR");
    for (const forbidden of ["model", "effort", "transport", "fallback", "budget"]) {
      assert.equal(Object.hasOwn(result.value, forbidden), false);
    }
  }
});

test("the rfc alias preserves its route and points to the canonical research process", () => {
  const alias = readFileSync(new URL("rfc.md", profileDirectory), "utf8");
  assert.match(alias, /\[researcher\]\(researcher\.md\)/);
  assert.equal(validateProfileMarkdown("rfc.md", alias).value.role, "deep_research");
  const missing = validateProfileCollection(documents().filter(document => document.path !== "researcher.md"));
  assert.ok(missing.some(problem => problem.path === "researcher.md" && problem.code === "required_missing"));
});

test("configured worker roles cannot silently lack a profile", () => {
  const replacement = structuredClone(routing);
  replacement.roles.fresh_worker = {};
  const problems = validateProfileCollection(documents(), replacement);
  assert.ok(problems.some(problem => problem.code === "coverage_missing"));
  const withoutPlanner = validateProfileCollection(documents().filter(document => document.path !== "planner.md"));
  assert.ok(withoutPlanner.some(problem => problem.path === "planner.md" && problem.code === "required_missing"));
  assert.ok(withoutPlanner.some(problem => problem.code === "coverage_missing"));
});

test("worker defaults and coordinator scopes require populated configuration routes", () => {
  const source = valid.replace("role: implementation", "role: implementation\ndefaultTier: feature");
  const replacement = structuredClone(routing);
  replacement.tiers.find(tier => tier.tier === "feature").cells.implementation = [];
  assert.ok(validateProfileMarkdown("fixture.md", source, replacement).problems
    .some(problem => problem.field === "defaultTier" && problem.code === "no_route"));
  const coordinator = valid.replace("role: implementation", "role: coordinator")
    .replace("matrix `implementation` row; evaluator `implementation_evaluation`", "coordinator matrix at `milestone` scope");
  replacement.coordinators.milestone = [];
  assert.ok(validateProfileMarkdown("fixture.md", coordinator, replacement).problems
    .some(problem => problem.field === "routing" && problem.code === "no_route"));
  delete replacement.coordinators.milestone;
  assert.ok(validateProfileMarkdown("fixture.md", coordinator, replacement).problems
    .some(problem => problem.code === "routing_mismatch"));
  assert.deepEqual(validateProfileMarkdown("fixture.md", coordinator).problems, []);
});

test("whole-document replacement supplies disjoint roles, tiers and coordinator scopes", () => {
  const replacement = { roles: { fresh_worker: {} },
    tiers: [{ tier: "fresh_tier", cells: { fresh_worker: [{}] } }],
    coordinators: { fresh_scope: [{}] } };
  const worker = valid.replaceAll("implementation_evaluation", "other_review")
    .replaceAll("implementation", "fresh_worker")
    .replace("role: fresh_worker", "role: fresh_worker\ndefaultTier: fresh_tier");
  assert.deepEqual(validateProfileMarkdown("fixture.md", worker, replacement).problems, []);
  assert.ok(validateProfileMarkdown("fixture.md", worker).problems.some(problem => problem.code === "unknown_role"));
  const coordinator = valid.replace("role: implementation", "role: coordinator")
    .replace("matrix `implementation` row; evaluator `implementation_evaluation`", "coordinator matrix at `fresh_scope` scope");
  assert.deepEqual(validateProfileMarkdown("fixture.md", coordinator, replacement).problems, []);
});

test("default tier is a known workload tier only on worker profiles", () => {
  const withTier = valid.replace("role: implementation", "role: implementation\ndefaultTier: feature");
  assert.deepEqual(codes(withTier), []);
  assert.ok(codes(withTier.replace("defaultTier: feature", "defaultTier: invented"))
    .includes("defaultTier:unknown_tier"));
  assert.ok(codes(withTier.replace("defaultTier: feature", "defaultTier: null"))
    .includes("defaultTier:unknown_tier"));
  const coordinator = withTier.replace("role: implementation", "role: coordinator")
    .replace("matrix \`implementation\` row; evaluator \`implementation_evaluation\`",
      "coordinator matrix at \`milestone\` scope");
  assert.ok(codes(coordinator).includes("defaultTier:unknown_tier"));
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

test("the fix profile is a required single-change bug-fix process on the implementation route", () => {
  const missing = validateProfileCollection(documents().filter(document => document.path !== "fix.md"));
  assert.ok(missing.some(problem => problem.path === "fix.md" && problem.code === "required_missing"));
  const source = readFileSync(new URL("fix.md", profileDirectory), "utf8");
  const result = validateProfileMarkdown("fix.md", source);
  assert.deepEqual(result.problems, []);
  assert.equal(result.value.name, "fix");
  assert.equal(result.value.title, "Fix: one bug, one PR");
  assert.equal(result.value.role, "implementation");
  assert.equal(result.value.defaultTier, "straightforward");
  for (const forbidden of ["model", "effort", "transport", "fallback", "budget"]) {
    assert.equal(Object.hasOwn(result.value, forbidden), false);
  }
  assert.match(source, /`fix\(<scope>\): <summary>`/);
  assert.match(source, /fails before the fix/);
});
