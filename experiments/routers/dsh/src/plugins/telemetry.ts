/**
 * `ctx.harnessTelemetry` — where run evidence is written, resolved once.
 *
 * E9 · #39 is the "status ?" killer: the reason the owner asks an orchestrator for a status update
 * is that nothing durable answers the question. `@rickylabs/telemetry` already builds the answer.
 * What it cannot do on its own is decide *where* — the observability directory comes from the
 * environment, with several overrides, and resolving it is not idempotent across a log rotation.
 *
 * That is the whole reason this is a service rather than an import. `resolveObservability` reads
 * `process.env` and falls back to `~/observability`; call it twice around a rotation and the two
 * answers differ. A snapshot taken from one path while the sink writes to another is not a wrong
 * number — it is a confident, empty board, which is worse. Resolving at boot and handing the same
 * `Observability` to every caller makes that impossible for the life of the fiber.
 *
 * Rotation is `planRotation`'s job and stays there. When a deployment rotates, the fiber is
 * reloaded, which is the point at which a new resolution is correct.
 *
 * ## Why the sink is opened here, once
 *
 * The service carries the sink as well as the snapshot, for the same reason it carries the resolved
 * paths: a writer and a reader that disagree about the directory produce a confident, empty board.
 * Opening it at construction is safe because `createFileSink` touches no filesystem at
 * construction — it computes two paths and an empty queue, and the directory is created on the
 * first append. Asking where telemetry *would* go must never itself create a directory.
 *
 * One sink rather than one per caller is also deliberate. The sink serialises its appends through
 * its own queue; two sinks over one file would each hold that guarantee only for their own writes.
 */

import { homedir } from "node:os";

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import {
  buildSnapshot,
  openObservabilitySink,
  resolveObservability,
  type Observability,
  type SessionTelemetrySink,
  type SnapshotInput,
  type TelemetrySnapshot,
} from "@rickylabs/telemetry";

/** Where this service attaches. Prefixed so it cannot collide with a service dsh adds later. */
export const CONTEXT_KEY = "harnessTelemetry" as const;

/** Row id in `cordis.patch.yml`. */
export const name = "harness-telemetry";

/** What a deployment may set on the `harness-telemetry` row. */
export interface TelemetryConfig {
  /**
   * Home directory the observability paths hang off. Empty means "ask the OS".
   *
   * Spelled as a config key rather than read straight from `homedir()` because the daemon runs as
   * a service account on the N5 whose home is not the operator's, and the paths in a receipt have
   * to be the paths someone can `cat`.
   */
  readonly home: string;
}

export const Config = z.object({
  home: z
    .string()
    .default("")
    .description("Home directory the observability paths hang off. Empty resolves to the OS home."),
});

/** The telemetry seam. */
export interface TelemetryService {
  /** The home the paths were resolved against. Recorded so a receipt can say where it looked. */
  readonly home: string;
  /** Directories, log paths and any notes the resolution produced. Fixed for this fiber. */
  readonly observability: Observability;
  /**
   * Where run evidence is appended, opened against the paths above.
   *
   * Never throws: a failed write is a note on the sink, not an exception, so a caller may await it
   * on a hot path without turning a telemetry problem into a work failure.
   */
  readonly sink: SessionTelemetrySink;
  /** Build a snapshot. Pure; here so callers reach the sink and the snapshot through one service. */
  snapshot(input: SnapshotInput): TelemetrySnapshot;
}

/** Fill in what the patch row left out. Empty and absent mean the same thing on purpose. */
export function resolveHome(config: Partial<TelemetryConfig> | undefined): string {
  const configured = config?.home ?? "";
  return configured === "" ? homedir() : configured;
}

/**
 * Build the service without a context, so it can be tested without booting cordis.
 *
 * `env` is a parameter rather than a direct `process.env` read for the same reason: the resolution
 * has environment overrides, and a test that cannot set them can only assert the default.
 */
export function createService(
  config: Partial<TelemetryConfig> | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): TelemetryService {
  const home = resolveHome(config);
  const observability = resolveObservability(home, env);
  return {
    home,
    observability,
    sink: openObservabilitySink(observability),
    snapshot(input) {
      return buildSnapshot(input);
    },
  };
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    harnessTelemetry: TelemetryService;
  }
}

export function apply(ctx: Context, config?: Partial<TelemetryConfig>): void {
  ctx.provide(CONTEXT_KEY, createService(config));
}

export default { name, Config, apply };
