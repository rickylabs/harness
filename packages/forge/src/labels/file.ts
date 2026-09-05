/**
 * `.github/labels.yml` — the machine-readable mirror, in both directions.
 *
 * The file is the source of truth once it exists: `eject` writes it, a human edits it, `apply`
 * reads it back. That round trip is the whole point — a taxonomy you can only change by editing
 * TypeScript is not a taxonomy the people using the board can own.
 *
 * The parser handles the subset this tool emits (a flat list of `name`/`color`/`description`) plus
 * the two shapes GitHub label actions conventionally use. It is not a YAML implementation, and it
 * says so by failing loudly on anything it does not recognise rather than guessing.
 */

import { readFile } from "node:fs/promises";

import type { LabelFamily, LabelSpec } from "./taxonomy.js";
import { isValidColor, normalizeColor } from "./taxonomy.js";

export const LABELS_FILE = ".github/labels.yml";

/** Recover the family from the label's own name, so a hand-edited file needs no extra field. */
export function familyOf(name: string, lanePrefix: string): LabelFamily {
  const prefix = name.includes(":") ? name.slice(0, name.indexOf(":")) : "";
  if (prefix === lanePrefix) return "lane";
  switch (prefix) {
    case "type":
    case "status":
    case "priority":
    case "eval":
    case "gate":
    case "ci":
    case "area":
    case "epic":
    case "wave":
      return prefix;
    default:
      return "flag";
  }
}

const unquote = (raw: string): string => {
  const value = raw.trim();
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
    const quote = value[0] as string;
    if (value.endsWith(quote)) {
      const inner = value.slice(1, -1);
      return quote === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
    }
  }
  return value;
};

export interface ParseIssue {
  readonly line: number;
  readonly message: string;
}

export interface ParsedLabelsFile {
  readonly labels: readonly LabelSpec[];
  /**
   * Rows carrying `superseded_by` — labels the file keeps a record of but no longer stamps.
   *
   * Separated at the parse rather than filtered later, because every caller of `labels` treats
   * what it gets as the set to install. A retired row left in that list is a row the next `apply`
   * puts back onto the repository as live, which is the one outcome retiring exists to prevent.
   */
  readonly retired: readonly LabelSpec[];
  /** Rows the parser could not use. Non-empty means the caller should refuse to apply. */
  readonly issues: readonly ParseIssue[];
}

/**
 * Parse the emitted subset. Every label needs a name; color and description default rather than
 * fail, because a human adding one row by hand should not have to look up a hex code.
 */
export function parseLabelsFile(text: string, lanePrefix = "lane"): ParsedLabelsFile {
  const labels: LabelSpec[] = [];
  const retired: LabelSpec[] = [];
  const issues: ParseIssue[] = [];

  let current: {
    name?: string;
    color?: string;
    description?: string;
    supersededBy?: string;
    line: number;
  } | null = null;

  const flush = () => {
    if (!current) return;
    const color = current.color ?? "ededed";
    if (current.name === undefined || current.name.length === 0) {
      issues.push({ line: current.line, message: "label entry has no `name`" });
    } else if (!isValidColor(color)) {
      // Recorded rather than defaulted. A silently corrected color is a file that disagrees with
      // the repository it claims to describe, and the human who typed it never finds out.
      issues.push({
        line: current.line,
        message: `${current.name}: color ${JSON.stringify(color)} is not six hex digits`,
      });
    } else {
      const base = {
        name: current.name,
        color: normalizeColor(color),
        description: current.description ?? "",
        family: familyOf(current.name, lanePrefix),
        origin: "core",
      } as const;
      // `exactOptionalPropertyTypes` is on, so the key is added or it is not — never set to
      // `undefined`, which would make `isRetired` true for a label nobody retired.
      if (current.supersededBy === undefined) labels.push(base);
      else retired.push({ ...base, supersededBy: current.supersededBy });
    }
    current = null;
  };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = raw.replace(/\r$/, "");
    const lineNo = i + 1;

    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) {
      flush();
      current = { line: lineNo };
      const rest = item[1] ?? "";
      const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(rest);
      if (!pair) {
        issues.push({ line: lineNo, message: `list item is not a \`key: value\` pair: ${rest.trim()}` });
        continue;
      }
      assign(current, pair[1] as string, pair[2] as string, lineNo, issues);
      continue;
    }

    const pair = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (pair && current) {
      assign(current, pair[1] as string, pair[2] as string, lineNo, issues);
      continue;
    }

    // A top-level `labels:` header is tolerated; anything else is a shape we do not understand,
    // and guessing at it is how a parser silently drops half a taxonomy.
    if (/^[A-Za-z_][\w-]*\s*:\s*$/.test(line)) {
      flush();
      continue;
    }
    issues.push({ line: lineNo, message: `unrecognized line: ${line.trim()}` });
  }
  flush();

  return { labels, retired, issues };
}

function assign(
  target: { name?: string; color?: string; description?: string; supersededBy?: string },
  key: string,
  value: string,
  line: number,
  issues: ParseIssue[],
): void {
  const parsed = unquote(value);
  switch (key) {
    case "name":
      target.name = parsed;
      return;
    case "color":
      target.color = parsed;
      return;
    case "description":
      target.description = parsed;
      return;
    case "superseded_by":
      // The retirement marker. An empty value is not a retirement — it is a half-finished edit,
      // and reading it as one would silently stop stamping a label the author still wanted.
      if (parsed.length === 0) {
        issues.push({ line, message: "`superseded_by` is empty — name the label that replaces it" });
        return;
      }
      target.supersededBy = parsed;
      return;
    default:
      // Extra keys used by other label tools (`aliases`, `from_name`) are not ours to interpret.
      issues.push({ line, message: `ignoring unsupported key \`${key}\`` });
  }
}

/** Read the file if the repository has one. A missing file is not an error — it is the first run. */
export async function loadLabelsFile(
  path: string,
  lanePrefix = "lane",
): Promise<ParsedLabelsFile | null> {
  try {
    return parseLabelsFile(await readFile(path, "utf8"), lanePrefix);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const yamlString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Emit the file. The rules go in the header because this is the artifact a reviewer sees in a PR,
 * and a rule that lives only in a skill file is a rule the person editing the taxonomy never reads.
 */
export function renderLabelsFile(
  specs: readonly LabelSpec[],
  repo: string,
  retired: readonly LabelSpec[] = [],
): string {
  const header = [
    `# Label taxonomy for ${repo} — the machine-readable source of truth.`,
    "#",
    "# Generated by `dsh-forge labels eject`. Edit this file, then run `dsh-forge labels apply`.",
    "#",
    "# RULES:",
    "# - Exactly ONE `status:` label on an open issue or PR at a time; it is the board column.",
    "# - On a completed close, replace the phase label with `status:shipped`. On a not-planned",
    "#   close, remove the `status:` label entirely — it did not ship.",
    "# - `type:`, `area:` and `priority:` are additive.",
    "# - Never delete a label: deleting strips it off every issue that carried it, so an item that",
    "#   recorded a decision stops saying so. Retire it instead — move the row to the retired",
    "#   section below and give it `superseded_by:`. It stays on the repository and on its items,",
    "#   and stops being stamped on new work.",
    "",
  ];

  const rowsFor = (row: LabelSpec): readonly string[] => [
    `- name: ${yamlString(row.name)}`,
    `  color: ${yamlString(row.color)}`,
    `  description: ${yamlString(row.description)}`,
    ...(row.supersededBy === undefined ? [] : [`  superseded_by: ${yamlString(row.supersededBy)}`]),
  ];

  const body: string[] = [];
  for (const family of [...new Set(specs.map((s) => s.family))]) {
    const rows = specs.filter((s) => s.family === family);
    if (rows.length === 0) continue;
    const derived = rows.every((r) => r.origin === "detected");
    body.push(`# ── ${family}: ${derived ? "derived from this repository" : "portable core"} ──`);
    for (const row of rows) body.push(...rowsFor(row));
    body.push("");
  }

  // Last, and in one block regardless of family: these are not part of any live family any more,
  // and interleaving them with the labels still in use is how someone copies one by mistake.
  if (retired.length > 0) {
    body.push("# ── retired: kept so the items that carry these still say what happened ──");
    body.push("# Not stamped on new work. Never delete a row here — deleting the label takes the");
    body.push("# record with it. `dsh-forge labels apply` only rewrites the description.");
    for (const row of retired) body.push(...rowsFor(row));
    body.push("");
  }

  return `${[...header, ...body].join("\n").trimEnd()}\n`;
}
