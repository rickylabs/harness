import { join } from '@std/path';
import type { GateReceipt } from '../gates/contract.ts';
import { RECEIPT_OUTCOMES } from '../gates/contract.ts';
import { evaluateEvidenceSet } from '../gates/evidence-set.ts';
import { renderMilestoneStatus } from './render-milestone-status.ts';

export const TOPIC_LANES = ['docs', 'internals', 'fixes', 'features'] as const;
const INTAKE_SOURCES = ['targetMilestone', 'unmilestoned', 'backlog', 'laterMilestone'] as const;
const ADMISSION_PREDICATES = [
  'release-critical',
  'dependency-required',
  'high-value-coherent',
] as const;
const DISPOSITIONS = [
  'active',
  'move',
  'close-fixed',
  'close-duplicate',
  'close-superseded',
] as const;
const EDGE_KINDS = ['requires', 'rfc-prerequisite', 'cross-epic-order'] as const;
const LEAF_PHASES = [
  'planned',
  'implementing',
  'gating',
  'evaluating',
  'blocked',
  'ready',
  'merged',
  'moved',
  'closed',
] as const;
const TERMINAL_LEAF_PHASES = new Set(['merged', 'moved', 'closed']);
const REPORT_LANE_STATES = ['active', 'queued', 'blocked', 'stalled', 'complete'] as const;
const CANARY_REPORT_STATES = [
  'not-planned',
  'planned',
  'qualifying',
  'blocked',
  'ready',
  'publishing',
  'complete',
] as const;
const REPORT_CONFIDENCE = ['low', 'medium', 'high'] as const;
const BLOCKER_CATEGORIES = [
  'product',
  'test-harness',
  'infrastructure',
  'lifecycle-metadata',
  'evaluator-transport',
] as const;

type JsonRecord = Record<string, unknown>;

export interface MilestoneClusterArtifacts {
  readonly intake: unknown;
  readonly inventory: unknown;
  readonly dag: unknown;
  readonly state: unknown;
  readonly status: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly findings: readonly ReconciliationFinding[];
}

export type TopicLane = (typeof TOPIC_LANES)[number];
export type LiveMilestonePrState = 'open' | 'merged' | 'closed';
export type LiveMilestonePrRole = 'leaf' | 'coordinator-artifact';

export interface LiveMilestonePr {
  readonly number: number;
  readonly issueNumbers: readonly number[];
  readonly lane: TopicLane | null;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly state: LiveMilestonePrState;
  readonly role: LiveMilestonePrRole;
}

export interface MilestonePrSource {
  listOpenMilestonePrs(repo: string, milestone: string): Promise<readonly LiveMilestonePr[]>;
  readPrHead(repo: string, prNumber: number): Promise<LiveMilestonePr>;
}

export interface ReconciliationFinding {
  readonly kind: 'stale-head' | 'missing-leaf' | 'source-unavailable';
  readonly issueNumber: number | null;
  readonly prNumber: number | null;
  readonly lane: TopicLane | null;
  readonly recordedHead: string | null;
  readonly liveHead: string | null;
  readonly detail?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function integers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0)
    : [];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value as T[number]);
}

function issueNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function knownResourceCountOrUnknown(value: unknown): value is number | null {
  return value === null || nonNegativeInteger(value);
}

function timestamp(value: unknown): number | null {
  if (!nonEmpty(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function topicLane(value: unknown): value is TopicLane {
  return oneOf(value, TOPIC_LANES);
}

function duplicateValues<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function validateReporting(
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

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

function parseGateReceipts(errors: string[], value: unknown): GateReceipt[] {
  const input = records(value);
  if (!Array.isArray(value) || input.length !== value.length) {
    errors.push('exactMainEvidence.receipts must contain receipt objects only');
    return [];
  }
  const receipts: GateReceipt[] = [];
  for (const receipt of input) {
    const argv = stringArray(receipt.argv);
    if (
      receipt.schemaVersion !== 1 || !nonEmpty(receipt.gateId) ||
      !nonEmpty(receipt.invocationId) || argv === null || !nonEmpty(receipt.cwd) ||
      !nonEmpty(receipt.gitHead) || !nonEmpty(receipt.actualGitHead) ||
      typeof receipt.timeoutMs !== 'number' || !Number.isInteger(receipt.timeoutMs) ||
      receipt.timeoutMs <= 0 || !nonEmpty(receipt.runnerIdentity) ||
      typeof receipt.attempt !== 'number' || !Number.isInteger(receipt.attempt) ||
      receipt.attempt <= 0 || !nonEmpty(receipt.requestHash) ||
      !nonEmpty(receipt.lifecycleId) || !oneOf(receipt.outcome, RECEIPT_OUTCOMES) ||
      !nonEmpty(receipt.claimedAt)
    ) {
      errors.push(
        `exactMainEvidence receipt ${String(receipt.invocationId ?? '?')} is malformed`,
      );
      continue;
    }
    receipts.push({
      schemaVersion: 1,
      gateId: receipt.gateId,
      invocationId: receipt.invocationId,
      argv,
      cwd: receipt.cwd,
      gitHead: receipt.gitHead,
      actualGitHead: receipt.actualGitHead,
      timeoutMs: receipt.timeoutMs,
      runnerIdentity: receipt.runnerIdentity,
      attempt: receipt.attempt,
      requestHash: receipt.requestHash,
      lifecycleId: receipt.lifecycleId,
      outcome: receipt.outcome,
      claimedAt: receipt.claimedAt,
    });
  }
  return receipts;
}

function requireSharedIdentity(
  errors: string[],
  intake: JsonRecord,
  inventory: JsonRecord,
  dag: JsonRecord,
  state: JsonRecord,
): void {
  const milestones = [intake.milestone, inventory.milestone, dag.milestone, state.milestone];
  if (!milestones.every(nonEmpty) || new Set(milestones).size !== 1) {
    errors.push('all artifacts must name the same non-empty milestone');
  }
  const baselines = [
    intake.baselineMainSha,
    inventory.baselineMainSha,
    dag.baselineMainSha,
    state.baselineMainSha,
  ];
  if (!baselines.every(nonEmpty) || new Set(baselines).size !== 1) {
    errors.push('all artifacts must use the same non-empty baselineMainSha');
  }
}

function validateIntake(errors: string[], intake: JsonRecord): JsonRecord[] {
  if (intake.schemaVersion !== 1) errors.push('intake.schemaVersion must be 1');
  if (!nonEmpty(intake.ownerRatifiedAt)) {
    errors.push('intake.ownerRatifiedAt is required before scope freeze');
  }
  const sources = isRecord(intake.sources) ? intake.sources : {};
  for (const source of ['targetMilestone', 'unmilestoned', 'backlog', 'laterMilestones']) {
    if (sources[source] !== true) errors.push(`intake.sources.${source} must be true`);
  }

  const candidates = records(intake.candidates);
  if (!Array.isArray(intake.candidates) || candidates.length !== intake.candidates.length) {
    errors.push('intake.candidates must contain objects only');
  }
  const numbers = candidates.map((candidate) => candidate.number).filter(issueNumber);
  for (const duplicate of duplicateValues(numbers)) {
    errors.push(`intake candidate #${duplicate} is duplicated`);
  }

  for (const candidate of candidates) {
    const number = issueNumber(candidate.number) ? candidate.number : '?';
    if (!issueNumber(candidate.number)) {
      errors.push('every intake candidate needs a positive issue number');
    }
    if (!oneOf(candidate.source, INTAKE_SOURCES)) {
      errors.push(`intake candidate #${number} has an invalid source`);
    }
    if (!oneOf(candidate.decision, ['include', 'exclude', 'defer'] as const)) {
      errors.push(`intake candidate #${number} needs include, exclude, or defer`);
    }
    if (!nonEmpty(candidate.reason)) errors.push(`intake candidate #${number} needs a reason`);
    if (strings(candidate.evidence).length === 0) {
      errors.push(`intake candidate #${number} needs linked evidence`);
    }
    if (candidate.ownerRatified !== true) {
      errors.push(`intake candidate #${number} is not owner-ratified`);
    }

    const external = candidate.source !== 'targetMilestone';
    if (candidate.decision === 'include' && external) {
      if (!oneOf(candidate.admissionPredicate, ADMISSION_PREDICATES)) {
        errors.push(`included external candidate #${number} lacks an admission predicate`);
      }
      if (candidate.targetMilestone !== intake.milestone || !nonEmpty(candidate.movedAt)) {
        errors.push(
          `included external candidate #${number} must be moved into the target milestone before freeze`,
        );
      }
    }
  }
  return candidates;
}

function validateInventory(errors: string[], inventory: JsonRecord): JsonRecord[] {
  if (inventory.schemaVersion !== 1) errors.push('inventory.schemaVersion must be 1');
  if (!nonEmpty(inventory.ownerRatifiedAt)) {
    errors.push('inventory.ownerRatifiedAt is required before dispatch');
  }
  const issues = records(inventory.issues);
  if (!Array.isArray(inventory.issues) || issues.length !== inventory.issues.length) {
    errors.push('inventory.issues must contain objects only');
  }
  if (inventory.targetIssueCount !== issues.length) {
    errors.push('inventory.targetIssueCount must equal the frozen issue count');
  }
  const numbers = issues.map((issue) => issue.number).filter(issueNumber);
  for (const duplicate of duplicateValues(numbers)) {
    errors.push(`inventory issue #${duplicate} is duplicated`);
  }

  for (const issue of issues) {
    const number = issueNumber(issue.number) ? issue.number : '?';
    if (!issueNumber(issue.number)) {
      errors.push('every inventory entry needs a positive issue number');
    }
    if (!oneOf(issue.disposition, DISPOSITIONS)) {
      errors.push(`inventory issue #${number} has an invalid disposition`);
    }
    if (issue.disposition === 'active') {
      if (!oneOf(issue.lane, TOPIC_LANES)) {
        errors.push(`active inventory issue #${number} needs exactly one topic lane`);
      }
    } else {
      if (issue.lane !== null) {
        errors.push(`non-active inventory issue #${number} must not own a lane`);
      }
      if (!nonEmpty(issue.reason) || strings(issue.evidence).length === 0) {
        errors.push(
          `non-active inventory issue #${number} needs written GitHub reason and evidence`,
        );
      }
    }
  }
  return issues;
}

function validateIntakeInventoryCrossing(
  errors: string[],
  intake: JsonRecord,
  candidates: JsonRecord[],
  inventoryIssues: JsonRecord[],
): void {
  const inventoryNumbers = new Set(
    inventoryIssues.map((issue) => issue.number).filter(issueNumber),
  );
  for (const candidate of candidates) {
    if (
      candidate.decision === 'include' && candidate.source !== 'targetMilestone' &&
      issueNumber(candidate.number) && !inventoryNumbers.has(candidate.number)
    ) {
      errors.push(
        `included external candidate #${candidate.number} is absent from the frozen inventory`,
      );
    }
  }
  if (!nonEmpty(intake.capturedAt)) errors.push('intake.capturedAt is required');
}

function validateDag(
  errors: string[],
  dag: JsonRecord,
  activeIssues: JsonRecord[],
): void {
  if (dag.schemaVersion !== 1) errors.push('dag.schemaVersion must be 1');
  const nodes = records(dag.nodes);
  const edges = records(dag.edges);
  const waves = records(dag.waves);
  const nodeIds = nodes.map((node) => node.id).filter(nonEmpty);
  for (const duplicate of duplicateValues(nodeIds)) {
    errors.push(`DAG node ${duplicate} is duplicated`);
  }
  const nodeSet = new Set(nodeIds);
  const activeNumbers = activeIssues.map((issue) => issue.number).filter(issueNumber);
  const activeNumberSet = new Set(activeNumbers);

  for (const node of nodes) {
    if (node.kind === 'issue') {
      if (!issueNumber(node.issueNumber) || !activeNumberSet.has(node.issueNumber)) {
        errors.push(`DAG issue node ${String(node.id)} has no active inventory backing`);
      }
      if (node.id !== `issue:${String(node.issueNumber)}`) {
        errors.push(`DAG issue node ${String(node.id)} has an inconsistent issueNumber`);
      }
    } else if (!oneOf(node.kind, ['rfc', 'external'] as const)) {
      errors.push(`DAG node ${String(node.id)} has an invalid kind`);
    }
  }

  for (const number of activeNumbers) {
    const matches = nodes.filter((node) =>
      node.id === `issue:${number}` && node.issueNumber === number
    );
    if (matches.length !== 1) {
      errors.push(`active issue #${number} must appear exactly once in the DAG`);
    }
  }

  const waveByNode = new Map<string, number>();
  for (const wave of waves) {
    if (!Number.isInteger(wave.index) || (wave.index as number) < 0) {
      errors.push('every DAG wave needs a non-negative integer index');
      continue;
    }
    for (const id of strings(wave.nodeIds)) {
      if (!nodeSet.has(id)) errors.push(`DAG wave references missing node ${id}`);
      if (waveByNode.has(id)) errors.push(`DAG node ${id} appears in more than one wave`);
      waveByNode.set(id, wave.index as number);
    }
  }
  for (const id of nodeIds) {
    if (!waveByNode.has(id)) errors.push(`DAG node ${id} is absent from waves`);
  }

  const adjacency = new Map(nodeIds.map((id) => [id, [] as string[]]));
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    if (!oneOf(edge.kind, EDGE_KINDS)) errors.push('DAG edge has an invalid kind');
    if (!nonEmpty(from) || !nodeSet.has(from) || !nonEmpty(to) || !nodeSet.has(to)) {
      errors.push('DAG edge references a missing node');
      continue;
    }
    if (from === to) errors.push(`DAG edge ${from} -> ${to} is self-referential`);
    adjacency.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    const fromWave = waveByNode.get(from);
    const toWave = waveByNode.get(to);
    if (fromWave !== undefined && toWave !== undefined && fromWave >= toWave) {
      errors.push(`DAG dependency ${from} -> ${to} must run in an earlier wave`);
    }
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const next of adjacency.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (visited !== nodeIds.length) errors.push('DAG contains a cycle');
}

function validateState(
  errors: string[],
  state: JsonRecord,
  activeIssues: JsonRecord[],
): void {
  if (state.schemaVersion !== 1 && state.schemaVersion !== 2) {
    errors.push('state.schemaVersion must be 1 or 2');
  }
  const coordinator = isRecord(state.coordinator) ? state.coordinator : {};
  if (!nonEmpty(coordinator.agentId)) errors.push('state.coordinator.agentId is required');
  if (!nonEmpty(state.currentMainSha)) errors.push('state.currentMainSha is required');
  const limits = isRecord(state.limits) ? state.limits : {};
  const expectedLimits: Record<string, number> = {
    activeImplementationSlicesPerLane: 2,
    activeEvaluatorsPerLane: 1,
    globalExpensiveGates: 1,
    releaseWriters: 1,
  };
  for (const [key, value] of Object.entries(expectedLimits)) {
    if (limits[key] !== value) errors.push(`state.limits.${key} must be ${value}`);
  }

  const lanes = records(state.lanes);
  const laneIds = lanes.map((lane) => lane.id).filter(nonEmpty);
  if (
    lanes.length !== TOPIC_LANES.length ||
    TOPIC_LANES.some((lane) => laneIds.filter((id) => id === lane).length !== 1)
  ) {
    errors.push('state must contain exactly docs, internals, fixes, and features lanes');
  }
  const laneIssues: number[] = [];
  const stateLaneByIssue = new Map<number, string>();
  for (const lane of lanes) {
    if (!nonEmpty(lane.orchestratorAgentId)) {
      errors.push(`lane ${String(lane.id)} needs one orchestrator identity`);
    }
    for (const number of integers(lane.issueNumbers)) {
      laneIssues.push(number);
      if (typeof lane.id === 'string') stateLaneByIssue.set(number, lane.id);
    }
  }
  for (const duplicate of duplicateValues(laneIssues)) {
    errors.push(`active issue #${duplicate} is owned by more than one lane`);
  }
  const activeNumbers = activeIssues.map((issue) => issue.number).filter(issueNumber).sort((a, b) =>
    a - b
  );
  const assignedNumbers = [...laneIssues].sort((a, b) => a - b);
  if (JSON.stringify(activeNumbers) !== JSON.stringify(assignedNumbers)) {
    errors.push('lane issue ownership must equal the active frozen inventory');
  }
  for (const issue of activeIssues) {
    if (issueNumber(issue.number) && stateLaneByIssue.get(issue.number) !== issue.lane) {
      errors.push(
        `active inventory issue #${issue.number} lane ${
          String(issue.lane)
        } disagrees with cluster state`,
      );
    }
  }

  if (state.schemaVersion === 2) validateReporting(errors, state, lanes);

  for (const watcher of records(state.watchers)) {
    if (!nonEmpty(watcher.agentId) || watcher.mutationAuthority !== false) {
      errors.push('watchers need an identity and mutationAuthority:false');
    }
  }
  const watcherIds = records(state.watchers).map((watcher) => watcher.agentId).filter(nonEmpty);
  for (const duplicate of duplicateValues(watcherIds)) {
    errors.push(`watcher ${duplicate} is duplicated`);
  }
  const laneOrchestratorIds = new Set(
    lanes.map((lane) => lane.orchestratorAgentId).filter(nonEmpty),
  );
  for (const watcherId of watcherIds) {
    if (laneOrchestratorIds.has(watcherId)) {
      errors.push(`watcher ${watcherId} cannot also be a lane orchestrator`);
    }
  }

  const leaves = records(state.leaves);
  const leafIds = leaves.map((leaf) => leaf.id).filter(nonEmpty);
  for (const duplicate of duplicateValues(leafIds)) errors.push(`leaf ${duplicate} is duplicated`);
  for (const leaf of leaves) {
    const id = nonEmpty(leaf.id) ? leaf.id : '?';
    if (!oneOf(leaf.lane, TOPIC_LANES)) errors.push(`leaf ${id} has an invalid lane`);
    if (!oneOf(leaf.phase, LEAF_PHASES)) errors.push(`leaf ${id} has an invalid phase`);
    if (leaf.baseBranch !== 'main') errors.push(`leaf ${id} must target main directly`);
    if (!issueNumber(leaf.prNumber)) errors.push(`leaf ${id} needs a positive prNumber`);
    if (!nonEmpty(leaf.headSha)) errors.push(`leaf ${id} needs an immutable headSha`);
    if (
      nonEmpty(leaf.implementerAgentId) && nonEmpty(leaf.evaluatorAgentId) &&
      leaf.implementerAgentId === leaf.evaluatorAgentId
    ) {
      errors.push(`leaf ${id} uses the same implementer and evaluator session`);
    }
    const lane = lanes.find((candidate) => candidate.id === leaf.lane);
    const owned = new Set(integers(lane?.issueNumbers));
    for (const number of integers(leaf.issueNumbers)) {
      if (!owned.has(number)) errors.push(`leaf ${id} claims issue #${number} outside its lane`);
    }
    for (const receipt of records(leaf.receiptRefs)) {
      if (!nonEmpty(receipt.id) || receipt.gitHead !== leaf.headSha) {
        errors.push(`leaf ${id} has a receipt missing its id or pinned to a different head`);
      }
    }
  }

  for (const lane of TOPIC_LANES) {
    const laneLeaves = leaves.filter((leaf) => leaf.lane === lane);
    const implementations = laneLeaves.filter((leaf) =>
      leaf.phase === 'implementing' || leaf.phase === 'gating'
    ).length;
    const evaluations = laneLeaves.filter((leaf) => leaf.phase === 'evaluating').length;
    if (implementations > 2) errors.push(`lane ${lane} exceeds two active implementation slices`);
    if (evaluations > 1) errors.push(`lane ${lane} exceeds one active evaluator`);
  }

  const runningGates = records(state.expensiveGates).filter((gate) => gate.state === 'running');
  if (runningGates.length > 1) errors.push('more than one global expensive gate is running');

  for (const checkpoint of records(state.canaryCheckpoints)) {
    const id = nonEmpty(checkpoint.id) ? checkpoint.id : '?';
    if (!nonEmpty(checkpoint.rationale)) errors.push(`canary checkpoint ${id} needs a rationale`);
    if (!oneOf(checkpoint.state, ['planned', 'publishing', 'complete'] as const)) {
      errors.push(`canary checkpoint ${id} has an invalid state`);
    }
    if (checkpoint.state !== 'planned') {
      if (!nonEmpty(checkpoint.contentSha) || strings(checkpoint.receiptRefs).length === 0) {
        errors.push(`active canary checkpoint ${id} needs content SHA and receipt evidence`);
      }
    }
  }

  const committedIssues = records(state.committedIssues);
  const committedNumbers = committedIssues.map((issue) => issue.number).filter(issueNumber);
  for (const duplicate of duplicateValues(committedNumbers)) {
    errors.push(`committed issue #${duplicate} is duplicated`);
  }
  if (
    JSON.stringify([...committedNumbers].sort((a, b) => a - b)) !== JSON.stringify(activeNumbers)
  ) {
    errors.push('committedIssues must equal the active frozen inventory');
  }
  for (const issue of committedIssues) {
    if (!oneOf(issue.state, ['open', 'closed', 'moved'] as const)) {
      errors.push(`committed issue #${String(issue.number)} has an invalid state`);
    }
    if (
      issue.state === 'moved' && (!nonEmpty(issue.reason) || strings(issue.evidence).length === 0)
    ) {
      errors.push(`moved committed issue #${String(issue.number)} needs reason and evidence`);
    }
  }

  const writers = strings(state.releaseWriters);
  if (writers.length > 1 || duplicateValues(writers).length > 0) {
    errors.push('there may be at most one release writer');
  }
  const captain = isRecord(state.releaseCaptain) ? state.releaseCaptain : {};
  if (!oneOf(captain.state, ['inactive', 'claimed', 'publishing', 'complete'] as const)) {
    errors.push('releaseCaptain.state is invalid');
    return;
  }
  if (captain.state === 'inactive') {
    if (writers.length > 0) errors.push('an inactive release captain cannot have a writer');
    return;
  }

  const terminalIssues = committedIssues.every((issue) =>
    issue.state === 'closed' || issue.state === 'moved'
  );
  const terminalLeaves = leaves.every((leaf) => TERMINAL_LEAF_PHASES.has(String(leaf.phase)));
  const exactEvidence = isRecord(state.exactMainEvidence) ? state.exactMainEvidence : {};
  const expectedGateIds = strings(exactEvidence.expectedGateIds);
  const evidenceReceipts = parseGateReceipts(errors, exactEvidence.receipts);
  const evaluatedEvidence = nonEmpty(state.currentMainSha) && nonEmpty(exactEvidence.surface)
    ? evaluateEvidenceSet({
      immutableHead: state.currentMainSha,
      surface: exactEvidence.surface,
      expectedGateIds,
      receipts: evidenceReceipts,
    })
    : undefined;
  if (expectedGateIds.length === 0) {
    errors.push('exactMainEvidence.expectedGateIds must not be empty');
  }
  for (const reason of evaluatedEvidence?.reasons ?? []) {
    errors.push(`exactMainEvidence: ${reason}`);
  }
  const exactMainGreen = exactEvidence.gitHead === state.currentMainSha &&
    expectedGateIds.length > 0 && evaluatedEvidence?.sufficiency === 'SUFFICIENT';
  if (
    !terminalIssues || !terminalLeaves || !exactMainGreen || state.existingReleaseLease !== false
  ) {
    errors.push(
      'release captain was claimed before the release-readiness preconditions were green',
    );
  }
  if (
    !nonEmpty(captain.agentId) || !nonEmpty(captain.leaseId) ||
    captain.contentSha !== state.currentMainSha || writers.length !== 1 ||
    writers[0] !== captain.agentId
  ) {
    errors.push('active release captain must own the single writer lease for current main');
  }
  const forbiddenWriters = new Set([
    ...lanes.map((lane) => lane.orchestratorAgentId).filter(nonEmpty),
    ...watcherIds,
  ]);
  if (nonEmpty(captain.agentId) && forbiddenWriters.has(captain.agentId)) {
    errors.push('topic orchestrators and watchers cannot act as release captain');
  }
  if (captain.state === 'complete' && strings(captain.evidence).length === 0) {
    errors.push('completed release captain needs publication and production-E2E evidence');
  }
}

function unavailableMilestonePrSource(detail: string): MilestonePrSource {
  const unavailable = () => Promise.reject<never>(new Error(detail));
  return {
    listOpenMilestonePrs: unavailable,
    readPrHead: unavailable,
  };
}

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

function firstIssueNumber(value: unknown): number | null {
  return integers(value)[0] ?? null;
}

async function reconcileMilestonePrs(
  state: JsonRecord,
  repo: string,
  milestone: string,
  source: MilestonePrSource,
): Promise<ReconciliationFinding[]> {
  let openPullRequests: readonly LiveMilestonePr[];
  try {
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
      TERMINAL_LEAF_PHASES.has(String(leaf.phase)) || leaf.baseBranch !== 'main' ||
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
      pullRequest.baseBranch !== 'main' || pullRequest.role === 'coordinator-artifact'
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

export async function validateMilestoneCluster(
  artifacts: MilestoneClusterArtifacts,
  source: MilestonePrSource = unavailableMilestonePrSource(
    'GitHub PR reconciliation source was not provided',
  ),
): Promise<ValidationResult> {
  const errors: string[] = [];
  const findings: ReconciliationFinding[] = [];
  if (!isRecord(artifacts.intake)) errors.push('milestone-intake.json must be an object');
  if (!isRecord(artifacts.inventory)) errors.push('milestone-inventory.json must be an object');
  if (!isRecord(artifacts.dag)) errors.push('milestone-dependency-dag.json must be an object');
  if (!isRecord(artifacts.state)) errors.push('milestone-cluster-state.json must be an object');
  if (errors.length > 0) return { ok: false, errors, findings };

  const intake = artifacts.intake as JsonRecord;
  const inventory = artifacts.inventory as JsonRecord;
  const dag = artifacts.dag as JsonRecord;
  const state = artifacts.state as JsonRecord;
  requireSharedIdentity(errors, intake, inventory, dag, state);
  const candidates = validateIntake(errors, intake);
  const inventoryIssues = validateInventory(errors, inventory);
  validateIntakeInventoryCrossing(errors, intake, candidates, inventoryIssues);
  const activeIssues = inventoryIssues.filter((issue) => issue.disposition === 'active');
  validateDag(errors, dag, activeIssues);
  validateState(errors, state, activeIssues);

  if (nonEmpty(intake.repo) && nonEmpty(state.milestone)) {
    findings.push(...await reconcileMilestonePrs(state, intake.repo, state.milestone, source));
  } else {
    findings.push({
      kind: 'source-unavailable',
      issueNumber: null,
      prNumber: null,
      lane: null,
      recordedHead: null,
      liveHead: null,
      detail: 'cluster artifacts do not provide a repository and milestone for reconciliation',
    });
  }

  const rendered = await renderMilestoneStatus(state);
  if (artifacts.status !== rendered) {
    errors.push('milestone-status.md is stale; regenerate it from milestone-cluster-state.json');
  }
  return { ok: errors.length === 0 && findings.length === 0, errors, findings };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(path));
}

export interface ValidateCliArgs {
  readonly runDir?: string;
  readonly githubPrsPath?: string;
  readonly error?: string;
}

/** Parse both direct invocation and `deno task ... -- <run-dir>` arguments. */
export function parseValidateCliArgs(args: readonly string[]): ValidateCliArgs {
  let runDir: string | undefined;
  let githubPrsPath: string | undefined;
  const values = args.filter((arg) => arg !== '--');
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === '--github-prs') {
      const path = values[++index];
      if (!path || path.startsWith('-')) return { error: '--github-prs requires a path' };
      githubPrsPath = path;
      continue;
    }
    if (value.startsWith('-')) return { error: `unknown option: ${value}` };
    if (runDir !== undefined) return { error: 'expected exactly one run directory' };
    runDir = value;
  }
  return runDir === undefined
    ? { error: 'missing run directory' }
    : githubPrsPath === undefined
    ? { runDir }
    : { runDir, githubPrsPath };
}

async function main(): Promise<void> {
  const parsed = parseValidateCliArgs(Deno.args);
  if (!parsed.runDir || parsed.error) {
    if (parsed.error) console.error(`error: ${parsed.error}`);
    console.error('usage: validate-milestone-cluster.ts <run-dir> [--github-prs <export.json>]');
    Deno.exit(2);
  }
  let result: ValidationResult;
  try {
    const runDir = parsed.runDir;
    let source = unavailableMilestonePrSource(
      'GitHub PR reconciliation input is unavailable; pass --github-prs <export.json>',
    );
    if (parsed.githubPrsPath) {
      try {
        source = milestonePrSourceFromExport(await readJson(parsed.githubPrsPath));
      } catch (error) {
        source = unavailableMilestonePrSource(
          `GitHub PR reconciliation input is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    result = await validateMilestoneCluster({
      intake: await readJson(join(runDir, 'milestone-intake.json')),
      inventory: await readJson(join(runDir, 'milestone-inventory.json')),
      dag: await readJson(join(runDir, 'milestone-dependency-dag.json')),
      state: await readJson(join(runDir, 'milestone-cluster-state.json')),
      status: await Deno.readTextFile(join(runDir, 'milestone-status.md')),
    }, source);
  } catch (error) {
    console.error(
      `error: unable to validate milestone cluster: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) Deno.exit(1);
}

if (import.meta.main) await main();
