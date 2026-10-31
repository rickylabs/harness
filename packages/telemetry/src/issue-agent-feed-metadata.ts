/** Supplemental bounded native metadata; callers decide execution authority and partial-tree policy. */
import { lstat } from "node:fs/promises";
import { orchidHost as host } from "@rickylabs/host-orchid";
import type { DispatchEvidence, IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { backfillFromDisk, defaultRoots } from "./backfill/index.js";
import { scanClaudeIssue } from "./backfill/claude-issue.js";
import { scanAGYIssue } from "./backfill/agy.js";
import { scanOpenCodeIssue } from "./backfill/opencode-issue.js";
import { openCodeRunStorePath, scanOpenCodeRunStore } from "./backfill/opencode-run-store.js";
import { readClaudeChildStarts } from "./claude-child-events.js";
import { resolveNativeOperatorBindings } from "./operator-environment.js";
import type { IssueAgentFeedOptions } from "./issue-agent-feed-cli.js";
import type { RunRecord } from "./model.js";
const PRE_DISPATCH_MS = 600_000;
/** A dispatch with no end evidence is read for at most this long after it was dispatched. */
export const RUNNING_DISPATCH_CAP_MS = 7 * 86_400_000;
/** An ended run is read for this long after its end, so its final tree is served complete. */
export const ENDED_RUN_WINDOW_MS = 86_400_000;
/** Native files written just after the end (a final record, a late child) still belong to the run. */
const POST_END_MS = 600_000;
const MAX_ISSUE_DISPATCHES = 8;
const MAX_ISSUE_FILES = 20;
const MAX_TRANSCRIPT_BYTES = 8 * 1_048_576;
export const MAX_FRAME_METADATA_BYTES = 32 * 1_048_576;

/**
 * When Orchid saw the root end: the later of a paired seat and process absence, for a stop or an
 * ordinary teardown, exactly the pair the tree treats as ended. The earliest such end counts; a
 * lone seat or process observation, or one stamped after the read, is no end.
 */
export function dispatchEndMs(dispatch: DispatchEvidence, nowMs: number): number | null {
  const ends: number[] = [];
  for (const pair of [dispatch.stop, dispatch.teardown]) {
    const seat = Date.parse(pair?.seatObservedAt ?? ""), process = Date.parse(pair?.processObservedAt ?? "");
    if (Number.isFinite(seat) && Number.isFinite(process)) ends.push(Math.max(seat, process)); // guard:window-end-pair
  }
  const end = ends.length === 0 ? null : Math.min(...ends);
  return end !== null && end <= nowMs ? end : null; // guard:window-end-not-future
}

/**
 * The issue feed reads a dispatch while its run can still change or its final tree is fresh:
 * without an end, until the running cap after dispatch; once ended (within that cap), until the
 * ended window after its end. Its native window runs from just before dispatch to just after the
 * end (or now), so it never spans more than the cap plus both margins.
 */
export function dispatchReadWindow(dispatch: DispatchEvidence, nowMs: number):
  { readonly readable: boolean; readonly startMs: number; readonly endMs: number } {
  const dispatchedMs = Date.parse(dispatch.observedAt ?? "");
  const startMs = dispatchedMs - PRE_DISPATCH_MS;
  if (!Number.isFinite(dispatchedMs)) return { readable: false, startMs, endMs: nowMs };
  const endedMs = dispatchEndMs(dispatch, nowMs);
  if (endedMs === null) return { readable: nowMs <= dispatchedMs + RUNNING_DISPATCH_CAP_MS, startMs, endMs: nowMs }; // guard:window-running-cap
  return { readable: nowMs <= endedMs + ENDED_RUN_WINDOW_MS && endedMs <= dispatchedMs + RUNNING_DISPATCH_CAP_MS, // guard:window-ended
    startMs, endMs: Math.min(nowMs, endedMs + POST_END_MS) }; // guard:window-native-end
}


export interface IssueAgentMetadata {
  readonly runs: readonly RunRecord[];
  readonly claudeChildStarts: ReadonlyMap<string, string>;
  readonly bounded: boolean;
  readonly reason: IssueAgentTreeSnapshot["reason"];
}
/** A shared byte budget covers every issue in a frame, including fallback metadata. */
export async function readIssueAgentMetadata(options: IssueAgentFeedOptions & {
  readonly dispatches: readonly DispatchEvidence[];
  readonly budget: { remainingBytes: number };
  readonly currentNative?: boolean;
}): Promise<IssueAgentMetadata> {
  const bindings = resolveNativeOperatorBindings(options.env);
  const runs: RunRecord[] = [], claudeChildStarts = new Map<string, string>();
  let bounded = false;
  if (options.dispatches.length > MAX_ISSUE_DISPATCHES || options.budget.remainingBytes <= 0 ||
      !options.currentNative && options.dispatches.some(d => !dispatchReadWindow(d, Date.parse(options.now)).readable)) {
    return { runs, claudeChildStarts, bounded: true, reason: "scan_limit" };
  }
  const issueFileLimit = Math.min(options.limit, MAX_ISSUE_FILES);
  const codexDispatches = options.dispatches.filter(d => d.source === "codex");
  if (codexDispatches.length > 0) {
    const windows = codexDispatches.map(d => {
      const { startMs, endMs } = options.currentNative
        ? { startMs: Date.parse(d.observedAt!) - PRE_DISPATCH_MS, endMs: Date.parse(options.now) }
        : dispatchReadWindow(d, Date.parse(options.now));
      return { startMs, endMs };
    });
    const codexSessions = defaultRoots(options.home).codexSessions;
    const scan = await backfillFromDisk(codexSessions === undefined ? {} : { codexSessions },
      { limit: issueFileLimit, codexWindows: windows,
        codexRootMatches: id => codexDispatches.some(dispatch => host.matchesNativeRootIdentity(dispatch, id, "codex")),
        maxTranscriptBytes: MAX_TRANSCRIPT_BYTES, maxTotalBytes: options.budget.remainingBytes, notAfterMs: Date.parse(options.now) });
    options.budget.remainingBytes -= scan.bytesRead;
    if (scan.degraded) return { runs, claudeChildStarts, bounded: scan.notes.some(note => /bound|limit|only the/.test(note)),
      reason: scan.notes.some(note => /bound|limit|only the/.test(note)) ? "scan_limit" : "source_unavailable" };
    // The roots were read and their tree is exact; only its descendants were bounded.
    bounded = scan.partial.length > 0;
    runs.push(...scan.runs);
  }
  if (options.dispatches.some(d => d.source === "claude")) {
    const scan = await scanClaudeIssue(defaultRoots(options.home).claudeProjects!,
      id => options.dispatches.some(dispatch => host.matchesNativeRootIdentity(dispatch, id, "claude")),
      issueFileLimit - runs.length, MAX_TRANSCRIPT_BYTES, options.budget.remainingBytes, Date.parse(options.now));
    options.budget.remainingBytes -= scan.bytesRead;
    if (scan.reason !== null) return { runs, claudeChildStarts, bounded: scan.reason === "scan_limit", reason: scan.reason };
    runs.push(...scan.runs);
  }
  for (const dispatch of options.dispatches.filter(d => d.source === "agy")) {
    const store = host.agyStoreDirectory(dispatch);
    if (store === null) return { runs, claudeChildStarts, bounded, reason: "binding_unavailable" };
    const scan = await scanAGYIssue(store, id => host.matchesNativeRootIdentity(dispatch, id, "agy"),
      issueFileLimit - runs.length, options.budget.remainingBytes, Date.parse(options.now));
    options.budget.remainingBytes -= scan.bytesRead;
    for (const file of scan.files) options.watchFiles?.add(file);
    options.watchStoreRoots?.add(store);
    if (scan.reason !== null) return { runs, claudeChildStarts, bounded: scan.reason === "scan_limit", reason: scan.reason };
    runs.push(...scan.runs);
  }

  for (const dispatch of options.dispatches.filter(d => d.source === "opencode")) {
    const id = host.openCodeSessionID(dispatch);
    if (id === null) return { runs, claudeChildStarts, bounded, reason: "binding_unavailable" };
    // A 2.x run owns its run database; a session without one is a 1.x run that ended in the legacy store.
    const roots = defaultRoots(options.home), runStore = openCodeRunStorePath(roots.opencodeData!, id);
    const legacy = runStore === null || await lstat(runStore).then(() => false, () => true);
    const path = legacy ? roots.opencodeDb! : runStore!;
    const scan = await (legacy ? scanOpenCodeIssue : scanOpenCodeRunStore)(path, id, issueFileLimit - runs.length,
      options.budget.remainingBytes, Date.parse(options.now));
    options.budget.remainingBytes -= scan.bytesRead;
    for (const file of scan.files) options.watchFiles?.add(file);
    options.watchStoreRoots?.add(path.slice(0, path.lastIndexOf("/")));
    if (scan.reason !== null || !await host.verifyOpenCodeBinding(dispatch)) {
      return { runs, claudeChildStarts, bounded: scan.reason === "scan_limit", reason: scan.reason ?? "binding_unavailable" };
    }
    runs.push(...scan.runs);
  }

  for (const run of runs) options.watchFiles?.add(run.origin);
  for (const dispatch of options.dispatches) {
    if (dispatch.source !== "claude") continue;
    const root = host.resolveNativeRoot(dispatch, runs);
    if (root === null) continue;
    const children = runs.filter(run => run.source === "claude" && run.parentId === root.id).map(run => run.id);
    const starts = await readClaudeChildStarts(bindings.claudeChildEventRoot, root.id,
      children, options.now, options.watchFiles);
    for (const [key, at] of starts) claudeChildStarts.set(key, at);
  }
  return { runs, claudeChildStarts, bounded, reason: null };
}
