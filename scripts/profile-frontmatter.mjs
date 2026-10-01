/** Strict, data-only metadata for the repo Markdown that Orchid pins at launch. */
import yaml from "js-yaml";
import { basename } from "node:path";
import routing from "../packages/routing/config/routing.fleet.v2.json" with { type: "json" };

const FIELDS = new Set(["name", "title", "role", "defaultTier", "description", "skills", "permissions", "guardrails"]);
// Process names stay stable; routing vocabulary and available cells come from replaceable data.
const REQUIRED = ["planner", "plan-evaluator", "leaf", "implementation-evaluator", "researcher",
  "docs", "ui-ux", "vision-evaluator", "rfc", "milestone-coordinator"];
const text = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit &&
  value === value.trim() && !/[\p{Cc}\u2028\u2029]/u.test(value);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Return field-specific codes without ever echoing potentially private metadata values. */
export function validateProfileMarkdown(path, markdown, configuration = routing) {
  const ROLES = new Set([...Object.keys(configuration.roles), "coordinator"]);
  const SCOPES = new Set(Object.keys(configuration.coordinators));
  const WORKLOAD_TIERS = new Set(configuration.tiers.map(tier => tier.tier));
  const problems = [];
  const fail = (field, code) => problems.push({ field, code });
  if (typeof markdown !== "string" || markdown.length > 256_000) {
    fail("frontmatter", "document_invalid");
    return { value: null, problems };
  }
  const lines = markdown.split(/\r?\n/);
  const close = lines.indexOf("---", 1);
  if (lines[0] !== "---" || close < 2 || close > 80 || lines.slice(1, close).join("\n").length > 8192) {
    fail("frontmatter", "boundary_invalid");
    return { value: null, problems };
  }
  let data;
  try { data = yaml.load(lines.slice(1, close).join("\n"), { schema: yaml.JSON_SCHEMA }); }
  catch { fail("frontmatter", "yaml_invalid"); return { value: null, problems }; }
  if (!record(data)) {
    fail("frontmatter", "object_required");
    return { value: null, problems };
  }
  for (const field of Object.keys(data)) if (!FIELDS.has(field)) fail(field, "unknown_field");
  const name = data.name;
  if (!text(name, 64) || !/^[a-z][a-z0-9-]*$/.test(name)) fail("name", "invalid");
  else if (name !== basename(path, ".md")) fail("name", "filename_mismatch");
  for (const [field, limit] of [["title", 80], ["description", 240]]) {
    if (!text(data[field], limit)) fail(field, "invalid");
  }
  const role = data.role;
  if (typeof role !== "string" || !ROLES.has(role)) fail("role", "unknown_role");
  if (Object.hasOwn(data, "defaultTier") &&
      (role === "coordinator" || typeof data.defaultTier !== "string" || !WORKLOAD_TIERS.has(data.defaultTier))) {
    fail("defaultTier", "unknown_tier");
  } else if (Object.hasOwn(data, "defaultTier") && ROLES.has(role)) {
    const cell = configuration.tiers.find(tier => tier.tier === data.defaultTier)?.cells?.[role];
    if (!Array.isArray(cell) || cell.length === 0) fail("defaultTier", "no_route");
  }
  for (const field of ["skills", "permissions", "guardrails"]) {
    const values = data[field];
    if (!Array.isArray(values) || values.length < 1 || values.length > 16) {
      fail(field, "list_required");
      continue;
    }
    const seen = new Set();
    values.forEach((value, index) => {
      if (!text(value, 200)) fail(`${field}[${index}]`, "invalid");
      else if (seen.has(value)) fail(`${field}[${index}]`, "duplicate");
      else seen.add(value);
    });
  }
  // Preserve Orchid's current Markdown routing-row grammar; frontmatter may describe it,
  // never override it. The first declared role is the profile's primary route.
  const rows = lines.slice(close + 1).filter(line => /^\|\s*`routing`\s*\|/.test(line));
  if (rows.length !== 1) fail("routing", "row_count");
  else {
    const tokens = [...rows[0].matchAll(/`([^`]+)`/g)].map(match => match[1].replaceAll("-", "_"));
    const roles = tokens.filter(token => ROLES.has(token) && token !== "coordinator");
    const scopes = tokens.filter(token => SCOPES.has(token));
    if (role === "coordinator") {
      if (roles.length !== 0 || scopes.length !== 1 || !/coordinator matrix/.test(rows[0])) fail("role", "routing_mismatch");
      else if (!Array.isArray(configuration.coordinators[scopes[0]]) || configuration.coordinators[scopes[0]].length === 0) {
        fail("routing", "no_route");
      }
    } else if (ROLES.has(role) && (roles.length === 0 || roles[0] !== role || scopes.length !== 0)) {
      fail("role", "routing_mismatch");
    }
  }
  return { value: problems.length === 0 ? data : null, problems };
}

/** Validate the dispatch inventory separately so aliases cannot hide missing canonical profiles. */
export function validateProfileCollection(documents, configuration = routing) {
  const problems = [];
  const files = new Set(documents.map(document => document.path));
  for (const name of REQUIRED) {
    const path = `${name}.md`;
    if (!files.has(path)) problems.push({ path, field: "profile", code: "required_missing" });
  }
  const covered = new Set();
  for (const { path, markdown } of documents) {
    const result = validateProfileMarkdown(path, markdown, configuration);
    for (const problem of result.problems) problems.push({ path, ...problem });
    if (result.value) covered.add(result.value.role);
  }
  Object.keys(configuration.roles).forEach((role, index) => {
    if (!covered.has(role)) problems.push({ path: "profiles", field: `roles[${index}]`, code: "coverage_missing" });
  });
  return problems;
}
