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

import { lstat, opendir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { collectCodexWindows, errorCode } from "./codex-discovery.js";
export { CODEX_WINDOW_MAX_MS } from "./codex-discovery.js";
import { selectCodexIssue, type CodexName, type CodexHead } from "./codex-selection.js";
import { readBounded, readHeadTail, headTailRun, type Transcript } from "./transcript-read.js";
/** Rollout names enumerated per issue scan; the root may be unseen beyond it. */
const CODEX_WINDOW_NAMES = 4_096;

import type { RunRecord } from "../model.js";
import { compareStrings } from "../order.js";
import { parseClaudeTranscript } from "./claude.js";
import { parseCodexRollout } from "./codex.js";
import { transcriptAsOf, type ParsedTranscript } from "./jsonl.js";
import { openOpencodeDb, readSessions } from "./opencode.js";
import { readOpenCodeRunSessions } from "./opencode-run-store.js";

export interface BackfillRoots {
  /** `~/.claude/projects`. */
  readonly claudeProjects?: string;
  /** `~/.codex/sessions`. */
  readonly codexSessions?: string;
  /** `~/.local/share/opencode/opencode.db`: the 1.x legacy store, read only for runs that already ended. */
  readonly opencodeDb?: string;
  /** `~/.local/share/opencode`: the OpenCode data directory that holds each 2.x run database. */
  readonly opencodeData?: string;
}

/** How much of each store to read. Both bounds are pushed into the readers, not applied after. */
export interface BackfillOptions {
  /** Runs to read per seam. A fleet accumulates thousands of transcripts. */
  readonly limit?: number;
  /** Account usage: bound directory enumeration as well as transcript reads. */
  readonly maxDirectoryEntries?: number;
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
  /** Scheduling only; never used to establish native state or identity. */
  readonly codexRootPriority?: (id: string) => number;
  /** Current issue-tree readers can keep verified roots when another root exceeds the byte budget. */
  readonly partialRoots?: boolean;
  /**
   * Issue feed only: a transcript over either byte bound is withheld, with degraded=true. A
   * dispatch-matched root or descendant is instead read as head and tail windows.
   */
  readonly maxTranscriptBytes?: number;
  readonly maxTotalBytes?: number;
  /** Issue feed only: read each transcript as it stood at the frame's capture (see `transcriptAsOf`). */
  readonly notAfterMs?: number;
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
  /**
   * Issue feed only: why a dispatch-matched Codex tree was read in part. Roots are mandatory unless
   * partialRoots permits a budget-bounded retry after a verified root; descendants can be missing. Empty
   * when the tree is complete. Not degraded: what was read is exact, only its extent is bounded.
   */
  readonly partial: readonly CodexTreePartialReason[];
}

/**
 * Why a dispatch-matched Codex tree is partial.
 * - `descendant_heads_bound`: more descendant candidates than `CODEX_HEAD_CANDIDATES`; only the
 *   newest were read.
 * - `descendant_heads_budget`: the frame's byte budget ran out before every candidate head.
 * - `descendant_head_unreadable`: a candidate's head was unreadable or ambiguous, so whether it
 *   descends from the root is unknown.
 * - `selected_files_bound`: the tree holds more transcripts than the scan limit; the nearest
 *   generations were kept, parents before children.
 * - `descendant_transcript_bound`: a selected descendant's transcript did not fit what the frame
 *   had left, not even as head and tail windows.
 * - `descendant_transcript_unreadable`: a selected descendant's transcript could not be opened or
 *   read, no longer held the session its head named, yielded no run, or held lines the parser
 *   could not read.
 * - `root_transcript_bound`: with partialRoots, a retry exceeded the remaining byte budget after
 *   at least one other root was verified. The issue's resolved dispatches remain a bounded forest.
 * A descendant omitted for either transcript reason takes its own descendants with it, so the
 * agents served are always a closed tree from the roots.
 */
export const CODEX_TREE_PARTIAL_REASONS = ["descendant_heads_bound", "descendant_heads_budget",
  "descendant_head_unreadable", "selected_files_bound", "descendant_transcript_bound",
  "descendant_transcript_unreadable", "root_transcript_bound"] as const;
export type CodexTreePartialReason = typeof CODEX_TREE_PARTIAL_REASONS[number];


export type Scan =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "found"; readonly files: readonly Transcript[]; readonly skipped: number; readonly limited?: boolean;
      /** Codex issue scans only: canonical rollout names, enumerated without opening a file. */
      readonly names?: readonly CodexName[] };

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

/** Streaming bounded variant for periodic account reads; a truncated tree is explicitly partial. */
async function collectBoundedJsonl(root: string, cap: number): Promise<Scan> {
  const files: Transcript[] = [];
  let skipped = 0, visited = 0, limited = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (limited) return;
    if (depth > 32) { limited = true; return; }
    try {
      if (!(await lstat(dir)).isDirectory()) { skipped++; return; }
      const handle = await opendir(dir);
      for await (const entry of handle) {
        if (++visited > cap) { limited = true; break; }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.name.endsWith(".jsonl")) {
          const found = await lstat(path).catch(() => null);
          if (!entry.isFile() || !found?.isFile()) skipped++;
          else files.push({ path, mtimeMs: found.mtimeMs });
        }
        if (limited) break;
      }
    } catch { skipped++; }
  };
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 100000) return { kind: "unreadable", reason: "invalid directory bound" };
  await walk(root, 0);
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
  const partialTree: CodexTreePartialReason[] = [];
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
        options.codexRootMatches === undefined ? limit : CODEX_WINDOW_NAMES,
        options.codexRootMatches === undefined ? 0 : 86_400_000, options.codexRootMatches !== undefined)
      : options.maxDirectoryEntries === undefined
        ? await collectJsonl(root) : await collectBoundedJsonl(root, options.maxDirectoryEntries);
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
    const rootPaths = new Set<string>();
    let issueTree = false;
    if (seam === "codex" && options.codexRootMatches !== undefined) {
      const names = scan.names ?? [];
      if (options.codexWindows === undefined || names.length > CODEX_WINDOW_NAMES) {
        notes.push("codex: candidate scan_limit"); degraded = true; continue;
      }
      const selected = await selectCodexIssue(names, options.codexRootMatches, limit,
        (options.maxTotalBytes ?? Infinity) - bytesRead, options.codexRootPriority);
      bytesRead += selected.bytesRead;
      if (selected.refused !== null) { notes.push(selected.refused); degraded = true; continue; }
      for (const reason of selected.partial) { partialTree.push(reason); notes.push(`codex: tree partial (${reason})`); }
      candidateFiles = selected.selected.map(row => row.file);
      for (const row of selected.selected) expectedHeads.set(row.file.path, row.head);
      for (const row of selected.selected.slice(0, selected.roots)) rootPaths.add(row.file.path);
      issueTree = true;
    }
    // An issue tree is read whole, in its selection order: roots first, parents before children.
    const fresh = sinceMs === null || issueTree ? candidateFiles : candidateFiles.filter((f) => f.mtimeMs >= sinceMs);
    const ordered = issueTree ? fresh : [...fresh].sort(
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
    let windowed = 0;
    let crashedDescendants = 0;
    // Degradation is counted across the whole seam rather than reported per file: one operator-
    // readable line beats five hundred, and the count is what says whether to care.
    const partial = new Map<string, { files: number; lines: number }>();
    const asOf = (text: string) => options.notAfterMs === undefined ? text : transcriptAsOf(text, options.notAfterMs);
    // An issue tree's descendants, once its roots are established: a failure omits that descendant
    // and its own descendants, under a named reason, and never the roots or their other branches.
    const omitted = new Set<string>();
    let readRoots = 0;
    const omit = (head: CodexHead, reason: CodexTreePartialReason) => {
      omitted.add(head.id);
      if (!partialTree.includes(reason)) {
        partialTree.push(reason);
        notes.push(`${seam}: tree partial (${reason})`);
      }
    };
    for (const { path } of ordered.slice(0, limit)) {
      const expected = expectedHeads.get(path);
      const descendant = issueTree && expected !== undefined && !rootPaths.has(path) ? expected : null;
      // Parents come first, so an omitted parent is already known when its child is reached.
      if (descendant !== null && descendant.parentId !== null && omitted.has(descendant.parentId)) { // guard:omit-subtree
        omitted.add(descendant.id); continue;
      }
      let text = "";
      let window: Awaited<ReturnType<typeof readHeadTail>> = null;
      // Every byte read is charged as it is read, before the next read, usable or not.
      const charge = (bytes: number) => { bytesRead += bytes; };
      try {
        if (options.maxTranscriptBytes !== undefined || options.maxTotalBytes !== undefined) {
          const budget = Math.min(options.maxTranscriptBytes ?? Infinity, (options.maxTotalBytes ?? Infinity) - bytesRead);
          const bounded = await readBounded(path, budget, charge);
          // An issue scan never drops a dispatch-matched rollout (a root or its native descendant)
          // for its size: it reads the head and the tail instead.
          if (bounded === null && expectedHeads.has(path)) {
            // A bounded read refuses only at open, before reading anything, so the window has this
            // file's whole allowance within what the frame has left.
            window = await readHeadTail(path, budget, charge,
              (options.maxTotalBytes ?? options.maxTranscriptBytes ?? budget) - bytesRead, options.notAfterMs);
          }
          if (bounded === null && window === null) {
            if (descendant !== null) omit(descendant, "descendant_transcript_bound"); // guard:descendant-bound-partial
            else if (options.partialRoots && readRoots > 0 && expected !== undefined) omit(expected, "root_transcript_bound");
            else limited++;
            continue;
          }
          if (bounded !== null) text = bounded;
        } else {
          text = await readFile(path, "utf8");
          bytesRead += Buffer.byteLength(text);
        }
      } catch {
        if (descendant !== null) omit(descendant, "descendant_transcript_unreadable"); // guard:descendant-read-partial
        else unreadable += 1;
        continue;
      }
      let parsed: ParsedTranscript<RunRecord>;
      try {
        if (window !== null) {
          windowed += 1;
          const head = asOf(window.head);
          // The tail keeps the session identity line, so it parses as the same thread.
          const identity = head.slice(0, head.indexOf("\n") + 1);
          const first = parse(head, path), last = parse(identity + window.state + asOf(window.tail), path);
          parsed = { run: first.run === null || last.run === null ? null : headTailRun(first.run, last.run),
            notes: [...first.notes, ...last.notes] };
        } else {
          parsed = parse(asOf(text), path);
        }
      } catch {
        // A parser that throws is this package's bug, not the store's — but a bug in one seam must
        // not take the other two down with it, and `status` has to answer while it is being fixed.
        // Finding F-4 on #105, where one `null` line reached a field access and ended the scan.
        if (descendant !== null) { crashedDescendants += 1; omit(descendant, "descendant_transcript_unreadable"); }
        else crashed += 1;
        continue;
      }
      if (expected !== undefined && (parsed.run?.id !== expected.id || parsed.run.parentId !== expected.parentId)) {
        // The file no longer holds the session its head named (or holds none).
        if (descendant !== null) omit(descendant, "descendant_transcript_unreadable"); // guard:descendant-identity-partial
        else unreadable += 1;
        continue;
      }
      // A descendant whose transcript holds lines the parser could not read (a record still being
      // written, an envelope this package does not know) has a state this scan cannot vouch for:
      // that descendant and its subtree are omitted. A root's notes still refuse below.
      if (descendant !== null && parsed.notes.length > 0) { // guard:descendant-notes-partial
        omit(descendant, "descendant_transcript_unreadable");
        continue;
      }
      for (const note of parsed.notes) {
        const seen = partial.get(note.reason) ?? { files: 0, lines: 0 };
        partial.set(note.reason, { files: seen.files + 1, lines: seen.lines + note.lines });
      }
      if (parsed.run === null) empty += 1;
      else { runs.push(parsed.run); if (rootPaths.has(path)) readRoots++; }
    }
    if (unreadable > 0) {
      notes.push(`${seam}: ${unreadable} transcript(s) could not be read`);
      degraded = true;
    }
    if (limited > 0) { notes.push(`${seam}: ${limited} transcript(s) exceeded the read bound`); degraded = true; }
    // Not degraded: identity and the latest state were read; only the history between is partial.
    if (windowed > 0) notes.push(`${seam}: ${windowed} large transcript(s) read as head and tail windows`);
    // Not degraded: the file was read completely and had no session identity in it, which is an
    // answer about the transcript rather than a gap in what this scan saw.
    if (empty > 0) notes.push(`${seam}: ${empty} transcript(s) carried no session identity`);
    if (crashed > 0) {
      notes.push(`${seam}: ${crashed} transcript(s) crashed the parser — please report`);
      degraded = true;
    }
    // Still this package's bug to report, but only that descendant's subtree is withheld.
    if (crashedDescendants > 0) notes.push(`${seam}: ${crashedDescendants} descendant transcript(s) crashed the parser — please report`);
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

  if (roots.opencodeData !== undefined) {
    const read = await readOpenCodeRunSessions(roots.opencodeData, limit, sinceMs);
    notes.push(...read.notes); degraded ||= read.degraded; runs.push(...read.runs);
  }

  // Deterministic order: newest activity first, ties broken by id so two runs updated in the same
  // millisecond do not swap places between snapshots.
  runs.sort((a, b) => compareStrings(b.updatedAt, a.updatedAt) || compareStrings(a.id, b.id));
  return { runs, notes, degraded, bytesRead, partial: partialTree };
}

/** The conventional store locations under a home directory. */
export function defaultRoots(home: string): BackfillRoots {
  return {
    claudeProjects: join(home, ".claude", "projects"),
    codexSessions: join(home, ".codex", "sessions"),
    opencodeDb: join(home, ".local", "share", "opencode", "opencode.db"),
    opencodeData: join(home, ".local", "share", "opencode"),
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
