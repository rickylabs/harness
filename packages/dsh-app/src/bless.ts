#!/usr/bin/env node
/**
 * Re-bless the `--dump-config` snapshot — the one supported way to change it.
 *
 * A golden file with no blessing command gets updated by whoever is annoyed by the failing test,
 * with `> dump-config.golden.yml` and no explanation, which is how a snapshot stops being evidence
 * and becomes a chore. So the reason is a required argument, it lands in the file's own header, and
 * the file is regenerated rather than edited — a hand edit cannot produce a header the test accepts,
 * because the row count in it is derived from the body.
 *
 * What the command prints is the review: rows before and after, the ids that appeared and
 * disappeared, and the dsh version either side. That summary is what belongs in the pull request
 * describing the upgrade, and it is easier to paste than to reconstruct from a 346-line diff.
 *
 * Deliberately not a `bin`: this writes into the checkout, and an operator installing profiles on a
 * box has no business with a command that edits the repository. It is reached through the root
 * script, next to the other repository-maintenance commands.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { packageDirOf } from "./cli.js";
import {
  captureFromScratch,
  checkReason,
  countRows,
  dshPackage,
  GOLDEN_FILE,
  missingFrom,
  parseGolden,
  renderGolden,
  rowIds,
} from "./golden.js";

/** Exit codes, in the house shape: one meaning per code. */
export const EXIT = {
  /** Blessed. The snapshot on disk now matches what dsh composes. */
  ok: 0,
  /** No reason was given, so there was nothing to record. */
  usage: 2,
  /** dsh could not be run, or the snapshot could not be written. */
  failed: 3,
} as const;

const USAGE = `bless-dump-config — re-take the golden ${GOLDEN_FILE}

usage
  pnpm run golden:bless -- "<what moved in the entry list, and why that is expected>"

The reason is required and is written into the snapshot's header, so the diff that
changes the rows also carries the sentence explaining them.`;

/** Thrown for an argv with no usable reason. Mapped to `EXIT.usage`. */
export class UsageError extends Error {}

/**
 * The reason, from argv.
 *
 * Every positional is joined rather than only the first, because `pnpm run golden:bless -- why it
 * moved` without quotes is the shape people actually type, and refusing it teaches nothing.
 *
 * The leading `--` is dropped because pnpm forwards the separator itself: the documented
 * invocation arrives here as `["--", "the reason"]`, and joining that blindly writes `-- the
 * reason` into the header of every blessing.
 *
 * @throws {UsageError} when nothing usable was given.
 */
export function reasonFrom(argv: readonly string[]): string {
  let at = 0;
  while (argv[at] === "--") at += 1;
  const reason = argv.slice(at).join(" ").trim();
  try {
    checkReason(reason);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  return reason;
}

export interface BlessDeps {
  readonly out: (line?: string) => void;
  /** Absolute directory of this package: where the snapshot lives, and the profile's link target. */
  readonly packageDir: string;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** What changed, in the form worth pasting into a pull request. */
function report(previous: string | null, body: string, dsh: string, out: BlessDeps["out"]): void {
  if (previous === null) {
    out(`first blessing: ${countRows(body)} rows, dsh ${dsh}`);
    return;
  }
  let before;
  try {
    before = parseGolden(previous);
  } catch {
    out(`the previous snapshot could not be read as one; replaced with ${countRows(body)} rows`);
    return;
  }
  out(`dsh    ${before.dsh === dsh ? dsh : `${before.dsh} -> ${dsh}`}`);
  out(`rows   ${before.rows === countRows(body) ? String(before.rows) : `${before.rows} -> ${countRows(body)}`}`);
  if (before.body === body) {
    out("");
    out("the entry list is unchanged; only the recorded reason moved.");
    return;
  }
  const was = rowIds(before.body);
  const now = rowIds(body);
  for (const id of missingFrom(now, was)) out(`  + ${id}`);
  for (const id of missingFrom(was, now)) out(`  - ${id}`);
  if (missingFrom(now, was).length === 0 && missingFrom(was, now).length === 0) {
    out("  (the same rows, reordered or reconfigured)");
  }
}

export async function main(argv: readonly string[], deps: BlessDeps): Promise<number> {
  const { out, packageDir } = deps;
  let reason: string;
  try {
    reason = reasonFrom(argv);
  } catch (error) {
    out(USAGE);
    out();
    out(error instanceof Error ? error.message : String(error));
    return EXIT.usage;
  }

  const goldenPath = join(packageDir, GOLDEN_FILE);
  const previous = await readOptional(goldenPath);
  const home = await mkdtemp(join(tmpdir(), "dsh-bless-"));
  try {
    const body = await captureFromScratch(packageDir, home);
    const { version } = dshPackage();
    await writeFile(goldenPath, renderGolden(body, version, reason), "utf8");
    report(previous, body, version, out);
    out();
    out(`wrote  ${GOLDEN_FILE}`);
    return EXIT.ok;
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

// Run only when invoked as a program, so the module stays importable by tests.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (line) => {
      process.stdout.write(`${line ?? ""}\n`);
    },
    packageDir: packageDirOf(import.meta.url),
  });
}
