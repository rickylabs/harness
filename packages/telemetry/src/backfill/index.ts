/**
 * Recover run history from the three vendor stores.
 *
 * Backfill exists because a coordinator crash must not lose the history. Every source here is a
 * file some other process already writes for its own reasons, so the recovery path survives the
 * failure of everything in this repository — which is the only kind of recovery path worth having.
 *
 * A source that cannot be read produces a note and never an exception. "Nothing ran" and "I could
 * not see whether anything ran" are different answers, and conflating them is the exact failure
 * this package was built to delete. That distinction is also why the result carries `degraded`:
 * notes say it in prose, and prose is not something a caller can branch on.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { RunRecord } from "../model.js";
import { compareStrings } from "../order.js";
import { parseClaudeTranscript } from "./claude.js";
import { parseCodexRollout } from "./codex.js";
import type { ParsedTranscript } from "./jsonl.js";
import { openOpencodeDb, readSessions } from "./opencode.js";

export interface BackfillRoots {
  /** `~/.claude/projects`. */
  readonly claudeProjects?: string;
  /** `~/.codex/sessions`. */
  readonly codexSessions?: string;
  /** `~/.local/share/opencode/opencode.db`. */
  readonly opencodeDb?: string;
}

/** How much of each store to read. Both bounds are pushed into the readers, not applied after. */
export interface BackfillOptions {
  /** Runs to read per seam. A fleet accumulates thousands of transcripts. */
  readonly limit?: number;
  /**
   * Drop runs with no activity at or after this epoch-millisecond.
   *
   * Applied to the stores rather than to the answer: `--since` used to bound output while the scan
   * still read every transcript on the box (finding F-7 on #105), which made it a display filter
   * wearing the costume of a bound.
   */
  readonly sinceMs?: number | null;
}

export interface BackfillResult {
  readonly runs: readonly RunRecord[];
  readonly notes: readonly string[];
  /**
   * True when something that should have been read was not.
   *
   * A truncated scan, an unreadable store, a transcript that could not be opened, a record this
   * package does not understand. It is deliberately *not* set by a store that simply is not on this
   * box: that is a complete answer about a vendor this machine does not run. The CLI turns this into
   * an exit status, so a script can tell an empty board from an unread one.
   */
  readonly degraded: boolean;
}

/** One transcript found on disk, with the filesystem's own record of when it was last written. */
interface Transcript {
  readonly path: string;
  readonly mtimeMs: number;
}

type Scan =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "found"; readonly files: readonly Transcript[]; readonly skipped: number };

/** The machine-readable part of a thrown error. No message, and therefore no path in it. */
function errorCode(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null)?.code;
  if (typeof code === "string" && code.length > 0) return code;
  return error instanceof Error ? error.name : "unknown error";
}

/**
 * Every `*.jsonl` under a root, at any depth, with its modification time.
 *
 * The mtime is what lets `--since` bound work rather than output: a transcript last written before
 * the cutoff cannot hold activity after it, so it never has to be opened. That holds short of a
 * clock that moved backwards, which is a failure this package cannot detect and does not pretend to.
 * It is also the sort key, so a bounded scan keeps the *newest* transcripts — an alphabetical
 * truncation would answer "what is running" with whichever sessions happen to sort first.
 */
async function collectJsonl(root: string): Promise<Scan> {
  try {
    if (!(await stat(root)).isDirectory()) return { kind: "unreadable", reason: "not a directory" };
  } catch (error) {
    // A store that is not there is not a failure: this box may simply not run that vendor. A store
    // that is there and will not open is one, and the two used to be the same answer.
    const reason = errorCode(error);
    return reason === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", reason };
  }

  const files: Transcript[] = [];
  let skipped = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      skipped += 1; // An unreadable subdirectory costs its own subtree — counted, not hidden.
      return;
    }
    // Sorted, so a scan that stats the same tree twice walks it the same way twice.
    for (const entry of entries.sort((a, b) => compareStrings(a.name, b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      const mtimeMs = await stat(path).then(
        (found) => found.mtimeMs,
        () => null,
      );
      if (mtimeMs === null) skipped += 1;
      else files.push({ path, mtimeMs });
    }
  };
  await walk(root);
  return { kind: "found", files, skipped };
}

/** How many runs to read per seam before stopping. A fleet accumulates thousands. */
export const DEFAULT_SCAN_LIMIT = 500;

/**
 * Read every configured store and return what was recoverable.
 *
 * `limit` bounds the scan rather than the result: a store with more runs than the limit is reported
 * in the notes and sets `degraded`, so a partial answer never passes as a complete one.
 */
export async function backfillFromDisk(
  roots: BackfillRoots,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const limit = options.limit ?? DEFAULT_SCAN_LIMIT;
  const sinceMs = options.sinceMs ?? null;
  const runs: RunRecord[] = [];
  const notes: string[] = [];
  let degraded = false;

  type Parser = (text: string, origin: string) => ParsedTranscript<RunRecord>;
  const seams: readonly [string | undefined, string, Parser][] = [
    [roots.claudeProjects, "claude", parseClaudeTranscript],
    [roots.codexSessions, "codex", parseCodexRollout],
  ];

  for (const [root, seam, parse] of seams) {
    if (root === undefined) {
      // Not degraded: the caller chose not to look here, which is a decision and not a failure.
      notes.push(`${seam}: no store configured — skipped, not empty`);
      continue;
    }
    const scan = await collectJsonl(root);
    if (scan.kind === "absent") {
      notes.push(`${seam}: no store on this box — nothing has run here`);
      continue;
    }
    if (scan.kind === "unreadable") {
      // No path in the note: it names a home directory, and notes are printed and published.
      notes.push(`${seam}: store could not be read (${scan.reason})`);
      degraded = true;
      continue;
    }
    if (scan.skipped > 0) {
      notes.push(`${seam}: ${scan.skipped} path(s) under the store could not be inspected`);
      degraded = true;
    }

    const fresh = sinceMs === null ? scan.files : scan.files.filter((f) => f.mtimeMs >= sinceMs);
    const ordered = [...fresh].sort(
      (a, b) => b.mtimeMs - a.mtimeMs || compareStrings(a.path, b.path),
    );
    if (ordered.length > limit) {
      notes.push(
        `${seam}: ${ordered.length} transcript(s) match — only the ${limit} most recent were read`,
      );
      degraded = true;
    }

    let unreadable = 0;
    let empty = 0;
    let crashed = 0;
    // Degradation is counted across the whole seam rather than reported per file: one operator-
    // readable line beats five hundred, and the count is what says whether to care.
    const partial = new Map<string, { files: number; lines: number }>();
    for (const { path } of ordered.slice(0, limit)) {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        unreadable += 1;
        continue;
      }
      let parsed: ParsedTranscript<RunRecord>;
      try {
        parsed = parse(text, path);
      } catch {
        // A parser that throws is this package's bug, not the store's — but a bug in one seam must
        // not take the other two down with it, and `status` has to answer while it is being fixed.
        // Finding F-4 on #105, where one `null` line reached a field access and ended the scan.
        crashed += 1;
        continue;
      }
      for (const note of parsed.notes) {
        const seen = partial.get(note.reason) ?? { files: 0, lines: 0 };
        partial.set(note.reason, { files: seen.files + 1, lines: seen.lines + note.lines });
      }
      if (parsed.run === null) empty += 1;
      else runs.push(parsed.run);
    }
    if (unreadable > 0) {
      notes.push(`${seam}: ${unreadable} transcript(s) could not be read`);
      degraded = true;
    }
    // Not degraded: the file was read completely and had no session identity in it, which is an
    // answer about the transcript rather than a gap in what this scan saw.
    if (empty > 0) notes.push(`${seam}: ${empty} transcript(s) carried no session identity`);
    if (crashed > 0) {
      notes.push(`${seam}: ${crashed} transcript(s) crashed the parser — please report`);
      degraded = true;
    }
    for (const [reason, seen] of [...partial].sort(([a], [b]) => compareStrings(a, b))) {
      notes.push(`${seam}: ${reason} — ${seen.lines} line(s) across ${seen.files} transcript(s)`);
      degraded = true;
    }
  }

  if (roots.opencodeDb === undefined) {
    notes.push("opencode: no store configured — skipped, not empty");
  } else {
    const { reader, note, absent } = await openOpencodeDb(roots.opencodeDb);
    if (note !== null) notes.push(note);
    if (reader === null && !absent) degraded = true;
    if (reader !== null) {
      try {
        // One more than asked for, so "there was more" is distinguishable from "that was all". The
        // extra row is dropped: the bound the operator gave is the bound they get.
        const read = readSessions(reader, roots.opencodeDb, { limit: limit + 1, sinceMs });
        if (read.length > limit) {
          notes.push(
            `opencode: more than ${limit} session(s) match — only the ${limit} most recent were read`,
          );
          degraded = true;
        }
        runs.push(...read.slice(0, limit));
      } catch (error) {
        // The message would carry the store path, which names a home directory. A store that opens
        // and then will not answer is the corrupt-database case: openable, unqueryable.
        notes.push(`opencode: session query failed (${errorCode(error)})`);
        degraded = true;
      } finally {
        reader.close();
      }
    }
  }

  // Deterministic order: newest activity first, ties broken by id so two runs updated in the same
  // millisecond do not swap places between snapshots.
  runs.sort((a, b) => compareStrings(b.updatedAt, a.updatedAt) || compareStrings(a.id, b.id));
  return { runs, notes, degraded };
}

/** The conventional store locations under a home directory. */
export function defaultRoots(home: string): BackfillRoots {
  return {
    claudeProjects: join(home, ".claude", "projects"),
    codexSessions: join(home, ".codex", "sessions"),
    opencodeDb: join(home, ".local", "share", "opencode", "opencode.db"),
  };
}

export { parseClaudeTranscript } from "./claude.js";
export { isoFromUnixSeconds, parseCodexRollout, quotaFromRateLimits } from "./codex.js";
export {
  isoFromMillis,
  MAX_TIME_MS,
  NoteTally,
  NOT_AN_OBJECT,
  NOT_JSON,
  parseLine,
  parseLineWithReason,
  type JsonObject,
  type ParsedTranscript,
  type ParseNote,
  typeLabel,
} from "./jsonl.js";
export {
  openOpencodeDb,
  readSessions,
  rowToRun,
  SESSION_COLUMNS,
  sessionQuery,
  type BoundQuery,
  type SessionBounds,
  type SessionRow,
  type SqliteReader,
} from "./opencode.js";
