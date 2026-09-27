/** Restartable JSONL source feed. The consuming cockpit owns durable replay. */
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { homedir } from "node:os";
import type { Writable } from "node:stream";
import { MAX_ISSUE_AGENT_TREE_BYTES, ISSUE_AGENT_TREE_FRESH_MS, readIssueAgentTreeSnapshot,
  type IssueAgentTreeFrame, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { backfillFromDisk, defaultRoots } from "./backfill/index.js";
import { buildAgentObservations } from "./agent-observations.js";
import { readDispatchEvidence } from "./dispatch-evidence.js";
import { buildIssueAgentTreeSnapshot } from "./issue-agent-feed.js";
import { foldLiveEvents, mergeLiveRuns, readLiveLog } from "./live.js";
import { logPaths, resolveObservability } from "./observability.js";
import { ORCHID_DISPATCH_ROOT, bindOrchidDispatchEvidence, readOrchidDispatches } from "./orchid-dispatch.js";

export interface IssueAgentFeedOptions {
  readonly home: string;
  readonly limit: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: string;
}

/** Read every source anew; a degraded read never inherits yesterday's complete tree. */
export async function collectIssueAgentTree(options: IssueAgentFeedOptions): Promise<IssueAgentTreeSnapshot> {
  const scan = await backfillFromDisk(defaultRoots(options.home), { limit: options.limit });
  const log = await readLiveLog(logPaths(resolveObservability(options.home, options.env)), options.now);
  const merged = mergeLiveRuns(scan.runs, foldLiveEvents(log.files));
  const orchid = await readOrchidDispatches(options.env[ORCHID_DISPATCH_ROOT]);
  const bound = bindOrchidDispatchEvidence(orchid.dispatches, readDispatchEvidence(log.files));
  const degraded = scan.degraded || log.degraded || merged.degraded || orchid.degraded || bound.degraded;
  const observations = buildAgentObservations({ dispatches: bound.dispatches, runs: merged.runs,
    observedAt: options.now, sourceBound: options.env[ORCHID_DISPATCH_ROOT] !== undefined,
    dispatchComplete: !log.degraded && !orchid.degraded && !bound.degraded,
    nativeComplete: !scan.degraded && !merged.degraded });
  if (degraded && observations.complete) {
    return unavailableSnapshot(options.now, "source_unavailable");
  }
  return buildIssueAgentTreeSnapshot({ observations, dispatches: bound.dispatches, runs: merged.runs });
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
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** `--watch` writes full snapshots and heartbeats; every new process starts seq 0. */
export async function issueAgentFeedCommand(args: readonly string[], deps: IssueAgentFeedDependencies = {}): Promise<number> {
  let home = homedir(), limit = 500, intervalMs = 5000, watch = false, json = false;
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
      else if (flag === "--interval-ms" && /^[1-9]\d*$/.test(args[i + 1] ?? "")) intervalMs = Number(args[++i]);
      else throw Error();
    }
    if ((!watch && !json) || limit > 5000 || intervalMs < 100 || intervalMs > 10_000) throw Error();
  } catch { process.stderr.write("issue-agents: invalid command line\n"); return 2; }
  const output = deps.output ?? process.stdout;
  const clock = deps.now ?? (() => new Date().toISOString());
  const collect = deps.collect ?? collectIssueAgentTree;
  const wait = deps.wait ?? ((ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal }));
  const env = deps.env ?? process.env;
  const generation = deps.generation?.() ?? randomUUID();
  const abort = new AbortController();
  let stopped = false, seq = 0;
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
      const at = clock();
      let snapshot: IssueAgentTreeSnapshot;
      try { snapshot = await collect({ home, limit, env, now: at }); }
      catch { snapshot = unavailableSnapshot(at); }
      if (stopped) break;
      const decoded = readIssueAgentTreeSnapshot(snapshot);
      if (!decoded.ok) snapshot = unavailableSnapshot(at, decoded.reason === "oversized" ? "scan_limit" : "source_unavailable");
      else snapshot = decoded.snapshot;
      const emittedAt = clock();
      if (emittedAt >= snapshot.validUntil) snapshot = unavailableSnapshot(emittedAt, "source_unavailable");
      if (watch) {
        const frame: IssueAgentTreeFrame = { type: "snapshot", generation, sequence: seq++, snapshot };
        await write(frame);
      } else await write(snapshot);
      if (!watch) return snapshot.complete ? 0 : 3;
      try { await wait(intervalMs, abort.signal); } catch { if (!stopped) throw Error(); }
    } while (!stopped);
    return 0;
  } catch { process.stderr.write("issue-agents: output unavailable\n"); return 3; }
  finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    output.removeListener("error", stop); output.removeListener("close", stop);
  }
}
