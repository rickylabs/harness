import type { EvidenceSet, GateReceipt } from './contract.ts';
import { isTerminal } from './contract.ts';

export function evaluateEvidenceSet(options: {
  immutableHead: string;
  surface: string;
  expectedGateIds: string[];
  receipts: GateReceipt[];
  frameworkSurface?: boolean;
}): EvidenceSet {
  const reasons: string[] = [];
  const duplicateExpected = duplicates(options.expectedGateIds);
  for (const gateId of duplicateExpected) reasons.push(`expected gate ${gateId} is duplicated`);

  const receipts = [...options.receipts].sort((left, right) =>
    left.gateId.localeCompare(right.gateId) ||
    left.invocationId.localeCompare(right.invocationId) ||
    left.requestHash.localeCompare(right.requestHash)
  );
  for (const gateId of duplicates(receipts.map((receipt) => receipt.gateId))) {
    reasons.push(`gate ${gateId} has duplicate or contradictory receipts`);
  }
  for (const invocationId of duplicates(receipts.map((receipt) => receipt.invocationId))) {
    reasons.push(`receipt id ${invocationId} is duplicated or contradictory`);
  }

  const byGate = new Map<string, GateReceipt>();
  for (const receipt of receipts) {
    if (!byGate.has(receipt.gateId)) byGate.set(receipt.gateId, receipt);
  }
  const required = new Set([...options.expectedGateIds].sort());
  if (options.frameworkSurface) {
    for (
      const gate of [
        'check',
        'lint',
        'fmt-check',
        'quality-gate',
        'dependency-evidence',
        'jsr-audit',
      ]
    ) {
      required.add(gate);
    }
  }
  for (const gateId of required) {
    const receipt = byGate.get(gateId);
    if (!receipt) {
      reasons.push(`missing receipt for ${gateId}`);
      continue;
    }
    if (!isTerminal(receipt.outcome)) reasons.push(`${gateId} is nonterminal (${receipt.outcome})`);
    if (receipt.outcome !== 'PASS') reasons.push(`${gateId} did not pass (${receipt.outcome})`);
    if (receipt.gitHead !== options.immutableHead) {
      reasons.push(`${gateId} targets ${receipt.gitHead}`);
    }
    if (receipt.actualGitHead !== receipt.gitHead) {
      reasons.push(`${gateId} attests ${receipt.gitHead} but ran at ${receipt.actualGitHead}`);
    }
  }
  return {
    schemaVersion: 1,
    immutableHead: options.immutableHead,
    surface: options.surface,
    expectedGateIds: [...required].sort(),
    receiptIds: [...new Set(receipts.map((receipt) => receipt.invocationId))],
    sufficiency: reasons.length === 0 ? 'SUFFICIENT' : 'INSUFFICIENT',
    reasons,
  };
}

function duplicates(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}
