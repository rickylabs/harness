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

  const seams: readonly [string | undefined, string, (t: string, o: string) => RunRecord | null][] =
    [
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
      notes.push(`${seam}: ${root} is not a readable directory`);
      continue;
    }
    if (files.length > limit) {
      notes.push(`${seam}: more than ${limit} transcripts under ${root} — scan truncated`);
    }
    let unreadable = 0;
    let empty = 0;
    for (const file of files.slice(0, limit)) {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        unreadable += 1;
        continue;
      }
      const run = parse(text, file);
      if (run === null) empty += 1;
      else runs.push(run);
    }
    if (unreadable > 0) notes.push(`${seam}: ${unreadable} transcript(s) could not be read`);
    if (empty > 0) notes.push(`${seam}: ${empty} transcript(s) carried no session identity`);
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
  openOpencodeDb,
  readSessions,
  rowToRun,
  SESSION_QUERY,
  type SessionRow,
  type SqliteReader,
} from "./opencode.js";
