import { isRecord, type JsonRecord, nonEmpty, records, timestamp } from '../json.ts';
import { topicLane } from './vocabulary.ts';

// I4 checks the supplied snapshot; it cannot establish live decision authority.
export function validateBlockedDecisions(errors: string[], state: JsonRecord): void {
  const reporting = isRecord(state.reporting) ? state.reporting : {};
  const rows = records(reporting.orchestratorMatrix);
  const decisions = records(reporting.ownerDecisions);

  function requireDecision(lane: unknown, reference: unknown): void {
    const label = topicLane(lane) ? lane : 'invalid';
    const prefix = `I4 lane ${label}: no open decision recorded in the snapshot`;
    if (state.schemaVersion !== 2) {
      errors.push(`${prefix}; a schema-2 decision snapshot is required`);
      return;
    }
    if (!nonEmpty(reference)) {
      errors.push(`${prefix}; decisionRef must be a nonblank string`);
      return;
    }
    // Count identities before status filtering: an open/closed pair is ambiguous.
    const matches = decisions.filter((decision) => decision.id === reference);
    if (matches.length !== 1) {
      errors.push(`${prefix}; decisionRef must identify exactly one record`);
      return;
    }
    const decision = matches[0]!;
    if (
      !topicLane(lane) || decision.lane !== lane || decision.status !== 'open' ||
      decision.answer != null || decision.answeredAt != null ||
      !nonEmpty(decision.question) || !Array.isArray(decision.options) ||
      decision.options.length < 2 || !decision.options.every(nonEmpty) ||
      !nonEmpty(decision.recommendation) || !nonEmpty(decision.costOfBeingWrong) ||
      timestamp(decision.raisedAt) === null
    ) {
      errors.push(`${prefix}; referenced record must be complete, unanswered, open, and in this lane`);
    }
  }

  for (const row of rows) {
    if (row.state === 'blocked') requireDecision(row.lane, row.decisionRef);
  }
  for (const leaf of records(state.leaves)) {
    if (leaf.phase !== 'blocked') continue;
    const laneRows = rows.filter((row) => row.lane === leaf.lane && row.state === 'blocked');
    const reference = Object.hasOwn(leaf, 'decisionRef')
      ? leaf.decisionRef
      : laneRows.length === 1 ? laneRows[0]!.decisionRef : undefined;
    requireDecision(leaf.lane, reference);
  }
}
