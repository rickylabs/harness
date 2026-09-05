/**
 * Recover run history from the three vendor stores.
 *
 * Backfill exists because a coordinator crash must not lose the history. Every source here is a
 * file some other process already writes for its own reasons, so the recovery path survives the
 * failure of everything in this repository — which is the only kind of recovery path worth having.
 *
 * A source that cannot be read produces a note and never an exception. "Nothing ran" and "I could
 * not see whether anything ran" are different answers, and conflating them is the exact failure
 * this package was built to delete.
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

export interface BackfillResult {
  readonly runs: readonly RunRecord[];
  readonly notes: readonly string[];
}

/** Every `*.jsonl` under a root, at any depth. Returns `null` when the root does not exist. */
async function findJsonl(root: string, limit: number): Promise<string[] | null> {
  try {
    if (!(await stat(root)).isDirectory()) return null;
  } catch {
    return null;
  }
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (found.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // An unreadable subdirectory costs its own subtree, not the whole scan.
    }
    // Sorted, so a truncated scan truncates the same way twice and a snapshot stays reproducible.
    for (const entry of entries.sort((a, b) => compareStrings(a.name, b.name))) {
      if (found.length >= limit) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".jsonl")) found.push(path);
    }
  };
  await walk(root);
  return found;
}

/** How many transcripts to read per seam before stopping. A fleet accumulates thousands. */
export const DEFAULT_SCAN_LIMIT = 500;

/**
 * Read every configured store and return what was recoverable.
 *
 * `limit` bounds the scan rather than the result: a store with more transcripts than the limit is
 * reported in the notes, so a partial answer never passes as a complete one.
 */
export async function backfillFromDisk(
  roots: BackfillRoots,
  limit: number = DEFAULT_SCAN_LIMIT,
): Promise<BackfillResult> {
  const runs: RunRecord[] = [];
  const notes: string[] = [];

  type Parser = (text: string, origin: string) => ParsedTranscript<RunRecord>;
  const seams: readonly [string | undefined, string, Parser][] = [
    [roots.claudeProjects, "claude", parseClaudeTranscript],
    [roots.codexSessions, "codex", parseCodexRollout],
  ];

  for (const [root, seam, parse] of seams) {
    if (root === undefined) {
      notes.push(`${seam}: no store configured — skipped, not empty`);
      continue;
    }
    const files = await findJsonl(root, limit + 1);
    if (files === null) {
      // No path in the note: it names a home directory, and notes are printed and published.
      notes.push(`${seam}: store is not a readable directory`);
      continue;
    }
    if (files.length > limit) {
      notes.push(`${seam}: more than ${limit} transcripts in the store — scan truncated`);
    }
    let unreadable = 0;
    let empty = 0;
    let crashed = 0;
    // Degradation is counted across the whole seam rather than reported per file: one operator-
    // readable line beats five hundred, and the count is what says whether to care.
    const degraded = new Map<string, { files: number; lines: number }>();
    for (const file of files.slice(0, limit)) {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        unreadable += 1;
        continue;
      }
      let parsed: ParsedTranscript<RunRecord>;
      try {
        parsed = parse(text, file);
      } catch {
        // A parser that throws is this package's bug, not the store's — but a bug in one seam must
        // not take the other two down with it, and `status` has to answer while it is being fixed.
        // Finding F-4 on #105, where one `null` line reached a field access and ended the scan.
        crashed += 1;
        continue;
      }
      for (const note of parsed.notes) {
        const seen = degraded.get(note.reason) ?? { files: 0, lines: 0 };
        degraded.set(note.reason, { files: seen.files + 1, lines: seen.lines + note.lines });
      }
      if (parsed.run === null) empty += 1;
      else runs.push(parsed.run);
    }
    if (unreadable > 0) notes.push(`${seam}: ${unreadable} transcript(s) could not be read`);
    if (empty > 0) notes.push(`${seam}: ${empty} transcript(s) carried no session identity`);
    if (crashed > 0) notes.push(`${seam}: ${crashed} transcript(s) crashed the parser — please report`);
    for (const [reason, seen] of [...degraded].sort(([a], [b]) => compareStrings(a, b))) {
      notes.push(
        `${seam}: ${reason} — ${seen.lines} line(s) across ${seen.files} transcript(s)`,
      );
    }
  }

  if (roots.opencodeDb === undefined) {
    notes.push("opencode: no store configured — skipped, not empty");
  } else {
    const { reader, note } = await openOpencodeDb(roots.opencodeDb);
    if (note !== null) notes.push(note);
    if (reader !== null) {
      try {
        runs.push(...readSessions(reader, roots.opencodeDb));
      } catch (error) {
        notes.push(`opencode: session query failed: ${String(error)}`);
      } finally {
        reader.close();
      }
    }
  }

  // Deterministic order: newest activity first, ties broken by id so two runs updated in the same
  // millisecond do not swap places between snapshots.
  runs.sort((a, b) => compareStrings(b.updatedAt, a.updatedAt) || compareStrings(a.id, b.id));
  return { runs, notes };
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
  SESSION_QUERY,
  type SessionRow,
  type SqliteReader,
} from "./opencode.js";
