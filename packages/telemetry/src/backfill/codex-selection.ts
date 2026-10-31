/** Exact private native root selection; parents precede descendants within every bound. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { compareStrings } from "../order.js";
import { CODEX_TREE_PARTIAL_REASONS, type CodexTreePartialReason } from "./index.js";
import type { Transcript } from "./transcript-read.js";
/** A canonical rollout name: its creation clock and session id, read from the name alone. */
export interface CodexName {
  readonly path: string;
  readonly createdMs: number;
  readonly id: string;
}
export interface CodexHead {
  readonly id: string;
  readonly parentId: string | null;
}
const CODEX_HEAD_BYTES = 65_536;
/** Descendant heads read per issue scan, newest first. The root is found by name, never counted. */
const CODEX_HEAD_CANDIDATES = 128;
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
export async function selectCodexIssue(names: readonly CodexName[], rootMatches: (id: string) => boolean,
  limit: number, remainingBytes: number, priority?: (id: string) => number): Promise<CodexSelection> {
  let bytesRead = 0;
  const partial = new Set<CodexTreePartialReason>();
  const charge = (bytes: number) => { bytesRead += bytes; };
  const fits = () => bytesRead + CODEX_HEAD_BYTES + 1 <= remainingBytes;
  const refuse = (note: string): CodexSelection => ({ selected: [], bytesRead, refused: note, partial: [], roots: 0 });
  const transcript = (name: CodexName): Transcript => ({ path: name.path, mtimeMs: name.createdMs });
  const roots = names.filter(name => rootMatches(name.id)).sort((a, b) =>
    (priority?.(b.id) ?? -Infinity) - (priority?.(a.id) ?? -Infinity) || compareStrings(a.path, b.path));
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
