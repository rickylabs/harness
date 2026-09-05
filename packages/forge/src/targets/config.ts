/**
 * Reading the dispatcher's own configuration file.
 *
 * Not a format of ours. `divybot.json` is the file the running dispatcher reads, and #74 asks for a
 * mapping "matching the existing divybot target shape" — the strongest available match is to read
 * the same bytes it does, rather than to define a second file that has to be kept in step with the
 * first by hand. Every JSON key below appears in `cmd/divybot/divybot.example.json`, and every
 * default applied here is applied by `loadConfig` in `cmd/divybot/main.go`.
 *
 * ## Two decisions worth stating
 *
 * **Defaults are applied at the parse, not at the point of use.** `loadConfig` fills in
 * `memory.repo` from the inbox, `memory.branch` from `main`, `memory.dir` from `memory` and
 * `memory.interval` from `5m` before anything reads them. Doing the same here means a rule about
 * the memory store is one rule rather than one rule plus a clause about the field being absent —
 * which matters, because the omission is the dangerous spelling (see `checkTargets`).
 *
 * **Nothing is coerced.** A `capacity` that arrived as `"6"` is not quietly turned into 6, and a
 * `targets` that arrived as an object is not wrapped in an array. The dispatcher is written in Go
 * and `encoding/json` refuses both; a parser here that accepted them would report a table healthy
 * that divybot will not start on. Every such case becomes a `ConfigIssue`, and the file still
 * parses as far as it can, because an operator fixing a config wants the whole list.
 */

import type { MemoryStore, Target, TargetTable } from "./model.js";
import { DEFAULT_TARGET_AGENT, agentsOf } from "./model.js";

/** The conventional name, and what `dsh-forge targets` looks for when `--config` is absent. */
export const CONFIG_FILE = "divybot.json";

/** One thing wrong with the *file*, as opposed to with the table it describes. */
export interface ConfigIssue {
  /** Dotted path to the offending value: `targets[2].agents[0]`, `memory.interval`. */
  readonly path: string;
  readonly message: string;
}

/** The outcome of a parse: whatever could be read, and everything that could not. */
export interface ParsedConfig {
  /** `null` only when the document is not a JSON object at all — there is nothing to salvage. */
  readonly table: TargetTable | null;
  readonly issues: readonly ConfigIssue[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A typed field read that records what it found rather than throwing on the first surprise.
 *
 * Absent and wrong-typed are deliberately different: absent takes the default silently, because
 * every optional key in the example config is legitimately absent somewhere. A wrong type is always
 * reported, because Go would have refused the whole file for it.
 */
class Reader {
  readonly issues: ConfigIssue[] = [];

  private say(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  string(source: Record<string, unknown>, key: string, path: string, fallback: string): string {
    const value = source[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "string") {
      this.say(path, `expected a string, found ${describeType(value)}`);
      return fallback;
    }
    return value;
  }

  boolean(source: Record<string, unknown>, key: string, path: string, fallback: boolean): boolean {
    const value = source[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "boolean") {
      this.say(path, `expected true or false, found ${describeType(value)}`);
      return fallback;
    }
    return value;
  }

  integer(source: Record<string, unknown>, key: string, path: string, fallback: number): number {
    const value = source[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      this.say(path, `expected a whole number, found ${describeType(value)}`);
      return fallback;
    }
    return value;
  }

  /** A list of strings, with each bad element named individually. */
  strings(source: Record<string, unknown>, key: string, path: string): readonly string[] {
    const value = source[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.say(path, `expected a list, found ${describeType(value)}`);
      return [];
    }
    const out: string[] = [];
    value.forEach((element, index) => {
      if (typeof element === "string") out.push(element);
      else this.say(`${path}[${String(index)}]`, `expected a string, found ${describeType(element)}`);
    });
    return out;
  }

  object(source: Record<string, unknown>, key: string, path: string): Record<string, unknown> | null {
    const value = source[key];
    if (value === undefined || value === null) return null;
    if (!isObject(value)) {
      this.say(path, `expected an object, found ${describeType(value)}`);
      return null;
    }
    return value;
  }

  note(path: string, message: string): void {
    this.say(path, message);
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return `a ${typeof value}`;
}

/**
 * Parse the dispatcher's config text into a table.
 *
 * The JSON spellings live here and nowhere else, so a rename upstream is one file's worth of change
 * on this side. Reported issues are about the file; `checkTargets` is about the table.
 */
export function parseTargetsConfig(text: string): ParsedConfig {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { table: null, issues: [{ path: "", message: `not valid JSON: ${detail}` }] };
  }
  if (!isObject(document)) {
    return {
      table: null,
      issues: [{ path: "", message: `expected a JSON object at the top level, found ${describeType(document)}` }],
    };
  }

  const read = new Reader();
  const inbox = read.string(document, "inbox", "inbox", "");
  const table: TargetTable = {
    inbox,
    botLogin: read.string(document, "bot_login", "bot_login", ""),
    branchPrefix: read.string(document, "branch_prefix", "branch_prefix", ""),
    pollInterval: read.string(document, "poll_interval", "poll_interval", "30s"),
    targets: readTargets(read, document),
    memory: readMemory(read, document, inbox),
  };
  return { table, issues: read.issues };
}

function readTargets(read: Reader, document: Record<string, unknown>): readonly Target[] {
  const raw = document["targets"];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    read.note("targets", `expected a list, found ${describeType(raw)}`);
    return [];
  }
  const targets: Target[] = [];
  raw.forEach((element, index) => {
    const path = `targets[${String(index)}]`;
    if (!isObject(element)) {
      read.note(path, `expected an object, found ${describeType(element)}`);
      return;
    }
    targets.push(readTarget(read, element, path));
  });
  return targets;
}

function readTarget(read: Reader, source: Record<string, unknown>, path: string): Target {
  // `agents` overrides `agent` when present, and normalisation to accounts happens once, here,
  // so nothing downstream has to remember which of the two fields it is looking at.
  const listed = read.strings(source, "agents", `${path}.agents`);
  const single = read.string(source, "agent", `${path}.agent`, "");
  const needCap = read.string(source, "need_cap", `${path}.need_cap`, "");
  const promptHint = read.string(source, "prompt_hint", `${path}.prompt_hint`, "");
  return {
    label: read.string(source, "label", `${path}.label`, ""),
    repo: read.string(source, "repo", `${path}.repo`, ""),
    agents: agentsOf(listed, single === "" ? DEFAULT_TARGET_AGENT : single),
    ...(needCap === "" ? {} : { needCap }),
    automerge: read.boolean(source, "automerge", `${path}.automerge`, false),
    priority: read.integer(source, "priority", `${path}.priority`, 0),
    ...(promptHint === "" ? {} : { promptHint }),
    disabled: read.boolean(source, "disabled", `${path}.disabled`, false),
  };
}

/**
 * The memory block, with `loadConfig`'s defaults applied.
 *
 * An absent block is not the same as a block that is off: divybot treats `enabled` as false when
 * the whole section is missing, so the store does not run, but every other default is still what it
 * would use if someone turned it on. Filling them in either way is what lets `checkTargets` say
 * something true about a config the moment `enabled` flips.
 */
function readMemory(read: Reader, document: Record<string, unknown>, inbox: string): MemoryStore {
  const source = read.object(document, "memory", "memory") ?? {};
  return {
    enabled: read.boolean(source, "enabled", "memory.enabled", false),
    repo: read.string(source, "repo", "memory.repo", inbox),
    branch: read.string(source, "branch", "memory.branch", "main"),
    dir: read.string(source, "dir", "memory.dir", "memory"),
    interval: read.string(source, "interval", "memory.interval", "5m"),
  };
}

/** What a filesystem gives back, so the CLI can tell "no file" from "bad file". */
export interface LoadedConfig extends ParsedConfig {
  readonly path: string;
  /** `false` when nothing was there. `table` is then `null` and `issues` is empty. */
  readonly found: boolean;
}

/** Just enough of `node:fs` to read one file — the seam the suite substitutes. */
export interface ConfigReader {
  (path: string): string;
}

/**
 * Load and parse, treating a missing file as an answer rather than a failure.
 *
 * Same convention as `loadLabelsFile`: a repository that has never had a dispatcher configured is
 * not a repository with a broken config, and the caller decides whether the absence matters.
 */
export function loadTargetsConfig(path: string, readFile: ConfigReader): LoadedConfig {
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    if (isMissing(error)) return { path, found: false, table: null, issues: [] };
    throw error;
  }
  return { path, found: true, ...parseTargetsConfig(text) };
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** One file issue as a line an operator can act on. */
export function describeIssue(issue: ConfigIssue): string {
  return issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`;
}
