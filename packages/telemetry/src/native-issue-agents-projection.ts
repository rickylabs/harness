/** Preserve feed facets while current native joins retain sole authority over root execution. */
import { homedir } from "node:os";
import { orchidHost } from "@rickylabs/host-orchid";
import { type AgentObservations, type DispatchEvidence, type IssueAgentTree, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { buildAgentObservations, type NativeRootObservation } from "./agent-observations.js";
import { buildIssueAgentTreeSnapshot, combineIssueAgentTreeSnapshots } from "./issue-agent-feed.js";
import { readIssueAgentMetadata, MAX_FRAME_METADATA_BYTES } from "./issue-agent-feed-metadata.js";
import { readActionReceipts } from "./action-receipt-cli.js";
import { readLocalHostCapacity } from "./host-capacity.js";
import { resolveNativeOperatorBindings, type OperatorEnvironment } from "./operator-environment.js";
import { resolveWireFamily } from "./producer-names.js";
import { digest } from "./issue-agent-tree-values.js";
import type { RunRecord } from "./model.js";

/** Native mode reads admission files alone; retained dispatch history cannot select live roots. */
export async function projectNativeIssueAgentFacets(input: {
  readonly dispatches: readonly DispatchEvidence[];
  readonly metadataDispatches: readonly DispatchEvidence[];
  readonly roots: ReadonlyMap<string, NativeRootObservation>;
  readonly env: OperatorEnvironment; readonly now: string;
  readonly home?: string; readonly limit?: number; readonly issueKey?: string; readonly partialTrees?: boolean;
  readonly complete: boolean; readonly overflow: boolean;
  readonly unavailableReason?: IssueAgentTreeSnapshot["reason"];
}): Promise<{ tree: IssueAgentTreeSnapshot; observations: AgentObservations; runs: readonly RunRecord[] }> {
  const config = resolveNativeOperatorBindings(input.env), wireFamily = resolveWireFamily(input.env);
  const [admissions, actions, capacity] = await Promise.all([
    orchidHost.readDispatches(config.dispatchRoot, { keys: [], launchStates: true }),
    readActionReceipts(config.dispatchRoot),
    readLocalHostCapacity(input.now, config.placementHost, {}, wireFamily),
  ]);
  const groups = new Map<string, DispatchEvidence[]>();
  for (const dispatch of input.dispatches) {
    const key = dispatch.issue!.repo.toLowerCase() + "#" + dispatch.issue!.number;
    if (input.issueKey !== undefined && input.issueKey !== key) continue;
    groups.set(key, [...(groups.get(key) ?? []), dispatch]);
  }
  const entries: { repo: IssueAgentTree["repo"]; issueNumber: number; snapshot: IssueAgentTreeSnapshot }[] = [];
  const allRuns: RunRecord[] = [], starts = new Map<string, string>();
  const budget = { remainingBytes: MAX_FRAME_METADATA_BYTES };
  for (const dispatches of groups.values()) {
    const metadata = await readIssueAgentMetadata({ home: input.home ?? homedir(), limit: input.limit ?? 500,
      env: input.env, now: input.now, partialTrees: true, currentNative: true, budget,
      dispatches: dispatches.map(d => input.metadataDispatches.find(original => original.runId === d.runId)!) });
    allRuns.push(...metadata.runs);
    for (const [key, at] of metadata.claudeChildStarts) starts.set(key, at);
    const observations = buildAgentObservations({ dispatches, runs: metadata.runs, nativeRoots: input.roots,
      observedAt: input.now, sourceBound: true, dispatchComplete: true, nativeComplete: true,
      claudeChildStarts: starts, wireFamily });
    let snapshot = buildIssueAgentTreeSnapshot({ dispatches, observations, runs: metadata.runs, nativeRoots: input.roots,
      wireFamily, localCapacity: capacity, actions: actions.receipts, actionsComplete: actions.complete,
      bounded: input.overflow || metadata.bounded });
    if (!input.partialTrees) {
      const issues = snapshot.issues.map(issue => issue.complete ? issue : { ...issue, dispatches: [] });
      snapshot = { ...snapshot, issues, revision: digest(JSON.stringify({ issues, reason: snapshot.reason })) };
    }
    const issue = snapshot.issues[0];
    const first = dispatches[0]!;
    const [owner, name] = first.issue!.repo.split("/") as [string, string];
    entries.push({ repo: issue?.repo ?? { owner, name }, issueNumber: first.issue!.number, snapshot });
  }
  const observations = buildAgentObservations({ dispatches: input.dispatches, runs: allRuns, nativeRoots: input.roots,
    observedAt: input.now, sourceBound: true, dispatchComplete: true, nativeComplete: true, claudeChildStarts: starts, wireFamily });
  let tree = combineIssueAgentTreeSnapshots({ observedAt: input.now, entries,
    globalReason: input.overflow || admissions.notes.some(note => note.includes("scan_limit")) ? "scan_limit"
      : input.unavailableReason ?? (!input.complete ? "binding_unavailable" : admissions.degraded ? "source_unavailable" : null) });
  const issues = new Map(tree.issues.map(issue => [issue.repo.owner.toLowerCase() + "/" + issue.repo.name.toLowerCase() + "#" + issue.issueNumber, issue]));
  for (const launch of admissions.launchStates) {
    if (!["refused", "blocked"].includes(launch.state) || launch.observedAt > input.now) continue;
    const key = launch.issue.repo.toLowerCase() + "#" + launch.issue.number;
    if (input.issueKey !== undefined && key !== input.issueKey) continue;
    const [owner, name] = launch.issue.repo.split("/") as [string, string];
    const issue = issues.get(key) ?? { repo: { owner, name }, issueNumber: launch.issue.number,
      complete: launch.state === "refused", reason: launch.state === "refused" ? null : "binding_unavailable", dispatches: [] };
    issues.set(key, { ...issue,
      ...(launch.state === "refused" ? { launchRefusal: { state: "refused", reason: launch.reasonCode,
        at: launch.observedAt, dispatchId: launch.dispatchId, source: "orchid" } as const }
        : launch.state === "blocked" ? { launchBlock: { state: "blocked", reason: launch.reasonCode,
          at: launch.observedAt, dispatchId: launch.dispatchId, source: "orchid" } as const } : {}) });
  }
  tree = combineIssueAgentTreeSnapshots({ observedAt: input.now,
    entries: [...issues.values()].map(issue => ({ repo: issue.repo, issueNumber: issue.issueNumber,
      ...(issue.launchBlock === undefined ? {} : { launchBlock: issue.launchBlock }),
      snapshot: { ...tree, issues: [issue], complete: issue.complete, reason: issue.reason } })),
    globalReason: tree.reason });
  return { tree, observations, runs: allRuns };
}
