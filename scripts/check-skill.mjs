#!/usr/bin/env node
/**
 * Assert that the committed board-process skill is what `dsh-forge` would write today.
 *
 * `.claude/skills/board-process/SKILL.md` is generated from the taxonomy, and it is the file that
 * tells every agent working in this repository which label to move an item to and when. Nothing
 * checked it. The taxonomy changed twice while the committed skill went on describing the previous
 * one, and there was no symptom: the file still parsed, still loaded, still read as authoritative.
 * An agent following a stale process document does not fail — it does the wrong thing confidently,
 * which is the worst available outcome for a file whose entire job is telling agents what to do.
 *
 * This is `check:docs` for the one generated artifact `check:docs` does not cover. The reference
 * pages under `docs/reference/cli/` are rendered by a script in this repository; the skill is
 * rendered by a published binary, so the drift check is the binary's own dry run rather than a byte
 * comparison written here. `installSkill` already computes exactly the verdict we want and reports
 * it per file: `unchanged` means the bytes on disk match what a fresh render produces.
 *
 * Note that `dsh-forge skill install --dry-run` exits 0 on `stale` — deliberately, because a person
 * asking what would happen has been answered. That is the wrong default for a gate, so this script
 * reads the verdict rather than the exit code.
 *
 * The rendered skill must not depend on whether the caller had a network. It did once: the lane
 * prefix was read from the repository's live labels, so the generator emitted `topic:` on a
 * workstation with an authenticated `gh` and `lane:` in CI, and this check would have failed on
 * every pull request for a reason no diff could fix. `detectLanePrefix` now reads
 * `.github/labels.yml` first, and `packages/forge/src/labels/detect.test.ts` holds that property.
 *
 * It did it a second time, one field over, and that one is worse. `epic:` labels are derived from a
 * live search for open umbrella issues, so the render named whatever was open that hour: green here,
 * red on an authenticated workstation, same commit — and the fix a red build invites is to commit a
 * label that exists in nobody's repository. Worse, because CI is the only place this gate is
 * enforced and CI has no transport: for that whole family the check could not fail where it runs.
 * `skill install` now renders from what a checkout can reproduce — the ejected file plus the
 * tree-derived families — and `packages/forge/src/cli.test.ts` holds *that* property, by running the
 * command twice against two different answers from GitHub and comparing the bytes. `labels plan` and
 * `labels apply` still propose epics from live issues; detection was never what was wrong. Letting
 * it reach a committed artifact was. See https://github.com/rickylabs/harness/issues/187.
 *
 * Exit codes: 0 the committed skill matches, 1 it does not, 2 the check could not run — a broken
 * check, which must never be able to look like a passing one.
 */

import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "forge", "dist", "cli.js");

// The dispatch label is an argument to the generator, not a fact it can discover, and it changes
// what the skill says: it is what makes the file warn that this label starts a real agent on a real
// host. It must match the root `skill:install` script, or the check compares against a skill nobody
// installs. Kept here rather than read from package.json so the mismatch is one grep away.
const ARGS = ["skill", "install", "--dispatch-label", "harness", "--dry-run", "--json"];

const fail = (message) => {
  console.error(`check:skill — ${message}`);
  process.exit(2);
};

let stdout;
try {
  ({ stdout } = await run(process.execPath, [CLI, ...ARGS], { cwd: ROOT, timeout: 120_000 }));
} catch (error) {
  fail(
    `could not run the generator: ${error instanceof Error ? error.message : String(error)}\n` +
      "  this check runs after `pnpm -r run build`, which is what produces packages/forge/dist.",
  );
}

let reports;
try {
  ({ reports } = JSON.parse(stdout));
} catch {
  fail(`the generator did not return JSON:\n${stdout}`);
}

if (!Array.isArray(reports) || reports.length === 0) {
  fail("the generator reported no skill files at all — nothing was compared");
}

const drifted = reports.filter((r) => r.outcome !== "unchanged");

if (drifted.length > 0) {
  for (const r of drifted) {
    console.error(`check:skill — ${r.path}: ${r.outcome}${r.note ? ` (${r.note})` : ""}`);
  }
  console.error(
    "\nThe committed skill is not what the taxonomy would generate.\n" +
      "  Regenerate it:  pnpm run skill:install\n" +
      "  Then commit the result. Do not edit the file by hand — the next run overwrites it.",
  );
  process.exit(1);
}

console.log(
  `check:skill — ${reports.length} generated skill file(s) match the taxonomy ` +
    `(${reports.map((r) => r.path).join(", ")})`,
);
