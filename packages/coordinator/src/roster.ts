/**
 * Reading a roster off disk, where it arrives as `unknown` and has to be checked.
 *
 * The lesson is borrowed from the board item feed, which learned it the expensive way: a cast at a
 * file boundary is not a check. `parsed as Candidate[]` type-checks, runs, and produces a list of
 * objects whose every field is `undefined` — and a selection over that list is not a wrong answer,
 * it is a confident one. So every field is read and every entry that cannot be read is dropped **by
 * index**, with the rest of the roster kept: a coordinator that refuses the whole file over one
 * malformed line has turned a typo into an outage.
 *
 * `openWeights` is the one field with no default. Absent, it would have to be guessed, and both
 * guesses are wrong in a way that matters: `true` lets a closed model review over the public relay,
 * and `false` silently demotes a legal open one. A property that gates who may see a diff is not a
 * property to infer from silence.
 */

import type { Actor, Candidate, Seam } from "./independence.js";

export interface Roster {
  readonly author: Actor;
  readonly candidates: readonly Candidate[];
}

export interface ParsedRoster {
  /** `null` when there is no readable author — nothing can be selected without one. */
  readonly roster: Roster | null;
  readonly notes: readonly string[];
}

/** How many malformed entries are named individually before the rest are counted. */
export const ROSTER_NOTE_CAP = 5;

const SEAMS: readonly string[] = ["subscription", "relay"];

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function seam(value: unknown): Seam | null {
  const raw = text(value);
  return raw !== null && SEAMS.includes(raw) ? (raw as Seam) : null;
}

/** The fields an author and a candidate share. Returns the missing field's name on failure. */
function actor(source: Readonly<Record<string, unknown>>): Actor | { readonly missing: string } {
  const id = text(source["id"]);
  if (id === null) return { missing: "id" };
  const s = seam(source["seam"]);
  if (s === null) return { missing: `seam (expected ${SEAMS.join(" or ")})` };
  const family = text(source["family"]);
  if (family === null) return { missing: "family" };
  const model = text(source["model"]);
  if (model === null) return { missing: "model" };
  return { id, seam: s, family, model, effort: text(source["effort"]) };
}

/**
 * Read a roster document.
 *
 * `{ "author": {...}, "candidates": [...] }`. The envelope is required rather than accepting a bare
 * array, because a roster without an author is a list of models and this module's whole question is
 * "independent of *whom*".
 */
export function parseRoster(text_: string): ParsedRoster {
  const notes: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text_);
  } catch (error) {
    return { roster: null, notes: [`roster is not JSON: ${(error as Error).message}`] };
  }

  const document = object(parsed);
  if (document === null) {
    return { roster: null, notes: ['roster is not a JSON object — expected { "author": …, "candidates": […] }'] };
  }

  const authorSource = object(document["author"]);
  if (authorSource === null) {
    return { roster: null, notes: ['roster has no "author" object — there is nothing to be independent of'] };
  }
  const author = actor(authorSource);
  if ("missing" in author) {
    return { roster: null, notes: [`author is unreadable: no ${author.missing}`] };
  }

  const rawCandidates = document["candidates"];
  if (!Array.isArray(rawCandidates)) {
    return { roster: null, notes: ['roster has no "candidates" array'] };
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let named = 0;
  const drop = (index: number, why: string): void => {
    dropped += 1;
    if (named < ROSTER_NOTE_CAP) {
      named += 1;
      notes.push(`candidate ${index} dropped: ${why}`);
    }
  };

  for (const [index, raw] of rawCandidates.entries()) {
    const source = object(raw);
    if (source === null) {
      drop(index, "not a JSON object");
      continue;
    }
    const base = actor(source);
    if ("missing" in base) {
      drop(index, `no ${base.missing}`);
      continue;
    }
    const open = source["openWeights"];
    if (typeof open !== "boolean") {
      drop(index, `${base.id} declares no boolean "openWeights" — it gates review over the public relay and is never inferred`);
      continue;
    }
    // A duplicate id makes the rejection list ambiguous: two rows would name the same candidate with
    // possibly different reasons, and a reader could not tell which one was actually considered.
    if (seen.has(base.id)) {
      drop(index, `duplicate id ${base.id} — the first entry is kept`);
      continue;
    }
    seen.add(base.id);
    candidates.push({ ...base, openWeights: open, blockedBy: text(source["blockedBy"]) });
  }

  if (dropped > named) notes.push(`${dropped} candidate(s) dropped in total`);
  if (candidates.length === 0 && rawCandidates.length > 0) {
    notes.push("every candidate was unreadable — the roster is present but empty in effect");
  }

  return { roster: { author, candidates }, notes };
}
