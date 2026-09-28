/** Restartable JSONL source feed. The consuming cockpit owns durable replay. */
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { MAX_AGENT_OBSERVATIONS, MAX_ISSUE_AGENT_TREE_BYTES, ISSUE_AGENT_TREE_FRESH_MS, readIssueAgentTreeSnapshot,
  type IssueAgentTree, type IssueAgentTreeFrame, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { backfillFromDisk, defaultRoots } from "./backfill/index.js";
import { buildAgentObservations } from "./agent-observations.js";
import { buildIssueAgentTreeSnapshot, combineIssueAgentTreeSnapshots } from "./issue-agent-feed.js";
import { readActionReceipts } from "./action-receipt-cli.js";
import { ORCHID_DISPATCH_ROOT, readOrchidDispatches } from "./orchid-dispatch.js";
import { matchesOrchidNativeRootIdentity } from "./orchid-native-binding.js";
import { HOST_CAPACITY_PLACEMENT_HOST, readLocalHostCapacity } from "./host-capacity.js";
import { openIssueFeedChanges, type IssueFeedChanges } from "./issue-agent-feed-changes.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";

export interface IssueAgentFeedOptions {
  readonly home: string;
  readonly limit: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: string;
  /** Canonical, lower-case owner/repo#number. Omit for the full cockpit feed. */
  readonly issueKey?: string;
  /** Private paths for a watch loop; never enter the public snapshot. */
  readonly watchFiles?: Set<string>;
}

const PRE_DISPATCH_MS = 600_000;
const MAX_DISPATCH_AGE_MS = 86_400_000;
const MAX_ISSUE_DISPATCHES = 8;
const MAX_ISSUE_FILES = 20;
const MAX_TRANSCRIPT_BYTES = 8 * 1_048_576;
const MAX_FRAME_TRANSCRIPT_BYTES = 32 * 1_048_576;

/** Read each bound issue independently; one stale receipt never blanks its neighbours. */
export async function collectIssueAgentTree(options: IssueAgentFeedOptions): Promise<IssueAgentTreeSnapshot> {
  if (options.env[ORCHID_DISPATCH_ROOT] === undefined) return unavailableSnapshot(options.now, "source_not_bound");
  const orchid = await readOrchidDispatches(options.env[ORCHID_DISPATCH_ROOT]);
  const nowMs = Date.parse(options.now);
  if (!Number.isFinite(nowMs) || orchid.reason !== null) return unavailableSnapshot(options.now, "source_unavailable");
  const localCapacity = await readLocalHostCapacity(options.now, options.env[HOST_CAPACITY_PLACEMENT_HOST]);
  const actionScan = await readActionReceipts(options.env[ORCHID_DISPATCH_ROOT]);
  const groups = new Map<string, { repo: IssueAgentTree["repo"]; issueNumber: number; dispatches: DispatchEvidence[] }>();
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
    Math.max(...b.dispatches.map(d => Date.parse(d.observedAt!))) - Math.max(...a.dispatches.map(d => Date.parse(d.observedAt!))));
  if (options.issueKey !== undefined && ordered.length === 0) {
    return unavailableSnapshot(options.now, orchid.degraded ? "source_unavailable" : "source_not_bound");
  }
  const entries: { repo: IssueAgentTree["repo"]; issueNumber: number; snapshot: IssueAgentTreeSnapshot }[] = [];
  let remainingBytes = MAX_FRAME_TRANSCRIPT_BYTES;
  for (const group of ordered.slice(0, MAX_AGENT_OBSERVATIONS)) {
    const entry = { repo: group.repo, issueNumber: group.issueNumber,
      snapshot: unavailableSnapshot(options.now, "binding_unavailable") };
    entries.push(entry);
    if (group.dispatches.some(d => d.source !== "codex" || d.observedAt === undefined)) continue;
    if (group.dispatches.length > MAX_ISSUE_DISPATCHES || remainingBytes <= 0 ||
        group.dispatches.some(d => nowMs > Date.parse(d.observedAt!) + MAX_DISPATCH_AGE_MS)) {
      entry.snapshot = unavailableSnapshot(options.now, "scan_limit"); continue;
    }
    const windows = group.dispatches.map(d => ({ startMs: Date.parse(d.observedAt!) - PRE_DISPATCH_MS, endMs: nowMs }));
    const codexSessions = defaultRoots(options.home).codexSessions;
    const scan = await backfillFromDisk(codexSessions === undefined ? {} : { codexSessions },
      { limit: Math.min(options.limit, MAX_ISSUE_FILES), codexWindows: windows,
        codexRootMatches: id => group.dispatches.some(dispatch => matchesOrchidNativeRootIdentity(dispatch, id)),
        maxTranscriptBytes: MAX_TRANSCRIPT_BYTES, maxTotalBytes: remainingBytes });
    for (const run of scan.runs) if (run.source === "codex") options.watchFiles?.add(run.origin);
    remainingBytes -= scan.bytesRead;
    if (scan.degraded) {
      entry.snapshot = unavailableSnapshot(options.now,
        scan.notes.some(note => note.includes("only the") || note.includes("read bound") || note.includes("scan_limit")) ? "scan_limit" : "source_unavailable");
      continue;
    }
    const observations = buildAgentObservations({ dispatches: group.dispatches, runs: scan.runs,
      observedAt: options.now, sourceBound: true, dispatchComplete: true, nativeComplete: true });
    entry.snapshot = buildIssueAgentTreeSnapshot({ observations, dispatches: group.dispatches, runs: scan.runs,
      localCapacity, actions: actionScan.receipts, actionsComplete: actionScan.complete });
  }
  // A malformed receipt cannot be proven unrelated to a scoped issue.
  return combineIssueAgentTreeSnapshots({ observedAt: options.now, entries,
    globalReason: groups.size > MAX_AGENT_OBSERVATIONS ? "scan_limit" : orchid.degraded ? "source_unavailable" : null });
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
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Below the 15-second contract freshness limit, including scan time. */
const SAFETY_RESCAN_MS = 12_000;

/** `--watch` writes full snapshots and heartbeats; every new process starts seq 0. */
export async function issueAgentFeedCommand(args: readonly string[], deps: IssueAgentFeedDependencies = {}): Promise<number> {
  let home = homedir(), limit = 500, intervalMs = 5000, watch = false, json = false, issueKey: string | undefined;
  const seen = new Set<string>();
  try {
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]!;
      if (seen.has(flag)) throw Error();
      seen.add(flag);
      if (flag === "--watch") watch = true;
      else if (flag === "--json") json = true;
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
  const changes = watch ? deps.changes ?? (deps.collect === undefined
    ? openIssueFeedChanges(env[ORCHID_DISPATCH_ROOT], defaultRoots(home).codexSessions!) : undefined) : undefined;
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
      const changed = changes?.consume() ?? false;
      const scan = cached === undefined || changed || elapsed() - scannedAt >= SAFETY_RESCAN_MS;
      let snapshot = cached;
      if (scan) {
        const at = clock(), files = new Set<string>();
        try { snapshot = await collect({ home, limit, env, now: at, watchFiles: files,
          ...(issueKey === undefined ? {} : { issueKey }) }); }
        catch { snapshot = unavailableSnapshot(at); }
        changes?.setFiles(files);
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
    changes?.close();
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    output.removeListener("error", stop); output.removeListener("close", stop);
  }
}
