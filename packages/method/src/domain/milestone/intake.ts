import { duplicateValues, isRecord, issueNumber, type JsonRecord, nonEmpty, oneOf, records, strings } from '../json.ts';
import { ADMISSION_PREDICATES, DISPOSITIONS, INTAKE_SOURCES, TOPIC_LANES } from './vocabulary.ts';

export function requireSharedIdentity(
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

export function validateIntake(errors: string[], intake: JsonRecord): JsonRecord[] {
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

export function validateInventory(errors: string[], inventory: JsonRecord): JsonRecord[] {
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

export function validateIntakeInventoryCrossing(
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
