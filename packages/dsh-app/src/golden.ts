/**
 * The golden `--dump-config` snapshot: what dsh actually composes for the `rickylabs` profile.
 *
 * `cordis.patch.yml` states the rows *we* add. It says nothing about the eighty-five rows
 * `@deepseek-ai/dsh-base` puts underneath them, and those are the ones a dsh upgrade moves. A
 * release that renames `session-log-deepseek`, drops `fs-sandbox`, or reorders the list so a service
 * is claimed after its first consumer changes what our plugins boot into — and every symptom of that
 * arrives at boot, on the box, at whatever hour the upgrade happened. #50's whole claim is that this
 * should be a red pull request instead.
 *
 * So the composed list is committed, and a test re-composes it and compares. What makes that
 * possible is a property of `--dump-config` worth stating, because the snapshot is worthless if it
 * is untrue: **the command does not boot and does not evaluate `!!js`**. dsh-base's
 * environment-sensitive rows print as the unevaluated source text — `!!js dshHomePath('sessions')`,
 * `!!js process.platform === 'win32'` — so the output carries no absolute path, no platform branch
 * and no clock. It is a function of the lockfile alone, which is why one committed file can be
 * correct on a Windows workstation and on CI's Linux runner at once.
 *
 * Two things could quietly break that property, and both are closed here rather than trusted:
 * the capture runs against a throwaway `DSH_HOME` (so no machine's `$DSH_HOME/cordis.patch.yml`
 * layer reaches the composition), and it runs with every `DSH_*` variable stripped from the child
 * environment (so no future dsh release can make the dump depend on one without this failing).
 *
 * ## Why the provenance lives in the file
 *
 * A golden that changes is only useful if the diff also says *why* — otherwise the reviewer's whole
 * job is guessing whether 89 rows becoming 90 was the upgrade or a mistake. The reason therefore
 * sits in the file's own header, `renderGolden` puts it there, and `bless.ts` refuses to write
 * without one. There is no path that updates the snapshot and leaves the explanation to a commit
 * message someone may or may not have written.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { applyPlan, nodeFs } from "./cli.js";
import { planProfile, PROFILE_NAME } from "./profile.js";

const run = promisify(execFile);

/** The committed snapshot, beside the bundle whose composition it records. */
export const GOLDEN_FILE = "dump-config.golden.yml";

/**
 * Separates the provenance header from the bytes the command printed.
 *
 * Everything after this line is `--dump-config` output, unmodified — so `sed '1,/^# ----/d'` on the
 * committed file yields exactly what the command produced, and the snapshot never becomes a format
 * of its own that has to be kept in sync with dsh's.
 */
export const MARKER = "# ---- composed entry list below, provenance above ----";

/** What the header records about a capture. */
export interface Provenance {
  /** Version of `@deepseek-ai/dsh` this was composed against. */
  readonly dsh: string;
  /** Top-level entries in the composed list. Derived from the body; the headline of any diff. */
  readonly rows: number;
  /** Why the entry list changed. One line, supplied by whoever blessed it. */
  readonly reason: string;
}

/** A parsed snapshot: its header, and the command output it wraps. */
export interface Golden extends Provenance {
  /** `--dump-config` output, byte for byte. */
  readonly body: string;
}

/**
 * Count top-level entries.
 *
 * Column zero is load-bearing: a row's own config can hold a nested list, and the dump indents those
 * (`root:` under the `hmr` row prints `      - .`). Anchoring at the start of the line is what keeps
 * the count a count of *entries* rather than of hyphens.
 */
export function countRows(body: string): number {
  let rows = 0;
  for (const line of body.split("\n")) if (line.startsWith("- ")) rows += 1;
  return rows;
}

/** The row ids in a dump, in order. Used for the readable half of a mismatch report. */
export function rowIds(body: string): readonly string[] {
  const ids: string[] = [];
  for (const line of body.split("\n")) {
    const match = /^- id: (.*)$/.exec(line);
    const id = match?.[1];
    if (id !== undefined) ids.push(id.trim());
  }
  return ids;
}

/** Ids present in `a` and absent from `b` — the readable half of any snapshot difference. */
export function missingFrom(a: readonly string[], b: readonly string[]): readonly string[] {
  const present = new Set(b);
  return a.filter((id) => !present.has(id));
}

/**
 * Reject a reason that would make the header useless.
 *
 * @throws {RangeError} for an empty reason, or one spanning lines.
 */
export function checkReason(reason: string): void {
  if (reason.trim() === "") {
    throw new RangeError("a blessing needs a reason: what moved in the entry list, and why that is expected");
  }
  if (reason.includes("\n")) {
    throw new RangeError("the reason is one line; the long version belongs in the commit message");
  }
}

/**
 * Render the committed file from a capture.
 *
 * The row count is derived here rather than passed in, so a hand-edited count cannot survive the
 * round-trip assertion in the tests.
 *
 * @throws {RangeError} if the reason is empty or multi-line.
 */
export function renderGolden(body: string, dsh: string, reason: string): string {
  checkReason(reason);
  const header = [
    "# GENERATED — the entry list dsh composes for the `rickylabs` profile. Do not edit by hand.",
    "#",
    "# Everything below the rule is the output of",
    "#",
    `#     dsh --profile ${PROFILE_NAME} --dump-config`,
    "#",
    "# captured against a throwaway DSH_HOME. A test re-runs that command and compares byte for",
    "# byte, so a dsh release that moves, renames, reorders or drops a row fails a pull request",
    "# instead of a boot. The command composes without booting and without evaluating `!!js`, so",
    "# these bytes are a function of the lockfile and of nothing about the machine.",
    "#",
    "# The only supported way to change this file:",
    "#",
    '#     pnpm run golden:bless -- "what moved, and why that is expected"',
    "#",
    `# dsh    ${dsh}`,
    `# rows   ${countRows(body)}`,
    `# why    ${reason.trim()}`,
    "#",
    MARKER,
  ];
  return `${header.join("\n")}\n${body}`;
}

function field(lines: readonly string[], key: string): string {
  const pattern = new RegExp(`^# ${key}\\s+(.*)$`);
  for (const line of lines) {
    const value = pattern.exec(line)?.[1];
    if (value !== undefined) return value.trim();
  }
  throw new SyntaxError(`${GOLDEN_FILE} has no '# ${key}' line in its provenance header`);
}

/**
 * Split a committed snapshot back into its header and its body.
 *
 * @throws {SyntaxError} when the marker or one of the header fields is missing, or the row count is
 * not a number — all of which mean someone edited the file by hand instead of re-blessing it.
 */
export function parseGolden(text: string): Golden {
  const lines = text.split("\n");
  const at = lines.indexOf(MARKER);
  if (at < 0) {
    throw new SyntaxError(
      `${GOLDEN_FILE} has no provenance marker; expected a line reading ${JSON.stringify(MARKER)}`,
    );
  }
  const head = lines.slice(0, at);
  const rows = Number.parseInt(field(head, "rows"), 10);
  if (!Number.isInteger(rows)) {
    throw new SyntaxError(`${GOLDEN_FILE} has a '# rows' line that is not a number`);
  }
  return {
    dsh: field(head, "dsh"),
    rows,
    reason: field(head, "why"),
    body: lines.slice(at + 1).join("\n"),
  };
}

/** Where dsh is installed, and at what version. */
export interface DshPackage {
  readonly version: string;
  /** Absolute path of the `dsh` executable's entry module. */
  readonly bin: string;
}

/**
 * Locate the installed dsh.
 *
 * Through its `package.json` and the `bin` field it declares, rather than a hard-coded `lib/bin.js`:
 * the path is dsh's to change between releases, and a snapshot test that silently stopped finding
 * the binary would be the one failure this file exists to prevent.
 *
 * @throws {Error} when dsh is not installed, or declares no `dsh` binary.
 */
export function dshPackage(): DshPackage {
  const manifestPath = createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version?: unknown;
    bin?: unknown;
  };
  const bin = typeof manifest.bin === "object" && manifest.bin !== null
    ? (manifest.bin as Record<string, unknown>)["dsh"]
    : undefined;
  if (typeof bin !== "string" || typeof manifest.version !== "string") {
    throw new Error(`${manifestPath} declares no 'dsh' binary or no version`);
  }
  return { version: manifest.version, bin: join(dirname(manifestPath), bin) };
}

export interface CaptureOptions {
  /** Absolute dsh home holding an installed profile. */
  readonly home: string;
  /** Absolute path of dsh's entry module. Defaults to the installed one. */
  readonly dshBin?: string;
  /** Profile name. Defaults to `rickylabs`. */
  readonly profile?: string;
  /** Base environment for the child. Defaults to this process's. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Run `dsh --profile <name> --dump-config` and return its stdout.
 *
 * The child's environment is this process's with **every `DSH_*` variable removed** and `DSH_HOME`
 * set to the throwaway home. Today only `DSH_HOME` reaches the dump — the telemetry switch that
 * reads `DSH_TELEMETRY_DISABLED` is applied in `composeProfile`, which this code path does not take.
 * Stripping the rest anyway costs nothing and means a future release cannot make the snapshot depend
 * on a developer's shell without this test noticing.
 *
 * @throws {Error} when dsh exits non-zero, carrying its stderr.
 */
export async function captureDump(options: CaptureOptions): Promise<string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined && !key.startsWith("DSH_")) env[key] = value;
  }
  env["DSH_HOME"] = options.home;

  const bin = options.dshBin ?? dshPackage().bin;
  const argv = ["--profile", options.profile ?? PROFILE_NAME, "--dump-config"];
  try {
    const { stdout } = await run(process.execPath, [bin, ...argv], { env, encoding: "utf8" });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr !== "" ? stderr.trimEnd() : String(error);
    throw new Error(`dsh ${argv.join(" ")} failed:\n${detail}`);
  }
}

/**
 * Install the profile into an empty home and capture the composition — the whole operation the
 * snapshot records, shared by the test that checks it and the command that re-blesses it, so the
 * two cannot disagree about what was captured.
 *
 * @param packageDir absolute directory of this package, the profile's link target.
 * @param home absolute, empty, and disposable: it is written to.
 */
export async function captureFromScratch(packageDir: string, home: string): Promise<string> {
  await applyPlan(planProfile({ home, packageDir }), nodeFs());
  return await captureDump({ home });
}
