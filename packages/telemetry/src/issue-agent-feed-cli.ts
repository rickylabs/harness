/** Native JSONL source feed. The consuming cockpit owns durable replay and KV publication. */
import { randomUUID } from "node:crypto";
import { resolveNativeOperatorBindings } from "./operator-environment.js";
import { resolveWireFamily } from "./producer-names.js";
import { setTimeout as sleep } from "node:timers/promises";
import { isAbsolute } from "node:path";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { MAX_ISSUE_AGENT_TREE_BYTES, readIssueAgentTreeSnapshot,
  type IssueAgentTreeFrame, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { collectLegacyIssueAgentTree } from "./issue-agent-feed-legacy.js";
import { collectNativeIssueAgents, unavailableNativeTree } from "./native-issue-agents.js";
import { openIssueFeedChanges, type IssueFeedChanges } from "./issue-agent-feed-changes.js";

export interface IssueAgentFeedOptions {
  readonly home: string;
  readonly limit: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: string;
  readonly issueKey?: string;
  readonly nativeSnapshot?: unknown;
  readonly partialTrees?: boolean;
  /** Private watch hints for the previous source, never execution evidence. */
  readonly watchFiles?: Set<string>;
  readonly watchStoreRoots?: Set<string>;
}
/** Current native roots select exact Orchid records; retained receipts never select a run. */
export async function collectIssueAgentTree(options: IssueAgentFeedOptions): Promise<IssueAgentTreeSnapshot> {
  try {
    resolveWireFamily(options.env);
    const bindings = resolveNativeOperatorBindings(options.env);
    if (bindings.dispatchRoot !== undefined && !isAbsolute(bindings.dispatchRoot)) throw Error();
    if (bindings.dispatchRoot === undefined) return unavailableNativeTree(options.now, "source_not_bound");
    if (bindings.orchidRunSocket === undefined) return await collectLegacyIssueAgentTree(options);
    return (await collectNativeIssueAgents(options)).issueAgentTree;
  } catch { return unavailableNativeTree(options.now); }
}
const unavailableSnapshot = unavailableNativeTree;

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

/** Well below the 30-second contract freshness limit, including scan time. */
const SAFETY_RESCAN_MS = 12_000;

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
    bindings = { dispatchRoot: undefined, orchidRunSocket: undefined, claudeChildEventRoot: undefined, placementHost: undefined };
  }
  const changes = watch && !configurationUnavailable ? deps.changes ?? (deps.collect === undefined
    ? openIssueFeedChanges(bindings.orchidRunSocket) : undefined) : undefined;
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
        const at = clock();
        try {
          if (configurationUnavailable) throw Error();
          snapshot = await collect({ home, limit, env, now: at,
          ...(partialTrees ? { partialTrees } : {}), ...(issueKey === undefined ? {} : { issueKey }) }); }
        catch { snapshot = unavailableSnapshot(at); }
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
      const waiting = new AbortController();
      const signal = AbortSignal.any([abort.signal, waiting.signal]);
      try {
        const timer = wait(Math.min(intervalMs, untilSafety), signal);
        await (changes ? Promise.race([timer, changes.wait(signal)]) : timer);
      } catch { if (!stopped) throw Error(); }
      // Each heartbeat/event cancels its losing waiter; neither timers nor listeners accumulate.
      finally { waiting.abort(); }
    } while (!stopped);
    return 0;
  } catch { process.stderr.write("issue-agents: output unavailable\n"); return 3; }
  finally {
    changes?.close();
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    output.removeListener("error", stop); output.removeListener("close", stop);
  }
}
