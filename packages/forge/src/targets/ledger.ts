/**
 * Reading `handover.json` — the parity ledger and the per-target pins.
 *
 * The same split as `model.ts` / `config.ts`: `handover.ts` is the decision, this is the bytes. One
 * rule differs, and it is the interesting one.
 *
 * **Unknown keys are reported here, and are not reported by `config.ts`.** That file reads a
 * document divybot owns, most of which is deliberately none of our business — `hosts`, `governor`,
 * `state_file` — so an unrecognised key there is normal. This file is ours, every key in it is read,
 * and the entire failure mode this ledger has is looking effective while doing nothing. An
 * `evidance:` that silently leaves `evidence` empty would be caught by `checkHandover`, but as
 * "records no evidence" — true, unhelpful, and three minutes from the actual typo. Naming the key is
 * the difference between a rule that reports and a rule that diagnoses.
 *
 * Nothing is coerced, for the reason `config.ts` gives: a `backend` that arrived as `["provider"]`
 * is a mistake to report, not a shape to unwrap.
 */

import type { Backend, BackendPin, HandoverLedger, ParityRecord } from "./handover.js";
import { BACKENDS, EMPTY_LEDGER } from "./handover.js";

/** One thing wrong with the *file*, as opposed to with the ledger it describes. */
export interface LedgerIssue {
  /** Dotted path to the offending value: `parity[1].evidence`, `pins[0].backend`. */
  readonly path: string;
  readonly message: string;
}

/** The outcome of a parse: whatever could be read, and everything that could not. */
export interface ParsedLedger {
  /** Never `null`: a document that is not an object yields the empty ledger plus one issue. */
  readonly ledger: HandoverLedger;
  readonly issues: readonly LedgerIssue[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return `a ${typeof value}`;
}

/** A field read that records what it found, and afterwards names every key it did not read. */
class Reader {
  readonly issues: LedgerIssue[] = [];

  say(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  string(source: Record<string, unknown>, key: string, path: string): string {
    const value = source[key];
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      this.say(`${path}.${key}`, `expected a string, found ${describeType(value)}`);
      return "";
    }
    return value;
  }

  /**
   * Every key of `source` that is not in `known`.
   *
   * Reported rather than refused: a ledger with a typo in one record still has correct records, and
   * an operator fixing it wants the whole list of what was ignored, not the first surprise.
   */
  unknownKeys(source: Record<string, unknown>, path: string, known: readonly string[]): void {
    for (const key of Object.keys(source)) {
      if (known.includes(key)) continue;
      this.say(path === "" ? key : `${path}.${key}`, "not a key this file has — the value is ignored");
    }
  }

  /** A list of objects, with each non-object element named individually and skipped. */
  rows(source: Record<string, unknown>, key: string): readonly (readonly [Record<string, unknown>, string])[] {
    const value = source[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.say(key, `expected a list, found ${describeType(value)}`);
      return [];
    }
    const out: (readonly [Record<string, unknown>, string])[] = [];
    value.forEach((element, index) => {
      const path = `${key}[${String(index)}]`;
      if (isObject(element)) out.push([element, path]);
      else this.say(path, `expected an object, found ${describeType(element)}`);
    });
    return out;
  }
}

const PARITY_KEYS = ["account", "provider", "provenAt", "evidence", "note"] as const;
const PIN_KEYS = ["label", "backend", "reason"] as const;
const LEDGER_KEYS = ["parity", "pins"] as const;

/**
 * Parse the ledger text.
 *
 * A `backend` that is neither `divybot` nor `provider` becomes `divybot` and an issue. Defaulting to
 * the *safe* value rather than dropping the pin matters: dropping it would leave the target on
 * whatever parity decided, which for a proven vendor is the provider path — so a typo in a
 * claw-back would silently fail to claw anything back. The direction of every fallback in this file
 * is toward the backend that is already verified.
 */
export function parseHandoverLedger(text: string): ParsedLedger {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ledger: EMPTY_LEDGER, issues: [{ path: "", message: `not valid JSON: ${detail}` }] };
  }
  if (!isObject(document)) {
    return {
      ledger: EMPTY_LEDGER,
      issues: [{ path: "", message: `expected a JSON object at the top level, found ${describeType(document)}` }],
    };
  }

  const read = new Reader();
  read.unknownKeys(document, "", LEDGER_KEYS);

  const parity: ParityRecord[] = read.rows(document, "parity").map(([source, path]) => {
    read.unknownKeys(source, path, PARITY_KEYS);
    return {
      account: read.string(source, "account", path),
      provider: read.string(source, "provider", path),
      provenAt: read.string(source, "provenAt", path),
      evidence: read.string(source, "evidence", path),
      note: read.string(source, "note", path),
    };
  });

  const pins: BackendPin[] = read.rows(document, "pins").map(([source, path]) => {
    read.unknownKeys(source, path, PIN_KEYS);
    return {
      label: read.string(source, "label", path),
      backend: readBackend(read, source, path),
      reason: read.string(source, "reason", path),
    };
  });

  return { ledger: { parity, pins }, issues: read.issues };
}

function readBackend(read: Reader, source: Record<string, unknown>, path: string): Backend {
  const raw = source["backend"];
  if (raw === undefined || raw === null) {
    read.say(`${path}.backend`, `no backend named — reading it as divybot (one of: ${BACKENDS.join(", ")})`);
    return "divybot";
  }
  if (typeof raw !== "string") {
    read.say(`${path}.backend`, `expected a string, found ${describeType(raw)} — reading it as divybot`);
    return "divybot";
  }
  if (!BACKENDS.some((backend) => backend === raw)) {
    read.say(
      `${path}.backend`,
      `${JSON.stringify(raw)} is not a backend (${BACKENDS.join(", ")}) — reading it as divybot`,
    );
    return "divybot";
  }
  return raw as Backend;
}

/** What a filesystem gives back, so the CLI can tell "no ledger" from "bad ledger". */
export interface LoadedLedger extends ParsedLedger {
  readonly path: string;
  /** `false` when nothing was there — which is today's state, not a fault. */
  readonly found: boolean;
}

/** Just enough of `node:fs` to read one file — the seam the suite substitutes. */
export interface LedgerReader {
  (path: string): string;
}

/**
 * Load and parse, treating a missing file as an answer.
 *
 * The strongest statement this module makes: a repository with no `handover.json` is a repository
 * where every target is dispatched by divybot, which is both the documented default and the state
 * the fleet is in today. Nothing has to be written for the current behaviour to be described.
 */
export function loadHandoverLedger(path: string, readFile: LedgerReader): LoadedLedger {
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    if (isMissing(error)) return { path, found: false, ledger: EMPTY_LEDGER, issues: [] };
    throw error;
  }
  return { path, found: true, ...parseHandoverLedger(text) };
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** One file issue as a line an operator can act on. */
export function describeLedgerIssue(issue: LedgerIssue): string {
  return issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`;
}
