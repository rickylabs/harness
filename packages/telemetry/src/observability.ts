/**
 * Where telemetry lands on the box, and what a caller that is not Node may push into it.
 *
 * `sink.ts` can write a bounded, rotated log to any directory, and it names `~/observability` and
 * `~/archives` as the right ones. Nothing opened it. A default path constant that no command ever
 * uses is not an observability sink — it is a plan for one — so this module is the resolution step
 * between "the convention on `ai-agents`" and a sink an operator can actually append to.
 *
 * Two properties drive the shape.
 *
 * The location is settled *before* anything is written, and every way it could have been misread is
 * reported rather than absorbed. A telemetry log that quietly went somewhere else, or quietly ran
 * under a different bound because `DSH_TELEMETRY_MAX_BYTES=32MB` did not parse, is worse than no log:
 * it is a log the operator trusts. So `resolveObservability` is pure, returns its notes, and never
 * touches a disk.
 *
 * And the writer has to be reachable from things that are not this process. The fleet's other
 * daemons are a Go dispatcher, shell hooks and tmux wrappers; they cannot import a `SessionTelemetrySink`.
 * What they can do is emit a line of JSON, which is why `parseEvents` exists and why the boundary is
 * JSONL rather than a function call.
 */

import { isAbsolute, join, resolve } from "node:path";

import {
  createFileSink,
  defaultArchiveDir,
  defaultObservabilityDir,
  DEFAULT_POLICY,
  type SessionTelemetrySink,
  type TelemetryEvent,
} from "./sink.js";
import { generationName, type RotationPolicy } from "./rotation.js";

/** The environment variables that move the log, named once so the CLI and the notes agree. */
export const ENV = {
  directory: "DSH_TELEMETRY_DIR",
  archive: "DSH_TELEMETRY_ARCHIVE",
  maxBytes: "DSH_TELEMETRY_MAX_BYTES",
  generations: "DSH_TELEMETRY_GENERATIONS",
} as const;

/** The value of `DSH_TELEMETRY_ARCHIVE` that means "keep no cold tier", rather than a path. */
export const NO_ARCHIVE = "none";

export interface Observability {
  /** Absolute directory holding the live log and its rotated generations. */
  readonly directory: string;
  /** Absolute cold tier, or `null` when an evicted generation is to be deleted instead. */
  readonly archiveDirectory: string | null;
  readonly policy: RotationPolicy;
  /** Everything about the resolution that was not what the environment asked for. */
  readonly notes: readonly string[];
}

/** A size, in bytes or with a binary suffix: `32M` and `33554432` are the same bound. */
const SIZE = /^(\d+)([kmg])?$/i;
const MULTIPLIER: Readonly<Record<string, number>> = { k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 };

/**
 * Parse a byte bound, or say why not.
 *
 * Suffixes are accepted because the bound is going into a unit file or a shell profile by hand, and
 * `33554432` is a number nobody can check at a glance. `32MB` is *not* accepted: silently reading a
 * trailing `B` invites `32Mb`, `32 MB` and eventually a value that means something else than it
 * looks like. Refusing loudly is cheap here — the default is right for the fleet.
 */
export function parseBytes(raw: string): { readonly bytes: number } | { readonly problem: string } {
  const match = SIZE.exec(raw.trim());
  if (match === null) return { problem: `expected a byte count like 33554432 or 32M, got ${raw}` };
  const digits = match[1] ?? "";
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === undefined ? 1 : (MULTIPLIER[suffix] ?? 1);
  const bytes = Number(digits) * scale;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    return { problem: `expected a positive byte count, got ${raw}` };
  }
  return { bytes };
}

/** A count of generations to keep. Zero is a real answer: rotate, and keep nothing. */
function parseCount(raw: string): { readonly count: number } | { readonly problem: string } {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { problem: `expected a whole number, got ${raw}` };
  const count = Number(trimmed);
  if (!Number.isSafeInteger(count)) return { problem: `number is too large: ${raw}` };
  return { count };
}

/** An environment value that is present and not blank. An empty variable is an unset one. */
function set(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Decide where this box's telemetry log lives, from the home directory and the environment.
 *
 * Pure, and absolute: a relative `DSH_TELEMETRY_DIR` is resolved against the working directory here
 * rather than at append time, so the path printed by `where` is the path written to even when the
 * caller later changes directory — which a long-lived daemon does.
 */
export function resolveObservability(
  home: string,
  env: Readonly<Record<string, string | undefined>> = {},
): Observability {
  const notes: string[] = [];

  const dirOverride = set(env[ENV.directory]);
  const directory =
    dirOverride === null
      ? defaultObservabilityDir(home)
      : isAbsolute(dirOverride)
        ? dirOverride
        : resolve(dirOverride);

  const archiveOverride = set(env[ENV.archive]);
  let archiveDirectory: string | null;
  if (archiveOverride === null) {
    archiveDirectory = defaultArchiveDir(home);
  } else if (archiveOverride.toLowerCase() === NO_ARCHIVE) {
    archiveDirectory = null;
  } else {
    archiveDirectory = isAbsolute(archiveOverride) ? archiveOverride : resolve(archiveOverride);
  }

  // The cold tier must not be the hot one: an evicted generation renamed into the directory it came
  // from would be picked up by the next rotation as a generation, and the bound would stop meaning
  // anything. Falling back to deletion keeps the bound true and says what it did.
  if (archiveDirectory !== null && archiveDirectory === directory) {
    notes.push(
      `${ENV.archive} names the same directory as the live log — evicted generations are deleted instead, because archiving into the live directory would defeat the bound`,
    );
    archiveDirectory = null;
  }

  let maxBytes = DEFAULT_POLICY.maxBytes;
  const rawBytes = set(env[ENV.maxBytes]);
  if (rawBytes !== null) {
    const parsed = parseBytes(rawBytes);
    if ("problem" in parsed) {
      notes.push(`${ENV.maxBytes} ignored (${parsed.problem}) — using ${humanBytes(maxBytes)}`);
    } else {
      maxBytes = parsed.bytes;
    }
  }

  let maxGenerations = DEFAULT_POLICY.maxGenerations;
  const rawCount = set(env[ENV.generations]);
  if (rawCount !== null) {
    const parsed = parseCount(rawCount);
    if ("problem" in parsed) {
      notes.push(`${ENV.generations} ignored (${parsed.problem}) — keeping ${maxGenerations}`);
    } else {
      maxGenerations = parsed.count;
    }
  }

  return {
    directory,
    archiveDirectory,
    policy: { name: DEFAULT_POLICY.name, maxBytes, maxGenerations },
    notes,
  };
}

/** The file being appended to right now. Everything else on the box is a rotated generation. */
export function livePath(o: Observability): string {
  return join(o.directory, o.policy.name);
}

/**
 * The live file, and the generations behind it, oldest last.
 *
 * Named through `generationName` rather than reimplemented, so `where` cannot come to print a set of
 * paths that rotation does not use — the one thing this command exists to be trusted about.
 */
export function logPaths(o: Observability): readonly string[] {
  const paths = [livePath(o)];
  for (let g = 1; g <= o.policy.maxGenerations; g += 1) {
    paths.push(join(o.directory, generationName(o.policy.name, g)));
  }
  return paths;
}

/**
 * Open the sink this box writes to.
 *
 * Separated from resolution so that a caller can look before it writes: `where` resolves and prints,
 * `record` resolves and opens. The sink creates the directory on its first append, not here, because
 * asking where telemetry would go must never itself create a directory.
 */
export function openObservabilitySink(o: Observability): SessionTelemetrySink {
  return o.archiveDirectory === null
    ? createFileSink({ directory: o.directory, policy: o.policy })
    : createFileSink({
        directory: o.directory,
        archiveDirectory: o.archiveDirectory,
        policy: o.policy,
      });
}

/** A bound a human can check at a glance, which is the only reason the suffix form is accepted. */
export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export interface ParsedEvents {
  readonly events: readonly TelemetryEvent[];
  readonly notes: readonly string[];
}

/** How many lines of a malformed batch are named individually before the rest are counted. */
export const EVENT_NOTE_CAP = 5;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Read a JSONL batch into events.
 *
 * A bad line loses that line and nothing else, and is named by its number — the same rule the board
 * item feed follows, for the same reason: a batch pushed by a shell hook at 03:00 is exactly when
 * losing the whole file over one truncated write is least affordable.
 *
 * A missing `at` is filled from `now` rather than refused. An `at` that is present and unparseable is
 * *also* filled from `now`, but it says so: a timestamp silently replaced is how a log comes to
 * disagree with itself about when something happened.
 */
export function parseEvents(text: string, now: string): ParsedEvents {
  const events: TelemetryEvent[] = [];
  const notes: string[] = [];
  let dropped = 0;
  let named = 0;

  // Named individually up to the cap, then counted. The cap is per *kind* of remark rather than on
  // the notes array, so a batch whose first five lines have an unreadable `at` still names the sixth
  // line that was dropped outright — the two say different things and one must not crowd out the
  // other.
  const drop = (line: number, why: string): void => {
    dropped += 1;
    if (named < EVENT_NOTE_CAP) {
      named += 1;
      notes.push(`line ${line} dropped: ${why}`);
    }
  };
  let remarked = 0;
  const remark = (note: string): void => {
    if (remarked < EVENT_NOTE_CAP) {
      remarked += 1;
      notes.push(note);
    }
  };

  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    if (raw.trim().length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      drop(line, "not JSON");
      continue;
    }
    const object = record(parsed);
    if (object === null) {
      drop(line, "not a JSON object");
      continue;
    }
    const runId = nonEmpty(object["runId"]);
    if (runId === null) {
      drop(line, "no runId");
      continue;
    }
    const kind = nonEmpty(object["kind"]);
    if (kind === null) {
      drop(line, "no kind");
      continue;
    }

    let at = now;
    const rawAt = object["at"];
    if (rawAt !== undefined) {
      const stamp = nonEmpty(rawAt);
      if (stamp !== null && Number.isFinite(Date.parse(stamp))) {
        at = stamp;
      } else {
        remark(`line ${line}: "at" is not a time — recorded as ${now}`);
      }
    }

    const detail = object["detail"] === undefined ? null : record(object["detail"]);
    if (object["detail"] !== undefined && detail === null) {
      remark(`line ${line}: "detail" is not an object — dropped, the event was kept`);
    }
    events.push(detail === null ? { at, runId, kind } : { at, runId, kind, detail });
  }

  if (dropped > named) {
    notes.push(`${dropped} line(s) dropped in total`);
  }
  return { events, notes };
}
