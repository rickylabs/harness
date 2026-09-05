/**
 * `SessionTelemetrySink` — the thing a run writes to as it works.
 *
 * The sink is deliberately the dumbest possible interface: one method, one record, no return value
 * worth branching on. A run must never fail because telemetry did, and an orchestrator must never
 * be able to make progress conditional on the sink having accepted something. Every implementation
 * here therefore swallows its own IO errors into a note rather than throwing them at the caller.
 *
 * "Push over /api/remote.mux, never poll" is E8's seam. `SessionTelemetrySink` is the shape that
 * transport plugs into, and `createTeeSink` is how a run writes to it and to disk at the same time.
 * Nothing in this package opens a socket: the file sink is what works today with no transport at
 * all, which is the property that makes it useful when the fleet is wedged.
 */

import { appendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { planRotation, type RotationPolicy } from "./rotation.js";

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
 * A JSONL sink under a byte bound, with generations rotated out to a cold tier.
 *
 * Writes are serialized through a promise chain rather than a lock, because two concurrent
 * appends that each read the current size would each decide not to rotate, and the bound would be
 * a suggestion. The chain costs nothing at this volume and makes the bound true.
 */
export function createFileSink(options: FileSinkOptions): SessionTelemetrySink {
  const notes: string[] = [];
  const live = join(options.directory, options.policy.name);
  let queue: Promise<void> = Promise.resolve();
  let ensured = false;

  const currentBytes = async (): Promise<number> => {
    try {
      return (await stat(live)).size;
    } catch {
      return 0; // Not yet created. An absent file is an empty one, not an error.
    }
  };

  const evict = async (name: string): Promise<void> => {
    const from = join(options.directory, name);
    const archive = options.archiveDirectory;
    if (archive === undefined) {
      await rm(from, { force: true });
      return;
    }
    await mkdir(archive, { recursive: true });
    // Stamped, because the cold tier holds many generations of the same name.
    const to = join(archive, name.replace(/(\.[^.]+)$/, `-${Date.now()}$1`));
    await rename(from, to).catch(async (error: unknown) => {
      // A rename across devices fails, and the cold tier may well be another mount.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      const { copyFile } = await import("node:fs/promises");
      await copyFile(from, to);
      await rm(from, { force: true });
    });
  };

  const step = async (event: TelemetryEvent): Promise<void> => {
    const line = `${JSON.stringify(event)}\n`;
    const size = byteLength(line);

    if (!ensured) {
      await mkdir(options.directory, { recursive: true });
      ensured = true;
    }

    const plan = planRotation(options.policy, await currentBytes(), size);
    if (plan.oversizedRecord) {
      // Saying so is the whole point: a dropped record that nobody hears about is the failure mode
      // this package exists to delete.
      notes.push(
        `record for run ${event.runId} is ${size} bytes, over the ${options.policy.maxBytes}-byte bound — written anyway, the bound is breached for one line`,
      );
    }
    if (plan.rotate && !plan.oversizedRecord) {
      if (plan.evicted !== null) await evict(plan.evicted).catch(() => {});
      for (const move of plan.renames) {
        await rename(join(options.directory, move.from), join(options.directory, move.to)).catch(
          () => {},
        );
      }
      await writeFile(live, "", "utf8");
    }
    await appendFile(live, line, "utf8");
  };

  return {
    notes,
    write(event: TelemetryEvent): Promise<void> {
      queue = queue.then(async () => {
        try {
          await step(event);
        } catch (error) {
          notes.push(`sink write failed for run ${event.runId}: ${String(error)}`);
        }
      });
      return queue;
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

/**
 * Fan out to several sinks, so a run can write to disk and to a transport at once.
 *
 * Failure of one must not deprive the others: this is exactly the case where the local file is the
 * only thing that survives, because the transport is down for the same reason the run is wedged.
 */
export function createTeeSink(sinks: readonly SessionTelemetrySink[]): SessionTelemetrySink {
  const notes: string[] = [];
  return {
    get notes() {
      return [...notes, ...sinks.flatMap((s) => s.notes)];
    },
    async write(event: TelemetryEvent): Promise<void> {
      const settled = await Promise.allSettled(sinks.map((s) => s.write(event)));
      for (const result of settled) {
        if (result.status === "rejected") notes.push(`tee: ${String(result.reason)}`);
      }
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
