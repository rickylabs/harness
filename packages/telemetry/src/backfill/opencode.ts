/**
 * Backfill from the opencode store: `~/.local/share/opencode/opencode.db`.
 *
 * This is the seam that *states* the subagent tree — `session.parent_id`, one column, one fact —
 * which is what makes the milestone -> epic -> task -> subagent view recoverable rather than
 * reconstructed from prose. The Claude store carries the same tree, but implied across two facts
 * rather than stated in one, so `backfill/claude.ts` has to read a file name against a flag to get
 * here. It is also the seam that reports cost, because the relay bills per call.
 *
 * Two constraints shape this file:
 *
 * 1. It reads the `session` table and nothing else. The same database holds `credential` and the
 *    directory holds `auth.json`; neither is touched. What the statement *reads* — the column list
 *    and the table — is a fixed literal that takes no input at all; the caller's bounds reach the
 *    database only as bound parameters, so no argument can widen the query by becoming text in it.
 *    `title` and `directory` are selected but not kept: they are read for the issue numbers in them
 *    and dropped in `rowToRun`, because a run record is published and those two columns hold the
 *    operator's prose and their disk layout.
 * 2. It opens the database **read-only**, against a live writer holding a WAL. Anything that could
 *    checkpoint or lock that file would degrade the agents this tool exists to observe.
 */

import { stat } from "node:fs/promises";

import {
  linkedIssuesOf,
  type LaunchIdentity,
  type RunRecord,
  type RunUsage,
} from "../model.js";
import { isoFromMillis } from "./jsonl.js";

/** One row of `session`, reduced to the columns this package reads. */
export interface SessionRow {
  readonly id: string;
  readonly parent_id: string | null;
  readonly title: string | null;
  readonly directory: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly cost: number | null;
  readonly tokens_input: number | null;
  readonly tokens_output: number | null;
  readonly tokens_reasoning: number | null;
  readonly tokens_cache_read: number | null;
  readonly tokens_cache_write: number | null;
  readonly time_created: number | null;
  readonly time_updated: number | null;
}

/**
 * Everything this module reads, as a fixed literal with no interpolation point in it.
 *
 * Exported so a reviewer can read it without running it, and so a test can assert that the module
 * does not reach beyond `session` — the containment claim in the header is checkable, not a promise.
 */
export const SESSION_COLUMNS = `
  select id, parent_id, title, directory, agent, model, cost,
         tokens_input, tokens_output, tokens_reasoning,
         tokens_cache_read, tokens_cache_write,
         time_created, time_updated
    from session` as const;

/** How much of the store to read. Both bounds travel as parameters, never as query text. */
export interface SessionBounds {
  /** Rows to return. The scan bound the operator asked for, honoured by the database itself. */
  readonly limit: number;
  /** Drop sessions with no activity at or after this epoch-millisecond. */
  readonly sinceMs?: number | null;
}

/** A statement and the values bound into it. */
export interface BoundQuery {
  readonly text: string;
  readonly params: readonly number[];
}

/**
 * Build the session statement for a given bound.
 *
 * `--limit 1` used to bound the two JSONL seams and leave this one unbounded, so the same flag meant
 * two different things depending on which store answered (finding F-7 on #105). The bound is pushed
 * into the database rather than applied to its output, so a store with a hundred thousand sessions
 * costs a hundred thousand rows of nothing.
 *
 * Ordering is newest-activity-first because a bound is only useful with one: `limit 3` has to mean
 * the three most recent sessions, not the three oldest. `coalesce` mirrors `rowToRun`, which falls
 * back to the creation time for a row that was never updated — without it those rows would sort last
 * and be dropped by a bound they are not actually outside of.
 */
export function sessionQuery(bounds: SessionBounds): BoundQuery {
  const params: number[] = [];
  let text: string = SESSION_COLUMNS;
  const since = bounds.sinceMs ?? null;
  if (since !== null) {
    text += `\n   where coalesce(time_updated, time_created) >= ?`;
    params.push(since);
  }
  text += `\n   order by coalesce(time_updated, time_created) desc\n   limit ?`;
  params.push(bounds.limit);
  return { text, params };
}

// opencode stores milliseconds. A value small enough to be a second would land in 1970, so it is
// rejected rather than silently rescaled into a plausible-looking lie, and one too large to be a
// date is rejected rather than thrown from (finding F-4 on #105).
const millisToIso = (value: number | null): string | null => isoFromMillis(value);

const count = (value: number | null): number | undefined =>
  value === null || !Number.isFinite(value) ? undefined : value;

/** Turn one `session` row into a run record. Pure, so the mapping is testable without a database. */
export function rowToRun(row: SessionRow, origin: string): RunRecord | null {
  const startedAt = millisToIso(row.time_created);
  if (startedAt === null) return null;

  const usage: RunUsage = {};
  const mutable = usage as Record<string, number>;
  const fields: readonly [keyof SessionRow, string][] = [
    ["tokens_input", "inputTokens"],
    ["tokens_output", "outputTokens"],
    ["tokens_reasoning", "reasoningTokens"],
    ["tokens_cache_read", "cacheReadTokens"],
    ["tokens_cache_write", "cacheWriteTokens"],
    ["cost", "costUsd"],
  ];
  for (const [column, field] of fields) {
    const value = count(row[column] as number | null);
    if (value !== undefined) mutable[field] = value;
  }

  const model = launchIdentity(row.model);
  return {
    id: row.id,
    source: "opencode",
    parentId: row.parent_id,
    startedAt,
    updatedAt: millisToIso(row.time_updated) ?? startedAt,
    branch: null,
    identity: {
      ...model,
      // opencode carries an agent profile as well, in its own column. Reporting the profile in the
      // effort slot would make a routing audit read a lane name as an effort level, so it stays
      // where it belongs and is reported as itself.
      profile: row.agent,
    },
    usage,
    // The store records no terminal state; a session row looks the same whether its agent finished
    // or its host was torn down for capacity.
    outcome: "unknown",
    linkedIssues: linkedIssuesOf(row.directory, row.title),
    origin,
    quota: [],
  };
}

/**
 * Read the launch identity out of `session.model`.
 *
 * The column holds a JSON object serialised to text — `{"id","providerID","variant"?}` — not the
 * `provider/model` string this module first assumed. The difference was invisible because the
 * fixture asserted the invented shape: against the real store every opencode run reported its whole
 * JSON blob in the model slot and that same blob again as its provider, which is the one field a
 * routing audit reads to check that a run went to the seam the matrix sent it to.
 *
 * `variant` goes into `effort` verbatim, `"default"` included. It is the seam's own word for how
 * the model was asked to run, and {@link LaunchIdentity} is explicit that a recorded value is
 * reported as recorded — normalising `"default"` to `null` would be this module deciding that the
 * provider default is the same as no answer, which is the guess the type exists to forbid.
 *
 * Anything that is not such an object is kept as an opaque model string, because a value this
 * module cannot parse is still what the seam recorded, and `null` would claim the row said nothing.
 */
export function launchIdentity(
  raw: string | null,
): Pick<LaunchIdentity, "model" | "effort" | "provider"> {
  const opaque = { model: raw, effort: null, provider: null };
  if (raw === null) return opaque;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return opaque;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return opaque;

  // A field that is present but not a string is not an identity; reporting it would put a number or
  // an object back into the slot this function exists to clean out.
  const field = (key: string): string | null => {
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" && value !== "" ? value : null;
  };

  const model = field("id");
  // An object with no usable id says nothing this module can attribute, and falling through to the
  // raw text at least keeps the evidence intact for whoever reads the run.
  if (model === null) return opaque;
  return { model, effort: field("variant"), provider: field("providerID") };
}

/**
 * The machine-readable part of a thrown error, with no message and therefore no path in it.
 *
 * `ERR_SQLITE_ERROR` for a database that will not open, `ENOENT` for one that is not there, and the
 * constructor name when a runtime offers neither.
 */
function errorCode(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null)?.code;
  if (typeof code === "string" && code.length > 0) return code;
  return error instanceof Error ? error.name : "unknown error";
}

/** What a SQLite driver has to provide. Kept minimal so `node:sqlite` is not a hard dependency. */
export interface SqliteReader {
  all(query: string, params: readonly number[]): readonly Readonly<Record<string, unknown>>[];
  close(): void;
}

/**
 * Open `opencode.db` read-only through `node:sqlite`.
 *
 * Returns `null` with a note rather than throwing when the runtime has no SQLite: the module is
 * experimental on Node 22 and the rest of the backfill must still produce a snapshot without it.
 * A missing subagent tree is a degraded answer; a crashed `status` is no answer at all.
 *
 * `absent` separates the two ways of having no reader. A box that does not run opencode has no
 * store, and saying so is a complete answer; a store that is there and will not open is missing
 * evidence. Both used to be reported as "unreadable", which left a caller no way to tell whether
 * its own answer was complete (finding F-7 on #105). The check is a `stat` rather than an error
 * code because `node:sqlite` reports a missing file as `ERR_SQLITE_ERROR`, the same code it uses
 * for a file that is present and corrupt.
 */
export async function openOpencodeDb(
  path: string,
): Promise<{ reader: SqliteReader | null; note: string | null; absent: boolean }> {
  const present = await stat(path).then(
    () => true,
    (error: unknown) => errorCode(error) !== "ENOENT",
  );
  if (!present) return { reader: null, note: "opencode: no store on this box", absent: true };
  interface DatabaseSync {
    prepare(sql: string): {
      all(...params: readonly number[]): readonly Readonly<Record<string, unknown>>[];
    };
    close(): void;
  }
  try {
    const sqlite = (await import("node:sqlite")) as unknown as {
      DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => DatabaseSync;
    };
    const db = new sqlite.DatabaseSync(path, { readOnly: true });
    return {
      reader: {
        all: (query: string, params: readonly number[]) => db.prepare(query).all(...params),
        close: () => {
          db.close();
        },
      },
      note: null,
      absent: false,
    };
  } catch (error) {
    // The path is not in the note. It names a home directory, and a note is printed, piped and
    // published. The error code says which failure this was, which is what an operator acts on.
    return { reader: null, note: `opencode: store unreadable (${errorCode(error)})`, absent: false };
  }
}

/** Read the bounded session rows through a reader, without knowing which driver produced it. */
export function readSessions(
  reader: SqliteReader,
  origin: string,
  bounds: SessionBounds,
): readonly RunRecord[] {
  const { text, params } = sessionQuery(bounds);
  const runs: RunRecord[] = [];
  for (const row of reader.all(text, params)) {
    const run = rowToRun(row as unknown as SessionRow, origin);
    if (run !== null) runs.push(run);
  }
  return runs;
}
