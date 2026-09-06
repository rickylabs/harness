/**
 * Reading and writing `supervision.json` — the record of what each pull has already been told.
 *
 * This file is ours, unlike `divybot.json` and unlike the dispatcher's `state.json`. That has one
 * consequence worth stating up front: **a key we do not recognise is reported**, the same rule
 * `ledger.ts` follows and for the same reason. A `conflictSHA:` that parses as nothing surfaces later
 * as a conflict forwarded on every single tick — true, and a long way from the typo that caused it.
 *
 * ## An absent file is a first tick, not a fault
 *
 * `loadSupervisionState` treats ENOENT as an empty state, so the first run on a fleet forwards
 * everything currently open and records it. That is the correct first tick — the agent has not been
 * told any of it — and it means the command is usable before anybody has written a file.
 *
 * ## Everything else in a corrupt file is a re-send, never a miss
 *
 * The fallbacks all point the same way: an unreadable field becomes *nothing recorded*, which makes
 * the note look new and forwards it again. The failure mode of a broken state file is therefore an
 * agent told something twice, not an agent never told. That direction is chosen; the reverse — a
 * malformed id silently counted as delivered — is the failure this whole module exists to prevent,
 * and it would be invisible from the outside.
 */

import { EMPTY_SEEN, EMPTY_STATE } from "./steer.js";
import type { SeenPull, SupervisionState } from "./steer.js";

/**
 * One thing wrong with the file, and where.
 *
 * The same two fields as `LedgerIssue` in `targets/ledger.ts`, and deliberately not the same type:
 * these are different documents read by different commands, and sharing the type would make every
 * change to one a change to both.
 */
export interface StateIssue {
  /** A dotted path into the document, or `""` for the document itself. */
  readonly path: string;
  readonly message: string;
}

/** Where the ledger lives when `--supervision` is not given. Beside the dispatcher's own config. */
export const SUPERVISION_FILE = "supervision.json";

export interface ParsedState {
  readonly state: SupervisionState;
  readonly issues: readonly StateIssue[];
}

const SEEN_KEYS = ["reviews", "checks", "conflictSha"] as const;
const STATE_KEYS = ["pulls"] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What `value` turned out to be, in words a reader can act on. */
const shapeOf = (value: unknown): string => {
  if (value === null) return "found null";
  if (Array.isArray(value)) return "found a list";
  return `found ${typeof value}`;
};

class Reader {
  readonly issues: StateIssue[] = [];

  say(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  /** A string field, or `""` — with the fallback named, since silence here means a re-send. */
  string(source: Record<string, unknown>, key: string, path: string): string {
    const value = source[key];
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      this.say(`${path}.${key}`, `expected a string, ${shapeOf(value)} — reading it as nothing recorded`);
      return "";
    }
    return value;
  }

  /** A list of ids. A non-list, or a non-string element, is dropped and named. */
  ids(source: Record<string, unknown>, key: string, path: string): readonly string[] {
    const value = source[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.say(`${path}.${key}`, `expected a list, ${shapeOf(value)} — reading it as nothing recorded`);
      return [];
    }
    const ids: string[] = [];
    value.forEach((element, index) => {
      if (typeof element !== "string") {
        this.say(`${path}.${key}[${String(index)}]`, `expected a string, ${shapeOf(element)} — dropped`);
        return;
      }
      ids.push(element);
    });
    return ids;
  }

  unknownKeys(source: Record<string, unknown>, known: readonly string[], path: string): void {
    for (const key of Object.keys(source)) {
      if (known.some((candidate) => candidate === key)) continue;
      this.say(path === "" ? key : `${path}.${key}`, "unknown key — nothing reads it");
    }
  }
}

/** Parse the document. Never throws: a file this cannot read is an empty state and a list of reasons. */
export function parseSupervisionState(text: string): ParsedState {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return {
      state: EMPTY_STATE,
      issues: [{ path: "", message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
  if (!isObject(payload)) {
    return {
      state: EMPTY_STATE,
      issues: [{ path: "", message: `expected a JSON object at the top level, ${shapeOf(payload)}` }],
    };
  }

  const reader = new Reader();
  reader.unknownKeys(payload, STATE_KEYS, "");

  const raw = payload["pulls"];
  const pulls = new Map<string, SeenPull>();
  if (raw !== undefined && raw !== null) {
    if (!isObject(raw)) {
      reader.say("pulls", `expected an object keyed by 'owner/name#123', ${shapeOf(raw)}`);
    } else {
      for (const [key, value] of Object.entries(raw)) {
        const path = `pulls[${key}]`;
        if (!isObject(value)) {
          reader.say(path, `expected an object, ${shapeOf(value)} — dropped, so this pull re-forwards`);
          continue;
        }
        reader.unknownKeys(value, SEEN_KEYS, path);
        pulls.set(key, {
          reviews: reader.ids(value, "reviews", path),
          checks: reader.ids(value, "checks", path),
          conflictSha: reader.string(value, "conflictSha", path),
        });
      }
    }
  }

  return { state: { pulls }, issues: reader.issues };
}

export interface LoadedState {
  readonly path: string;
  /** `false` when nothing is there — a first tick, not an error. */
  readonly found: boolean;
  readonly state: SupervisionState;
  readonly issues: readonly StateIssue[];
}

/** Injected so the parse is testable without a filesystem, matching `loadHandoverLedger`. */
export type StateReader = (path: string) => string;

/**
 * Read the file, treating a missing one as an empty state.
 *
 * ENOENT and ENOTDIR are the two ways "there is nothing there" arrives. Everything else — a
 * permission error, a directory where a file belongs — re-throws, because an unreadable state file
 * is not an empty one, and silently re-forwarding a fleet's whole review backlog because a mode bit
 * was wrong is not a recovery.
 */
export function loadSupervisionState(path: string, read: StateReader): LoadedState {
  let text: string;
  try {
    text = read(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { path, found: false, state: EMPTY_STATE, issues: [] };
    }
    throw error;
  }
  const { state, issues } = parseSupervisionState(text);
  return { path, found: true, state, issues };
}

/**
 * The state as a plain document, keys sorted.
 *
 * Sorted so two ticks that delivered the same things produce the same file. A state file that churns
 * on every write is one nobody can diff, and this one is the only durable record of what an agent has
 * been told. Exported separately from {@link serializeSupervisionState} so `--json` can carry the
 * *same* document it would write, rather than a second rendering of it that can drift.
 */
export function supervisionStateDocument(state: SupervisionState): { pulls: Record<string, SeenPull> } {
  const pulls: Record<string, SeenPull> = {};
  for (const key of [...state.pulls.keys()].sort()) {
    pulls[key] = state.pulls.get(key) ?? EMPTY_SEEN;
  }
  return { pulls };
}

/** The bytes to write once a tick's steering has actually been delivered. */
export const serializeSupervisionState = (state: SupervisionState): string =>
  `${JSON.stringify(supervisionStateDocument(state), null, 2)}\n`;

export const describeStateIssue = (issue: StateIssue): string =>
  issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`;
