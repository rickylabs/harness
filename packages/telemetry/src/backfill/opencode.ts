/**
 * Backfill from the opencode store: `~/.local/share/opencode/opencode.db`.
 *
 * This is the only seam that records the subagent tree as data — `session.parent_id` — which is
 * what makes the milestone -> epic -> task -> subagent view recoverable rather than reconstructed
 * from prose. It is also the seam that reports cost, because the relay bills per call.
 *
 * Two constraints shape this file:
 *
 * 1. It reads the `session` table and nothing else. The same database holds `credential` and the
 *    directory holds `auth.json`; neither is touched, and the query is a fixed literal so no future
 *    caller can widen it through a parameter.
 * 2. It opens the database **read-only**, against a live writer holding a WAL. Anything that could
 *    checkpoint or lock that file would degrade the agents this tool exists to observe.
 */

import { linkedIssuesOf, type RunRecord, type RunUsage } from "../model.js";
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
 * The only statement this module runs.
 *
 * Exported so a reviewer can read it without running it, and so a test can assert that the module
 * does not reach beyond `session` — the containment claim in the header is checkable, not a promise.
 */
export const SESSION_QUERY = `
  select id, parent_id, title, directory, agent, model, cost,
         tokens_input, tokens_output, tokens_reasoning,
         tokens_cache_read, tokens_cache_write,
         time_created, time_updated
    from session
   order by time_created asc
` as const;

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

  const model = row.model;
  return {
    id: row.id,
    source: "opencode",
    parentId: row.parent_id,
    startedAt,
    updatedAt: millisToIso(row.time_updated) ?? startedAt,
    title: row.title,
    cwd: row.directory,
    branch: null,
    identity: {
      model,
      // opencode carries the agent profile rather than a reasoning effort. Reporting the profile in
      // the effort slot would make a routing audit read a lane name as an effort level, so it stays
      // null and the profile travels in the title.
      effort: null,
      provider: model === null ? null : (model.split("/")[0] ?? null),
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

/** What a SQLite driver has to provide. Kept minimal so `node:sqlite` is not a hard dependency. */
export interface SqliteReader {
  all(query: string): readonly Readonly<Record<string, unknown>>[];
  close(): void;
}

/**
 * Open `opencode.db` read-only through `node:sqlite`.
 *
 * Returns `null` with a note rather than throwing when the runtime has no SQLite: the module is
 * experimental on Node 22 and the rest of the backfill must still produce a snapshot without it.
 * A missing subagent tree is a degraded answer; a crashed `status` is no answer at all.
 */
export async function openOpencodeDb(
  path: string,
): Promise<{ reader: SqliteReader | null; note: string | null }> {
  interface DatabaseSync {
    prepare(sql: string): { all(): readonly Readonly<Record<string, unknown>>[] };
    close(): void;
  }
  try {
    const sqlite = (await import("node:sqlite")) as unknown as {
      DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => DatabaseSync;
    };
    const db = new sqlite.DatabaseSync(path, { readOnly: true });
    return {
      reader: {
        all: (query: string) => db.prepare(query).all(),
        close: () => {
          db.close();
        },
      },
      note: null,
    };
  } catch (error) {
    return { reader: null, note: `opencode.db unreadable at ${path}: ${String(error)}` };
  }
}

/** Read every session row through a reader, without knowing which driver produced it. */
export function readSessions(reader: SqliteReader, origin: string): readonly RunRecord[] {
  const runs: RunRecord[] = [];
  for (const row of reader.all(SESSION_QUERY)) {
    const run = rowToRun(row as unknown as SessionRow, origin);
    if (run !== null) runs.push(run);
  }
  return runs;
}
