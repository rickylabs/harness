#!/usr/bin/env node
/**
 * Assert that `dsh-board`'s default lifecycle is the taxonomy `dsh-forge` actually stamps.
 *
 * This exists because the two drifted, and the drift was invisible from inside either package.
 * `packages/board/src/lifecycle.ts` listed `backlog`, `ready`, `in-progress`, `blocked`,
 * `in-review`, `changes-requested` — a plausible lifecycle that `dsh-forge` has never emitted —
 * while its own doc comment claimed the two matched. Nothing failed. `phaseOf` returned `null` for
 * every correctly labelled item, `progressOf` counted them *invisible*, and a board that had just
 * been filled in reported itself empty. The board-package suite stayed green throughout, because
 * every test that exercised a phase passed its own lifecycle in rather than using the default.
 *
 * That is the shape of failure this script is for: not a wrong answer, but a projector that
 * silently sees nothing and calls it an empty board.
 *
 * Neither package can check this alone. `board` must not depend on `forge` — the projector is
 * meant to be pointed at repositories that were never forged, and a dependency would make the
 * default a coupling. `forge` must not depend on `board` either; it stamps labels and has no
 * opinion about who reads them. The repository is the only place that can see both, so the check
 * lives here.
 *
 * Sources of truth, in the order `dsh-forge` itself defers to them:
 *
 *   1. `.github/labels.yml` — once ejected, this is the file a human edits and reviews, and
 *      `dsh-forge` treats it as winning where it overlaps the built-in taxonomy. Compared as a
 *      *set*: it is a label registry, not a lifecycle, and it carries no claim about column order.
 *   2. `packages/forge/src/labels/taxonomy.ts` — the built-in taxonomy. Compared as an ordered
 *      list, plus which phase is terminal, because that file does make both claims.
 *
 * Every source present is checked, and a disagreement between two sources is itself reported —
 * if the ejected file and the built-in taxonomy have diverged, that is worth knowing regardless
 * of what `board` says about either.
 *
 * Both files are read with regular expressions rather than executed or type-checked. That is a
 * real limitation and the mitigation is the exit code: a parse that finds nothing exits 2, never
 * 0. An empty comparison must never be able to look like agreement — that is precisely the bug.
 *
 * Not wired into `build` or `typecheck` yet: `packages/forge` is a stub on some branches and the
 * full taxonomy on others, so a gate here would fail for a reason that has nothing to do with the
 * change under review. When both packages sit on `main`, add `check:lifecycle` alongside
 * `check:graph` in the root `build` and `typecheck` scripts. Until then it is run deliberately.
 *
 * Exit codes: 0 the lifecycles agree (or no source is present), 1 they do not, 2 nothing could be
 * read — a broken check, which is not the same as a passing one.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BOARD_LIFECYCLE = join(repoRoot, "packages/board/src/lifecycle.ts");
const FORGE_TAXONOMY = join(repoRoot, "packages/forge/src/labels/taxonomy.ts");
const LABELS_FILE = join(repoRoot, ".github/labels.yml");

/**
 * Remove comments before matching, so prose that mentions a phase name cannot be read as one.
 *
 * `lifecycle.ts` has a header comment naming every phase the list used to contain. Matching over
 * it would make the check pass on exactly the file that motivated the check.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The `DEFAULT_LIFECYCLE` block, as phase names in declaration order plus their terminal flags. */
function readBoardLifecycle() {
  if (!existsSync(BOARD_LIFECYCLE)) {
    throw new Error("packages/board/src/lifecycle.ts not found — this is the file being checked");
  }
  const source = stripComments(readFileSync(BOARD_LIFECYCLE, "utf8"));
  const block = /export const DEFAULT_LIFECYCLE[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (block === null) throw new Error("could not find `export const DEFAULT_LIFECYCLE` in lifecycle.ts");

  const prefix = /prefix:\s*"([^"]+)"/.exec(block[1]);
  if (prefix === null) throw new Error("DEFAULT_LIFECYCLE declares no `prefix`");

  const phases = [];
  // `phase("name")` or `phase("name", { terminal: true, queued: true })`. Only `terminal` is
  // compared against the taxonomy — `queued` is the board's own reading of a phase and forge makes
  // no claim about it.
  for (const m of block[1].matchAll(/phase\(\s*"([^"]+)"\s*(?:,\s*\{([^}]*)\}\s*)?\)/g)) {
    const flags = m[2] ?? "";
    phases.push({ name: m[1], label: `${prefix[1]}:${m[1]}`, terminal: /terminal:\s*true/.test(flags) });
  }
  if (phases.length === 0) throw new Error("DEFAULT_LIFECYCLE parsed to zero phases");
  return { prefix: prefix[1], phases };
}

/** The built-in taxonomy: `STATUS_LIFECYCLE` in order, then the terminal and override labels. */
function readForgeTaxonomy() {
  if (!existsSync(FORGE_TAXONOMY)) return null;
  const source = stripComments(readFileSync(FORGE_TAXONOMY, "utf8"));

  const array = /export const STATUS_LIFECYCLE\s*=\s*\[([\s\S]*?)\]/.exec(source);
  if (array === null) {
    throw new Error("packages/forge/src/labels/taxonomy.ts has no `STATUS_LIFECYCLE` array");
  }
  const labels = [...array[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (labels.length === 0) throw new Error("STATUS_LIFECYCLE parsed to zero labels");

  const single = (name) => {
    const m = new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`).exec(source);
    return m === null ? null : m[1];
  };
  const terminal = single("STATUS_TERMINAL");
  if (terminal === null) throw new Error("taxonomy.ts declares no `STATUS_TERMINAL`");
  // `STATUS_OVERRIDE` is deliberately optional: #100 moves `close-gate-override` into the `flag:`
  // family, and when it leaves forge it must also leave the board's lifecycle. Its absence here
  // should surface as an extra phase on the board, not as a crash.
  const override = single("STATUS_OVERRIDE");

  return {
    origin: "packages/forge/src/labels/taxonomy.ts",
    labels: [...labels, terminal, ...(override === null ? [] : [override])],
    ordered: labels,
    terminal,
  };
}

/**
 * Status labels from an ejected `.github/labels.yml`.
 *
 * Only the `name:` field matters here, and only for the status family. The file is parsed the same
 * loose way `dsh-forge` parses it — a flat list of `- name: …` entries — because reimplementing
 * YAML to answer one question is how the second parser starts disagreeing with the first.
 */
function readLabelsFile() {
  if (!existsSync(LABELS_FILE)) return null;
  const labels = [];
  for (const raw of readFileSync(LABELS_FILE, "utf8").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*(?:-\s+)?name\s*:\s*(.*)$/.exec(line);
    if (m === null) continue;
    let value = m[1].trim().replace(/\s+#.*$/, "");
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      if (value.endsWith(value[0])) value = value.slice(1, -1);
    }
    if (value.startsWith("status:")) labels.push(value);
  }
  if (labels.length === 0) {
    throw new Error(".github/labels.yml exists but declares no `status:` labels");
  }
  return { origin: ".github/labels.yml", labels, ordered: null, terminal: null };
}

/** Compare one source against the board's default lifecycle. Returns a list of problems. */
function compare(board, source) {
  const problems = [];
  const boardLabels = board.phases.map((p) => p.label);
  const mine = new Set(boardLabels);
  const theirs = new Set(source.labels);

  for (const label of source.labels) {
    if (!mine.has(label)) {
      problems.push(
        `${label} is stamped but has no column — every item carrying it reads as "no status" ` +
          `and is counted invisible`,
      );
    }
  }
  for (const label of boardLabels) {
    if (!theirs.has(label)) {
      // Scoped to this source on purpose. With two sources in the tree, "nothing declares it"
      // would be a claim this comparison cannot make, and a check that overstates its evidence
      // is one people learn to argue with instead of fix.
      problems.push(
        `${label} is a column nothing can ever enter — ${source.origin} does not declare it`,
      );
    }
  }

  // Order and terminality are only claimed by the built-in taxonomy. Checking them against a label
  // registry would be inventing an assertion the file never made.
  if (source.ordered !== null) {
    const shared = boardLabels.filter((l) => source.ordered.includes(l));
    const expected = source.ordered.filter((l) => mine.has(l));
    if (shared.join(" ") !== expected.join(" ")) {
      problems.push(
        `column order disagrees with STATUS_LIFECYCLE\n      board: ${shared.join(" → ")}` +
          `\n      forge: ${expected.join(" → ")}`,
      );
    }
  }
  if (source.terminal !== null) {
    const terminal = board.phases.filter((p) => p.terminal).map((p) => p.label);
    if (terminal.length !== 1 || terminal[0] !== source.terminal) {
      problems.push(
        `terminal phase is ${terminal.length === 0 ? "unset" : terminal.join(", ")}, ` +
          `but the taxonomy's terminal status is ${source.terminal} — a lifecycle with no single ` +
          `terminal phase either never finishes work or finishes it in the wrong column`,
      );
    }
  }
  return problems;
}

const main = () => {
  const board = readBoardLifecycle();
  const sources = [readLabelsFile(), readForgeTaxonomy()].filter((s) => s !== null);

  if (sources.length === 0) {
    console.log("SKIP: lifecycle check did not run — no taxonomy to check against.");
    console.log("");
    console.log("  Looked for .github/labels.yml and packages/forge/src/labels/taxonomy.ts.");
    console.log("  Neither is in this tree, so nothing here can say whether the board's default");
    console.log("  lifecycle matches what dsh-forge stamps. This is a skip, not a pass: the two");
    console.log("  have drifted before and the drift was silent.");
    console.log("");
    console.log(`  Board default (${board.phases.length} phases): ${board.phases.map((p) => p.name).join(" → ")}`);
    return 0;
  }

  // Every source is reported, agreements first, so a failure and the advice that follows it are
  // not split apart by an unrelated "ok" line from the other source.
  const results = sources.map((source) => ({ source, problems: compare(board, source) }));
  for (const { source, problems } of results) {
    if (problems.length > 0) continue;
    console.log(`lifecycle ok — ${board.phases.length} phases agree with ${source.origin}`);
  }
  for (const { source, problems } of results) {
    if (problems.length === 0) continue;
    console.error(`lifecycle check failed against ${source.origin} — ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("");
  }

  if (results.some((r) => r.problems.length > 0)) {
    console.error("A phase the projector does not know is not a smaller column — it is an item");
    console.error("that vanishes. Fix DEFAULT_LIFECYCLE in packages/board/src/lifecycle.ts, or the");
    console.error("taxonomy, whichever is the one that moved.");
    return 1;
  }
  return 0;
};

try {
  process.exitCode = main();
} catch (error) {
  console.error(`lifecycle check could not run: ${error.message}`);
  console.error("This is a broken check, not a passing one.");
  process.exitCode = 2;
}
