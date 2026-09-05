#!/usr/bin/env node
/**
 * `dsh-telemetry` — status without an agent in the loop.
 *
 * The command exists to make one sentence false: "I'm constantly spamming `status ?` to my current
 * orchestrator because I have zero visibility across the board." So it must work when every agent
 * is asleep, when the coordinator has crashed, and when the network is down. It reads files, and
 * that is all it does.
 *
 * Board items are read from a JSON file rather than fetched, because the fetch belongs to the board
 * package and a status command that needs a GitHub token is a status command that fails exactly
 * when the token is the problem.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

import { backfillFromDisk, defaultRoots, type BackfillRoots } from "./backfill/index.js";
import { diagnosticsFor } from "./diagnostics.js";
import type { BoardItemRef } from "./model.js";
import { renderSnapshot } from "./render.js";
import { buildSnapshot } from "./snapshot.js";

const USAGE = `dsh-telemetry — board activity, read from disk, with no agent awake

usage:
  dsh-telemetry status [options]     render the current picture
  dsh-telemetry runs [options]       one line per run, newest first
  dsh-telemetry why <run-id>         which log to open first for that run

options:
  --home <path>          home directory the stores live under (default: this user's)
  --items <path>         JSON array of board items to attribute runs to
  --limit <n>            transcripts to scan per seam (default: 500)
  --since <iso>          drop runs whose last activity is older than this
  --now <iso>            reference time for ages, so output is reproducible
  --json                 machine-readable output
  --help
`;

interface Flags {
  readonly home: string;
  readonly items: string | null;
  readonly limit: number;
  readonly since: string | null;
  readonly now: string;
  readonly json: boolean;
  readonly help: boolean;
  readonly rest: readonly string[];
}

export function parseFlags(argv: readonly string[]): Flags {
  let home = homedir();
  let items: string | null = null;
  let limit = 500;
  let since: string | null = null;
  let now = new Date().toISOString();
  let json = false;
  let help = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${String(arg)} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--home":
        home = next();
        break;
      case "--items":
        items = next();
        break;
      case "--limit": {
        // Parsed strictly rather than leniently: `--limit 1.5` under parseInt becomes 1, which is a
        // scan the operator did not ask for and would have no reason to suspect.
        const raw = next();
        const value = Number.parseInt(raw, 10);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
          throw new Error("--limit needs a positive integer");
        }
        limit = value;
        break;
      }
      case "--since":
        since = next();
        break;
      case "--now":
        now = next();
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (arg !== undefined) rest.push(arg);
    }
  }
  return { home, items, limit, since, now, json, help, rest };
}

/** Read the board items to attribute against. An absent file is not an error, only a poorer view. */
async function loadItems(path: string | null): Promise<{ items: BoardItemRef[]; note: string | null }> {
  if (path === null) {
    return {
      items: [],
      // Said explicitly: without items every run is unattributed, and that would otherwise look
      // like a board with no work on it rather than a command that was not told where the board is.
      note: "no --items given: runs are listed but not attributed to epics",
    };
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) return { items: [], note: `${path} is not a JSON array` };
    return { items: parsed as BoardItemRef[], note: null };
  } catch (error) {
    return { items: [], note: `${path} could not be read: ${String(error)}` };
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    process.stdout.write(`${String(error instanceof Error ? error.message : error)}\n\n${USAGE}`);
    return 2;
  }
  if (flags.help || flags.rest.length === 0) {
    process.stdout.write(USAGE);
    return flags.help ? 0 : 2;
  }

  const command = flags.rest[0];
  const roots: BackfillRoots = defaultRoots(flags.home);
  const { runs: allRuns, notes: backfillNotes } = await backfillFromDisk(roots, flags.limit);
  const runs =
    flags.since === null ? allRuns : allRuns.filter((r) => r.updatedAt >= (flags.since as string));

  if (command === "why") {
    const id = flags.rest[1];
    if (id === undefined) {
      process.stdout.write("dsh-telemetry why <run-id>\n");
      return 2;
    }
    const run = runs.find((r) => r.id === id || r.id.startsWith(id));
    if (run === undefined) {
      process.stdout.write(`no run matching ${id} in this scan\n`);
      return 1;
    }
    const pointers = diagnosticsFor(run);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ run: run.id, pointers }, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${run.id} (${run.source}, ${run.outcome}) — look here, in this order:\n\n`);
    for (const p of pointers) {
      process.stdout.write(`  ${p.what}\n    ${p.where}\n    grep: ${p.grep}\n    why: ${p.why}\n\n`);
    }
    return 0;
  }

  const { items, note } = await loadItems(flags.items);
  const notes = note === null ? backfillNotes : [...backfillNotes, note];
  const snapshot = buildSnapshot({ generatedAt: flags.now, runs, items, notes });

  if (command === "runs") {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
      return 0;
    }
    for (const run of runs) {
      const model = run.identity.model ?? "model unrecorded";
      // Issue numbers rather than a title: a run record carries no prose, by design. What a reader
      // wants here is which board item this was, and the number is the join to it.
      const about = run.linkedIssues.map((link) => `#${link.number}`).join(" ");
      process.stdout.write(
        `${run.updatedAt}  ${run.source.padEnd(9)} ${run.outcome.padEnd(8)} ${model}  ${about}\n`,
      );
    }
    return 0;
  }

  if (command === "status") {
    process.stdout.write(
      flags.json ? `${JSON.stringify(snapshot, null, 2)}\n` : `${renderSnapshot(snapshot, flags.now)}\n`,
    );
    return 0;
  }

  process.stdout.write(`unknown command: ${String(command)}\n\n${USAGE}`);
  return 2;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("cli.js") || invoked.endsWith("dsh-telemetry")) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stdout.write(`dsh-telemetry failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
