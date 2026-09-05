/**
 * `SessionTelemetrySink` — the thing a run writes to as it works.
 *
 * The sink is deliberately the dumbest possible interface: one method, one record, no return value
 * worth branching on. A run must never fail because telemetry did, and an orchestrator must never
 * be able to make progress conditional on the sink having accepted something. Every implementation
 * here therefore swallows its own IO errors into a note rather than throwing them at the caller.
 *
 * "Never throws" is a stronger claim than it looks, and this file used to fall short of it in two
 * ways (findings F-1 and F-2 on #105). A `TelemetryEvent` comes from a caller this package does not
 * control, so it can be an object whose `runId` is a getter that throws — which made the error
 * handler throw too, rejected the write, and then poisoned every write after it, because the queue
 * was chained with no rejection handler. And `createTeeSink` invoked its legs inside `Array.map`, so
 * a transport that threw *synchronously* rejected the caller and, if it sat before the disk sink in
 * the array, stopped the disk sink being invoked at all. Both are now closed: untrusted values are
 * read exactly once at the public boundary, the queue continues from a step that provably cannot
 * reject, and each tee leg runs inside its own guard with a timeout.
 *
 * "Push over /api/remote.mux, never poll" is E8's seam. `SessionTelemetrySink` is the shape that
 * transport plugs into, and `createTeeSink` is how a run writes to it and to disk at the same time.
 * Nothing in this package opens a socket: the file sink is what works today with no transport at
 * all, which is the property that makes it useful when the fleet is wedged.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { planRotation, type Rename, type RotationPlan, type RotationPolicy } from "./rotation.js";

/** A single telemetry record. Free-form on purpose: the sink is a pipe, not a schema authority. */
export interface TelemetryEvent {
  /** ISO 8601, supplied by the caller so a replayed batch keeps its original times. */
  readonly at: string;
  /** The run this belongs to, so records can be grouped without ordering assumptions. */
  readonly runId: string;
  readonly kind: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface SessionTelemetrySink {
  /** Record one event. Never throws: a failed write is a note, not an exception. */
  write(event: TelemetryEvent): Promise<void>;
  /** Everything the sink could not do, in order. Empty means every write landed. */
  readonly notes: readonly string[];
}

/** The convention on `ai-agents`: hot logs next to the other daemons, cold ones in `~/archives`. */
export interface FileSinkOptions {
  /** Directory for the live log. `~/observability` in production. */
  readonly directory: string;
  /** Where an evicted generation goes. When absent, an evicted generation is deleted. */
  readonly archiveDirectory?: string;
  readonly policy: RotationPolicy;
}

const encoder = new TextEncoder();

/** Byte length, not character length: the bound is on the file, and the file is UTF-8. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * The run id, read once and defensively, for use in notes.
 *
 * `event` is whatever a caller passed. Reading `runId` a second time in an error path is how the
 * error path itself came to throw, so every note in this file uses the value captured here.
 */
function safeRunId(event: TelemetryEvent): string {
  try {
    const id: unknown = (event as { readonly runId?: unknown }).runId;
    return typeof id === "string" && id.length > 0 ? id : "an unidentified run";
  } catch {
    // A `runId` that cannot be read is exactly the case this function exists for.
    return "an unidentified run";
  }
}

/**
 * A short reason for a note, preferring the error code over the message.
 *
 * Filesystem messages carry the full path, and a note is printed, piped and published — the same
 * reasoning as the paths removed from the backfill notes in F-5. `EACCES` is what an operator acts
 * on; `/home/agent/observability/dsh-telemetry.jsonl` is not this package's to hand out.
 */
function reason(error: unknown): string {
  try {
    const code: unknown = (error as { readonly code?: unknown } | null)?.code;
    if (typeof code === "string" && code.length > 0) return code;
    const message: unknown = (error as { readonly message?: unknown } | null)?.message;
    if (typeof message === "string" && message.length > 0) return message;
    return String(error);
  } catch {
    // A thrown value whose own `message` or `toString` throws. It has happened once already.
    return "unprintable error";
  }
}

/** A cold-tier name no other rotation can take, in this process or any other. */
let archiveCounter = 0;

/**
 * Stamp an evicted generation so it cannot overwrite an earlier one.
 *
 * The stamp used to be `Date.now()` alone. Five rotations inside a single millisecond kept three
 * records and silently overwrote two (finding F-3 on #105). The counter separates rotations within
 * this process; the random suffix separates this process from every other one writing the same
 * archive directory, which is the normal case on a box running a fleet.
 */
function archiveName(name: string): string {
  archiveCounter += 1;
  const stamp = `${Date.now()}-${archiveCounter}-${randomUUID().slice(0, 8)}`;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}-${stamp}`;
  return `${name.slice(0, dot)}-${stamp}${name.slice(dot)}`;
}

/** How long a lock may be held before it is taken to belong to a process that is gone. */
const STALE_LOCK_MS = 30_000;
/** How long a writer waits for someone else's lock before giving up and writing without one. */
const LOCK_WAIT_MS = 5_000;
/** How often a waiting writer retries. Short, because rotation is measured in milliseconds. */
const LOCK_POLL_MS = 10;

/**
 * `held` — this writer owns the lock and must release it.
 * `contended` — someone else holds it and would not let go; write anyway, and say so.
 * `unavailable` — the lock could not be created for a reason that is not contention. The append is
 * about to fail the same way and will report it, so this case stays quiet rather than saying the
 * same thing twice.
 */
type LockState = "held" | "contended" | "unavailable";

/**
 * A JSONL sink under a byte bound, with generations rotated out to a cold tier.
 *
 * Writes are serialized twice over. In-process, through a promise chain: two concurrent appends
 * that each read the current size would each decide not to rotate, and the bound would be a
 * suggestion. Across processes, through a lock *directory* next to the live file, because `mkdir`
 * is the one atomic create every filesystem agrees on. The chain alone was not enough — thirty-two
 * sinks on the same path produced a 3,478-byte file under a 220-byte policy, with no note
 * (finding F-3 on #105) — and on this box the fleet is many processes by construction.
 *
 * Rotation is failure-atomic in the only sense that matters here: it stops at the first move it
 * cannot make and says so, and it never truncates the live file. It used to blank the live file
 * after discarding every rename error, which turned a failed rotation into silent data loss.
 */
export function createFileSink(options: FileSinkOptions): SessionTelemetrySink {
  const notes: string[] = [];
  const live = join(options.directory, options.policy.name);
  const lock = `${live}.lock`;
  let queue: Promise<void> = Promise.resolve();
  let ensured = false;

  const currentBytes = async (): Promise<number> => {
    try {
      return (await stat(live)).size;
    } catch {
      return 0; // Not yet created. An absent file is an empty one, not an error.
    }
  };

  const acquireLock = async (): Promise<LockState> => {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        await mkdir(lock); // Not recursive: an existing lock must be an error, not a success.
        return "held";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return "unavailable";
        // A holder that was killed leaves its directory behind, and no other process can tell the
        // difference except by age. Anything older than the window is broken rather than waited on
        // forever, because a wedged fleet is exactly when this tool has to keep working.
        const heldSince = await stat(lock).then(
          (s) => s.mtimeMs,
          () => null,
        );
        if (heldSince !== null && Date.now() - heldSince > STALE_LOCK_MS) {
          await rm(lock, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        if (Date.now() >= deadline) return "contended";
        await sleep(LOCK_POLL_MS);
      }
    }
  };

  /** Move one generation aside. `null` on success, and a reason when the move could not be made. */
  const moveGeneration = async (move: Rename): Promise<string | null> => {
    try {
      await rename(join(options.directory, move.from), join(options.directory, move.to));
      return null;
    } catch (error) {
      // A generation that was never created is not a failure; it simply is not there yet.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return reason(error);
    }
  };

  /** Send the oldest generation to the cold tier, or delete it when there is no cold tier. */
  const evict = async (name: string): Promise<string | null> => {
    const from = join(options.directory, name);
    const archive = options.archiveDirectory;
    try {
      if (archive === undefined) {
        await rm(from, { force: true });
        return null;
      }
      await mkdir(archive, { recursive: true });
      const to = join(archive, archiveName(name));
      try {
        await rename(from, to);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        // A rename across devices fails, and the cold tier may well be another mount.
        if (code !== "EXDEV") throw error;
        const { copyFile } = await import("node:fs/promises");
        await copyFile(from, to);
        await rm(from, { force: true });
      }
      return null;
    } catch (error) {
      return reason(error);
    }
  };

  /**
   * Apply a rotation plan, stopping at the first move that fails.
   *
   * Stopping is the point. Every move either happened or did not, so an abandoned rotation leaves
   * the generations in a readable state and loses nothing; carrying on past a failure and then
   * blanking the live file is what lost a record with `notes: []` in the review.
   */
  const rotate = async (plan: RotationPlan, runId: string): Promise<void> => {
    const abandoned = (what: string, why: string): void => {
      notes.push(
        `rotation abandoned before writing ${runId}: could not ${what} (${why}) — the record is appended to the live file, which is now over the bound`,
      );
    };

    if (plan.evicted !== null) {
      const failed = await evict(plan.evicted);
      if (failed !== null) return abandoned(`evict ${plan.evicted}`, failed);
    }
    for (const move of plan.renames) {
      const failed = await moveGeneration(move);
      if (failed !== null) return abandoned(`move ${move.from} to ${move.to}`, failed);
    }
  };

  const step = async (event: TelemetryEvent, runId: string): Promise<void> => {
    const line = `${JSON.stringify(event)}\n`;
    const size = byteLength(line);

    if (!ensured) {
      await mkdir(options.directory, { recursive: true });
      ensured = true;
    }

    const lockState = await acquireLock();
    if (lockState === "contended") {
      notes.push(
        `could not take the rotation lock within ${LOCK_WAIT_MS} ms — ${runId} was written without it, so the bound may be breached`,
      );
    }

    try {
      const before = await currentBytes();
      const plan = planRotation(options.policy, before, size);

      if (plan.oversizedRecord) {
        // Saying so is the whole point: a dropped record that nobody hears about is the failure
        // mode this package exists to delete.
        notes.push(
          `record for ${runId} is ${size} bytes, over the ${options.policy.maxBytes}-byte bound — written whole, so the live file holds one line over the bound`,
        );
      }
      // An oversized record still rotates when there is something to preserve. The generation on
      // disk is a complete one and rolling it out is what keeps it complete; only an already-empty
      // live file is left alone, because rotating it would produce an empty generation and evict a
      // real one for nothing.
      if (plan.rotate && (!plan.oversizedRecord || before > 0)) await rotate(plan, runId);

      // No truncation. After a successful rotation the live file has been renamed away and this
      // creates it; after an abandoned one it still holds records, and blanking it would destroy
      // them to enforce a bound that has already been breached and reported.
      await appendFile(live, line, "utf8");
    } finally {
      if (lockState === "held") await rm(lock, { recursive: true, force: true }).catch(() => {});
    }
  };

  /** The one thing chained onto the queue. Total by construction, so the chain cannot be poisoned. */
  const runStep = async (event: TelemetryEvent, runId: string): Promise<void> => {
    try {
      await step(event, runId);
    } catch (error) {
      notes.push(`sink write failed for ${runId}: ${reason(error)}`);
    }
  };

  return {
    notes,
    write(event: TelemetryEvent): Promise<void> {
      // Read once, here, before anything can be re-read in an error path.
      const runId = safeRunId(event);
      const done = queue.then(() => runStep(event, runId));
      queue = done;
      return done;
    },
  };
}

/**
 * A sink that keeps everything in memory.
 *
 * Not a test double. A backfill run needs somewhere to put records it is only about to summarize,
 * and writing them to disk first would make `dsh-telemetry status` mutate the log it reads.
 */
export function createMemorySink(): SessionTelemetrySink & { readonly events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = [];
  return {
    events,
    notes: [],
    write(event: TelemetryEvent): Promise<void> {
      events.push(event);
      return Promise.resolve();
    },
  };
}

/** How long a tee leg may take before the tee stops waiting for it and notes that it did. */
export const DEFAULT_TEE_TIMEOUT_MS = 5_000;

export interface TeeOptions {
  /** Milliseconds a single leg may take. Zero or non-finite waits forever, which is a choice. */
  readonly timeoutMs?: number;
}

/**
 * Race a leg against the clock, without letting a late settle become an unhandled rejection.
 *
 * The timer is deliberately *not* unreferenced. Unreferencing it looks like the tidy choice — a
 * transport that never answers should not hold a process open — but it inverts the guarantee: with
 * nothing else pending, the loop drains, the timer never fires, and the write that was supposed to
 * time out never settles at all. A referenced timer can delay exit by at most `timeoutMs`, and it
 * is cleared the moment the leg settles.
 */
function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return work;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`did not settle within ${ms} ms`));
    }, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(reason(error)));
      },
    );
  });
}

/**
 * Fan out to several sinks, so a run can write to disk and to a transport at once.
 *
 * Failure of one must not deprive the others: this is exactly the case where the local file is the
 * only thing that survives, because the transport is down for the same reason the run is wedged.
 *
 * Three things make that true, and the first two were missing (finding F-2 on #105). Each leg is
 * invoked inside its own guard, so a sink that throws synchronously cannot stop the legs after it
 * in the array from being called — array order must not decide whether the disk write happens. Each
 * leg is raced against `timeoutMs`, so a transport that never settles cannot hang the run that is
 * writing to it. And a failing leg is named by its index, because that is what identifies it to
 * whoever configured the tee: a transport's own error text says what went wrong, not which of them
 * it was.
 */
export function createTeeSink(
  sinks: readonly SessionTelemetrySink[],
  options: TeeOptions = {},
): SessionTelemetrySink {
  const notes: string[] = [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEE_TIMEOUT_MS;

  const attempt = async (sink: SessionTelemetrySink, event: TelemetryEvent, index: number) => {
    try {
      await withTimeout(sink.write(event), timeoutMs);
    } catch (error) {
      notes.push(`tee: sink ${index} did not take the record (${reason(error)})`);
    }
  };

  return {
    get notes() {
      return [...notes, ...sinks.flatMap((s) => s.notes)];
    },
    async write(event: TelemetryEvent): Promise<void> {
      // Invoked first, awaited second, and `attempt` never rejects: every leg is called even when
      // an earlier one throws on the way in.
      await Promise.all(sinks.map((sink, index) => attempt(sink, event, index)));
    },
  };
}

/** Directory the file sink defaults to. `~/observability` on `ai-agents`, alongside the daemons. */
export function defaultObservabilityDir(home: string): string {
  return join(home, "observability");
}

/** The cold tier. Rotated generations land here rather than being deleted. */
export function defaultArchiveDir(home: string): string {
  return join(home, "archives");
}

/** The bound the fleet runs under: 32 MiB live, four generations kept, then the cold tier. */
export const DEFAULT_POLICY: RotationPolicy = {
  name: "dsh-telemetry.jsonl",
  maxBytes: 32 * 1024 * 1024,
  maxGenerations: 4,
};
