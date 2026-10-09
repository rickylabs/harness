/** File and log IO behind the `harness-telemetry` commands: board items, governance input, `record`, `where`. */
import { readFile } from "node:fs/promises";
import { ALL_POINTERS } from "./diagnostics.js";
import { parseItems, type LoadedItems } from "./items.js";
import { humanBytes, livePath, logPaths, openObservabilitySink, parseEvents, resolveObservability } from "./observability.js";
import { assertObservabilityWriteTarget } from "./log-source.js";
import type { OperatorEnvironment } from "./operator-environment.js";
import type { TelemetryEvent } from "./sink.js";
import type { GovernanceReadSnapshot } from "@rickylabs/harness-contracts";
import type { Flags } from "./cli-flags.js";
import { governanceAt, invalidGovernance, unconfiguredGovernance } from "@rickylabs/governance";
import { wireProducer } from "./producer-names.js";

/** The `EXIT` name a command resolved to; `cli.ts` owns the numbers. */
export type CliExit = "ok" | "usage" | "incomplete";

/**
 * Read the board items to attribute against. An absent flag is not an error, only a poorer view.
 *
 * The shape check and the adapting both live in `items.ts`, which is where the data actually stops
 * being `unknown`. This function's only remaining job is the file, and the one case the parser
 * cannot see: not asking is not a gap.
 */
export async function loadItems(path: string | null): Promise<LoadedItems> {
  if (path === null) {
    return {
      items: [],
      // Said explicitly: without items every run is unattributed, and that would otherwise look
      // like a board with no work on it rather than a command that was not told where the board is.
      notes: ["no --items given: runs are listed but not attributed to epics"],
      ok: true,
    };
  }
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return { items: [], notes: [`${path} could not be read: ${String(error)}`], ok: false };
  }
  return parseItems(text, path);
}

/** Governance as `status` and `tree` take it: the read document, the notes it adds, and whether it is complete. */
export interface LoadedGovernance {
  readonly governance: GovernanceReadSnapshot;
  readonly notes: readonly string[];
  readonly ok: boolean;
}

/**
 * Read one stored governance read document (the `governance` command's output) as of `now`, without
 * allowing its local path or bytes into public notes. No file is the explicit unknown, not a failure.
 */
export async function loadGovernance(path: string | null, now: string): Promise<LoadedGovernance> {
  if (path === null) return { governance: unconfiguredGovernance(wireProducer(), now), notes: [], ok: true };
  const refuse = (reason: string): LoadedGovernance => ({ governance: invalidGovernance(wireProducer(), now, [reason]), notes: [reason], ok: false });
  let text: string;
  try { text = await readFile(path, "utf8"); } catch { return refuse("governance observations could not be read"); }
  let decoded: unknown;
  try { decoded = JSON.parse(text) as unknown; } catch { return refuse("invalid governance observations: input is not JSON"); }
  const read = governanceAt(decoded, now);
  // A decoded document keeps its own completeness and diagnostics: a partial or unavailable reading stays incomplete.
  return read.ok ? { governance: read.snapshot, notes: [...read.snapshot.notes], ok: read.snapshot.complete }
    : refuse(`invalid governance observations: ${read.detail}`);
}

/** Print the notes under a heading. Used when a command's own output would otherwise be silent. */
export function writeNotes(notes: readonly string[]): void {
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
 * writes into, which is the only way the configured observability log ends up holding the whole
 * story rather than the part that happened to be in Node.
 */
export async function recordEvents(flags: Flags, env: OperatorEnvironment): Promise<CliExit> {
  const target = resolveObservability(flags.home, env);
  await assertObservabilityWriteTarget(target);
  const notes = [...target.notes];
  const live = livePath(target);

  let events: readonly TelemetryEvent[];
  if (flags.kind !== null) {
    if (flags.run === null) {
      process.stdout.write("harness-telemetry record --kind <name> also needs --run <id>\n");
      return "usage";
    }
    events = [{ at: flags.now, runId: flags.run, kind: flags.kind }];
  } else {
    // Refused rather than blocked: a `record` with no pipe and no flags would otherwise sit on a
    // terminal waiting for an EOF the operator has no reason to expect it wants.
    if (process.stdin.isTTY === true) {
      process.stdout.write(
        'harness-telemetry record reads JSONL on stdin, or takes --run <id> --kind <name>\n\n  echo \'{"runId":"r1","kind":"turn"}\' | harness-telemetry record\n',
      );
      return "usage";
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
    return "ok";
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
  return notes.length === 0 ? "ok" : "incomplete";
}

/**
 * Say where the log is, and what sits below a run that failed.
 *
 * Two questions with one answer, because they are asked in the same minute. An operator who has just
 * been handed "something is wrong" needs the file to tail and the layer to look at next, and the
 * second half of this output is the same table `why` uses — printed without a run id, for the case
 * where there is not one yet.
 */
export function whereItWrites(flags: Flags, env: OperatorEnvironment): CliExit {
  const target = resolveObservability(flags.home, env);
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
    return complete ? "ok" : "incomplete";
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
  return complete ? "ok" : "incomplete";
}
