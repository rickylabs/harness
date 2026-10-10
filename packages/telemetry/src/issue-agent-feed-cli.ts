import { resolveWireFamily } from "./producer-names.js";
/** Restartable JSONL source feed. The consuming cockpit owns durable replay. */
import { randomUUID, createHash } from "node:crypto";
import { resolveNativeOperatorBindings } from "./operator-environment.js";
import { setTimeout as sleep } from "node:timers/promises";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { MAX_AGENT_OBSERVATIONS, MAX_ISSUE_AGENT_TREE_BYTES, ISSUE_AGENT_TREE_FRESH_MS, readIssueAgentTreeSnapshot,
  type IssueLaunchBlock, type IssueAgentTree, type IssueAgentTreeFrame, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { backfillFromDisk, defaultRoots } from "./backfill/index.js";
import { scanClaudeIssue } from "./backfill/claude-issue.js";
import { scanAGYIssue } from "./backfill/agy.js";
import { readOpenCodeIssue } from "./opencode-issue.js";
import type { OpenCodeSessionReads } from "./opencode-reads.js";
import { openOpenCodeChanges, type OpenCodeChanges } from "./opencode-feed-changes.js";
import { baseUrlProblems, createSdkSessionReader } from "@rickylabs/provider-opencode";
import { buildAgentObservations } from "./agent-observations.js";
import { readClaudeChildStarts } from "./claude-child-events.js";
import { buildIssueAgentTreeSnapshot, combineIssueAgentTreeSnapshots } from "./issue-agent-feed.js";
import { readActionReceipts } from "./action-receipt-cli.js";
import { orchidHost } from "@rickylabs/host-orchid";
import type { OrchidReads } from "./host-reads.js";
import { readLocalHostCapacity } from "./host-capacity.js";
import { openIssueFeedChanges, type IssueFeedChanges } from "./issue-agent-feed-changes.js";
import type { DispatchEvidence, OrchidLaunchState } from "@rickylabs/harness-contracts";
import type { RunRecord } from "./model.js";
/** Composition root: the Orchid host behind the telemetry-owned port. */
const host: OrchidReads = orchidHost;

/** The OpenCode server behind its port, or why there is none: no url is not bound, a bad url is unavailable. */
export type OpenCodeServerBinding =
  | { readonly reads: OpenCodeSessionReads }
  | { readonly reason: "source_not_bound" | "source_unavailable" };
/** Composition root: `createSdkSessionReader` (`@opencode-ai/sdk`) behind the telemetry-owned port. */
export function openCodeServerBinding(baseUrl: string | undefined): OpenCodeServerBinding {
  if (baseUrl === undefined) return { reason: "source_not_bound" };
  if (baseUrlProblems(baseUrl).length > 0) return { reason: "source_unavailable" };
  return { reads: createSdkSessionReader({ baseUrl }) };
}
/** One issue's OpenCode reads finish within this, well inside the safety rescan, or the issue is unavailable. */
const OPENCODE_READ_MS = 5_000;
/** Well below the 30-second contract freshness limit, including scan time. */
export const SAFETY_RESCAN_MS = 12_000;

export interface IssueAgentFeedOptions {
  readonly home: string;
  readonly limit: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: string;
  /** Canonical, lower-case owner/repo#number. Omit for the full cockpit feed. */
  readonly issueKey?: string;
  /** Private paths for a watch loop; never enter the public snapshot. */
  readonly watchFiles?: Set<string>;
  /** Exact private roots certified by native bindings; only watch hints, never evidence. */
  readonly watchStoreRoots?: Set<string>;
  /**
   * Publish a bounded Codex tree as a `scan_limit` issue that keeps the agents it read (contract
   * 0.37 and later). Without it the issue is `scan_limit` with no agents, which every earlier
   * reader accepts: a reader on 0.36 or older rejects a whole snapshot holding a bounded row.
   */
  readonly partialTrees?: boolean;
  /** The OpenCode server; resolved from the environment when omitted. */
  readonly openCode?: OpenCodeServerBinding;
  /** Private OpenCode session ids the scan read, for the watch loop's event-stream hint; never published. */
  readonly watchOpenCodeSessions?: Set<string>;
  /** Cancels in-flight server reads when the feed stops. */
  readonly signal?: AbortSignal;
  /**
   * The observation clock in epoch ms, read after a server read finishes; `now` when omitted. The
   * snapshot is stamped with the latest such clock, so no fact a read saw is newer than its frame.
   */
  readonly clock?: () => number;
  /** The signal that ends one issue's server reads after `ms`; `AbortSignal.timeout` when omitted. */
  readonly deadline?: (ms: number) => AbortSignal;
}

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
const MAX_FRAME_TRANSCRIPT_BYTES = 32 * 1_048_576;

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

/** Read each bound issue independently; one stale receipt never blanks its neighbours. */
export async function collectIssueAgentTree(options: IssueAgentFeedOptions): Promise<IssueAgentTreeSnapshot> {
  let bindings: ReturnType<typeof resolveNativeOperatorBindings>;
  let wireFamily: ReturnType<typeof resolveWireFamily>;
  try { wireFamily = resolveWireFamily(options.env); bindings = resolveNativeOperatorBindings(options.env); }
  catch { return unavailableSnapshot(options.now, "source_unavailable"); }
  if (bindings.dispatchRoot === undefined) return unavailableSnapshot(options.now, "source_not_bound");
  const openCode = options.openCode ?? openCodeServerBinding(bindings.openCodeServer);
  const orchid = await host.readDispatches(bindings.dispatchRoot);
  const nowMs = Date.parse(options.now);
  if (!Number.isFinite(nowMs) || orchid.reason !== null) return unavailableSnapshot(options.now, "source_unavailable");
  const localCapacity = await readLocalHostCapacity(options.now, bindings.placementHost, {}, wireFamily);
  const actionScan = await readActionReceipts(bindings.dispatchRoot);
  const groups = new Map<string, { repo: IssueAgentTree["repo"]; issueNumber: number;
    dispatches: DispatchEvidence[]; refusal?: Extract<OrchidLaunchState, { state: "refused" }>;
    block?: IssueLaunchBlock }>();
  for (const launch of orchid.launchStates) {
    if ((launch.state !== "refused" && launch.state !== "blocked") || Date.parse(launch.observedAt) > nowMs) continue;
    const [owner, name] = launch.issue.repo.split("/");
    if (!owner || !name) continue;
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}#${launch.issue.number}`;
    if (options.issueKey !== undefined && key !== options.issueKey) continue;
    groups.set(key, { repo: { owner, name }, issueNumber: launch.issue.number, dispatches: [],
      ...(launch.state === "refused" ? { refusal: launch } : { block: {
        state: "blocked", reason: launch.reasonCode, at: launch.observedAt,
        dispatchId: launch.dispatchId, source: "orchid" } as const }) });
  }
  for (const dispatch of orchid.dispatches) {
    if (!dispatch.issue) continue;
    const [owner, name] = dispatch.issue.repo.split("/");
    if (!owner || !name) continue;
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}#${dispatch.issue.number}`;
    if (options.issueKey !== undefined && key !== options.issueKey) continue;
    let group = groups.get(key);
    if (!group) { group = { repo: { owner, name }, issueNumber: dispatch.issue.number, dispatches: [] }; groups.set(key, group); }
    group.dispatches.push(dispatch);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    Math.max(...b.dispatches.map(d => Date.parse(d.observedAt!)), b.refusal ? Date.parse(b.refusal.observedAt) : b.block ? Date.parse(b.block.at) : -Infinity) -
    Math.max(...a.dispatches.map(d => Date.parse(d.observedAt!)), a.refusal ? Date.parse(a.refusal.observedAt) : a.block ? Date.parse(a.block.at) : -Infinity));
  if (options.issueKey !== undefined && ordered.length === 0) {
    return unavailableSnapshot(options.now, orchid.degraded ? "source_unavailable" : "source_not_bound");
  }
  // Each issue's snapshot is built once the frame's clock is known: the latest clock any read was judged at.
  const entries: { repo: IssueAgentTree["repo"]; issueNumber: number; build: (at: string) => IssueAgentTreeSnapshot;
    launchBlock?: IssueLaunchBlock }[] = [];
  let remainingBytes = MAX_FRAME_TRANSCRIPT_BYTES, observedMs = nowMs;
  const clock = options.clock ?? (() => nowMs);
  for (const group of ordered.slice(0, MAX_AGENT_OBSERVATIONS)) {
    const entry = { repo: group.repo, issueNumber: group.issueNumber,
      build: (at: string) => unavailableSnapshot(at, "binding_unavailable"),
      ...(group.block === undefined ? {} : { launchBlock: group.block }) };
    const unavailable = (reason: IssueAgentTreeSnapshot["reason"]) => { entry.build = at => unavailableSnapshot(at, reason); };
    entries.push(entry);
    if (group.dispatches.length === 0 && group.refusal !== undefined) {
      const issue: IssueAgentTree = { repo: group.repo, issueNumber: group.issueNumber,
        complete: true, reason: null, dispatches: [], launchRefusal: {
          state: "refused", reason: group.refusal.reasonCode, at: group.refusal.observedAt,
          dispatchId: group.refusal.dispatchId, source: "orchid" } };
      entry.build = at => ({ schema: 1, protocol: 1, observedAt: at,
        validUntil: new Date(Date.parse(at) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
        revision: createHash("sha256").update(JSON.stringify(issue)).digest("hex"),
        complete: true, reason: null, issues: [issue] });
      continue;
    }
    if (group.dispatches.length === 0) continue;
    if (group.dispatches.some(d => (d.source !== "codex" && d.source !== "claude" && d.source !== "agy" && d.source !== "opencode") || d.observedAt === undefined)) continue;
    if (group.dispatches.length > MAX_ISSUE_DISPATCHES || remainingBytes <= 0 ||
        group.dispatches.some(d => !dispatchReadWindow(d, nowMs).readable)) {
      unavailable("scan_limit"); continue;
    }
    const issueFileLimit = Math.min(options.limit, MAX_ISSUE_FILES);
    const runs: RunRecord[] = [];
    let bounded = false;
    const codexDispatches = group.dispatches.filter(d => d.source === "codex");
    if (codexDispatches.length > 0) {
      const windows = codexDispatches.map(d => {
        const { startMs, endMs } = dispatchReadWindow(d, nowMs);
        return { startMs, endMs };
      });
      const codexSessions = defaultRoots(options.home).codexSessions;
      const scan = await backfillFromDisk(codexSessions === undefined ? {} : { codexSessions },
        { limit: issueFileLimit, codexWindows: windows,
          codexRootMatches: id => codexDispatches.some(dispatch => host.matchesNativeRootIdentity(dispatch, id, "codex")),
          maxTranscriptBytes: MAX_TRANSCRIPT_BYTES, maxTotalBytes: remainingBytes, notAfterMs: nowMs });
      remainingBytes -= scan.bytesRead;
      if (scan.degraded) {
        unavailable(scan.notes.some(note => note.includes("only the") || note.includes("read bound") || note.includes("scan_limit")) ? "scan_limit" : "source_unavailable");
        continue;
      }
      // The roots were read and their tree is exact; only its descendants were bounded.
      bounded = scan.partial.length > 0;
      if (bounded && options.partialTrees !== true) { unavailable("scan_limit"); continue; }
      runs.push(...scan.runs);
    }
    if (group.dispatches.some(d => d.source === "claude")) {
      const scan = await scanClaudeIssue(defaultRoots(options.home).claudeProjects!,
        id => group.dispatches.some(dispatch => host.matchesNativeRootIdentity(dispatch, id, "claude")),
        issueFileLimit - runs.length, MAX_TRANSCRIPT_BYTES, remainingBytes, nowMs);
      remainingBytes -= scan.bytesRead;
      if (scan.reason !== null) { unavailable(scan.reason); continue; }
      runs.push(...scan.runs);
    }
    let agyUnavailable = false;
    for (const dispatch of group.dispatches.filter(d => d.source === "agy")) {
      const store = host.agyStoreDirectory(dispatch);
      if (store === null) { agyUnavailable = true; break; }
      const scan = await scanAGYIssue(store, id => host.matchesNativeRootIdentity(dispatch, id, "agy"),
        issueFileLimit - runs.length, remainingBytes, nowMs);
      remainingBytes -= scan.bytesRead;
      for (const file of scan.files) options.watchFiles?.add(file);
      options.watchStoreRoots?.add(store);
      if (scan.reason !== null) { unavailable(scan.reason); agyUnavailable = true; break; }
      runs.push(...scan.runs);
    }
    if (agyUnavailable) continue;
    let openCodeUnavailable = false;
    for (const dispatch of group.dispatches.filter(d => d.source === "opencode")) {
      const id = host.openCodeSessionID(dispatch);
      if (id === null) { openCodeUnavailable = true; break; }
      if (!("reads" in openCode)) { unavailable(openCode.reason); openCodeUnavailable = true; break; }
      const timeout = (options.deadline ?? AbortSignal.timeout)(OPENCODE_READ_MS);
      const scan = await readOpenCodeIssue(openCode.reads, id, { limit: issueFileLimit - runs.length,
        maxBytes: remainingBytes, clock, signal: options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]) });
      remainingBytes -= scan.bytesRead;
      for (const session of scan.sessions) options.watchOpenCodeSessions?.add(session);
      if (scan.reason !== null || !await host.verifyOpenCodeBinding(dispatch)) {
        unavailable(scan.reason ?? "binding_unavailable");
        openCodeUnavailable = true; break;
      }
      observedMs = Math.max(observedMs, scan.observedMs ?? observedMs);
      runs.push(...scan.runs);
    }
    if (openCodeUnavailable) continue;
    for (const run of runs) options.watchFiles?.add(run.origin);
    const claudeChildStarts = new Map<string, string>();
    for (const dispatch of group.dispatches) {
      if (dispatch.source !== "claude") continue;
      const root = host.resolveNativeRoot(dispatch, runs);
      if (root === null) continue;
      const children = runs.filter(run => run.source === "claude" && run.parentId === root.id).map(run => run.id);
      const starts = await readClaudeChildStarts(bindings.claudeChildEventRoot, root.id,
        children, options.now, options.watchFiles);
      for (const [key, at] of starts) claudeChildStarts.set(key, at);
    }
    entry.build = at => buildIssueAgentTreeSnapshot({ wireFamily, dispatches: group.dispatches, runs,
      observations: buildAgentObservations({ wireFamily, dispatches: group.dispatches, runs,
        observedAt: at, sourceBound: true, dispatchComplete: true, nativeComplete: true, claudeChildStarts, host }),
      localCapacity, actions: actionScan.receipts, actionsComplete: actionScan.complete, bounded, host });
  }
  const observedAt = new Date(observedMs).toISOString();
  // A malformed receipt cannot be proven unrelated to a scoped issue.
  const combined = combineIssueAgentTreeSnapshots({ observedAt,
    entries: entries.map(({ build, ...entry }) => ({ ...entry, snapshot: build(observedAt) })),
    globalReason: groups.size > MAX_AGENT_OBSERVATIONS ? "scan_limit" : orchid.degraded ? "source_unavailable" : null });
  const issues = combined.issues.map(issue => {
    const key = `${issue.repo.owner.toLowerCase()}/${issue.repo.name.toLowerCase()}#${issue.issueNumber}`;
    const refusal = groups.get(key)?.refusal;
    return refusal === undefined ? issue : { ...issue, launchRefusal: { state: "refused" as const,
      reason: refusal.reasonCode, at: refusal.observedAt, dispatchId: refusal.dispatchId, source: "orchid" as const } };
  });
  const snapshot = { ...combined, issues,
    revision: createHash("sha256").update(JSON.stringify({ issues, reason: combined.reason })).digest("hex") };
  const decoded = readIssueAgentTreeSnapshot(snapshot);
  return decoded.ok ? decoded.snapshot : unavailableSnapshot(observedAt);
}

function unavailableSnapshot(at: string, reason: IssueAgentTreeSnapshot["reason"] = "source_unavailable"): IssueAgentTreeSnapshot {
  return { schema: 1, protocol: 1, observedAt: at, validUntil: new Date(Date.parse(at) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: createHash("sha256").update(`${at}\0${reason}`).digest("hex"),
    complete: false, reason, issues: [] };
}

export interface IssueAgentFeedDependencies {
  readonly collect?: (options: IssueAgentFeedOptions) => Promise<IssueAgentTreeSnapshot>;
  readonly output?: Writable;
  readonly now?: () => string;
  readonly generation?: () => string;
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly elapsed?: () => number;
  readonly changes?: IssueFeedChanges;
  readonly openCodeChanges?: OpenCodeChanges;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** `--watch` writes full snapshots and heartbeats; every new process starts seq 0. */
export async function issueAgentFeedCommand(args: readonly string[], deps: IssueAgentFeedDependencies = {}): Promise<number> {
  let home = homedir(), limit = 500, intervalMs = 5000, watch = false, json = false, partialTrees = false, issueKey: string | undefined;
  const seen = new Set<string>();
  try {
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]!;
      if (seen.has(flag)) throw Error();
      seen.add(flag);
      if (flag === "--watch") watch = true;
      else if (flag === "--json") json = true;
      else if (flag === "--partial-trees") partialTrees = true;
      else if (flag === "--home" && args[i + 1]?.startsWith("/")) home = args[++i]!;
      else if (flag === "--limit" && /^[1-9]\d*$/.test(args[i + 1] ?? "")) limit = Number(args[++i]);
      else if (flag === "--issue") {
        const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})#([1-9]\d*)$/.exec(args[++i] ?? "");
        if (!match || !Number.isSafeInteger(Number(match[3]))) throw Error();
        issueKey = `${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}#${Number(match[3])}`;
      }
      else if (flag === "--interval-ms" && /^[1-9]\d*$/.test(args[i + 1] ?? "")) intervalMs = Number(args[++i]);
      else throw Error();
    }
    if ((!watch && !json) || limit > 5000 || intervalMs < 100 || intervalMs > 10_000) throw Error();
  } catch { process.stderr.write("issue-agents: invalid command line\n"); return 2; }
  const output = deps.output ?? process.stdout;
  const clock = deps.now ?? (() => new Date().toISOString());
  const collect = deps.collect ?? collectIssueAgentTree;
  const wait = deps.wait ?? ((ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal }));
  const elapsed = deps.elapsed ?? (() => performance.now());
  const env = deps.env ?? process.env;
  let configurationUnavailable = false;
  let bindings: ReturnType<typeof resolveNativeOperatorBindings>;
  try { resolveWireFamily(env); bindings = resolveNativeOperatorBindings(env); }
  catch {
    configurationUnavailable = true;
    bindings = { dispatchRoot: undefined, claudeChildEventRoot: undefined, placementHost: undefined, openCodeServer: undefined };
  }
  const openCode = openCodeServerBinding(bindings.openCodeServer);
  const changes = watch && !configurationUnavailable ? deps.changes ?? (deps.collect === undefined
    ? openIssueFeedChanges(bindings.dispatchRoot, defaultRoots(home).codexSessions!,
      defaultRoots(home).claudeProjects, bindings.claudeChildEventRoot) : undefined) : undefined;
  const openCodeChanges = watch && !configurationUnavailable ? deps.openCodeChanges ??
    (deps.collect === undefined && "reads" in openCode ? openOpenCodeChanges(openCode.reads) : undefined) : undefined;
  const generation = deps.generation?.() ?? randomUUID();
  const abort = new AbortController();
  let stopped = false, seq = 0;
  let cached: IssueAgentTreeSnapshot | undefined;
  let scannedAt = Number.NEGATIVE_INFINITY;
  let rejectWrite: ((error: Error) => void) | undefined;
  const stop = () => { stopped = true; abort.abort(); rejectWrite?.(Error("output closed")); };
  output.on("error", stop); output.on("close", stop);
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const write = (value: unknown): Promise<void> => new Promise((resolve, reject) => {
    const line = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(line) > MAX_ISSUE_AGENT_TREE_BYTES + 1024) { reject(Error("oversized")); return; }
    rejectWrite = reject;
    try { output.write(line, error => { rejectWrite = undefined; error ? reject(error) : resolve(); }); }
    catch (error) { rejectWrite = undefined; reject(error); }
  });
  try {
    do {
      if (stopped) break;
      // Both are drained every pass, so a hint never outlives the scan it caused.
      const changed = [changes?.consume() ?? false, openCodeChanges?.consume() ?? false].includes(true);
      const scan = cached === undefined || changed || elapsed() - scannedAt >= SAFETY_RESCAN_MS;
      let snapshot = cached;
      if (scan) {
        const at = clock(), files = new Set<string>();
        const storeRoots = new Set<string>(), openCodeSessions = new Set<string>();
        try {
          if (configurationUnavailable) throw Error();
          snapshot = await collect({ home, limit, env, now: at, watchFiles: files, watchStoreRoots: storeRoots,
          openCode, watchOpenCodeSessions: openCodeSessions, signal: abort.signal, clock: () => Date.parse(clock()),
          ...(partialTrees ? { partialTrees } : {}), ...(issueKey === undefined ? {} : { issueKey }) }); }
        catch { snapshot = unavailableSnapshot(at); }
        changes?.setFiles(files, storeRoots);
        openCodeChanges?.watch(openCodeSessions);
        scannedAt = elapsed();
      }
      if (stopped) break;
      if (snapshot === undefined) throw Error();
      const decoded = readIssueAgentTreeSnapshot(snapshot);
      if (!decoded.ok) snapshot = unavailableSnapshot(clock(), decoded.reason === "oversized" ? "scan_limit" : "source_unavailable");
      else snapshot = decoded.snapshot;
      const emittedAt = clock();
      if (emittedAt >= snapshot.validUntil) {
        // An event may be missed, but a heartbeat may not extend the last disk observation.
        snapshot = unavailableSnapshot(emittedAt, "source_unavailable"); cached = undefined;
      } else cached = snapshot;
      if (watch) {
        const frame: IssueAgentTreeFrame = { type: "snapshot", generation, sequence: seq++, snapshot };
        await write(frame);
      } else await write(snapshot);
      if (!watch) return snapshot.complete ? 0 : 3;
      const untilSafety = Math.max(1, SAFETY_RESCAN_MS - (elapsed() - scannedAt));
      try { await wait(Math.min(intervalMs, untilSafety), abort.signal); } catch { if (!stopped) throw Error(); }
    } while (!stopped);
    return 0;
  } catch { process.stderr.write("issue-agents: output unavailable\n"); return 3; }
  finally {
    changes?.close(); openCodeChanges?.close();
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    output.removeListener("error", stop); output.removeListener("close", stop);
  }
}
