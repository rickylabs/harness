/**
 * The OpenCode issue read, through the server port (`opencode-reads.ts`): the one bound root session,
 * its explicit children (`parentID`), and each one's latest messages. No session list, no store file,
 * no neighbour that merely shares a directory. Every read is byte-capped against one issue budget and
 * cancelled with the caller's signal.
 *
 * Unknown is not failed: a root the server answers `404` for is `binding_unavailable`, a server that
 * cannot be read or a reply that is not an SDK shape is `source_unavailable`, a bound passed is
 * `scan_limit`. Each of them is no runs at all, never a partial or invented timeline.
 */
import type { RunRecord } from "./model.js";
import type { OpenCodeRead, OpenCodeReadBounds, OpenCodeSessionReads } from "./opencode-reads.js";
import { openCodeRun, readOpenCodeSession, sessionID } from "./opencode-session.js";

/** Messages read per session: the latest ones, which hold the current turn and far more than the 20 published steps. */
export const MAX_OPENCODE_MESSAGES = 100;
/** Reply bytes one issue may read, across every session in its tree. */
export const MAX_OPENCODE_ISSUE_BYTES = 8 * 1_048_576;
const MAX_SESSIONS = 20;

export interface OpenCodeIssueScan {
  readonly runs: readonly RunRecord[];
  readonly bytesRead: number;
  readonly reason: "scan_limit" | "source_unavailable" | "binding_unavailable" | null;
  /** Every session id this read reached, root first: a private change-watch hint, never published. */
  readonly sessions: readonly string[];
}
export interface OpenCodeIssueBounds {
  readonly limit: number;
  readonly maxBytes: number;
  readonly nowMs: number;
  readonly signal: AbortSignal;
}

class Missing extends Error {}

export async function readOpenCodeIssue(reads: OpenCodeSessionReads, root: string,
  bounds: OpenCodeIssueBounds): Promise<OpenCodeIssueScan> {
  let bytesRead = 0;
  const sessions: string[] = [];
  const budget = Math.min(bounds.maxBytes, MAX_OPENCODE_ISSUE_BYTES);
  const fail = (reason: OpenCodeIssueScan["reason"]): OpenCodeIssueScan => ({ runs: [], bytesRead, reason, sessions });
  /** One read against what is left of the budget; anything but `ok` ends the issue's read. */
  const body = async (call: (each: OpenCodeReadBounds) => Promise<OpenCodeRead>): Promise<unknown> => {
    if (budget - bytesRead <= 0) throw new RangeError();
    const read = await call({ maxBytes: budget - bytesRead, signal: bounds.signal });
    bytesRead += read.bytes;
    if (read.kind === "ok") return read.body;
    throw read.kind === "oversized" ? new RangeError() : read.kind === "missing" ? new Missing() : new Error();
  };
  try {
    if (!sessionID(root) || bounds.limit < 1) return fail("source_unavailable");
    let rootHead;
    try { rootHead = readOpenCodeSession(await body(each => reads.session(root, each)), bounds.nowMs); }
    catch (error) { if (error instanceof Missing) return fail("binding_unavailable"); throw error; }
    if (rootHead === null || rootHead.id !== root || rootHead.parentID !== null) return fail("source_unavailable");
    const heads = [rootHead];
    sessions.push(root);
    const maxSessions = Math.min(bounds.limit, MAX_SESSIONS);
    for (let cursor = 0; cursor < heads.length; cursor++) {
      const parent = heads[cursor]!;
      const children = await body(each => reads.children(parent.id, each));
      if (!Array.isArray(children)) return fail("source_unavailable");
      for (const value of children) {
        const child = readOpenCodeSession(value, bounds.nowMs);
        if (child === null || child.parentID !== parent.id || sessions.includes(child.id)) return fail("source_unavailable");
        heads.push(child); sessions.push(child.id);
        if (heads.length > maxSessions) return fail("scan_limit");
      }
    }
    const runs: RunRecord[] = [];
    for (const head of heads) {
      const messages = await body(each => reads.messages(head.id, MAX_OPENCODE_MESSAGES + 1, each));
      if (!Array.isArray(messages)) return fail("source_unavailable");
      const windowed = messages.length > MAX_OPENCODE_MESSAGES;
      const run = openCodeRun(head, windowed ? messages.slice(-MAX_OPENCODE_MESSAGES) : messages, windowed,
        `opencode-session:${head.id}`, bounds.nowMs);
      if (run === null) return fail("source_unavailable");
      runs.push(run);
    }
    // A pending descendant cannot make a root/tree appear fully Done.
    for (let i = 0; i < runs.length; i++) if (runs[i]!.outcome === "complete" && runs.some(run => {
      let parent = run.parentId;
      for (let depth = 0; parent !== null && depth < MAX_SESSIONS; depth++) {
        if (parent === runs[i]!.id) return run.outcome !== "complete" && run.outcome !== "failed";
        parent = runs.find(candidate => candidate.id === parent)?.parentId ?? null;
      }
      return false;
    })) { const { terminalAt: _at, terminalCause: _cause, ...run } = runs[i]!; runs[i] = { ...run, outcome: "running" }; }
    return { runs, bytesRead, reason: null, sessions };
  } catch (error) { return fail(error instanceof RangeError ? "scan_limit" : "source_unavailable"); }
}
