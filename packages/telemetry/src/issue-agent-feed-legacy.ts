/** Previous bounded source for deployments without the optional Orchid native-run socket. */
import { createHash } from "node:crypto";
import { MAX_AGENT_OBSERVATIONS, ISSUE_AGENT_TREE_FRESH_MS, readIssueAgentTreeSnapshot,
  type DispatchEvidence, type IssueLaunchBlock, type IssueAgentTree, type IssueAgentTreeSnapshot,
  type OrchidLaunchState } from "@rickylabs/harness-contracts";
import { orchidHost as host } from "@rickylabs/host-orchid";
import { buildAgentObservations } from "./agent-observations.js";
import { buildIssueAgentTreeSnapshot, combineIssueAgentTreeSnapshots } from "./issue-agent-feed.js";
import { readActionReceipts } from "./action-receipt-cli.js";
import { readLocalHostCapacity } from "./host-capacity.js";
import { resolveNativeOperatorBindings } from "./operator-environment.js";
import { resolveWireFamily } from "./producer-names.js";
import { readIssueAgentMetadata, MAX_FRAME_METADATA_BYTES } from "./issue-agent-feed-metadata.js";
import type { IssueAgentFeedOptions } from "./issue-agent-feed-cli.js";
/** Read each bound issue independently; one stale receipt never blanks its neighbours. */
export async function collectLegacyIssueAgentTree(options: IssueAgentFeedOptions): Promise<IssueAgentTreeSnapshot> {
  let bindings: ReturnType<typeof resolveNativeOperatorBindings>;
  let wireFamily: ReturnType<typeof resolveWireFamily>;
  try { wireFamily = resolveWireFamily(options.env); bindings = resolveNativeOperatorBindings(options.env); }
  catch { return unavailableSnapshot(options.now, "source_unavailable"); }
  if (bindings.dispatchRoot === undefined) return unavailableSnapshot(options.now, "source_not_bound");
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
  const entries: { repo: IssueAgentTree["repo"]; issueNumber: number; snapshot: IssueAgentTreeSnapshot;
    launchBlock?: IssueLaunchBlock }[] = [];
  const budget = { remainingBytes: MAX_FRAME_METADATA_BYTES };
  for (const group of ordered.slice(0, MAX_AGENT_OBSERVATIONS)) {
    const entry = { repo: group.repo, issueNumber: group.issueNumber,
      snapshot: unavailableSnapshot(options.now, "binding_unavailable"),
      ...(group.block === undefined ? {} : { launchBlock: group.block }) };
    entries.push(entry);
    if (group.dispatches.length === 0 && group.refusal !== undefined) {
      const issue: IssueAgentTree = { repo: group.repo, issueNumber: group.issueNumber,
        complete: true, reason: null, dispatches: [], launchRefusal: {
          state: "refused", reason: group.refusal.reasonCode, at: group.refusal.observedAt,
          dispatchId: group.refusal.dispatchId, source: "orchid" } };
      entry.snapshot = { schema: 1, protocol: 1, observedAt: options.now,
        validUntil: new Date(nowMs + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
        revision: createHash("sha256").update(JSON.stringify(issue)).digest("hex"),
        complete: true, reason: null, issues: [issue] };
      continue;
    }
    if (group.dispatches.length === 0) continue;
    if (group.dispatches.some(d => (d.source !== "codex" && d.source !== "claude" && d.source !== "agy" && d.source !== "opencode") || d.observedAt === undefined)) continue;
    const metadata = await readIssueAgentMetadata({ ...options, dispatches: group.dispatches, budget });
    if (metadata.reason !== null || metadata.bounded && !options.partialTrees) {
      entry.snapshot = unavailableSnapshot(options.now, metadata.reason ?? "scan_limit"); continue;
    }
    const { runs, claudeChildStarts, bounded } = metadata;
    let dispatches = group.dispatches;
    if (options.partialTrees) {
      const resolved = dispatches.filter(dispatch => host.resolveNativeRoot(dispatch, runs) !== null);
      if (resolved.length > 0 && resolved.length < dispatches.length) dispatches = resolved;
    }
    const observations = buildAgentObservations({ wireFamily, dispatches, runs,
      observedAt: options.now, sourceBound: true, dispatchComplete: true, nativeComplete: true,
      claudeChildStarts, host });
    entry.snapshot = buildIssueAgentTreeSnapshot({ wireFamily, observations, dispatches, runs,
      localCapacity, actions: actionScan.receipts, actionsComplete: actionScan.complete, bounded: bounded || dispatches.length < group.dispatches.length, host });
  }
  // A malformed receipt cannot be proven unrelated to a scoped issue.
  const combined = combineIssueAgentTreeSnapshots({ observedAt: options.now, entries,
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
  return decoded.ok ? decoded.snapshot : unavailableSnapshot(options.now);
}

function unavailableSnapshot(at: string, reason: IssueAgentTreeSnapshot["reason"] = "source_unavailable"): IssueAgentTreeSnapshot {
  return { schema: 1, protocol: 1, observedAt: at, validUntil: new Date(Date.parse(at) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: createHash("sha256").update(`${at}\0${reason}`).digest("hex"),
    complete: false, reason, issues: [] };
}
