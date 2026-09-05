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
 * | code | meaning |
 * | --- | --- |
 * | 0 | clean |
 * | 1 | the board contradicts itself (`check` only) |
 * | 2 | usage error |
 * | 3 | no usable transport — `gh` missing, unauthenticated, or unable to reach GitHub |
 * | 4 | internal error |
 *
 * These are the command's contract, and `1` is the one that has to stay honest: it means the
 * *board* is wrong, and something reading this in CI will treat it that way. A network failure
 * exiting 1 tells that reader the board is broken when the truth is that nobody looked. So every
 * failure gets its own code, and nothing falls through to 1 by accident — a defect that only
 * appears when the network does, which is to say, never on the machine where it was written.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildHierarchy } from "./hierarchy.js";
import { fetchItems, TransportUnavailable, detectRepoSlug } from "./github.js";
import type { FetchResult } from "./github.js";
import { projectBoard } from "./project.js";
import { renderAnomalies, renderColumns, renderHierarchy, renderCompleteness } from "./render.js";

const USAGE = `dsh-board — project a GitHub repository as a board

usage:
  dsh-board status [--repo <owner/name>]     the hierarchy: milestone -> epic -> task
  dsh-board columns [--repo <owner/name>]    the kanban view, one section per column
  dsh-board check [--repo <owner/name>]      exit 1 if the board contradicts itself
  dsh-board snapshot [--repo <owner/name>]   the projection as JSON
  dsh-board doctor                           report transport and detected repository

options:
  --repo <owner/name>   repository to project; defaults to the one in the working directory
  --lane-prefix <name>  label family holding the lane (default: lane)
  --limit <n>           maximum items to fetch per kind (default: 500)
  --at <iso8601>        timestamp to record on the snapshot (default: now)

exit codes:
  0 clean · 1 board anomalies (check only) · 2 usage · 3 transport unavailable · 4 internal error
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
  const options: Options = { repo: null, lanePrefix: "lane", limit: 500, at: null };
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
    return 2;
  }

  if (command === "help") {
    deps.stdout(USAGE);
    return 0;
  }

  const repo = options.repo ?? (await deps.detectRepoSlug(deps.cwd()));
  if (repo === null) {
    deps.stderr(
      "could not determine the repository.\n" +
        "Run inside a git repository with a GitHub remote, or pass --repo <owner/name>.\n",
    );
    return 3;
  }

  if (command === "doctor") {
    deps.stdout(`repo:      ${repo}\n`);
    deps.stdout(`transport: gh\n`);
    try {
      const { items } = await deps.fetchItems(repo, 1);
      deps.stdout(`reachable: yes (${items.length} item sampled)\n`);
      return 0;
    } catch (error) {
      if (error instanceof TransportUnavailable) {
        deps.stdout(`reachable: no — ${error.message}\n`);
        return 3;
      }
      throw error;
    }
  }

  if (!["status", "columns", "snapshot", "check"].includes(command)) {
    deps.stderr(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
    return 2;
  }

  let fetched: FetchResult;
  try {
    fetched = await deps.fetchItems(repo, options.limit);
  } catch (error) {
    if (error instanceof TransportUnavailable) {
      deps.stderr(
        `${error.message}\n\nInstall the GitHub CLI and run "gh auth login", then retry.\n`,
      );
      return 3;
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
  const banner = renderCompleteness(snapshot.completeness);
  if (banner !== null) {
    deps.stderr(`${banner}\n`);
    if (command !== "snapshot") deps.stdout(`${banner}\n\n`);
  }

  switch (command) {
    case "status":
      deps.stdout(`${renderHierarchy(buildHierarchy(snapshot))}\n`);
      return 0;
    case "columns":
      deps.stdout(`${renderColumns(snapshot)}\n`);
      return 0;
    case "snapshot":
      deps.stdout(`${JSON.stringify(snapshot, null, 2)}\n`);
      return 0;
    default:
      deps.stdout(`${renderAnomalies(snapshot)}\n`);
      return snapshot.anomalies.length === 0 ? 0 : 1;
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
      process.exitCode = 4;
    },
  );
}
/* c8 ignore stop */
