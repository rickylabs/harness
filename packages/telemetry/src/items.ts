/**
 * Read the board items feed.
 *
 * This is the join between the two halves of the answer. The board projects GitHub; telemetry says
 * what ran; the two meet on an issue number, and they meet *here*, in a file, because a status
 * command that needs a GitHub token is a status command that fails exactly when the token is the
 * problem (see `cli.ts`).
 *
 * Two things this module exists to fix.
 *
 * **The feed did not compose.** `dsh-telemetry status --items` documented "JSON array of board
 * items" and `dsh-board snapshot` emits `{ items: [...] }` whose entries nest the GitHub fields
 * under `source` and carry `phase` as an object. Piping one into the other produced a file that
 * parsed, an array that was not empty, and refs with `number: undefined` — so every run came back
 * unattributed and the board looked idle. The reader below accepts both the envelope and the bare
 * array, and both the nested projection item and a flat hand-written ref.
 *
 * **The cast was not a check.** The old loader did `parsed as BoardItemRef[]` after confirming only
 * that the value was an array. `as` is a claim, not a test: it produced the same silent-empty-board
 * failure for any malformed feed. Everything here is a guard, and an entry that cannot be read is
 * dropped with a note that names its index — because a partly-read feed that says so is usable and
 * a partly-read feed that stays quiet is a lie about the board.
 */

import type { BoardItemRef, RefKind } from "./model.js";

/** Board items, and every reason the feed could not be read whole. */
export interface LoadedItems {
  readonly items: readonly BoardItemRef[];
  readonly notes: readonly string[];
  /** False when at least one entry was dropped, or the feed was not readable at all. */
  readonly ok: boolean;
}

/**
 * How many per-entry notes survive into the result.
 *
 * A feed of the wrong shape produces one note per entry, and four thousand notes above a status
 * screen is the same as no notes. The cap keeps the first few, which say what is wrong, and a tail
 * line that says how much more of it there is.
 */
const NOTE_CAP = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const kindOf = (value: unknown): RefKind | undefined =>
  value === "issue" || value === "pull-request" ? value : undefined;

const stateOf = (value: unknown): "open" | "closed" | undefined =>
  value === "open" || value === "closed" ? value : undefined;

/** A number that can address a GitHub item: a positive integer and nothing else. */
const issueNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/**
 * A list of item numbers, with the unusable entries dropped rather than the whole list.
 *
 * An empty result is returned as absent, so `closes: []` and no `closes` at all mean the same
 * thing — neither says this pull request delivers a task.
 */
function numberList(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const entry of value) {
    const n = issueNumber(entry);
    if (n !== undefined && !out.includes(n)) out.push(n);
  }
  return out.length === 0 ? undefined : out;
}

/**
 * The phase, from either encoding.
 *
 * The projection carries a `Phase` object whose `name` is the short column name (`impl-eval`); a
 * hand-written feed carries that string directly. `null` and absence both mean the item is in no
 * column, which is a real board state and not a parse failure.
 */
function phaseOf(value: unknown): string | null {
  const direct = str(value);
  if (direct !== undefined) return direct;
  if (isRecord(value)) return str(value["name"]) ?? str(value["label"]) ?? null;
  return null;
}

/**
 * Read one entry, from either shape.
 *
 * Only `number` is required. Everything else is carried when the feed has it and left absent when
 * it does not — never defaulted, because a defaulted `state: "open"` on an item nobody described is
 * an invention that reads exactly like a fact.
 */
export function toRef(raw: unknown): BoardItemRef | null {
  if (!isRecord(raw)) return null;
  const source = isRecord(raw["source"]) ? raw["source"] : undefined;
  const pick = (key: string): unknown => (key in raw ? raw[key] : source?.[key]);

  const number = issueNumber(raw["number"] ?? source?.["number"]);
  if (number === undefined) return null;

  const kind = kindOf(pick("kind"));
  const state = stateOf(pick("state"));
  const merged = bool(pick("merged"));
  const isEpic = bool(raw["isEpic"]);
  const closes = numberList(raw["closes"]);
  const url = str(pick("url"));
  const updatedAt = str(pick("updatedAt"));

  // Built by spreading rather than by assigning `undefined`, because `exactOptionalPropertyTypes`
  // draws the distinction this module depends on: an absent key means "the feed did not say", and
  // a present `undefined` would mean "the feed said nothing", which is a different claim.
  return {
    number,
    title: str(pick("title")) ?? "",
    epic: str(raw["epic"]) ?? null,
    milestone: str(pick("milestone")) ?? null,
    phase: phaseOf(raw["phase"]),
    ...(kind === undefined ? {} : { kind }),
    ...(state === undefined ? {} : { state }),
    ...(merged === undefined ? {} : { merged }),
    ...(isEpic === undefined ? {} : { isEpic }),
    ...(closes === undefined ? {} : { closes }),
    ...(url === undefined ? {} : { url }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

/** Pull the entry list out of whichever envelope the producer used. */
function entriesOf(parsed: unknown): readonly unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (isRecord(parsed) && Array.isArray(parsed["items"])) return parsed["items"];
  return null;
}

/**
 * Normalise a parsed feed into refs.
 *
 * `where` names the file in every note, because these notes are read on a screen that is also
 * showing notes from three transcript stores and a database.
 */
export function normaliseItems(parsed: unknown, where: string): LoadedItems {
  const entries = entriesOf(parsed);
  if (entries === null) {
    return {
      items: [],
      notes: [`${where} is neither a JSON array of items nor a board snapshot with an "items" array`],
      ok: false,
    };
  }

  const items: BoardItemRef[] = [];
  const seen = new Map<number, number>();
  const dropped: string[] = [];
  let duplicates = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const ref = toRef(entries[index]);
    if (ref === null) {
      dropped.push(`entry ${index} has no usable item number`);
      continue;
    }
    const first = seen.get(ref.number);
    if (first !== undefined) {
      // Kept: the first wins. Which one wins matters less than saying that a choice was made — a
      // feed with two #85s is a producer bug, and silently taking either one hides it.
      duplicates += 1;
      dropped.push(`entry ${index} repeats #${ref.number}, first seen at entry ${first} — kept the first`);
      continue;
    }
    seen.set(ref.number, index);
    items.push(ref);
  }

  const notes = dropped.slice(0, NOTE_CAP);
  if (dropped.length > notes.length) {
    notes.push(`${where}: ${dropped.length - notes.length} further entries had the same problems`);
  }
  if (notes.length > 0) notes.unshift(`${where}: ${dropped.length - duplicates} entries unreadable, ${duplicates} duplicated`);

  return { items, notes, ok: dropped.length === 0 };
}

/** Parse the feed's text. A file that is not JSON is a note, not a crash. */
export function parseItems(text: string, where: string): LoadedItems {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { items: [], notes: [`${where} is not valid JSON: ${String(error)}`], ok: false };
  }
  return normaliseItems(parsed, where);
}
