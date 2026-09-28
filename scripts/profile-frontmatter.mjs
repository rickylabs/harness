/** Strict, data-only metadata for the repo Markdown that Orchid pins at launch. */
import yaml from "js-yaml";
import { basename } from "node:path";

const FIELDS = new Set(["name", "title", "role", "description", "skills", "permissions", "guardrails"]);
// Mirrored from the pinned NetScript delegation matrix; Orchid still checks the live matrix cell.
const ROLES = new Set(["implementation", "ui_ux", "plan", "plan_evaluation",
  "implementation_evaluation", "vision_evaluation", "documentation", "deep_research", "coordinator"]);
const SCOPES = new Set(["small_project", "project", "framework", "milestone"]);
const text = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit &&
  value === value.trim() && !/[\p{Cc}\u2028\u2029]/u.test(value);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Return field-specific codes without ever echoing potentially private metadata values. */
export function validateProfileMarkdown(path, markdown) {
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
    } else if (ROLES.has(role) && (roles.length === 0 || roles[0] !== role || scopes.length !== 0)) {
      fail("role", "routing_mismatch");
    }
  }
  return { value: problems.length === 0 ? data : null, problems };
}
