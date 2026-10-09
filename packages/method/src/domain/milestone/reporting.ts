import { integers, isRecord, issueNumber, type JsonRecord, nonEmpty, nonNegativeInteger, oneOf, records, timestamp } from '../json.ts';
import {
  BLOCKER_CATEGORIES,
  CANARY_REPORT_STATES,
  knownResourceCountOrUnknown,
  REPORT_CONFIDENCE,
  REPORT_LANE_STATES,
  TOPIC_LANES,
  topicLane,
} from './vocabulary.ts';

export function validateReporting(
  errors: string[],
  state: JsonRecord,
  lanes: JsonRecord[],
): void {
  const reporting = isRecord(state.reporting) ? state.reporting : null;
  if (!reporting) {
    errors.push('state.reporting is required for schemaVersion 2');
    return;
  }

  const cadence = reporting.cadenceMinutes;
  if (!Number.isInteger(cadence) || (cadence as number) < 15 || (cadence as number) > 60) {
    errors.push('state.reporting.cadenceMinutes must be an integer from 15 through 60');
  }
  const lastReportAt = timestamp(reporting.lastReportAt);
  const nextReportDueAt = timestamp(reporting.nextReportDueAt);
  const updatedAt = timestamp(state.updatedAt);
  if (lastReportAt === null) errors.push('state.reporting.lastReportAt must be an ISO timestamp');
  if (nextReportDueAt === null) {
    errors.push('state.reporting.nextReportDueAt must be an ISO timestamp');
  }
  if (updatedAt === null) errors.push('state.updatedAt must be an ISO timestamp');
  if (
    lastReportAt !== null && nextReportDueAt !== null && Number.isInteger(cadence) &&
    (nextReportDueAt <= lastReportAt ||
      nextReportDueAt - lastReportAt > (cadence as number) * 60_000)
  ) {
    errors.push('state.reporting.nextReportDueAt must be after the report and within cadence');
  }
  if (
    lastReportAt !== null && updatedAt !== null && Number.isInteger(cadence) &&
    (lastReportAt > updatedAt || updatedAt - lastReportAt > (cadence as number) * 60_000)
  ) {
    errors.push('state.reporting is stale relative to state.updatedAt');
  }
  if (!nonEmpty(reporting.lastReportRef)) {
    errors.push('state.reporting.lastReportRef is required');
  }
  if (!nonEmpty(reporting.headline)) errors.push('state.reporting.headline is required');
  if (reporting.currentMainSha !== state.currentMainSha) {
    errors.push('state.reporting.currentMainSha must equal state.currentMainSha');
  }

  const canary = isRecord(reporting.canary) ? reporting.canary : {};
  const eta = isRecord(canary.eta) ? canary.eta : {};
  const criticalPath = records(canary.criticalPath);
  if (!nonEmpty(canary.target)) errors.push('state.reporting.canary.target is required');
  if (!oneOf(canary.state, CANARY_REPORT_STATES)) {
    errors.push('state.reporting.canary.state is invalid');
  }
  if (!nonEmpty(eta.window) || !oneOf(eta.confidence, REPORT_CONFIDENCE) || !nonEmpty(eta.basis)) {
    errors.push('state.reporting.canary.eta needs window, confidence, and basis');
  }
  if (canary.state !== 'not-planned' && canary.state !== 'complete' && criticalPath.length === 0) {
    errors.push('an active canary report needs a non-empty critical path');
  }
  for (const item of criticalPath) {
    if (
      !nonEmpty(item.id) || !nonEmpty(item.state) || !nonEmpty(item.impact) ||
      !nonEmpty(item.nextAction)
    ) {
      errors.push('every canary critical-path item needs id, state, impact, and nextAction');
    }
  }

  const progress = isRecord(reporting.progress) ? reporting.progress : {};
  for (const key of ['mergedPullRequests', 'closedIssues', 'newIssues']) {
    if (!Array.isArray(progress[key]) || integers(progress[key]).length !== progress[key].length) {
      errors.push(`state.reporting.progress.${key} must contain positive issue/PR numbers only`);
    }
  }
  if (!nonEmpty(progress.queueDeltaExplanation)) {
    errors.push('state.reporting.progress.queueDeltaExplanation is required');
  }

  const scope = isRecord(reporting.scope) ? reporting.scope : {};
  for (
    const key of [
      'openIssueCount',
      'ownedIssueCount',
      'scheduledIssueCount',
      'openPullRequestCount',
    ]
  ) {
    if (!nonNegativeInteger(scope[key])) {
      errors.push(`state.reporting.scope.${key} must be a non-negative integer`);
    }
  }
  const unscheduled = integers(scope.unscheduledIssueNumbers);
  if (
    !Array.isArray(scope.unscheduledIssueNumbers) ||
    unscheduled.length !== scope.unscheduledIssueNumbers.length
  ) {
    errors.push('state.reporting.scope.unscheduledIssueNumbers must contain issue numbers only');
  }
  if (unscheduled.length > 0) {
    errors.push('state.reporting.scope has unscheduled milestone issues');
  }
  if (
    nonNegativeInteger(scope.openIssueCount) && nonNegativeInteger(scope.ownedIssueCount) &&
    nonNegativeInteger(scope.scheduledIssueCount) &&
    (scope.openIssueCount !== scope.ownedIssueCount ||
      scope.openIssueCount !== scope.scheduledIssueCount)
  ) {
    errors.push('state.reporting.scope open, owned, and scheduled issue counts must agree');
  }

  const mergeQueue = records(reporting.mergeQueue);
  if (!Array.isArray(reporting.mergeQueue) || mergeQueue.length !== reporting.mergeQueue.length) {
    errors.push('state.reporting.mergeQueue must contain objects only');
  }
  for (const candidate of mergeQueue) {
    if (
      !issueNumber(candidate.prNumber) || !topicLane(candidate.lane) ||
      !nonEmpty(candidate.state) ||
      !nonEmpty(candidate.nextGate) || !nonEmpty(candidate.nextAction)
    ) {
      errors.push('every merge-queue row needs PR, lane, state, nextGate, and nextAction');
    }
  }

  const matrix = records(reporting.orchestratorMatrix);
  const matrixLanes = matrix.map((row) => row.lane).filter(topicLane);
  if (
    !Array.isArray(reporting.orchestratorMatrix) || matrix.length !== TOPIC_LANES.length ||
    TOPIC_LANES.some((lane) => matrixLanes.filter((candidate) => candidate === lane).length !== 1)
  ) {
    errors.push('state.reporting.orchestratorMatrix must cover every topic lane exactly once');
  }
  for (const row of matrix) {
    if (
      !topicLane(row.lane) || !oneOf(row.state, REPORT_LANE_STATES) ||
      !Array.isArray(row.activeItems) || timestamp(row.lastConcreteProgressAt) === null ||
      !(row.blocker === null || nonEmpty(row.blocker)) || !nonEmpty(row.nextAction)
    ) {
      errors.push(
        `orchestrator report row ${
          String(row.lane ?? '?')
        } needs state, activeItems, progress, blocker, and nextAction`,
      );
    }
  }
  const stateLaneIds = lanes.map((lane) => lane.id).filter(topicLane).sort();
  if (JSON.stringify([...matrixLanes].sort()) !== JSON.stringify(stateLaneIds)) {
    errors.push('state.reporting.orchestratorMatrix disagrees with cluster lanes');
  }

  const blockers = records(reporting.blockers);
  if (!Array.isArray(reporting.blockers) || blockers.length !== reporting.blockers.length) {
    errors.push('state.reporting.blockers must contain objects only');
  }
  for (const blocker of blockers) {
    if (
      !nonEmpty(blocker.id) || !oneOf(blocker.category, BLOCKER_CATEGORIES) ||
      !nonEmpty(blocker.summary) || !nonEmpty(blocker.impact) || !nonEmpty(blocker.owner) ||
      !nonEmpty(blocker.nextAction) || typeof blocker.ownerDecisionRequired !== 'boolean'
    ) {
      errors.push('every blocker needs a class, plain-English impact, owner, and next action');
    }
  }

  const environment = isRecord(reporting.environment) ? reporting.environment : {};
  if (
    timestamp(environment.checkedAt) === null ||
    !knownResourceCountOrUnknown(environment.aspireApplications) ||
    !knownResourceCountOrUnknown(environment.dockerContainers) ||
    !knownResourceCountOrUnknown(environment.dockerCustomNetworks)
  ) {
    errors.push(
      'state.reporting.environment needs a timestamp and non-negative owned-resource counts or null when unknown',
    );
  }

  const ownerDecisions = records(reporting.ownerDecisions);
  if (
    !Array.isArray(reporting.ownerDecisions) ||
    ownerDecisions.length !== reporting.ownerDecisions.length
  ) {
    errors.push('state.reporting.ownerDecisions must contain objects only');
  }
  for (const decision of ownerDecisions) {
    if (
      !nonEmpty(decision.id) || !nonEmpty(decision.question) ||
      !nonEmpty(decision.whyOwnerOnly) || !Array.isArray(decision.blockedItems)
    ) {
      errors.push('every owner decision needs id, question, whyOwnerOnly, and blockedItems');
    }
  }
}
