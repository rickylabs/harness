import { duplicateValues, integers, isRecord, issueNumber, nonEmpty, oneOf, records } from '../domain/json.ts';
import { type LiveMilestonePr, topicLane } from '../domain/milestone/vocabulary.ts';
import type { MilestonePrSource } from '../ports/milestone-pr-source.ts';

/** Build the read-only reconciliation port from a freshly captured PR export. */
export function milestonePrSourceFromExport(value: unknown): MilestonePrSource {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('GitHub PR export must be an object with schemaVersion 1');
  }
  if (!nonEmpty(value.repo) || !nonEmpty(value.milestone) || !nonEmpty(value.capturedAt)) {
    throw new Error('GitHub PR export requires repo, milestone, and capturedAt');
  }
  const entries = records(value.pullRequests);
  if (!Array.isArray(value.pullRequests) || entries.length !== value.pullRequests.length) {
    throw new Error('GitHub PR export pullRequests must contain objects only');
  }
  const pullRequests: LiveMilestonePr[] = [];
  for (const entry of entries) {
    const issueNumbers = integers(entry.issueNumbers);
    if (
      !issueNumber(entry.number) ||
      !Array.isArray(entry.issueNumbers) || issueNumbers.length !== entry.issueNumbers.length ||
      !(entry.lane === null || topicLane(entry.lane)) ||
      !nonEmpty(entry.baseBranch) || !nonEmpty(entry.headSha) ||
      !oneOf(entry.state, ['open', 'merged', 'closed'] as const) ||
      !oneOf(entry.role, ['leaf', 'coordinator-artifact'] as const)
    ) {
      throw new Error(`GitHub PR export entry #${String(entry.number ?? '?')} is malformed`);
    }
    pullRequests.push({
      number: entry.number,
      issueNumbers,
      lane: entry.lane,
      baseBranch: entry.baseBranch,
      headSha: entry.headSha,
      state: entry.state,
      role: entry.role,
    });
  }
  for (const duplicate of duplicateValues(pullRequests.map((pullRequest) => pullRequest.number))) {
    throw new Error(`GitHub PR export PR #${duplicate} is duplicated`);
  }

  const exportRepo = value.repo;
  const exportMilestone = value.milestone;
  function requireIdentity(repo: string, milestone?: string): void {
    if (repo !== exportRepo || (milestone !== undefined && milestone !== exportMilestone)) {
      throw new Error(
        `GitHub PR export identity ${exportRepo}/${exportMilestone} does not match ${repo}/${milestone}`,
      );
    }
  }
  return {
    listOpenMilestonePrs: (repo, milestone) => {
      requireIdentity(repo, milestone);
      return Promise.resolve(
        pullRequests.filter((pullRequest) => pullRequest.state === 'open'),
      );
    },
    readPrHead: (repo, prNumber) => {
      requireIdentity(repo);
      const pullRequest = pullRequests.find((candidate) => candidate.number === prNumber);
      return pullRequest
        ? Promise.resolve(pullRequest)
        : Promise.reject(new Error(`GitHub PR export has no PR #${prNumber}`));
    },
  };
}
