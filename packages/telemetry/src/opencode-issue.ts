/**
 * The OpenCode issue read, through the server port (`opencode-reads.ts`): the one bound root session,
 * its explicit children (`parentID`), and each one's latest messages. No session list, no store file,
 * no neighbour that merely shares a directory. Every read is byte-capped against one issue budget and
 * cancelled with the caller's signal.
 *
 * Every reply is in before any native clock is judged: the observation clock is read once the reads
 * are done, so a fact the server wrote while it was being read is not mistaken for one from the
 * future, and a clock still later than that one is. The scan returns that clock, and the caller
 * stamps its snapshot no earlier, so no published fact is newer than the frame that carries it.
 *
 * Unknown is not failed: a root the server answers `404` for is `binding_unavailable`, a server that
 * cannot be read or a reply that is not an SDK shape is `source_unavailable`, a bound passed is
 * `scan_limit`. Each of them is no runs at all, never a partial or invented timeline.
 */
import type { NativeReadBounds, NativeReadOutcome } from "@rickylabs/harness-contracts";
import type { RunRecord } from "./model.js";
import type { OpenCodeSessionReads } from "./opencode-reads.js";
import { openCodeRun, readOpenCodeSession, sessionID, type OpenCodeSessionHead } from "./opencode-session.js";

/** Messages read per session: the latest ones, which hold the current turn and far more than the 20 published steps. */
export const MAX_OPENCODE_MESSAGES = 100;
/** Reply bytes one issue may read, across every session in its tree. */
export const MAX_OPENCODE_ISSUE_BYTES = 8 * 1_048_576;
const MAX_SESSIONS = 20;
/** While replies are still arriving only their shape is checked; their clocks are judged after the last one. */
const UNJUDGED = Number.MAX_SAFE_INTEGER;

export interface OpenCodeIssueScan {
  readonly runs: readonly RunRecord[];
  readonly bytesRead: number;
  readonly reason: "scan_limit" | "source_unavailable" | "binding_unavailable" | null;
  /** Every session id this read reached, root first: a private change-watch hint, never published. */
  readonly sessions: readonly string[];
  /** The observation clock the runs were judged against, read after the last reply; null without runs. */
  readonly observedMs: number | null;
}
export interface OpenCodeIssueBounds {
  readonly limit: number;
  readonly maxBytes: number;
  /** The observation clock, in epoch ms. Read once, after every reply has arrived. */
  readonly clock: () => number;
  readonly signal: AbortSignal;
}

class Missing extends Error {}

/**
 * A run whose own turn ended, held open only by a descendant observed running. A descendant that is
 * merely unknown (registered, empty, or with a finish this reader does not know) is left unknown on
 * its own row: it is no evidence that anything is executing, so it never erases a confirmed end.
 */
function heldOpen(runs: RunRecord[]): void {
  const parentOf = new Map(runs.map(run => [run.id, run.parentId]));
  const descends = (run: RunRecord, ancestor: string): boolean => {
    // The tree is acyclic by construction: every child names a parent read before it.
    for (let parent = run.parentId; parent !== null; parent = parentOf.get(parent) ?? null) if (parent === ancestor) return true;
    return false;
  };
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.outcome !== "complete" || !runs.some(other => other.outcome === "running" && descends(other, run.id))) continue;
    const { terminalAt: _at, terminalCause: _cause, ...open } = run;
    runs[i] = { ...open, outcome: "running" };
  }
}

export async function readOpenCodeIssue(reads: OpenCodeSessionReads, root: string,
  bounds: OpenCodeIssueBounds): Promise<OpenCodeIssueScan> {
  let bytesRead = 0;
  const sessions: string[] = [];
  const budget = Math.min(bounds.maxBytes, MAX_OPENCODE_ISSUE_BYTES);
  const fail = (reason: OpenCodeIssueScan["reason"]): OpenCodeIssueScan =>
    ({ runs: [], bytesRead, reason, sessions, observedMs: null });
  /** One read against what is left of the budget; anything but `ok` ends the issue's read. */
  const body = async (call: (each: NativeReadBounds) => Promise<NativeReadOutcome>): Promise<unknown> => {
    if (budget - bytesRead <= 0) throw new RangeError();
    const read = await call({ maxBytes: budget - bytesRead, signal: bounds.signal });
    bytesRead += read.bytes;
    if (read.kind === "ok") return read.body;
    throw read.kind === "oversized" ? new RangeError() : read.kind === "missing" ? new Missing() : new Error();
  };
  try {
    if (!sessionID(root)) return fail("source_unavailable");
    if (bounds.limit < 1) return fail("scan_limit");
    let rootReply: unknown;
    try { rootReply = await body(each => reads.session(root, each)); }
    catch (error) { if (error instanceof Missing) return fail("binding_unavailable"); throw error; }
    const rootHead = readOpenCodeSession(rootReply, UNJUDGED);
    if (rootHead === null || rootHead.id !== root || rootHead.parentID !== null) return fail("source_unavailable");
    const tree: { head: OpenCodeSessionHead; reply: unknown; messages?: unknown[] }[] = [{ head: rootHead, reply: rootReply }];
    sessions.push(root);
    const maxSessions = Math.min(bounds.limit, MAX_SESSIONS);
    for (let cursor = 0; cursor < tree.length; cursor++) {
      const parent = tree[cursor]!.head;
      const children = await body(each => reads.children(parent.id, each));
      if (!Array.isArray(children)) return fail("source_unavailable");
      for (const reply of children) {
        const child = readOpenCodeSession(reply, UNJUDGED);
        if (child === null || child.parentID !== parent.id || sessions.includes(child.id)) return fail("source_unavailable");
        tree.push({ head: child, reply }); sessions.push(child.id);
        if (tree.length > maxSessions) return fail("scan_limit");
      }
    }
    for (const node of tree) {
      const messages = await body(each => reads.messages(node.head.id, MAX_OPENCODE_MESSAGES + 1, each));
      if (!Array.isArray(messages)) return fail("source_unavailable");
      node.messages = messages;
    }
    const observedMs = bounds.clock();
    const runs: RunRecord[] = [];
    for (const { reply, messages } of tree) {
      const head = readOpenCodeSession(reply, observedMs);
      if (head === null) return fail("source_unavailable");
      const windowed = messages!.length > MAX_OPENCODE_MESSAGES;
      const run = openCodeRun(head, windowed ? messages!.slice(-MAX_OPENCODE_MESSAGES) : messages!, windowed,
        `opencode-session:${head.id}`, observedMs);
      if (run === null) return fail("source_unavailable");
      runs.push(run);
    }
    heldOpen(runs);
    return { runs, bytesRead, reason: null, sessions, observedMs };
  } catch (error) { return fail(error instanceof RangeError ? "scan_limit" : "source_unavailable"); }
}
