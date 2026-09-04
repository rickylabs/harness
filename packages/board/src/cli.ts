#!/usr/bin/env node
/**
 * `dsh-board` — the board, printed.
 *
 * This is the command that is supposed to make "status ?" unnecessary. It reads GitHub, projects
 * it, and prints the answer. No agent is consulted, so it works when every agent is asleep,
 * wedged, or out of quota — which is when the question actually gets asked.
 *
 * Exit codes: 0 clean, 1 anomalies found (`check` only), 2 usage error, 3 no usable transport.
 */

import { buildHierarchy } from "./hierarchy.js";
import { fetchItems, TransportUnavailable, detectRepoSlug } from "./github.js";
import { projectBoard } from "./project.js";
import { renderAnomalies, renderColumns, renderHierarchy } from "./render.js";

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
`;

interface Options {
  repo: string | null;
  lanePrefix: string;
  limit: number;
  at: string | null;
}

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

async function main(argv: readonly string[]): Promise<number> {
  let command: string;
  let options: Options;
  try {
    ({ command, options } = parseArgs(argv));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const repo = options.repo ?? (await detectRepoSlug(process.cwd()));
  if (repo === null) {
    process.stderr.write(
      "could not determine the repository.\n" +
        "Run inside a git repository with a GitHub remote, or pass --repo <owner/name>.\n",
    );
    return 3;
  }

  if (command === "doctor") {
    process.stdout.write(`repo:      ${repo}\n`);
    process.stdout.write(`transport: gh\n`);
    try {
      const items = await fetchItems(repo, 1);
      process.stdout.write(`reachable: yes (${items.length} item sampled)\n`);
      return 0;
    } catch (error) {
      if (error instanceof TransportUnavailable) {
        process.stdout.write(`reachable: no — ${error.message}\n`);
        return 3;
      }
      throw error;
    }
  }

  let items;
  try {
    items = await fetchItems(repo, options.limit);
  } catch (error) {
    if (error instanceof TransportUnavailable) {
      process.stderr.write(
        `${error.message}\n\nInstall the GitHub CLI and run "gh auth login", then retry.\n`,
      );
      return 3;
    }
    throw error;
  }

  const snapshot = projectBoard(items, {
    repo,
    generatedAt: options.at ?? new Date().toISOString(),
    lanePrefix: options.lanePrefix,
  });

  switch (command) {
    case "status":
      process.stdout.write(`${renderHierarchy(buildHierarchy(snapshot))}\n`);
      return 0;
    case "columns":
      process.stdout.write(`${renderColumns(snapshot)}\n`);
      return 0;
    case "snapshot":
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return 0;
    case "check":
      process.stdout.write(`${renderAnomalies(snapshot)}\n`);
      return snapshot.anomalies.length === 0 ? 0 : 1;
    default:
      process.stderr.write(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
