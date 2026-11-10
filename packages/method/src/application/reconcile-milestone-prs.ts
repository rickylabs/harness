import { integers, issueNumber, type JsonRecord, nonEmpty, records } from '../domain/json.ts';
import {
  type LiveMilestonePr,
  type ReconciliationFinding,
  TERMINAL_LEAF_PHASES,
  type TopicLane,
  topicLane,
} from '../domain/milestone/vocabulary.ts';
import type { MilestonePrSource } from '../ports/milestone-pr-source.ts';
import { type MilestoneIdentity, requireRepositorySnapshot } from '../domain/milestone/identity.ts';

function firstIssueNumber(value: unknown): number | null {
  return integers(value)[0] ?? null;
}

export async function reconcileMilestonePrs(
  state: JsonRecord,
  identity: MilestoneIdentity,
  updatedAt: number,
  source: MilestonePrSource,
): Promise<ReconciliationFinding[]> {
  const { repo, milestone, defaultBranch } = identity;
  let openPullRequests: readonly LiveMilestonePr[];
  try {
    requireRepositorySnapshot(await source.readRepository(repo), identity, updatedAt, Date.now());
    openPullRequests = await source.listOpenMilestonePrs(repo, milestone);
  } catch (error) {
    return [{
      kind: 'source-unavailable',
      issueNumber: null,
      prNumber: null,
      lane: null,
      recordedHead: null,
      liveHead: null,
      detail: error instanceof Error ? error.message : String(error),
    }];
  }

  const findings: ReconciliationFinding[] = [];
  const leaves = records(state.leaves);
  const leafByPrNumber = new Map<number, JsonRecord>();
  for (const leaf of leaves) {
    if (issueNumber(leaf.prNumber)) leafByPrNumber.set(leaf.prNumber, leaf);
  }

  for (const leaf of leaves) {
    if (
      TERMINAL_LEAF_PHASES.has(String(leaf.phase)) ||
      !issueNumber(leaf.prNumber)
    ) {
      continue;
    }
    let livePullRequest: LiveMilestonePr;
    try {
      livePullRequest = await source.readPrHead(repo, leaf.prNumber);
    } catch (error) {
      findings.push({
        kind: 'source-unavailable',
        issueNumber: firstIssueNumber(leaf.issueNumbers),
        prNumber: leaf.prNumber,
        lane: topicLane(leaf.lane) ? leaf.lane : null,
        recordedHead: nonEmpty(leaf.headSha) ? leaf.headSha : null,
        liveHead: null,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    // A corrupt recorded base must not hide a stale head; reconcile it and refuse its identity.
    if (leaf.baseBranch !== defaultBranch || livePullRequest.baseBranch !== defaultBranch) {
      findings.push({
        kind: 'source-unavailable',
        issueNumber: firstIssueNumber(leaf.issueNumbers),
        prNumber: leaf.prNumber,
        lane: topicLane(leaf.lane) ? leaf.lane : null,
        recordedHead: nonEmpty(leaf.headSha) ? leaf.headSha : null,
        liveHead: livePullRequest.headSha,
        detail: 'recorded and live PR bases must match the verified repository defaultBranch',
      });
    }
    if (
      livePullRequest.state === 'open' && nonEmpty(leaf.headSha) &&
      livePullRequest.headSha !== leaf.headSha
    ) {
      findings.push({
        kind: 'stale-head',
        issueNumber: firstIssueNumber(leaf.issueNumbers),
        prNumber: leaf.prNumber,
        lane: topicLane(leaf.lane) ? leaf.lane : null,
        recordedHead: leaf.headSha,
        liveHead: livePullRequest.headSha,
      });
    }
  }

  const laneByIssue = new Map<number, TopicLane>();
  for (const lane of records(state.lanes)) {
    if (!topicLane(lane.id)) continue;
    for (const number of integers(lane.issueNumbers)) laneByIssue.set(number, lane.id);
  }
  const seenOpenPrNumbers = new Set<number>();
  for (const pullRequest of openPullRequests) {
    if (
      seenOpenPrNumbers.has(pullRequest.number) || pullRequest.state !== 'open' ||
      pullRequest.baseBranch !== defaultBranch || pullRequest.role === 'coordinator-artifact'
    ) {
      continue;
    }
    seenOpenPrNumbers.add(pullRequest.number);
    if (leafByPrNumber.has(pullRequest.number)) continue;
    const issue = pullRequest.issueNumbers[0] ?? null;
    findings.push({
      kind: 'missing-leaf',
      issueNumber: issue,
      prNumber: pullRequest.number,
      lane: pullRequest.lane ?? (issue === null ? null : laneByIssue.get(issue) ?? null),
      recordedHead: null,
      liveHead: pullRequest.headSha,
    });
  }
  return findings;
}
