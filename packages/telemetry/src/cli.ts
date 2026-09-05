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
 *
 * The exit statuses are disjoint and documented in `USAGE`, because this command is going to be run
 * from scripts and cron. The one that matters is 3: the answer printed above it is real but partial,
 * and a caller that treats it as complete will conclude the board is quiet when in fact the scan
 * could not see. Every other status collapses into "it worked", "you asked wrong", or "I broke".
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

import { backfillFromDisk, defaultRoots, type BackfillRoots } from "./backfill/index.js";
import { diagnosticsFor, ALL_POINTERS } from "./diagnostics.js";
import type { BoardItemRef } from "./model.js";
import {
  humanBytes,
  livePath,
  logPaths,
  openObservabilitySink,
  parseEvents,
  resolveObservability,
} from "./observability.js";
import type { TelemetryEvent } from "./sink.js";
import { publicRuns, publicSnapshot } from "./public.js";
import { renderSnapshot } from "./render.js";
import { buildSnapshot } from "./snapshot.js";

const USAGE = `dsh-telemetry — board activity, read from disk, with no agent awake

usage:
  dsh-telemetry status [options]     render the current picture
  dsh-telemetry runs [options]       one line per run, newest first
  dsh-telemetry why <run-id>         which log to open first for that run
  dsh-telemetry record [options]     append events to the observability log
  dsh-telemetry where [options]      where that log is, and the layers below a run

options:
  --home <path>          home directory the stores live under (default: this user's)
  --items <path>         JSON array of board items to attribute runs to
  --limit <n>            runs to read per seam, most recent first (default: 500)
  --since <iso>          only runs with activity at or after this time
  --now <iso>            reference time for ages, so output is reproducible
  --json                 machine-readable output
  --run <id>             with "record": the run one event belongs to
  --kind <name>          with "record": write that one event instead of reading stdin
  --help

"record" reads JSONL on stdin — one {"runId","kind","at","detail"} object per line, "at"
and "detail" optional. A bad line loses that line and is named; an empty batch is not an
error. The log is bounded and rotated, and it is the same file whether an agent, a shell
hook or a daemon wrote it.

environment:
  DSH_TELEMETRY_DIR          live log directory (default: ~/observability)
  DSH_TELEMETRY_ARCHIVE      cold tier for rotated generations, or "none" to delete them
                             (default: ~/archives)
  DSH_TELEMETRY_MAX_BYTES    bound per generation, e.g. 33554432 or 32M
  DSH_TELEMETRY_GENERATIONS  generations kept behind the live file

exit status:
  0  the picture is complete
  1  dsh-telemetry itself failed
  2  the command line was wrong
  3  the picture is incomplete: a store could not be read, or a scan hit --limit
  4  nothing matched, on a scan that could see everything
`;

/**
 * What the command exited with, and what a caller should do about it.
 *
 * Exit 1 used to cover both a `why` that found nothing and an internal crash, and exit 0 covered
 * three unreadable stores (finding F-7 on #105) — so a script could not tell success from missing
 * evidence from a bug. These are disjoint, and 3 outranks 4: "I did not find it" and "I could not
 * see everywhere" are different answers, and when both are true the second is the one to act on.
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  incomplete: 3,
  notFound: 4,
} as const;

interface Flags {
  readonly home: string;
  readonly items: string | null;
  readonly limit: number;
  readonly since: string | null;
  /** `--since` as an epoch millisecond, which is what actually bounds the readers. */
  readonly sinceMs: number | null;
  readonly now: string;
  readonly json: boolean;
  readonly help: boolean;
  /** `record` only: the run one event belongs to. */
  readonly run: string | null;
  /** `record` only: the kind of that one event. Present means "do not read stdin". */
  readonly kind: string | null;
  readonly rest: readonly string[];
}

/**
 * Parse a timestamp flag, or refuse.
 *
 * `--since not-a-date` used to be accepted and compared as a string, which silently returned zero
 * runs: an operator asking a reasonable question got "nothing is happening" and exit 0.
 */
function timeFlag(raw: string, flag: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`${flag} needs a time, like 2026-09-05T00:00:00Z`);
  return ms;
}

export function parseFlags(argv: readonly string[]): Flags {
  let home = homedir();
  let items: string | null = null;
  let limit = 500;
  let since: string | null = null;
  let sinceMs: number | null = null;
  let now = new Date().toISOString();
  let json = false;
  let help = false;
  let run: string | null = null;
  let kind: string | null = null;
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
      case "--since": {
        const raw = next();
        sinceMs = timeFlag(raw, "--since");
        since = raw;
        break;
      }
      case "--now": {
        const raw = next();
        timeFlag(raw, "--now");
        now = raw;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--run":
        run = next();
        break;
      case "--kind":
        kind = next();
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (arg !== undefined) rest.push(arg);
    }
  }
  return { home, items, limit, since, sinceMs, now, json, help, run, kind, rest };
}

/** The board items to attribute against, and whether asking for them failed. */
interface LoadedItems {
  readonly items: BoardItemRef[];
  readonly note: string | null;
  /** True only when items were asked for and could not be had. Not asking is not a gap. */
  readonly degraded: boolean;
}

/** Read the board items to attribute against. An absent flag is not an error, only a poorer view. */
async function loadItems(path: string | null): Promise<LoadedItems> {
  if (path === null) {
    return {
      items: [],
      // Said explicitly: without items every run is unattributed, and that would otherwise look
      // like a board with no work on it rather than a command that was not told where the board is.
      note: "no --items given: runs are listed but not attributed to epics",
      degraded: false,
    };
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      return { items: [], note: `${path} is not a JSON array`, degraded: true };
    }
    return { items: parsed as BoardItemRef[], note: null, degraded: false };
  } catch (error) {
    return { items: [], note: `${path} could not be read: ${String(error)}`, degraded: true };
  }
}

/** Print the notes under a heading. Used when a command's own output would otherwise be silent. */
function writeNotes(notes: readonly string[]): void {
  process.stdout.write("\nthis scan was incomplete:\n");
  for (const note of notes) process.stdout.write(`  ${note}\n`);
}

/** Everything on stdin, as text. Read only when `record` was not given a whole event in flags. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Append events to the observability log.
 *
 * This is the command that makes `~/observability` real. Everything under it already existed — the
 * bounded file sink, the rotation policy, the cold tier, the default paths — and nothing opened any
 * of it, so the package could write a rotated log and never had.
 *
 * JSONL on stdin rather than an import, because the callers are a Go dispatcher, shell hooks and
 * tmux wrappers. A caller that can emit one line of JSON can now write into the same log an agent
 * writes into, which is the only way `~/observability/dsh-telemetry.jsonl` ends up holding the whole
 * story rather than the part that happened to be in Node.
 */
async function recordEvents(flags: Flags): Promise<number> {
  const target = resolveObservability(flags.home, process.env);
  const notes = [...target.notes];
  const live = livePath(target);

  let events: readonly TelemetryEvent[];
  if (flags.kind !== null) {
    if (flags.run === null) {
      process.stdout.write("dsh-telemetry record --kind <name> also needs --run <id>\n");
      return EXIT.usage;
    }
    events = [{ at: flags.now, runId: flags.run, kind: flags.kind }];
  } else {
    // Refused rather than blocked: a `record` with no pipe and no flags would otherwise sit on a
    // terminal waiting for an EOF the operator has no reason to expect it wants.
    if (process.stdin.isTTY === true) {
      process.stdout.write(
        'dsh-telemetry record reads JSONL on stdin, or takes --run <id> --kind <name>\n\n  echo \'{"runId":"r1","kind":"turn"}\' | dsh-telemetry record\n',
      );
      return EXIT.usage;
    }
    const parsed = parseEvents(await readStdin(), flags.now);
    events = parsed.events;
    notes.push(...parsed.notes);
  }

  if (events.length > 0) {
    const sink = openObservabilitySink(target);
    // Sequential on purpose. The sink serializes internally anyway, and awaiting each one keeps the
    // ordering in the file the ordering on the wire, which is what makes the log readable by eye.
    for (const event of events) await sink.write(event);
    notes.push(...sink.notes);
  } else if (notes.length === 0) {
    // Not an error, and not silent either: a producer that has stopped emitting looks exactly like a
    // pipeline that legitimately had nothing in it, and only this sentence tells them apart.
    process.stdout.write(`no events to record — ${live} unchanged\n`);
    return EXIT.ok;
  }

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          recorded: events.length,
          live,
          archive: target.archiveDirectory,
          notes,
          complete: notes.length === 0,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`recorded ${events.length} event(s) to ${live}\n`);
    for (const note of notes) process.stdout.write(`  ${note}\n`);
  }
  // A note here means a line was dropped, a bound was defaulted, or a write did not land. The
  // records that did land are real, which is exactly what 3 means everywhere else in this command.
  return notes.length === 0 ? EXIT.ok : EXIT.incomplete;
}

/**
 * Say where the log is, and what sits below a run that failed.
 *
 * Two questions with one answer, because they are asked in the same minute. An operator who has just
 * been handed "something is wrong" needs the file to tail and the layer to look at next, and the
 * second half of this output is the same table `why` uses — printed without a run id, for the case
 * where there is not one yet.
 */
function whereItWrites(flags: Flags): number {
  const target = resolveObservability(flags.home, process.env);
  const paths = logPaths(target);
  const complete = target.notes.length === 0;

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          directory: target.directory,
          archive: target.archiveDirectory,
          policy: target.policy,
          files: paths,
          pointers: ALL_POINTERS,
          notes: target.notes,
          complete,
        },
        null,
        2,
      )}\n`,
    );
    return complete ? EXIT.ok : EXIT.incomplete;
  }

  process.stdout.write("telemetry is written here:\n\n");
  process.stdout.write(`  live       ${livePath(target)}\n`);
  process.stdout.write(
    `  rotated    ${target.policy.maxGenerations} generation(s) behind it, ${humanBytes(target.policy.maxBytes)} each\n`,
  );
  process.stdout.write(
    `  cold tier  ${target.archiveDirectory ?? "none — an evicted generation is deleted"}\n\n`,
  );
  process.stdout.write("a failing run is usually a layer below itself — look here, in this order:\n\n");
  for (const p of ALL_POINTERS) {
    process.stdout.write(`  ${p.what}\n    ${p.where}\n    grep: ${p.grep}\n\n`);
  }
  for (const note of target.notes) process.stdout.write(`  ${note}\n`);
  return complete ? EXIT.ok : EXIT.incomplete;
}

export async function main(argv: readonly string[]): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    process.stdout.write(`${String(error instanceof Error ? error.message : error)}\n\n${USAGE}`);
    return EXIT.usage;
  }
  if (flags.help || flags.rest.length === 0) {
    process.stdout.write(USAGE);
    return flags.help ? EXIT.ok : EXIT.usage;
  }

  const command = flags.rest[0];

  // Dispatched before the scan, and deliberately. `record` and `why` answer different questions, but
  // `record` must land a line when every transcript store on the box is unreadable — reading three
  // of them to append one event would make the writer as fragile as the thing it exists to explain.
  if (command === "record") return await recordEvents(flags);
  if (command === "where") return whereItWrites(flags);

  const roots: BackfillRoots = defaultRoots(flags.home);
  const scan = await backfillFromDisk(roots, { limit: flags.limit, sinceMs: flags.sinceMs });
  // The stores are bounded by mtime and by the database's own `where`, which is coarse: a transcript
  // written after the cutoff can still hold nothing but older activity. This is the exact filter.
  const sinceMs = flags.sinceMs;
  const runs =
    sinceMs === null ? scan.runs : scan.runs.filter((r) => Date.parse(r.updatedAt) >= sinceMs);

  if (command === "why") {
    const id = flags.rest[1];
    if (id === undefined) {
      process.stdout.write("dsh-telemetry why <run-id>\n");
      return EXIT.usage;
    }
    const run = runs.find((r) => r.id === id || r.id.startsWith(id));
    if (run === undefined) {
      process.stdout.write(`no run matching ${id} in this scan\n`);
      if (!scan.degraded) return EXIT.notFound;
      writeNotes(scan.notes);
      return EXIT.incomplete;
    }
    const pointers = diagnosticsFor(run);
    if (flags.json) {
      // The transcript path leaves through this command and no other. It names a home directory, so
      // `status` and `runs` withhold it (finding F-5 on #105) — but `why` is run by an operator on
      // the box the file is on, and handing back the file to open is the whole command.
      process.stdout.write(
        `${JSON.stringify({ run: run.id, transcript: run.origin, pointers }, null, 2)}\n`,
      );
      return EXIT.ok;
    }
    process.stdout.write(`${run.id} (${run.source}, ${run.outcome}) — look here, in this order:\n\n`);
    // The run's own transcript first: whatever else is true of the box, that file says something
    // about this run, and the pointers below it are guesses about the layer underneath.
    process.stdout.write(`  the run's own transcript\n    ${run.origin}\n\n`);
    for (const p of pointers) {
      process.stdout.write(`  ${p.what}\n    ${p.where}\n    grep: ${p.grep}\n    why: ${p.why}\n\n`);
    }
    // A `why` that found its run answered its question completely, whatever else the scan missed.
    return EXIT.ok;
  }

  if (command === "runs") {
    if (flags.json) {
      const envelope = publicRuns(flags.now, runs, scan.notes, !scan.degraded);
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return scan.degraded ? EXIT.incomplete : EXIT.ok;
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
    if (!scan.degraded) return EXIT.ok;
    // An empty list from a truncated scan looks exactly like an empty board. It is not.
    writeNotes(scan.notes);
    return EXIT.incomplete;
  }

  if (command === "status") {
    const loaded = await loadItems(flags.items);
    const notes = loaded.note === null ? scan.notes : [...scan.notes, loaded.note];
    const complete = !scan.degraded && !loaded.degraded;
    const snapshot = buildSnapshot({
      generatedAt: flags.now,
      runs,
      items: loaded.items,
      notes,
    });
    process.stdout.write(
      flags.json
        ? `${JSON.stringify(publicSnapshot(snapshot, complete), null, 2)}\n`
        : `${renderSnapshot(snapshot, flags.now)}\n`,
    );
    return complete ? EXIT.ok : EXIT.incomplete;
  }

  process.stdout.write(`unknown command: ${String(command)}\n\n${USAGE}`);
  return EXIT.usage;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("cli.js") || invoked.endsWith("dsh-telemetry")) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stdout.write(`dsh-telemetry failed: ${String(error)}\n`);
      process.exitCode = EXIT.failed;
    });
}
