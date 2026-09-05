#!/usr/bin/env node
/**
 * `dsh-profile` — put the `rickylabs` profile where dsh looks for it.
 *
 * dsh can be pointed at a profile directory; it cannot be told to compose our bundle without a
 * manifest that names it, and hand-editing that manifest is the deterministic-work-in-the-daemon
 * principle being violated once per machine. This command writes it.
 *
 * Three commands, and the read-only one is the interesting one: `check` exits non-zero when the
 * installed profile has drifted from what this package would write, which is what makes the profile
 * a checkable artifact rather than a step in a runbook. `install --dry-run` prints the same report
 * without touching anything.
 *
 * ## What it does not do
 *
 * It does not run `pnpm install` in the profile directory, and it does not install dsh. dsh brings
 * its own bundles; ours is reached through a link, for the reason `profile.ts` states. A profile
 * that needed a package install to work would need a published package, and this one is not.
 */

import { mkdir, readlink, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

import { BUNDLE_ROWS } from "./bundle.js";
import {
  DEFAULT_SURFACE,
  isSurfaceName,
  planProfile,
  plannedRowIds,
  PROFILE_NAME,
  SURFACE_NAMES,
  type PlannedFile,
  type ProfilePlan,
  type SurfaceName,
} from "./profile.js";

/** Exit codes, in the house shape: one meaning per code, stated once. */
export const EXIT = {
  /** Installed, or already matching. */
  ok: 0,
  /** `check` found a difference between what is installed and what this package would write. */
  drift: 1,
  /** The argv did not name a command this tool has. */
  usage: 2,
  /** The profile directory could not be written or linked. */
  unwritable: 3,
} as const;

const USAGE = `dsh-profile — install the rickylabs dsh profile

usage
  dsh-profile install         write the profile and link this bundle into it
  dsh-profile check           exit non-zero when the installed profile has drifted
  dsh-profile path            print the profile directory (for DSH_HOME scripting)

options
  --home <dir>     dsh home (default: $DSH_HOME, else ~/.dsh)
  --name <name>    profile name (default: ${PROFILE_NAME})
  --surface <s>    ${SURFACE_NAMES.join(" | ")} (default: ${DEFAULT_SURFACE})
  --dry-run        with install: report what would change, write nothing

after installing
  dsh --profile ${PROFILE_NAME} --dump-config     show the composed entry list`;

/** Thrown for an argv this tool cannot act on. Mapped to `EXIT.usage`. */
export class UsageError extends Error {}

/** Thrown when the filesystem refuses. Mapped to `EXIT.unwritable`. */
export class WriteError extends Error {}

/** The filesystem this CLI needs, narrowed so a test can supply a fake. */
export interface ProfileFs {
  mkdirp(dir: string): Promise<void>;
  /** File contents, or `null` when the file is absent. Any other error propagates. */
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  /** Link target, or `null` when the path is absent or is not a link. */
  linkTarget(path: string): Promise<string | null>;
  /** Replace whatever is at `path` with a link to `target`. */
  link(path: string, target: string): Promise<void>;
}

export interface CliDeps {
  readonly out: (line?: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Absolute directory of this package — the link target. */
  readonly packageDir: string;
  readonly fs: ProfileFs;
}

/** One difference between the plan and what is on disk. */
export interface Difference {
  readonly path: string;
  readonly kind: "missing" | "changed" | "link";
  readonly detail: string;
}

function missing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "EINVAL" ||
      (error as { code?: unknown }).code === "UNKNOWN")
  );
}

/** The real filesystem. `junction` because a plain symlink needs a privilege on Windows. */
export function nodeFs(): ProfileFs {
  return {
    async mkdirp(dir) {
      await mkdir(dir, { recursive: true });
    },
    async read(path) {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async write(path, contents) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");
    },
    async linkTarget(path) {
      try {
        return await readlink(path);
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async link(path, target) {
      await mkdir(dirname(path), { recursive: true });
      await rm(path, { recursive: true, force: true });
      await symlink(target, path, "junction");
    },
  };
}

/** Compare the plan with what is on disk. Unmanaged files are seeds and are never compared. */
export async function diffPlan(plan: ProfilePlan, fs: ProfileFs): Promise<readonly Difference[]> {
  const differences: Difference[] = [];
  for (const file of plan.files) {
    if (!file.managed) continue;
    const found = await fs.read(join(plan.dir, file.path));
    if (found === null) {
      differences.push({ path: file.path, kind: "missing", detail: "not installed" });
    } else if (found !== file.contents) {
      differences.push({ path: file.path, kind: "changed", detail: "differs from this package" });
    }
  }
  const target = await fs.linkTarget(join(plan.dir, plan.link.path));
  if (target === null) {
    differences.push({ path: plan.link.path, kind: "link", detail: "not linked" });
  } else if (target !== plan.link.target) {
    differences.push({ path: plan.link.path, kind: "link", detail: `points at ${target}` });
  }
  return differences;
}

/** Write the plan. Seeds are written only when absent; the link is always refreshed. */
export async function applyPlan(plan: ProfilePlan, fs: ProfileFs): Promise<readonly string[]> {
  const written: string[] = [];
  try {
    await fs.mkdirp(plan.dir);
    for (const file of plan.files) {
      const path = join(plan.dir, file.path);
      if (!file.managed && (await fs.read(path)) !== null) continue;
      const found = file.managed ? await fs.read(path) : null;
      if (found === file.contents) continue;
      await fs.write(path, file.contents);
      written.push(file.path);
    }
    const linkPath = join(plan.dir, plan.link.path);
    if ((await fs.linkTarget(linkPath)) !== plan.link.target) {
      await fs.link(linkPath, plan.link.target);
      written.push(plan.link.path);
    }
  } catch (error) {
    throw new WriteError(
      `cannot write the profile at ${plan.dir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return written;
}

function describe(plan: ProfilePlan, out: CliDeps["out"], surfaceNote = ""): void {
  out(`profile   ${plan.name}`);
  out(`surface   ${plan.surface}${surfaceNote}`);
  out(`directory ${plan.dir}`);
  out(`bundles   ${plan.bundles.join(", ")}`);
  out(`rows      ${plannedRowIds().join(", ")}`);
  out(`link      ${plan.link.path} -> ${plan.link.target}`);
}

function seeds(plan: ProfilePlan): readonly PlannedFile[] {
  return plan.files.filter((file) => !file.managed);
}

/** What `check` decided to compare against, and whether the operator had to say so. */
interface CheckTarget {
  readonly plan: ProfilePlan;
  readonly differences: readonly Difference[];
  /** Suffix for the surface line: empty when the operator named it, ` (inferred)` when we did. */
  readonly note: string;
}

/**
 * Pick the surface `check` reports against.
 *
 * With `--surface`, that one: an operator who names a surface is asserting it, and a profile
 * installed as something else is the drift they asked us to find. Without it, the installed manifest
 * decides — the first surface that matches exactly. A `check` that reported an intact `web` profile
 * as drift merely because `tui` is the default would teach the operator to ignore the check, which
 * is the same as not having one.
 */
async function resolveCheck(
  requested: SurfaceName | undefined,
  plan: (surface: SurfaceName) => ProfilePlan,
  fs: ProfileFs,
): Promise<CheckTarget> {
  if (requested !== undefined) {
    const chosen = plan(requested);
    return { plan: chosen, differences: await diffPlan(chosen, fs), note: "" };
  }
  for (const surface of SURFACE_NAMES) {
    const candidate = plan(surface);
    const differences = await diffPlan(candidate, fs);
    if (differences.length === 0) {
      return { plan: candidate, differences, note: surface === DEFAULT_SURFACE ? "" : " (inferred)" };
    }
  }
  const fallback = plan(DEFAULT_SURFACE);
  return { plan: fallback, differences: await diffPlan(fallback, fs), note: "" };
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const { out, env, packageDir, fs } = deps;
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        home: { type: "string" },
        name: { type: "string" },
        surface: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
    if (values.help) {
      out(USAGE);
      return EXIT.ok;
    }
    const command = positionals[0] ?? "";
    const home = resolveDshHome(values.home, { ...env });
    const requested = values.surface;
    if (requested !== undefined && !isSurfaceName(requested)) {
      throw new UsageError(
        `unknown surface: ${JSON.stringify(requested)} (known: ${SURFACE_NAMES.join(", ")})`,
      );
    }
    const planFor = (surface: SurfaceName): ProfilePlan =>
      planProfile(
        values.name === undefined
          ? { home, packageDir, surface }
          : { home, packageDir, name: values.name, surface },
      );
    const plan = planFor(requested ?? DEFAULT_SURFACE);

    switch (command) {
      case "path":
        out(plan.dir);
        return EXIT.ok;

      case "check": {
        const target = await resolveCheck(requested, planFor, fs);
        describe(target.plan, out, target.note);
        out();
        if (target.differences.length === 0) {
          out("installed and matching.");
          return EXIT.ok;
        }
        for (const difference of target.differences) {
          out(`drift  ${difference.path}: ${difference.detail}`);
        }
        out();
        out(
          `run 'dsh-profile install${target.plan.surface === DEFAULT_SURFACE ? "" : ` --surface ${target.plan.surface}`}' to bring it back in line.`,
        );
        return EXIT.drift;
      }

      case "install": {
        describe(plan, out);
        out();
        if (values["dry-run"]) {
          const differences = await diffPlan(plan, fs);
          if (differences.length === 0) {
            out("nothing to do.");
          } else {
            for (const difference of differences) {
              out(`would write  ${difference.path}  (${difference.detail})`);
            }
          }
          for (const seed of seeds(plan)) out(`would seed   ${seed.path}  (only if absent)`);
          return EXIT.ok;
        }
        const written = await applyPlan(plan, fs);
        if (written.length === 0) {
          out("already installed; nothing changed.");
        } else {
          for (const path of written) out(`wrote  ${path}`);
        }
        out();
        out(`${BUNDLE_ROWS.length} rows will be inserted. Verify with:`);
        out(`  dsh --profile ${plan.name} --dump-config`);
        return EXIT.ok;
      }

      default:
        throw new UsageError(command === "" ? "no command given" : `unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      out(USAGE);
      out();
      out(error.message);
      return EXIT.usage;
    }
    if (error instanceof WriteError) {
      out(error.message);
      return EXIT.unwritable;
    }
    if (error instanceof RangeError) {
      out(USAGE);
      out();
      out(error.message);
      return EXIT.usage;
    }
    out(error instanceof Error ? error.message : String(error));
    return EXIT.unwritable;
  }
}

/**
 * This package's directory, from the compiled file's own location (`dist/cli.js`).
 *
 * Through `fileURLToPath`, not `new URL(...).pathname`: on Windows the latter yields `/C:/...`,
 * which is not a path any filesystem call accepts, and the link this feeds is the one thing in the
 * install that cannot be wrong quietly.
 */
export function packageDirOf(moduleUrl: string): string {
  return join(dirname(fileURLToPath(moduleUrl)), "..");
}

// Run only when invoked as a program, so the module stays importable by tests.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (line) => {
      process.stdout.write(`${line ?? ""}\n`);
    },
    env: process.env,
    packageDir: packageDirOf(import.meta.url),
    fs: nodeFs(),
  });
}
