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
import { transcriptAsOf, type ParsedTranscript } from "./jsonl.js";
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
   * Issue feed only: why a dispatch-matched Codex tree was read in part. The root is always read
   * whole or the scan is degraded instead; these name the descendants that may be missing. Empty
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
 * A descendant omitted for either transcript reason takes its own descendants with it, so the
 * agents served are always a closed tree from the roots.
 */
export const CODEX_TREE_PARTIAL_REASONS = ["descendant_heads_bound", "descendant_heads_budget",
  "descendant_head_unreadable", "selected_files_bound", "descendant_transcript_bound",
  "descendant_transcript_unreadable"] as const;
export type CodexTreePartialReason = typeof CODEX_TREE_PARTIAL_REASONS[number];

/** One transcript found on disk, with the filesystem's own record of when it was last written. */
interface Transcript {
  readonly path: string;
  readonly mtimeMs: number;
}
/** A canonical rollout name: its creation clock and session id, read from the name alone. */
interface CodexName {
  readonly path: string;
  readonly createdMs: number;
  readonly id: string;
}
interface CodexHead {
  readonly id: string;
  readonly parentId: string | null;
}
const CODEX_HEAD_BYTES = 65_536;
/** Descendant heads read per issue scan, newest first. The root is found by name, never counted. */
const CODEX_HEAD_CANDIDATES = 128;
/** Rollout names enumerated per issue scan. Past it the root itself may be unseen: refused. */
const CODEX_WINDOW_NAMES = 4_096;
/**
 * A descendant is created after its root, but rollout names carry the writer's local wall clock,
 * which a DST change can set back. Candidates are names no earlier than the root's minus this.
 */
const CODEX_SPAWN_CLOCK_MARGIN_MS = 2 * 3_600_000;

/**
 * Read the first session_meta line only; full files, including huge neighbours, stay unopened.
 * `charge` receives every byte as it is read, so an unreadable or refused head still pays for it.
 */
async function readCodexHead(path: string, charge: (bytes: number) => void): Promise<CodexHead | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) return null;
    const bytes = Buffer.allocUnsafe(CODEX_HEAD_BYTES + 1);
    let size = 0, lineEnd = -1;
    while (size < bytes.length && lineEnd < 0) {
      const { bytesRead } = await file.read(bytes, size, Math.min(512, bytes.length - size), size);
      charge(bytesRead);
      if (bytesRead === 0) break;
      lineEnd = bytes.subarray(size, size + bytesRead).indexOf(10);
      if (lineEnd >= 0) lineEnd += size;
      size += bytesRead;
    }
    if (size > CODEX_HEAD_BYTES) return null;
    if (lineEnd < 0) lineEnd = size; // A final JSONL record may omit its trailing newline.
    const line = JSON.parse(bytes.subarray(0, lineEnd).toString("utf8")) as unknown;
    if (typeof line !== "object" || line === null || Array.isArray(line) ||
        (line as Record<string, unknown>).type !== "session_meta") return null;
    const payload = (line as Record<string, unknown>).payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    const str = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
    const id = str(p.id) ?? str(p.session_id);
    if (id === null) return null;
    const source = typeof p.source === "object" && p.source !== null && !Array.isArray(p.source) ? p.source as Record<string, unknown> : null;
    const subagent = typeof source?.subagent === "object" && source.subagent !== null && !Array.isArray(source.subagent)
      ? source.subagent as Record<string, unknown> : null;
    const spawned = typeof subagent?.thread_spawn === "object" && subagent.thread_spawn !== null && !Array.isArray(subagent.thread_spawn)
      ? subagent.thread_spawn as Record<string, unknown> : null;
    const parents = new Set<string>();
    for (const candidate of [p.parent_thread_id, spawned?.parent_thread_id]) {
      if (candidate === undefined || candidate === null) continue;
      const parent = str(candidate);
      if (parent === null || parent.trim() !== parent) return null;
      parents.add(parent);
    }
    if (parents.size > 1 || parents.has(id)) return null;
    return { id, parentId: parents.values().next().value ?? null };
  } finally { await file.close(); }
}

interface CodexSelection {
  readonly selected: readonly { readonly file: Transcript; readonly head: CodexHead }[];
  readonly bytesRead: number;
  /** A note that refuses the scan: the root itself could not be established. */
  readonly refused: string | null;
  readonly partial: readonly CodexTreePartialReason[];
  /** The first `roots` selected rows are the roots; every later row is a descendant. */
  readonly roots: number;
}

/**
 * The dispatch-matched tree. Roots are found by their rollout name, which carries the session id,
 * and confirmed by their head; no neighbour is read to find them. Descendants are read from the
 * newest `CODEX_HEAD_CANDIDATES` names created no earlier than the earliest root, and linked to it
 * through their heads' parent ids. A bound reached on descendants makes the tree partial, never
 * refused. The selection lists parents before children, so a bounded prefix stays a closed tree.
 */
async function selectCodexIssue(names: readonly CodexName[], rootMatches: (id: string) => boolean,
  limit: number, remainingBytes: number): Promise<CodexSelection> {
  let bytesRead = 0;
  const partial = new Set<CodexTreePartialReason>();
  const charge = (bytes: number) => { bytesRead += bytes; };
  const fits = () => bytesRead + CODEX_HEAD_BYTES + 1 <= remainingBytes;
  const refuse = (note: string): CodexSelection => ({ selected: [], bytesRead, refused: note, partial: [], roots: 0 });
  const transcript = (name: CodexName): Transcript => ({ path: name.path, mtimeMs: name.createdMs });
  const roots = names.filter(name => rootMatches(name.id)).sort((a, b) => compareStrings(a.path, b.path));
  if (roots.length === 0) return { selected: [], bytesRead, refused: null, partial: [], roots: 0 };
  if (roots.length > limit) return refuse("codex: head or selected-file scan_limit");
  const rootHeads: { file: Transcript; head: CodexHead }[] = [];
  const ids = new Set<string>();
  for (const name of roots) {
    if (!fits()) return refuse("codex: head or selected-file scan_limit");
    let head: CodexHead | null;
    try { head = await readCodexHead(name.path, charge); } catch { head = null; }
    // The name says which session the file holds; a head that disagrees, or a second file under
    // the same name id, leaves the root unestablished.
    if (head === null || head.id !== name.id || ids.has(head.id)) return refuse("codex: candidate head could not be read");
    ids.add(head.id);
    rootHeads.push({ file: transcript(name), head });
  }
  const earliest = Math.min(...roots.map(name => name.createdMs)) - CODEX_SPAWN_CLOCK_MARGIN_MS;
  const candidates = names.filter(name => !roots.includes(name) && name.createdMs >= earliest)
    .sort((a, b) => b.createdMs - a.createdMs || compareStrings(a.path, b.path));
  if (candidates.length > CODEX_HEAD_CANDIDATES) partial.add("descendant_heads_bound");
  const heads: { file: Transcript; head: CodexHead }[] = [];
  const ambiguous = new Set<string>();
  for (const name of candidates.slice(0, CODEX_HEAD_CANDIDATES)) {
    if (!fits()) { partial.add("descendant_heads_budget"); break; }
    let head: CodexHead | null;
    try { head = await readCodexHead(name.path, charge); } catch { head = null; }
    if (head === null || head.id !== name.id) { partial.add("descendant_head_unreadable"); continue; }
    if (ids.has(head.id)) { ambiguous.add(head.id); continue; }
    ids.add(head.id);
    heads.push({ file: transcript(name), head });
  }
  if (ambiguous.size > 0) partial.add("descendant_head_unreadable");
  const children = new Map<string, { file: Transcript; head: CodexHead }[]>();
  for (const row of heads) {
    if (row.head.parentId === null || ambiguous.has(row.head.id)) continue;
    children.set(row.head.parentId, [...children.get(row.head.parentId) ?? [], row]);
  }
  // Breadth first from the roots, newest first within a generation.
  const tree = [...rootHeads];
  for (let i = 0; i < tree.length; i++) tree.push(...children.get(tree[i]!.head.id) ?? []);
  if (tree.length > limit) partial.add("selected_files_bound");
  return { selected: tree.slice(0, limit), bytesRead, refused: null, roots: rootHeads.length,
    partial: CODEX_TREE_PARTIAL_REASONS.filter(reason => partial.has(reason)) };
}

/**
 * Read the file as it stood when it was opened: never past the size measured then, plus one
 * sentinel byte that shows whether it grew. A file that grew keeps exactly the complete records it
 * held at open, including a final record without its newline when that record is complete JSON on
 * its own; bytes past the measured size are not yet seen and belong to the next read. `charge`
 * receives every byte as it is read, usable or not, so a refusal or an error still pays for it.
 */
async function readBounded(path: string, maxBytes: number, charge: (bytes: number) => void): Promise<string | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const bytes = Buffer.allocUnsafe(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      charge(bytesRead);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size <= info.size) return bytes.subarray(0, size).toString("utf8");
    const snapshot = bytes.subarray(0, info.size);
    const lastLine = snapshot.lastIndexOf(10) + 1;
    try {
      // Complete at open: it stays, whatever was appended after it.
      JSON.parse(snapshot.subarray(lastLine).toString("utf8"));
      return snapshot.toString("utf8");
    } catch {
      // Still being written at open: only the records before it were seen.
      return snapshot.subarray(0, lastLine).toString("utf8");
    }
  } finally { await file.close(); }
}

const CODEX_WINDOW_HEAD_BYTES = 262_144;
const CODEX_WINDOW_TAIL_BYTES = 2_097_152;

/**
 * A dispatch-matched rollout past the per-transcript read bound, as its first and last complete
 * records. The head holds the session identity, the tail the latest state; the middle stays unread.
 * Null when either part has no complete record. Nothing is read unless both windows and the tail's
 * one byte of look-behind fit the budget; `charge` receives every byte read, usable or not.
 */
async function readHeadTail(path: string, maxBytes: number, charge: (bytes: number) => void):
  Promise<{ readonly head: string; readonly tail: string } | null> {
  if (maxBytes < CODEX_WINDOW_HEAD_BYTES + CODEX_WINDOW_TAIL_BYTES + 1) return null;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) return null;
    const read = async (position: number, length: number) => {
      const bytes = Buffer.allocUnsafe(length);
      let size = 0;
      while (size < length) {
        const { bytesRead } = await file.read(bytes, size, length - size, position + size);
        charge(bytesRead);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      return bytes.subarray(0, size);
    };
    // The size is fixed here: lines a growing file appends later belong to the next read.
    const head = await read(0, Math.min(info.size, CODEX_WINDOW_HEAD_BYTES));
    const headEnd = head.lastIndexOf(10);
    const tailStart = Math.max(info.size - CODEX_WINDOW_TAIL_BYTES, head.length);
    // One byte of look-behind says whether the tail starts on a record boundary: the first record
    // begins after the first newline, so after a newline at the look-behind byte it is complete and
    // kept, while a clipped first record is dropped unparsed.
    const tail = await read(tailStart - 1, info.size - tailStart + 1);
    const tailFrom = tail.indexOf(10) + 1;
    if (headEnd < 0 || tailFrom === 0) return null;
    // The tail runs to the end of the file: a final record without its newline is still a record.
    return { head: head.subarray(0, headEnd + 1).toString("utf8"), tail: tail.subarray(tailFrom).toString("utf8") };
  } finally { await file.close(); }
}

/**
 * One run from a head and a tail window. Identity comes from the head. State comes only from the
 * tail: a turn the head saw finish says nothing about one the unread middle may have started, so
 * no outcome crosses the gap. The token history between the windows is unread and marked so.
 */
function headTailRun(head: RunRecord, tail: RunRecord): RunRecord {
  const samples = tail.tokenSamples;
  return {
    ...tail,
    startedAt: head.startedAt,
    identity: { model: tail.identity.model ?? head.identity.model, effort: tail.identity.effort ?? head.identity.effort,
      provider: head.identity.provider ?? tail.identity.provider, profile: head.identity.profile ?? tail.identity.profile },
    linkedIssues: head.linkedIssues,
    ...(samples === undefined ? {} : { tokenSamples: { ...samples, partial: true } }),
  };
}

type Scan =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "found"; readonly files: readonly Transcript[]; readonly skipped: number; readonly limited?: boolean;
      /** Codex issue scans only: canonical rollout names, enumerated without opening a file. */
      readonly names?: readonly CodexName[] };

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

/**
 * Visit an offset-safe envelope around receipt dates; filename clocks may be local to another process.
 * With `namesOnly`, canonical names are listed with their creation clock and session id and no
 * file is opened or stat'ed: an issue scan picks the ones it reads by name.
 */
async function collectCodexWindows(root: string, windows: NonNullable<BackfillOptions["codexWindows"]>, limit: number,
  offsetEnvelopeMs: number, namesOnly = false): Promise<Scan> {
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
  const names: CodexName[] = [];
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
        const match = /^rollout-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-([0-9a-f-]{36})\.jsonl$/.exec(entry.name);
        if (!entry.isFile() || !match || match[1] !== date) { skipped++; continue; }
        const created = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.000Z`);
        if (!Number.isFinite(created) || !windows.some(w =>
          created >= w.startMs - offsetEnvelopeMs && created <= w.endMs + offsetEnvelopeMs)) continue;
        const path = join(dir, entry.name);
        if (namesOnly) {
          names.push({ path, createdMs: created, id: match[5]! });
          if (names.length > limit) break;
          continue;
        }
        const found = await lstat(path).catch(() => null);
        if (!found?.isFile()) skipped++;
        else files.push({ path, mtimeMs: found.mtimeMs });
        if (files.length > limit) break;
      }
    } catch { skipped++; }
    if (limited || files.length > limit || names.length > limit) break;
  }
  return { kind: "found", files, skipped, limited, ...(namesOnly ? { names } : {}) };
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
        (options.maxTotalBytes ?? Infinity) - bytesRead);
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
            window = await readHeadTail(path, budget, charge);
          }
          if (bounded === null && window === null) {
            if (descendant !== null) omit(descendant, "descendant_transcript_bound"); // guard:descendant-bound-partial
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
          const first = parse(head, path), last = parse(identity + asOf(window.tail), path);
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
      else runs.push(parsed.run);
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
