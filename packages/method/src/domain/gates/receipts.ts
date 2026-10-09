import { nonEmpty, oneOf, records } from '../json.ts';
import { type GateReceipt, RECEIPT_OUTCOMES } from './contract.ts';

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

export function parseGateReceipts(errors: string[], value: unknown): GateReceipt[] {
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
