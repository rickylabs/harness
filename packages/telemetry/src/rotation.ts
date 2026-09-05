/**
 * Bounded rotation, as a pure function.
 *
 * The sink writes next to `archiver.log`, `spare-reaper.log` and `codex-daemon.log` under
 * `~/observability/`, which is a directory on a box that also runs the agents. An unbounded
 * telemetry log is a way to take the fleet down with the tool that was supposed to explain it, so
 * the bound is not a nicety.
 *
 * The policy is separated from the filesystem because every interesting case here — the boundary
 * at exactly `maxBytes`, a single record larger than the whole budget, the oldest generation
 * falling off the end — is a case you want to test without a disk.
 */

/** One generation rename, applied oldest-first so nothing is overwritten before it is moved. */
export interface Rename {
  readonly from: string;
  readonly to: string;
}

/** What to do before appending the next record. */
export interface RotationPlan {
  /** `false` means append to the live file and do nothing else. */
  readonly rotate: boolean;
  /**
   * Renames in the order they must be applied — oldest first, and strictly *after* `evicted` has
   * been dealt with, because the first rename is the one that would overwrite it.
   */
  readonly renames: readonly Rename[];
  /**
   * The generation that fell off the end. `~/archives/` is the cold tier, so this is a file to be
   * moved there when an archive directory is configured, and only deleted when one is not. It must
   * be handled before `renames` are applied.
   */
  readonly evicted: string | null;
  /** Set when the record cannot fit in a whole generation, so rotating would not help. */
  readonly oversizedRecord: boolean;
}

export interface RotationPolicy {
  /** Base name of the live file, e.g. `runs.jsonl`. */
  readonly name: string;
  /** Rotate before a write that would take the live file past this many bytes. */
  readonly maxBytes: number;
  /** How many rotated generations to keep, not counting the live file. Zero keeps none. */
  readonly maxGenerations: number;
}

/** `runs.jsonl` at generation 2 is `runs.2.jsonl`; generation 0 is the live file. */
export function generationName(name: string, generation: number): string {
  if (generation <= 0) return name;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${generation}`;
  return `${name.slice(0, dot)}.${generation}${name.slice(dot)}`;
}

/**
 * Decide what must happen before `recordBytes` are appended to a live file of `currentBytes`.
 *
 * Rotation happens *before* the write that would breach the bound, not after one that already did:
 * a bound enforced after the fact is not a bound.
 *
 * The claim this supports is therefore narrower than "the live file never exceeds `maxBytes`", and
 * it is worth stating exactly, because the review found the wider version false in three ways
 * (finding F-3 on #105). What holds is: **the live file never exceeds `maxBytes` except by a single
 * record that is itself larger than `maxBytes`, which is written whole and announced in a note.**
 * Even that needs the sink to do its part — rotation cannot be decided by a pure function alone
 * when several processes append to one path, so `createFileSink` serializes read-size, decide,
 * rotate and append under a lock, and notes the breach when it cannot take one.
 */
export function planRotation(
  policy: RotationPolicy,
  currentBytes: number,
  recordBytes: number,
): RotationPlan {
  const fits = currentBytes + recordBytes <= policy.maxBytes;
  if (fits) {
    return { rotate: false, renames: [], evicted: null, oversizedRecord: false };
  }

  // A record larger than a whole generation is reported rather than silently dropped or silently
  // written. Rotating for it would produce an empty generation and still breach the bound; the
  // caller decides, and the plan says plainly that rotation is not the remedy.
  const oversizedRecord = recordBytes > policy.maxBytes;

  if (policy.maxGenerations <= 0) {
    return { rotate: true, renames: [], evicted: policy.name, oversizedRecord };
  }

  // Oldest first: N-1 -> N frees the slot that N-2 -> N-1 needs, and so on down to the live file.
  const renames: Rename[] = [];
  for (let g = policy.maxGenerations - 1; g >= 0; g -= 1) {
    renames.push({
      from: generationName(policy.name, g),
      to: generationName(policy.name, g + 1),
    });
  }
  return {
    rotate: true,
    renames,
    // The oldest kept generation is the one the first rename lands on, so it is the one that goes.
    evicted: generationName(policy.name, policy.maxGenerations),
    oversizedRecord,
  };
}
