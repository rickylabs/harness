/** Test-only composition of historical scanner output into the public pure tree projector. */
import { orchidHost } from "@rickylabs/host-orchid";
import { buildAgentObservations } from "../agent-observations.js";
import { buildIssueAgentTreeSnapshot } from "../issue-agent-feed.js";
import { backfillFromDisk, defaultRoots } from "../backfill/index.js";
import { scanClaudeIssue } from "../backfill/claude-issue.js";
import { scanAGYIssue } from "../backfill/agy.js";
import { scanOpenCodeIssue } from "../backfill/opencode-issue.js";
import { openCodeRunStorePath, scanOpenCodeRunStore } from "../backfill/opencode-run-store.js";
import { readActionReceipts } from "../action-receipt-cli.js";
import { lstat } from "node:fs/promises";
import { readClaudeChildStarts } from "../claude-child-events.js";
import { resolveNativeOperatorBindings } from "../operator-environment.js";
import { resolveWireFamily } from "../producer-names.js";
import { combineIssueAgentTreeSnapshots } from "../issue-agent-feed.js";
import { unavailableNativeTree } from "../native-issue-agents.js";
import type { IssueAgentFeedOptions } from "../issue-agent-feed-cli.js";
import type { RunRecord } from "../model.js";

/** Historical metadata parity only. Production live intake never calls these scanners. */
export async function projectHistoricalIssueFixture(options: IssueAgentFeedOptions) {
  const config = resolveNativeOperatorBindings(options.env);
  const wireFamily = resolveWireFamily(options.env);
  const receipts = await orchidHost.readDispatches(config.dispatchRoot);
  const actions = await readActionReceipts(config.dispatchRoot);
  const groups = new Map<string, typeof receipts.dispatches[number][]>();
  for (const d of receipts.dispatches) {
    if (!d.issue) continue;
    const key = d.issue.repo.toLowerCase() + "#" + d.issue.number;
    if (options.issueKey && options.issueKey !== key) continue;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  if (options.issueKey && groups.size === 0) return unavailableNativeTree(options.now, "source_not_bound");
  const entries = [];
  for (const ds of groups.values()) {
    const first = ds[0]!;
    const [owner, name] = first.issue!.repo.split("/") as [string, string];
    const runs: RunRecord[] = []; let reason: import("@rickylabs/harness-contracts").IssueAgentTreeSnapshot["reason"] = null, bounded = false;
    if (ds.some(d => d.source === "codex")) {
      const roots = defaultRoots(options.home);
      const scan = await backfillFromDisk({ codexSessions: roots.codexSessions! }, {
        limit: options.limit, maxTranscriptBytes: 8 * 1_048_576, maxTotalBytes: 32 * 1_048_576,
        notAfterMs: Date.parse(options.now),
        codexWindows: ds.filter(d => d.source === "codex").map(d => ({ startMs: Date.parse(d.observedAt!) - 600_000, endMs: Date.parse(options.now) })),
        codexRootMatches: id => ds.some(d => orchidHost.matchesNativeRootIdentity(d, id, "codex")),
      });
      runs.push(...scan.runs); bounded = scan.partial.length > 0;
      if (scan.degraded) reason = scan.notes.some(n => /bound|limit|only the/.test(n)) ? "scan_limit" : "source_unavailable";
    }
    if (ds.some(d => d.source === "claude")) {
      const scan = await scanClaudeIssue(defaultRoots(options.home).claudeProjects!,
        id => ds.some(d => orchidHost.matchesNativeRootIdentity(d, id, "claude")), options.limit, 8 * 1_048_576, 32 * 1_048_576, Date.parse(options.now));
      runs.push(...scan.runs); reason ??= scan.reason;
    }
    for (const d of ds.filter(d => d.source === "agy" || d.source === "opencode")) {
      if (d.source === "agy") {
        const store = orchidHost.agyStoreDirectory(d);
        if (store === null) { reason = "binding_unavailable"; continue; }
        const scan = await scanAGYIssue(store, id => orchidHost.matchesNativeRootIdentity(d, id, "agy"), options.limit, 32 * 1_048_576, Date.parse(options.now));
        runs.push(...scan.runs); reason ??= scan.reason;
      } else {
        const id = orchidHost.openCodeSessionID(d);
        if (id === null || !await orchidHost.verifyOpenCodeBinding(d)) { reason = "source_unavailable"; continue; }
        const paths = defaultRoots(options.home);
        const store = openCodeRunStorePath(paths.opencodeData!, id);
        const native = store !== null && await lstat(store).then(() => true, () => false);
        const scan = native ? await scanOpenCodeRunStore(store!, id, options.limit, 32 * 1_048_576, Date.parse(options.now))
          : await scanOpenCodeIssue(paths.opencodeDb!, id, options.limit, 32 * 1_048_576, Date.parse(options.now));
        runs.push(...scan.runs); reason ??= scan.reason;
      }
    }
    const starts = new Map<string, string>();
    for (const d of ds.filter(d => d.source === "claude")) {
      const root = orchidHost.resolveNativeRoot(d, runs);
      if (root) for (const [key, at] of await readClaudeChildStarts(config.claudeChildEventRoot, root.id,
        runs.filter(r => r.parentId === root.id).map(r => r.id), options.now)) starts.set(key, at);
    }
    let selected = ds;
    if (bounded && !options.partialTrees) reason = "scan_limit";
    if (options.partialTrees) {
      const resolved = ds.filter(d => orchidHost.resolveNativeRoot(d, runs) !== null);
      if (resolved.length && resolved.length < ds.length) { selected = resolved; bounded = true; }
    }
    const observations = buildAgentObservations({ dispatches: selected, runs, host: orchidHost, wireFamily,
      observedAt: options.now, sourceBound: true, dispatchComplete: !receipts.degraded,
      nativeComplete: reason === null, claudeChildStarts: starts });
    const snapshot = reason !== null ? unavailableNativeTree(options.now, reason) :
      buildIssueAgentTreeSnapshot({ dispatches: selected, runs, observations, host: orchidHost, wireFamily, bounded, actions: actions.receipts, actionsComplete: actions.complete });
    entries.push({ repo: { owner, name }, issueNumber: first.issue!.number, snapshot });
  }
  for (const launch of receipts.launchStates) {
    if (launch.state !== "refused") continue;
    const [owner, name] = launch.issue.repo.split("/") as [string, string];
    const issue = { repo: { owner, name }, issueNumber: launch.issue.number, complete: true, reason: null,
      dispatches: [], launchRefusal: { state: "refused" as const, reason: launch.reasonCode,
        at: launch.observedAt, dispatchId: launch.dispatchId, source: "orchid" as const } };
    entries.push({ repo: issue.repo, issueNumber: issue.issueNumber, snapshot: {
      ...unavailableNativeTree(options.now), issues: [issue], complete: true, reason: null,
    } });
  }
  return combineIssueAgentTreeSnapshots({ observedAt: options.now, entries });
}
