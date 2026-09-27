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

import { lstat, open, opendir, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
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
  /** Issue feed only: inspect canonical Codex rollout filenames in these receipt windows. */
  readonly codexWindows?: readonly { readonly startMs: number; readonly endMs: number }[];
  /** Issue feed only: private Orchid root predicate; no native identity enters public output. */
  readonly codexRootMatches?: (id: string) => boolean;
  /** Issue feed only: a transcript over either byte bound is withheld, with degraded=true. */
  readonly maxTranscriptBytes?: number;
  readonly maxTotalBytes?: number;
}

export interface BackfillResult {
  readonly runs: readonly RunRecord[];
  readonly notes: readonly string[];
  readonly bytesRead: number;
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
interface CodexHead {
  readonly id: string;
  readonly parentId: string | null;
}
const CODEX_HEAD_BYTES = 16_384;
const CODEX_HEAD_CANDIDATES = 128;

/** Read the first session_meta line only; full files, including huge neighbours, stay unopened. */
async function readCodexHead(path: string): Promise<{ head: CodexHead | null; bytesRead: number }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) return { head: null, bytesRead: 0 };
    const bytes = Buffer.allocUnsafe(CODEX_HEAD_BYTES + 1);
    let size = 0, lineEnd = -1;
    while (size < bytes.length && lineEnd < 0) {
      const { bytesRead } = await file.read(bytes, size, Math.min(512, bytes.length - size), size);
      if (bytesRead === 0) break;
      lineEnd = bytes.subarray(size, size + bytesRead).indexOf(10);
      if (lineEnd >= 0) lineEnd += size;
      size += bytesRead;
    }
    if (size > CODEX_HEAD_BYTES) return { head: null, bytesRead: size };
    if (lineEnd < 0) lineEnd = size; // A final JSONL record may omit its trailing newline.
    const line = JSON.parse(bytes.subarray(0, lineEnd).toString("utf8")) as unknown;
    if (typeof line !== "object" || line === null || Array.isArray(line) ||
        (line as Record<string, unknown>).type !== "session_meta") return { head: null, bytesRead: size };
    const payload = (line as Record<string, unknown>).payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { head: null, bytesRead: size };
    const p = payload as Record<string, unknown>;
    const str = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
    const id = str(p.id) ?? str(p.session_id);
    if (id === null) return { head: null, bytesRead: size };
    const source = typeof p.source === "object" && p.source !== null && !Array.isArray(p.source) ? p.source as Record<string, unknown> : null;
    const subagent = typeof source?.subagent === "object" && source.subagent !== null && !Array.isArray(source.subagent)
      ? source.subagent as Record<string, unknown> : null;
    const spawned = typeof subagent?.thread_spawn === "object" && subagent.thread_spawn !== null && !Array.isArray(subagent.thread_spawn)
      ? subagent.thread_spawn as Record<string, unknown> : null;
    const parents = new Set<string>();
    for (const candidate of [p.parent_thread_id, spawned?.parent_thread_id]) {
      if (candidate === undefined || candidate === null) continue;
      const parent = str(candidate);
      if (parent === null || parent.trim() !== parent) return { head: null, bytesRead: size };
      parents.add(parent);
    }
    if (parents.size > 1 || parents.has(id)) return { head: null, bytesRead: size };
    return { head: { id, parentId: parents.values().next().value ?? null }, bytesRead: size };
  } finally { await file.close(); }
}

async function selectCodexIssue(files: readonly Transcript[], rootMatches: (id: string) => boolean,
  limit: number, remainingBytes: number): Promise<{ selected: readonly { file: Transcript; head: CodexHead }[];
    bytesRead: number; limited: boolean; unreadable: boolean }> {
  const heads: { file: Transcript; head: CodexHead }[] = [];
  const ids = new Set<string>();
  let bytesRead = 0, limited = false, unreadable = false;
  for (const file of [...files].sort((a, b) => compareStrings(a.path, b.path))) {
    if (bytesRead + CODEX_HEAD_BYTES + 1 > remainingBytes) { limited = true; break; }
    try {
      const result = await readCodexHead(file.path);
      bytesRead += result.bytesRead;
      if (result.head === null || ids.has(result.head.id)) { unreadable = true; continue; }
      ids.add(result.head.id);
      heads.push({ file, head: result.head });
    } catch { unreadable = true; }
  }
  const selectedIds = new Set(heads.filter(row => rootMatches(row.head.id)).map(row => row.head.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const row of heads) if (row.head.parentId !== null && selectedIds.has(row.head.parentId) && !selectedIds.has(row.head.id)) {
      selectedIds.add(row.head.id); changed = true;
    }
  }
  const selected = heads.filter(row => selectedIds.has(row.head.id));
  if (selected.length > limit) limited = true;
  return { selected: selected.slice(0, limit), bytesRead, limited, unreadable };
}

/** Read at most the remaining byte budget, including a sentinel byte for a growing file. */
async function readBounded(path: string, maxBytes: number): Promise<string | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    return size > maxBytes ? null : bytes.subarray(0, size).toString("utf8");
  } finally { await file.close(); }
}

type Scan =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "found"; readonly files: readonly Transcript[]; readonly skipped: number; readonly limited?: boolean };

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

/** Visit an offset-safe envelope around receipt dates; filename clocks may be local to another process. */
async function collectCodexWindows(root: string, windows: NonNullable<BackfillOptions["codexWindows"]>, limit: number,
  offsetEnvelopeMs: number): Promise<Scan> {
  try {
    if (!(await lstat(root)).isDirectory()) return { kind: "unreadable", reason: "not a directory" };
  } catch (error) {
    const reason = errorCode(error);
    return reason === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", reason };
  }
  if (windows.length === 0 || windows.length > 8 || windows.some(w => !Number.isSafeInteger(w.startMs) ||
      !Number.isSafeInteger(w.endMs) || w.endMs < w.startMs || w.endMs - w.startMs > 86_400_000 + 600_000)) {
    return { kind: "unreadable", reason: "invalid receipt window" };
  }
  const dates = new Set<string>();
  for (const window of windows) {
    for (let day = Math.floor((window.startMs - offsetEnvelopeMs) / 86_400_000);
      day <= Math.floor((window.endMs + offsetEnvelopeMs) / 86_400_000); day++) {
      dates.add(new Date(day * 86_400_000).toISOString().slice(0, 10));
    }
  }
  const files: Transcript[] = [];
  let skipped = 0;
  let limited = false;
  for (const date of [...dates].sort()) {
    const [year, month, day] = date.split("-");
    const dir = join(root, year!, month!, day!);
    let dirHandle;
    try {
      for (const part of [join(root, year!), join(root, year!, month!), dir]) {
        if (!(await lstat(part)).isDirectory()) throw new Error("not a directory");
      }
      dirHandle = await opendir(dir);
    }
    catch (error) { if (errorCode(error) !== "ENOENT") skipped++; continue; }
    let entriesSeen = 0;
    try {
      for await (const entry of dirHandle) {
        if (++entriesSeen > 1000) { limited = true; break; }
        if (!entry.name.startsWith("rollout-")) continue;
        const match = /^rollout-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-[0-9a-f-]{36}\.jsonl$/.exec(entry.name);
        if (!entry.isFile() || !match || match[1] !== date) { skipped++; continue; }
        const created = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.000Z`);
        if (!Number.isFinite(created) || !windows.some(w =>
          created >= w.startMs - offsetEnvelopeMs && created <= w.endMs + offsetEnvelopeMs)) continue;
        const path = join(dir, entry.name);
        const found = await lstat(path).catch(() => null);
        if (!found?.isFile()) skipped++;
        else files.push({ path, mtimeMs: found.mtimeMs });
        if (files.length > limit) break;
      }
    } catch { skipped++; }
    if (limited || files.length > limit) break;
  }
  return { kind: "found", files, skipped, limited };
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
  let bytesRead = 0;

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
    const scan = seam === "codex" && options.codexWindows !== undefined
      ? await collectCodexWindows(root, options.codexWindows,
        options.codexRootMatches === undefined ? limit : CODEX_HEAD_CANDIDATES,
        options.codexRootMatches === undefined ? 0 : 86_400_000) : await collectJsonl(root);
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
    if (scan.limited) { notes.push(`${seam}: directory entry scan_limit`); degraded = true; }

    let candidateFiles = scan.files;
    const expectedHeads = new Map<string, CodexHead>();
    if (seam === "codex" && options.codexRootMatches !== undefined) {
      if (options.codexWindows === undefined || candidateFiles.length > CODEX_HEAD_CANDIDATES) {
        notes.push("codex: candidate scan_limit"); degraded = true; continue;
      }
      const selected = await selectCodexIssue(candidateFiles, options.codexRootMatches, limit,
        (options.maxTotalBytes ?? Infinity) - bytesRead);
      bytesRead += selected.bytesRead;
      if (selected.limited) { notes.push("codex: head or selected-file scan_limit"); degraded = true; }
      if (selected.unreadable) { notes.push("codex: candidate head could not be read"); degraded = true; }
      candidateFiles = selected.selected.map(row => row.file);
      for (const row of selected.selected) expectedHeads.set(row.file.path, row.head);
    }
    const fresh = sinceMs === null ? candidateFiles : candidateFiles.filter((f) => f.mtimeMs >= sinceMs);
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
    let limited = 0;
    // Degradation is counted across the whole seam rather than reported per file: one operator-
    // readable line beats five hundred, and the count is what says whether to care.
    const partial = new Map<string, { files: number; lines: number }>();
    for (const { path } of ordered.slice(0, limit)) {
      let text: string;
      try {
        if (options.maxTranscriptBytes !== undefined || options.maxTotalBytes !== undefined) {
          const budget = Math.min(options.maxTranscriptBytes ?? Infinity, (options.maxTotalBytes ?? Infinity) - bytesRead);
          const bounded = await readBounded(path, budget);
          if (bounded === null) { limited++; continue; }
          text = bounded;
        } else {
          text = await readFile(path, "utf8");
        }
      } catch {
        unreadable += 1;
        continue;
      }
      bytesRead += Buffer.byteLength(text);
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
      const expected = expectedHeads.get(path);
      if (expected !== undefined && (parsed.run?.id !== expected.id || parsed.run.parentId !== expected.parentId)) {
        unreadable += 1; continue;
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
    if (limited > 0) { notes.push(`${seam}: ${limited} transcript(s) exceeded the read bound`); degraded = true; }
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
  return { runs, notes, degraded, bytesRead };
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
