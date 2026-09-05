/**
 * The parts of JSONL transcript reading that every seam needs to get right the same way.
 *
 * Two rules live here because getting either one wrong in one seam and right in another is worse
 * than getting it wrong everywhere — an operator would learn to trust the output on Mondays.
 *
 * 1. A line that is not a JSON object is not a record. `JSON.parse` happily returns `null`, `7`,
 *    `"x"` and `[]`, and a parser that casts the result to its record interface and reaches for a
 *    field throws a `TypeError` on the first of those. One `null` line in one transcript took down
 *    all three seams and made `status` exit 1 (finding F-4 on #105).
 * 2. Degradation is counted and reported. A tolerated line is still a line this package could not
 *    read, and a run whose history is missing a third of its turns must not present itself as a
 *    complete one (finding F-9). Notes carry a reason and a count, never file content.
 */

/** The largest millisecond value `Date` represents. Past it, `toISOString` throws a `RangeError`. */
export const MAX_TIME_MS = 8_640_000_000_000_000;

/**
 * Convert epoch milliseconds to ISO 8601, or `null` when the value cannot be a real timestamp.
 *
 * The range check is the point. `resets_at` and `time_updated` come out of files this package does
 * not write, and `new Date(1e20).toISOString()` throws rather than returning something wrong — so a
 * single absurd number in one vendor record would otherwise end the whole scan.
 */
export function isoFromMillis(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // A non-positive value is a missing value written as a zero, not a moment in 1970.
  if (value <= 0 || value > MAX_TIME_MS) return null;
  return new Date(value).toISOString();
}

/** A JSON object, which is the only shape a transcript line is allowed to be. */
export type JsonObject = Readonly<Record<string, unknown>>;

/**
 * Parse one JSONL line into an object.
 *
 * Returns `null` both for text that is not JSON and for JSON that is not an object. The caller
 * cannot tell those apart from the return value, which is deliberate: it should count them
 * separately only if it means to report them separately, and `parseLineWithReason` exists for that.
 */
export function parseLine(raw: string): JsonObject | null {
  return parseLineWithReason(raw).line;
}

/** The reasons a line yields no record, as they appear in notes. */
export const NOT_JSON = "not valid JSON";
export const NOT_AN_OBJECT = "not a JSON object";

/** Parse one line, reporting which of the two failures happened. */
export function parseLineWithReason(raw: string): {
  readonly line: JsonObject | null;
  readonly reason: string | null;
} {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // A live transcript's last line is routinely half-written; that is normal, not corruption.
    return { line: null, reason: NOT_JSON };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { line: null, reason: NOT_AN_OBJECT };
  }
  return { line: value as JsonObject, reason: null };
}

/** Something this package could not read, and how much of it there was. */
export interface ParseNote {
  /** A stable, content-free reason. Two transcripts that degraded the same way say the same words. */
  readonly reason: string;
  /** How many lines in this transcript hit it. */
  readonly lines: number;
}

/** What a transcript parser returns: what it recovered, and what it could not. */
export interface ParsedTranscript<T> {
  readonly run: T | null;
  readonly notes: readonly ParseNote[];
}

/** Count degradations by reason while parsing, so one note covers a thousand bad lines. */
export class NoteTally {
  readonly #counts = new Map<string, number>();

  bump(reason: string): void {
    this.#counts.set(reason, (this.#counts.get(reason) ?? 0) + 1);
  }

  /** Sorted by reason, so the same transcript produces the same notes in the same order. */
  notes(): readonly ParseNote[] {
    return [...this.#counts]
      .map(([reason, lines]) => ({ reason, lines }))
      .sort((a, b) => (a.reason === b.reason ? 0 : a.reason < b.reason ? -1 : 1));
  }
}

/**
 * Render a record's `type` field for a note.
 *
 * The value comes from a file this package does not write, and the note it lands in is printed and
 * may be published, so it is bounded in both length and alphabet. A schema token survives intact; a
 * paragraph someone put in a `type` field does not become output.
 */
export function typeLabel(value: unknown): string {
  if (typeof value !== "string") return typeof value === "undefined" ? "(absent)" : "(not a string)";
  const safe = value.replace(/[^A-Za-z0-9_.:/-]/g, "?").slice(0, 40);
  return safe.length === 0 ? "(empty)" : safe;
}
