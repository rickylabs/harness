#!/usr/bin/env node
/**
 * `dsh-board` — the board, printed.
 *
 * This is the command that is supposed to make "status ?" unnecessary. It reads GitHub, projects
 * it, and prints the answer. No agent is consulted, so it works when every agent is asleep,
 * wedged, or out of quota — which is when the question actually gets asked.
 *
 * ## Exit codes
 *
 * `EXIT_MEANINGS` below is the table; repeating it here would be a second copy that nothing
 * compares. `1` is the one that has to stay honest: it means the
 * *board* is wrong, and something reading this in CI will treat it that way. A network failure
 * exiting 1 tells that reader the board is broken when the truth is that nobody looked. So every
 * failure gets its own code, and nothing falls through to 1 by accident — a defect that only
 * appears when the network does, which is to say, never on the machine where it was written.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderDigest } from "./digest.js";
import { buildHierarchy } from "./hierarchy.js";
import { fetchItems, TransportUnavailable, detectRepoSlug } from "./github.js";
import type { FetchResult } from "./github.js";
import { DEFAULT_LANE_PREFIX } from "./labels.js";
import { projectBoard } from "./project.js";
import { renderAnomalies, renderColumns, renderHierarchy, renderCompleteness } from "./render.js";

/** The command's contract with whatever called it. Disjoint; nothing falls through to another. */
export const EXIT = {
  ok: 0,
  anomalies: 1,
  usage: 2,
  unavailable: 3,
  failed: 4,
} as const;

/**
 * One sentence per code, keyed on `EXIT` — so a code added without a meaning is a type error
 * rather than an undocumented number that CI discovers by treating it as a board defect.
 *
 * This is the only statement of these meanings. The `exit codes` block in `USAGE` renders from it,
 * and so does `docs/reference/cli/dsh-board.md`, which `pnpm run check:docs` byte-compares.
 */
export const EXIT_MEANINGS: Readonly<Record<keyof typeof EXIT, string>> = {
  ok: "clean: the board was read and it agrees with itself",
  anomalies: "the board contradicts itself (check only)",
  usage: "the command line was wrong",
  unavailable: "no usable transport: gh missing, unauthenticated, or unable to reach GitHub",
  failed: "dsh-board itself failed",
};

const EXIT_BLOCK = Object.entries(EXIT)
  .map(([name, code]) => `  ${code}  ${EXIT_MEANINGS[name as keyof typeof EXIT]}`)
  .join("\n");

const USAGE = `dsh-board — project a GitHub repository as a board

usage:
  dsh-board status [--repo <owner/name>]     the hierarchy: milestone -> epic -> task
  dsh-board columns [--repo <owner/name>]    the kanban view, one section per column
  dsh-board check [--repo <owner/name>]      exit 1 if the board contradicts itself
  dsh-board digest [--repo <owner/name>]     the board as a markdown page, for committing
  dsh-board snapshot [--repo <owner/name>]   the projection as JSON
  dsh-board doctor                           report transport and detected repository

options:
  --repo <owner/name>   repository to project; defaults to the one in the working directory
  --lane-prefix <name>  label family holding the lane (default: lane)
  --limit <n>           maximum items to fetch per kind (default: 500)
  --at <iso8601>        timestamp to record on the snapshot (default: now)

exit codes:
${EXIT_BLOCK}
`;

interface Options {
  repo: string | null;
  lanePrefix: string;
  limit: number;
  at: string | null;
}

/** Everything the command touches that is not itself. Injected so the exit codes are testable. */
export interface CliDeps {
  fetchItems: (repo: string, limit: number) => Promise<FetchResult>;
  detectRepoSlug: (cwd: string) => Promise<string | null>;
  cwd: () => string;
  now: () => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultDeps = (): CliDeps => ({
  fetchItems,
  detectRepoSlug,
  cwd: () => process.cwd(),
  now: () => new Date().toISOString(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});

function parseArgs(argv: readonly string[]): { command: string; options: Options } {
  const options: Options = { repo: null, lanePrefix: DEFAULT_LANE_PREFIX, limit: 500, at: null };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--repo":
        options.repo = next();
        break;
      case "--lane-prefix":
        options.lanePrefix = next();
        break;
      case "--limit": {
        const raw = next();
        if (!/^\d+$/.test(raw)) throw new Error(`--limit expects a positive integer, got ${raw}`);
        options.limit = Number.parseInt(raw, 10);
        break;
      }
      case "--at":
        options.at = next();
        break;
      case "-h":
      case "--help":
        rest.push("help");
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
        rest.push(arg);
    }
  }

  return { command: rest[0] ?? "status", options };
}

/** Run the command. Returns the exit code; never throws for an expected failure. */
export async function main(argv: readonly string[], deps: CliDeps = defaultDeps()): Promise<number> {
  let command: string;
  let options: Options;
  try {
    ({ command, options } = parseArgs(argv));
  } catch (error) {
    deps.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (command === "help") {
    deps.stdout(USAGE);
    return EXIT.ok;
  }

  const repo = options.repo ?? (await deps.detectRepoSlug(deps.cwd()));
  if (repo === null) {
    deps.stderr(
      "could not determine the repository.\n" +
        "Run inside a git repository with a GitHub remote, or pass --repo <owner/name>.\n",
    );
    return EXIT.unavailable;
  }

  if (command === "doctor") {
    deps.stdout(`repo:      ${repo}\n`);
    deps.stdout(`transport: gh\n`);
    try {
      const { items } = await deps.fetchItems(repo, 1);
      deps.stdout(`reachable: yes (${items.length} item sampled)\n`);
      return EXIT.ok;
    } catch (error) {
      if (error instanceof TransportUnavailable) {
        deps.stdout(`reachable: no — ${error.message}\n`);
        return EXIT.unavailable;
      }
      throw error;
    }
  }

  if (!["status", "columns", "snapshot", "check", "digest"].includes(command)) {
    deps.stderr(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
    return EXIT.usage;
  }

  let fetched: FetchResult;
  try {
    fetched = await deps.fetchItems(repo, options.limit);
  } catch (error) {
    if (error instanceof TransportUnavailable) {
      deps.stderr(
        `${error.message}\n\nInstall the GitHub CLI and run "gh auth login", then retry.\n`,
      );
      return EXIT.unavailable;
    }
    throw error;
  }

  const snapshot = projectBoard(fetched.items, {
    repo,
    generatedAt: options.at ?? deps.now(),
    lanePrefix: options.lanePrefix,
    completeness: fetched.completeness,
  });

  // A capped fetch means everything below is a prefix of the real board. It goes above the output
  // and on stderr as well, so it survives a pipe into a file that nobody reads the top of.
  //
  // `snapshot` and `digest` are excluded from the stdout copy because both are consumed whole by a
  // machine — one parsed as JSON, one committed as a file — and a warning line pasted above the
  // first byte corrupts them. Neither loses the warning: the JSON carries `completeness`, the page
  // renders it as a blockquote, and both still get it on stderr.
  const banner = renderCompleteness(snapshot.completeness);
  if (banner !== null) {
    deps.stderr(`${banner}\n`);
    if (command !== "snapshot" && command !== "digest") deps.stdout(`${banner}\n\n`);
  }

  switch (command) {
    case "status":
      deps.stdout(`${renderHierarchy(buildHierarchy(snapshot))}\n`);
      return EXIT.ok;
    case "columns":
      deps.stdout(`${renderColumns(snapshot)}\n`);
      return EXIT.ok;
    case "digest":
      deps.stdout(renderDigest(snapshot, buildHierarchy(snapshot)));
      return EXIT.ok;
    case "snapshot":
      deps.stdout(`${JSON.stringify(snapshot, null, 2)}\n`);
      return EXIT.ok;
    default:
      deps.stdout(`${renderAnomalies(snapshot)}\n`);
      return snapshot.anomalies.length === 0 ? EXIT.ok : EXIT.anomalies;
  }
}

/**
 * True only when this file is the program, not when a test imported it.
 *
 * `realpath` on both sides because the bin is a symlink under `node_modules/.bin`, and comparing
 * the link to its target would make the binary a no-op.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/* c8 ignore start — the process seam, exercised by running the binary rather than by a test */
if (invokedDirectly()) {
  void main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `internal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      // Not 1. Exit 1 means the board contradicts itself, and a crash is not evidence of that.
      process.exitCode = EXIT.failed;
    },
  );
}
/* c8 ignore stop */
