#!/usr/bin/env node
/**
 * Every pasted output block in `docs/tutorials/` either re-runs and matches, or says out loud that
 * it does not.
 *
 * The failure this exists for was measured rather than imagined. #212 read
 * `01-from-clone-to-board.md` end to end on a clean clone and found step 4 stale in four places: the
 * profile had grown a fifth row, and the page still promised four. Nothing went red. `check:docs`
 * regenerates `docs/reference/cli` and compares only that; `check:links` proves a link arrives
 * somewhere, not that the somewhere is true; `check:snapshots` excludes prose deliberately. A
 * tutorial is the one page a newcomer has no way to check, because they have nothing to check it
 * against — which is exactly when being wrong costs the most.
 *
 * `cli-reference.mjs` already had the right idea and applied it to one document. Its opening line
 * is the whole argument: "A hand-written CLI reference is wrong within one milestone, and wrong
 * quietly: nothing goes red." The tutorial is also hand-written, also full of pasted output, and
 * read first.
 *
 * ## The contract
 *
 * Every ```` ```text ```` fence under `docs/tutorials/` is an *output claim* and must be preceded by
 * a directive comment, invisible in the rendered page:
 *
 *     <!-- verify: exact -->        the nearest preceding bash fence is run; stdout must match
 *     <!-- verify: contains -->     ... must contain these lines, contiguously, in order
 *     <!-- verify: none - reason -->  not run, and the reason is printed in the summary
 *
 * An unmarked output block fails the check. That is the part that matters most: it is not possible
 * to paste a new transcript into a tutorial without saying which of the two kinds it is, so the
 * boundary between what is proved and what is trusted stays visible instead of becoming folklore.
 * The `none` reasons are printed on every run for the same purpose — a shrinking list is progress
 * and a growing one is a decision somebody made.
 *
 * The directive is an HTML comment, so the page ends up making its claim twice: once to this script
 * and once, in the italic line above the block, to a reader. Two claims about one block can
 * disagree, and "Executed transcript" over a block nothing runs is worse than no marker at all — so
 * they are compared too. For the same reason an unclosed fence is an error rather than a shrug:
 * a block the parser cannot see is a block that skips every check below.
 *
 * ## Three deliberate limits
 *
 * **The interpreter is a subset, not a shell.** It understands `VAR=$(mktemp -d)`, plain
 * assignments, `env -u NAME`, `printf '%s\n' ... |`, `node <script>`, and a `node_modules/.bin/`
 * entry point resolved through its own `package.json`. Everything else is refused by name. A shell
 * would let a tutorial line run anything a tutorial line could run; a subset means a block that
 * cannot be checked has to be marked `none` and explained, rather than quietly doing something
 * surprising on a contributor's machine.
 *
 * **Nothing here touches the network or a real home directory.** Every temp directory comes from
 * `mkdtemp` and is removed afterwards, and any command reaching GitHub is `none` by construction:
 * a gate that fails because a token expired is a gate people re-run until it passes.
 *
 * **Machine paths are normalised, and a leak is an error.** The tutorial prints display
 * placeholders (`/tmp/tel-home`, `/path/to/harness`) where a real run prints a real path, so the
 * comparison substitutes the same way — from the longest binding down, after folding Windows
 * separators. If a real path survives that substitution the check fails rather than reporting a
 * confusing diff: an unmapped variable means the placeholder table below is out of date, which is
 * the same class of drift as the one being checked for.
 *
 * Exit codes: 0 every claim holds, 1 at least one does not, 2 no output block was scanned at all —
 * a broken checker, which must never be able to look like a clean one.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { harvestAssignments, planCommand } from "./tutorial-interpreter.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TUTORIALS = join(ROOT, "docs", "tutorials");

/**
 * What each shell variable's temp directory is printed as in the prose.
 *
 * A run writes to a path nobody can predict; the page has to show *a* path. These are the display
 * strings the tutorial uses, and binding a variable that is not in this table is an error rather
 * than an unnormalised diff.
 */
const PLACEHOLDERS = new Map([
  ["TELEMETRY_HOME", "/tmp/tel-home"],
]);

const CHECKOUT_PLACEHOLDER = "/path/to/harness";

const DIRECTIVE = /^<!--\s*verify:\s*(.+?)\s*-->$/;
/** How far above a fence the directive may sit: room for a blank line and one italic prose marker. */
const DIRECTIVE_LOOKBACK = 4;

function fail(message) {
  console.error(`  ${message}`);
}

/** Markdown files under `docs/tutorials`, in a stable order. */
function tutorialFiles() {
  if (!existsSync(TUTORIALS)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) out.push(full);
    }
  };
  walk(TUTORIALS);
  return out;
}

/**
 * Fenced blocks, with the 1-based line of their opening fence.
 *
 * A fence left open is reported rather than dropped. Everything below keys off "this block is an
 * output claim", so a block the parser cannot see is a block that skips the check entirely — the
 * silent pass this whole script exists to make impossible.
 */
function fences(lines) {
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^```(\S*)\s*$/.exec(lines[i]);
    if (!match) continue;
    if (open === null) open = { lang: match[1], line: i + 1, body: [] };
    else {
      blocks.push(open);
      open = null;
    }
  }
  return { blocks, unclosed: open };
}

/** Re-read each fence's body once the boundaries are known. */
function withBodies(blocks, lines) {
  for (let b = 0; b < blocks.length; b += 1) {
    const start = blocks[b].line; // 1-based opening fence
    const body = [];
    for (let i = start; i < lines.length; i += 1) {
      if (/^```\s*$/.test(lines[i])) break;
      body.push(lines[i]);
    }
    blocks[b].body = body;
  }
  return blocks;
}

function directiveFor(lines, fenceLine) {
  for (let i = fenceLine - 2; i >= 0 && i >= fenceLine - 2 - DIRECTIVE_LOOKBACK; i -= 1) {
    const match = DIRECTIVE.exec(lines[i].trim());
    if (match) return { raw: match[1], line: i + 1 };
  }
  return null;
}

/**
 * The italic line a reader actually sees above the block, if there is one.
 *
 * The directive is an HTML comment, so it is invisible in the rendered page — which means the page
 * makes its claim twice, once to a machine and once to a person. Two claims about the same block is
 * a thing that can disagree, and a page that says "Executed transcript" above a block nothing runs
 * is worse than one that says nothing at all.
 */
function proseMarker(lines, directiveLine) {
  for (let i = directiveLine - 2; i >= 0 && i >= directiveLine - 4; i -= 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    return /^\*\(.+\)\*$/.test(line) ? { text: line, line: i + 1 } : null;
  }
  return null;
}

function markerDisagrees(mode, text) {
  const claimsExecuted = /\bExecuted\b/.test(text);
  const claimsUnexecuted = /\bunexecuted\b|\bIllustrative\b/.test(text);
  if (mode === "none" && claimsExecuted) return "says “Executed” above a block nothing runs";
  if (mode !== "none" && claimsUnexecuted) return "calls a block the build re-runs illustrative";
  return null;
}

function parseDirective(raw) {
  if (raw === "exact" || raw === "contains") return { mode: raw };
  const none = /^none\s*[-\u2014]\s*(.+)$/.exec(raw);
  if (none) return { mode: "none", reason: none[1].trim() };
  return { error: `unrecognised directive \`verify: ${raw}\`` };
}

/* ------------------------------------------------------------------------- normalisation ----- */

function slashes(value) {
  return value.split("\\").join("/");
}

function normalise(text, bindings) {
  let out = slashes(text.split("\r\n").join("\n"));
  const substitutions = [];
  for (const [name, dir] of bindings) {
    if (PLACEHOLDERS.has(name)) substitutions.push([slashes(dir), PLACEHOLDERS.get(name)]);
  }
  substitutions.push([slashes(ROOT), CHECKOUT_PLACEHOLDER]);
  substitutions.sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of substitutions) out = out.split(from).join(to);
  return out
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Any real machine path still standing in normalised output — ignoring the placeholders it was
 * normalised *into*.
 *
 * That exception is the whole of this function's difficulty. A display placeholder can itself sit
 * under the real temp root: `/tmp/tel-home` does, on every machine whose `tmpdir()` is `/tmp`.
 * Scanning for `tmpdir()` without blanking the placeholders first reports the substitution this
 * script just made — and reports it only on POSIX, so a Windows run passes and CI does not. Blank
 * them, and what is left is a path nothing accounted for.
 */
function leaks(text, bindings) {
  const real = slashes(tmpdir());
  let residue = text;
  for (const shown of [...PLACEHOLDERS.values(), CHECKOUT_PLACEHOLDER]) {
    residue = residue.split(shown).join("");
  }
  const found = [];
  if (residue.includes(real)) found.push(real);
  for (const dir of bindings.values()) {
    if (typeof dir === "string" && dir.includes(real) && residue.includes(slashes(dir))) {
      found.push(slashes(dir));
    }
  }
  return found;
}

/* ------------------------------------------------------------------------------- checking ---- */

function containsContiguously(haystack, needle) {
  if (needle.length === 0) return true;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function reportDiff(expected, actual) {
  const want = expected.split("\n");
  const got = actual.split("\n");
  for (let i = 0; i < Math.max(want.length, got.length); i += 1) {
    if (want[i] !== got[i]) {
      fail(`first difference at line ${i + 1} of the block:`);
      fail(`  page:    ${want[i] === undefined ? "(nothing — the block ends here)" : want[i]}`);
      fail(`  command: ${got[i] === undefined ? "(nothing — the output ends here)" : got[i]}`);
      return;
    }
  }
}

function main() {
  const files = tutorialFiles();
  let claims = 0;
  let executed = 0;
  let problems = 0;
  const trusted = [];
  const temps = [];

  try {
    for (const file of files) {
      const rel = slashes(relative(ROOT, file));
      const lines = readFileSync(file, "utf8").split("\r\n").join("\n").split("\n");
      const parsed = fences(lines);
      if (parsed.unclosed) {
        problems += 1;
        fail(`${rel}:${parsed.unclosed.line} this fence is never closed — everything below it is unchecked`);
      }
      const blocks = withBodies(parsed.blocks, lines);
      const bindings = new Map();

      for (let b = 0; b < blocks.length; b += 1) {
        const block = blocks[b];
        if (block.lang === "bash") {
          const harvest = harvestAssignments(block.body, bindings, temps, PLACEHOLDERS);
          if (harvest.error) {
            problems += 1;
            fail(`${rel}:${block.line} ${harvest.error}`);
          }
          continue;
        }
        if (block.lang !== "text") continue;
        claims += 1;
        const where = `${rel}:${block.line}`;

        const found = directiveFor(lines, block.line);
        if (!found) {
          problems += 1;
          fail(`${where} output block with no \`<!-- verify: ... -->\` directive above it`);
          continue;
        }
        const directive = parseDirective(found.raw);
        if (directive.error) {
          problems += 1;
          fail(`${rel}:${found.line} ${directive.error}`);
          continue;
        }
        const marker = proseMarker(lines, found.line);
        if (marker) {
          const disagreement = markerDisagrees(directive.mode, marker.text);
          if (disagreement) {
            // Reported, not skipped: the block still runs, so one wrong marker does not cascade
            // into every later block that depended on this one having happened.
            problems += 1;
            fail(`${rel}:${marker.line} the visible marker ${disagreement}`);
          }
        }

        if (directive.mode === "none") {
          if (directive.reason.length < 12) {
            problems += 1;
            fail(`${rel}:${found.line} \`verify: none\` needs a reason worth reading`);
            continue;
          }
          trusted.push(`${where} — ${directive.reason}`);
          continue;
        }

        let source = null;
        for (let k = b - 1; k >= 0; k -= 1) {
          if (blocks[k].lang === "bash") {
            source = blocks[k];
            break;
          }
        }
        if (!source) {
          problems += 1;
          fail(`${where} \`verify: ${directive.mode}\` with no bash block above it to run`);
          continue;
        }

        let plan;
        try {
          plan = planCommand(source.body, bindings);
        } catch (error) {
          plan = { unsupported: error.message };
        }
        if (plan.unsupported) {
          problems += 1;
          fail(`${rel}:${source.line} cannot be run: ${plan.unsupported}`);
          fail(`  mark ${where} as \`verify: none - ...\` if that is deliberate`);
          continue;
        }

        let stdout;
        try {
          stdout = execFileSync(process.execPath, [plan.script, ...plan.args], {
            cwd: ROOT,
            env: plan.env,
            input: plan.stdin ?? "",
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 32 * 1024 * 1024,
          });
        } catch (error) {
          problems += 1;
          fail(`${rel}:${source.line} the command failed (exit ${error.status ?? "?"})`);
          const detail = String(error.stderr ?? "").trim().split("\n")[0];
          if (detail) fail(`  ${detail}`);
          continue;
        }
        executed += 1;

        const actual = normalise(stdout, bindings);
        const leaked = leaks(actual, bindings);
        if (leaked.length > 0) {
          problems += 1;
          fail(`${where} a real path survived normalisation: ${leaked[0]}`);
          fail("  PLACEHOLDERS in scripts/check-tutorial.mjs is missing a binding");
          continue;
        }
        const expected = normalise(block.body.join("\n"), bindings);

        if (directive.mode === "exact") {
          if (actual !== expected) {
            problems += 1;
            fail(`${where} the pasted output is not what the command prints`);
            reportDiff(expected, actual);
          }
        } else if (!containsContiguously(actual.split("\n"), expected.split("\n"))) {
          problems += 1;
          fail(`${where} these lines do not appear together in the command's output`);
          reportDiff(expected, actual);
        }
      }
    }
  } finally {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  }

  if (claims === 0) {
    console.error("check-tutorial: no output blocks found at all — the checker is broken");
    process.exit(2);
  }
  if (problems > 0) {
    console.error(`\ntutorial drift — ${problems} problem(s) across ${files.length} page(s)`);
    process.exit(1);
  }
  console.log(
    `tutorial ok — ${executed} block(s) re-run and matched, ${trusted.length} declared untested ` +
      `(${claims} output claim(s) across ${files.length} page(s))`,
  );
  for (const line of trusted) console.log(`  trusted  ${line}`);
}

main();
