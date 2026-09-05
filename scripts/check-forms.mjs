#!/usr/bin/env node
/**
 * The GitHub issue forms, checked against the two things that can silently break them.
 *
 * **A form that does not parse does not exist.** GitHub renders the "blank issue" path instead and
 * says nothing — no error, no annotation, no red anywhere. `task.yml` shipped with an unquoted colon
 * in a `description:` for exactly one commit before this check was written, and the only way to find
 * out would have been for someone to open the new-issue page and notice a form missing that they had
 * never seen present.
 *
 * **A field with `render:` truncates a dispatched brief.** A rendered textarea wraps the submitted
 * value in a fenced code block, and in this repository an issue body is a prompt: the dispatcher
 * stops reading at the first fence and runs what it got, without reporting that it stopped. So no
 * field here may carry `render:` — not as a style preference, as a correctness rule. `AGENTS.md`
 * owns the full statement of that hazard; this is the mechanical half of it.
 *
 * It also checks the labels the forms apply against `.github/labels.yml` rather than against the
 * live repository. Two reasons: the file is the reviewed source of truth, and it is readable with no
 * network, so this runs in the same CI job as everything else instead of needing a token. A form
 * that applies a label the taxonomy does not declare files issues nobody's board query can see; one
 * that applies a *retired* label puts a label back into circulation that was retired on purpose.
 *
 * Exit codes: 0 every form is valid, 1 at least one is not, 2 the check could not run.
 */

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".github", "ISSUE_TEMPLATE");

const require = createRequire(import.meta.url);
let yaml;
try {
  yaml = require("js-yaml");
} catch (error) {
  console.error(`check:forms — js-yaml is not installed: ${error.message}`);
  console.error("  run `pnpm install` first.");
  process.exit(2);
}

const KINDS = new Set(["markdown", "input", "textarea", "dropdown", "checkboxes"]);

const problems = [];
const note = (where, message) => problems.push(`${where}: ${message}`);

// ── the taxonomy, read from the file rather than from GitHub ─────────────────

const taxonomy = new Map();
try {
  const rows = yaml.load(readFileSync(join(ROOT, ".github", "labels.yml"), "utf8"));
  if (!Array.isArray(rows)) throw new Error("expected a sequence of label rows");
  for (const row of rows) {
    if (typeof row?.name === "string") taxonomy.set(row.name, row.superseded_by ?? null);
  }
} catch (error) {
  console.error(`check:forms — could not read .github/labels.yml: ${error.message}`);
  process.exit(2);
}
if (taxonomy.size === 0) {
  console.error("check:forms — .github/labels.yml declared no labels. That is a broken check.");
  process.exit(2);
}

// ── the forms ────────────────────────────────────────────────────────────────

let entries;
try {
  entries = readdirSync(DIR).sort();
} catch (error) {
  console.error(`check:forms — no ${DIR}: ${error.message}`);
  process.exit(2);
}

const forms = entries.filter((f) => /\.ya?ml$/.test(f) && f !== "config.yml");
if (forms.length === 0) {
  console.error("check:forms — no issue forms found. That is a broken check, not a clean one.");
  process.exit(2);
}

for (const file of forms) {
  const where = `.github/ISSUE_TEMPLATE/${file}`;
  let form;
  try {
    form = yaml.load(readFileSync(join(DIR, file), "utf8"));
  } catch (error) {
    // The message carries the line and column, which is the only part worth reading.
    note(where, `does not parse, so GitHub will not show it — ${error.message}`);
    continue;
  }

  if (typeof form?.name !== "string") note(where, "no `name`");
  if (typeof form?.description !== "string") note(where, "no `description`");
  if (!Array.isArray(form?.body) || form.body.length === 0) note(where, "no `body`");

  if (!Array.isArray(form?.labels) || form.labels.length === 0) {
    // Frontmatter is the only way a form can apply a label — a dropdown answer cannot. A form with
    // none files items with no status, which no board column shows.
    note(where, "applies no labels, so items filed through it land on no board column");
  } else {
    for (const label of form.labels) {
      if (!taxonomy.has(label)) {
        note(where, `applies \`${label}\`, which .github/labels.yml does not declare`);
      } else if (taxonomy.get(label) !== null) {
        note(where, `applies \`${label}\`, which is retired in favour of \`${taxonomy.get(label)}\``);
      }
    }
  }

  const ids = new Set();
  for (const [i, field] of (form?.body ?? []).entries()) {
    const at = `${where} body[${i}]`;

    if (!KINDS.has(field?.type)) note(at, `unknown field type \`${field?.type}\``);

    if (field?.type !== "markdown") {
      if (typeof field?.id !== "string") note(at, "no `id`");
      else if (ids.has(field.id)) note(at, `duplicate id \`${field.id}\``);
      else ids.add(field.id);
      if (typeof field?.attributes?.label !== "string") note(at, "no `label`");
    }

    if (field?.attributes && "render" in field.attributes) {
      note(at, "carries `render:` — a rendered field emits a fence, which truncates a dispatch");
    }

    if (field?.type === "dropdown") {
      const options = field.attributes?.options;
      if (!Array.isArray(options) || options.length < 2) note(at, "dropdown with fewer than 2 options");
      else for (const o of options) if (typeof o !== "string") note(at, `non-string option ${JSON.stringify(o)}`);
    }

    if (field?.type === "checkboxes") {
      const options = field.attributes?.options;
      if (!Array.isArray(options) || options.length === 0) note(at, "checkboxes with no options");
      else for (const o of options) if (typeof o?.label !== "string") note(at, "a checkbox with no label");
    }
  }
}

// ── config.yml ───────────────────────────────────────────────────────────────

if (entries.includes("config.yml")) {
  const where = ".github/ISSUE_TEMPLATE/config.yml";
  let config;
  try {
    config = yaml.load(readFileSync(join(DIR, "config.yml"), "utf8"));
  } catch (error) {
    note(where, `does not parse — ${error.message}`);
    config = null;
  }
  if (config !== null) {
    if (typeof config?.blank_issues_enabled !== "boolean") {
      note(where, "`blank_issues_enabled` must be true or false");
    }
    for (const [i, link] of (config?.contact_links ?? []).entries()) {
      const at = `${where} contact_links[${i}]`;
      if (typeof link?.name !== "string") note(at, "no `name`");
      if (typeof link?.about !== "string") note(at, "no `about`");
      // Relative URLs are accepted by the schema and simply do not resolve for a reader who
      // arrived from anywhere but the repository root.
      if (typeof link?.url !== "string" || !link.url.startsWith("https://")) {
        note(at, "`url` must be an absolute https URL");
      }
    }
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────

for (const p of problems) console.error(p);

const summary = `check:forms — ${forms.length} issue form(s) valid against ${taxonomy.size} declared label(s)`;

if (problems.length > 0) {
  console.error(`\ncheck:forms — ${problems.length} problem(s)`);
  process.exit(1);
}

console.log(summary);
