/** Durable process evidence shared by CI and harness workers. */

export const RECEIPT_SCHEMA_VERSION = 1 as const;

export const RECEIPT_OUTCOMES = [
  'CLAIMED',
  'RUNNING',
  'PASS',
  'FAIL',
  'TIMED_OUT',
  'SPAWN_FAILED',
  'INTERRUPTED',
  'SKIPPED',
  'NOT_RUN',
] as const;

export type ReceiptOutcome = typeof RECEIPT_OUTCOMES[number];

export const TERMINAL_OUTCOMES: ReadonlySet<ReceiptOutcome> = new Set<ReceiptOutcome>([
  'PASS',
  'FAIL',
  'TIMED_OUT',
  'SPAWN_FAILED',
  'INTERRUPTED',
  'SKIPPED',
  'NOT_RUN',
]);

export interface GateRequest {
  gateId: string;
  invocationId: string;
  argv: string[];
  cwd: string;
  gitHead: string;
  actualGitHead: string;
  gitHeadOverrideReason?: string;
  timeoutMs: number;
  runnerIdentity: string;
  attempt: number;
}

export interface OutputEvidence {
  bytes: number;
  sha256: string;
  tail: string;
  truncated: boolean;
}

export interface ChildReportEvidence {
  path: string;
  bytes: number;
  sha256: string;
  modifiedAt?: string;
}

export interface GateReceipt extends GateRequest {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  requestHash: string;
  lifecycleId: string;
  outcome: ReceiptOutcome;
  claimedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  signal?: string;
  stdout?: OutputEvidence;
  stderr?: OutputEvidence;
  childReport?: string;
  childReportEvidence?: ChildReportEvidence;
  reason?: string;
}

export interface EvidenceSet {
  schemaVersion: 1;
  immutableHead: string;
  surface: string;
  expectedGateIds: string[];
  receiptIds: string[];
  sufficiency: 'SUFFICIENT' | 'INSUFFICIENT';
  reasons: string[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${
    Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')
  }}`;
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalRequest(request: GateRequest): string {
  return canonical({
    attempt: request.attempt,
    argv: request.argv,
    cwd: request.cwd,
    gateId: request.gateId,
    gitHead: request.gitHead,
    actualGitHead: request.actualGitHead,
    gitHeadOverrideReason: request.gitHeadOverrideReason,
    invocationId: request.invocationId,
    runnerIdentity: request.runnerIdentity,
    timeoutMs: request.timeoutMs,
  });
}

export function isTerminal(outcome: ReceiptOutcome): boolean {
  return TERMINAL_OUTCOMES.has(outcome);
}
