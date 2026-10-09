import { evaluateEvidenceSet } from '../gates/evidence-set.ts';
import { parseGateReceipts } from '../gates/receipts.ts';
import { duplicateValues, integers, isRecord, issueNumber, type JsonRecord, nonEmpty, oneOf, records, strings } from '../json.ts';
import { validateBlockedDecisions } from './blocked-decisions.ts';
import { validateReporting } from './reporting.ts';
import { LEAF_PHASES, TERMINAL_LEAF_PHASES, TOPIC_LANES } from './vocabulary.ts';

export function validateState(
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
  validateBlockedDecisions(errors, state);

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
