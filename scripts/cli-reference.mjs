#!/usr/bin/env node
/**
 * Render `docs/reference/cli/` from the binaries themselves.
 *
 * A hand-written CLI reference is wrong within one milestone, and wrong quietly: nothing goes red
 * when a flag is added, so the page keeps being served to whoever reads it. This repository already
 * refuses that for `cordis.patch.yml`, `SKILL.md` and `.github/labels.yml` — the same treatment,
 * applied to prose.
 *
 * Two inputs, both from the code:
 *
 *   - the `--help` text, captured by **running the built binary**, so the page cannot claim a
 *     synopsis the binary does not print;
 *   - `EXIT` and `EXIT_MEANINGS`, imported from the same module, so the exit table is the map the
 *     command actually returns from. Retyping the codes into this script would be the same drift
 *     with an extra step.
 *
 * `--write` regenerates. With no flag it compares, byte for byte, and exits 1 on a difference —
 * which is what runs in CI, at the end of `pnpm run build`. There is deliberately no new workflow:
 * a second place to declare the check is a second place to forget it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPERIMENT = process.argv.includes("--experiment-dsh");
const OUT_DIR = join(ROOT, EXPERIMENT ? "experiments/routers/dsh/docs/reference/cli" : "docs/reference/cli");
const REGENERATE = EXPERIMENT ? "docs:cli:dsh" : "docs:cli";
const CHECK = EXPERIMENT ? "check:docs:dsh" : "check:docs";

/** Core commands are checked by default; experimental binaries are explicitly opt-in. */
const CORE_CLIS = [
  { bin: "harness-forge", pkg: "forge" },
  { bin: "harness-board", pkg: "board" },
  { bin: "harness-coordinator", pkg: "coordinator" },
  { bin: "harness-telemetry", pkg: "telemetry" },
  { bin: "harness-method", pkg: "method" },
  { bin: "dsh-forge", pkg: "forge", aliasOf: "harness-forge" },
  { bin: "dsh-board", pkg: "board", aliasOf: "harness-board" },
  { bin: "dsh-coordinator", pkg: "coordinator", aliasOf: "harness-coordinator" },
  { bin: "dsh-telemetry", pkg: "telemetry", aliasOf: "harness-telemetry" },
];

/** Paths from a page in `docs/reference/cli/` back to the repository root. */
const CLIS = EXPERIMENT ? [
  { bin: "harness-dsh-profile", dir: "experiments/routers/dsh" },
  { bin: "dsh-profile", dir: "experiments/routers/dsh", aliasOf: "harness-dsh-profile" },
] : CORE_CLIS.map(cli => ({ ...cli, dir: `packages/${cli.pkg}` }));
const up = (path) => relative(OUT_DIR, join(ROOT, path)).replaceAll("\\", "/");

/**
 * Every `bin` the workspace declares must appear in `CLIS`.
 *
 * Without this, the failure mode is a new binary shipping with no page and nothing going red —
 * the exact drift this whole script exists to prevent, just one level up. The list above is
 * hand-ordered on purpose (a newcomer's order, not alphabetical), so it cannot be derived; it can
 * only be checked.
 */
function assertEveryBinIsCovered() {
  const declared = new Map();
  const directories = EXPERIMENT ? ["experiments/routers/dsh"] : readdirSync(join(ROOT, "packages")).map(dir => `packages/${dir}`);
  for (const dir of directories) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    for (const [bin, entry] of Object.entries(manifest.bin ?? {})) declared.set(bin, { dir, entry });
  }

  const covered = new Set(CLIS.map((cli) => cli.bin));
  const missing = [...declared.keys()].filter((bin) => !covered.has(bin)).sort();
  const phantom = CLIS.filter((cli) => declared.get(cli.bin)?.dir !== cli.dir);
  const splitAliases = CLIS.filter((cli) => cli.aliasOf !== undefined &&
    (declared.get(cli.bin)?.dir !== declared.get(cli.aliasOf)?.dir ||
      declared.get(cli.bin)?.entry !== declared.get(cli.aliasOf)?.entry));
  if (splitAliases.length > 0) {
    throw new Error(`compatibility aliases must share the canonical entrypoint: ${splitAliases.map(cli => cli.bin).join(", ")}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `these binaries have no reference page: ${missing.join(", ")}\n` +
        "Add them to CLIS in scripts/cli-reference.mjs.",
    );
  }
  if (phantom.length > 0) {
    throw new Error(
      `CLIS names binaries the workspace does not ship from that package: ${phantom
        .map((cli) => `${cli.bin} (${cli.dir})`)
        .join(", ")}`,
    );
  }
}

/** The bin's entry file, relative to its package, read from the manifest that declares it. */
function entryOf(cli) {
  const manifest = JSON.parse(readFileSync(join(ROOT, cli.dir, "package.json"), "utf8"));
  return manifest.bin[cli.bin].replace(/^\.\//, "");
}

/** The source the entry runs: itself when it is TypeScript, else the `src/` file tsc emitted it from. */
function sourceOf(cli) {
  const entry = entryOf(cli);
  return entry.endsWith(".ts") ? entry : entry.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
}

/**
 * `--help` as the binary prints it, with CRLF flattened.
 *
 * Windows terminals and Linux runners disagree about line endings, and a committed file that only
 * matches on the machine it was generated on is a check that fails for everybody else.
 */
function helpTextOf(cli) {
  const entry = join(ROOT, cli.dir, entryOf(cli));
  let text;
  try {
    text = execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8" });
  } catch (error) {
    throw new Error(
      `${cli.bin} --help failed. Run "pnpm run ${EXPERIMENT ? "experiment:dsh:build" : "build:packages"}" first.\n${String(error?.message ?? error)}`,
    );
  }
  return text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

/** The exit map and its meanings, from the module the binary is compiled from. */
async function exitsOf(cli) {
  const entry = join(ROOT, cli.dir, entryOf(cli));
  const mod = await import(pathToFileURL(entry).href);
  if (mod.EXIT === undefined || mod.EXIT_MEANINGS === undefined) {
    throw new Error(
      `${cli.dir}/${sourceOf(cli)} must export EXIT and EXIT_MEANINGS for this page to exist.`,
    );
  }
  return Object.entries(mod.EXIT).map(([name, code]) => ({
    code,
    name,
    meaning: mod.EXIT_MEANINGS[name],
  }));
}

/** A fence long enough that nothing inside it can close it early. */
function fence(body) {
  let ticks = 3;
  while (body.includes("`".repeat(ticks))) ticks += 1;
  return "`".repeat(ticks);
}

function renderPage(cli, help, exits) {
  const firstLine = help.split("\n")[0] ?? "";
  const summary = firstLine.includes(" — ") ? firstLine.split(" — ").slice(1).join(" — ") : "";
  const bar = fence(help);
  const source = `${cli.dir}/${sourceOf(cli)}`;

  const lines = [
    `<!-- Generated from ${source} by scripts/cli-reference.mjs. Do not edit; run "pnpm run ${REGENERATE}". -->`,
    "",
    `# \`${cli.bin}\``,
    "",
    `> ${summary}`,
    "",
    ...(cli.aliasOf === undefined ? [] : [
      `Temporary compatibility alias for [\`${cli.aliasOf}\`](${cli.aliasOf}.md). Both names run the`,
      "same entrypoint, help text and exit statuses. Prefer the canonical command in new callers.",
      "",
    ]),
    `Shipped by [\`${cli.dir}\`](${up(cli.dir)}). This page is *what it does*;`,
    `*why it does it that way* is [\`${cli.dir}/README.md\`](${up(`${cli.dir}/README.md`)}).`,
    "",
    "## Exit codes",
    "",
    "| code | name | meaning |",
    "| --- | --- | --- |",
    ...exits.map((e) => `| \`${e.code}\` | \`${e.name}\` | ${e.meaning} |`),
    "",
    `Read from \`EXIT\` and \`EXIT_MEANINGS\` in [\`${source}\`](${up(source)}). The \`exit codes\``,
    "block in the help text below renders from those same two constants, so this table, that block",
    "and the number the process actually returns cannot disagree.",
    "",
    `## \`${cli.bin} --help\``,
    "",
    `${bar}text`,
    help,
    bar,
    "",
    "---",
    "",
    `Generated by [\`scripts/cli-reference.mjs\`](${up("scripts/cli-reference.mjs")}).`,
    `Editing this file by hand fails \`pnpm run ${CHECK}\`; edit the CLI and run \`pnpm run ${REGENERATE}\`.`,
    "Back to [reference](../README.md) · [docs](../../README.md)",
    "",
  ];
  return lines.join("\n");
}

function renderIndex(pages) {
  const lines = [
    `<!-- Generated by scripts/cli-reference.mjs. Do not edit; run "pnpm run ${REGENERATE}". -->`,
    "",
    EXPERIMENT ? "# Optional dsh-router CLI reference" : "# Core CLI reference",
    "",
    "One page per binary, rendered from the binary. Every one of them runs without an agent awake,",
    "which is the property that makes them worth documenting separately from the packages behind",
    "them.",
    "",
    "| command | what it does | exit codes |",
    "| --- | --- | --- |",
    ...pages.map(
      (p) => `| [\`${p.bin}\`](${p.bin}.md) | ${p.summary} | ${p.exits.map((e) => `\`${e.code}\``).join(" ")} |`,
    ),
    "",
    "The four core `harness-*` commands keep temporary `dsh-*` compatibility aliases. Each pair",
    "shares one entrypoint; the aliases are retained for existing callers and reference links.",
    EXPERIMENT
      ? "These profile commands belong to the optional router. Run `pnpm run experiment:dsh:check` explicitly; default core checks do not execute them."
      : `The optional router has a [separate CLI reference](${up("experiments/routers/dsh/docs/reference/cli/README.md")}). Its checks are explicit; default core checks do not execute it.`,
    "",
    "`2` is a usage error in every command. `3` is a missing GitHub transport for",
    "`harness-board` and `harness-forge`, an unreadable input for `harness-coordinator`, an unwritable destination",
    "for the experimental profile command, and an incomplete picture for `harness-telemetry`. Read the table on the page.",
    "",
    "---",
    "",
    "Back to [reference](../README.md) · [docs](../../README.md)",
    "",
  ];
  return lines.join("\n");
}

async function build() {
  assertEveryBinIsCovered();
  const files = new Map();
  const pages = [];
  for (const cli of CLIS) {
    const help = helpTextOf(cli);
    const exits = await exitsOf(cli);
    const firstLine = help.split("\n")[0] ?? "";
    const summary = firstLine.includes(" — ") ? firstLine.split(" — ").slice(1).join(" — ") : "";
    files.set(join(OUT_DIR, `${cli.bin}.md`), renderPage(cli, help, exits));
    pages.push({ bin: cli.bin, summary, exits });
  }
  files.set(join(OUT_DIR, "README.md"), renderIndex(pages));
  if (!EXPERIMENT) files.set(join(OUT_DIR, "dsh-profile.md"), [
    '<!-- Generated by scripts/cli-reference.mjs. Do not edit; run "pnpm run docs:cli". -->',
    "", "# `dsh-profile`", "",
    `The temporary alias now belongs to the [optional dsh-router experiment](${up("experiments/routers/dsh/docs/reference/cli/harness-dsh-profile.md")}).`,
    "Use `harness-dsh-profile` for new experimental callers. Both names share one entrypoint.",
    "Default core checks validate this redirect; experimental help and exits are checked only by `pnpm run check:docs:dsh`.",
    "",
  ].join("\n"));
  return files;
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const write = process.argv.includes("--write");
const files = await build();

if (write) {
  mkdirSync(OUT_DIR, { recursive: true });
  let changed = 0;
  for (const [path, body] of files) {
    if (read(path) === body) continue;
    writeFileSync(path, body, "utf8");
    changed += 1;
  }
  console.log(
    changed === 0
      ? `${relative(ROOT, OUT_DIR)}: ${files.size} page(s), already current`
      : `${relative(ROOT, OUT_DIR)}: wrote ${changed} of ${files.size} page(s)`,
  );
  process.exit(0);
}

const problems = [];
for (const [path, body] of files) {
  const actual = read(path);
  if (actual === null) problems.push(`missing: ${relative(ROOT, path)}`);
  else if (actual !== body) problems.push(`stale:   ${relative(ROOT, path)}`);
}

// A page for a binary that no longer exists is drift in the other direction, and would otherwise
// sit in the tree forever being read.
let present = [];
try {
  present = readdirSync(OUT_DIR);
} catch {
  present = [];
}
for (const name of present) {
  if (!files.has(join(OUT_DIR, name))) problems.push(`orphan:  ${relative(ROOT, OUT_DIR)}/${name}`);
}

if (problems.length > 0) {
  console.error("docs/reference/cli is out of date with the code:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\nRun "pnpm run ${REGENERATE}" and commit the result.`);
  process.exit(1);
}

console.log(`${relative(ROOT, OUT_DIR)}: ${files.size} page(s) match the binaries`);
