import { type JsonRecord, nonEmpty } from '../json.ts';

/** Canonical run identity, agreed by every artifact before it can select a PR base. */
export interface MilestoneIdentity {
  readonly repo: string;
  readonly milestone: string;
  readonly defaultBranch: string;
}

/** Repository metadata and PRs share one export capture, rather than separate clocks. */
export interface RepositorySnapshot {
  readonly repo: string;
  readonly defaultBranch: string;
  readonly capturedAt: string;
}

/** Literal branch names follow git-check-ref-format; checkout shorthand is not identity. */
export function branchName(value: unknown): value is string {
  return nonEmpty(value) && value !== '@' && !value.startsWith('-') &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.includes('..') &&
    !value.includes('@{') && !value.endsWith('.') &&
    value.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'));
}

/** Round-tripping rejects impossible UTC calendar dates that Date.parse would normalize. */
export function captureTime(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const date = new Date(value);
  const canonical = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  return Number.isFinite(date.valueOf()) && date.toISOString() === canonical ? date.valueOf() : null;
}

export function requireSharedIdentity(errors: string[], ...artifacts: JsonRecord[]): MilestoneIdentity | undefined {
  const before = errors.length;
  for (const field of ['repo', 'milestone', 'baselineMainSha', 'defaultBranch'] as const) {
    const values = artifacts.map((artifact) => artifact[field]);
    const valid = field === 'defaultBranch' ? values.every(branchName) : values.every(nonEmpty);
    if (!valid || new Set(values).size !== 1) {
      errors.push(`all artifacts must name the same valid ${field}`);
    }
  }
  const first = artifacts[0];
  return errors.length === before && first
    ? { repo: first.repo as string, milestone: first.milestone as string, defaultBranch: first.defaultBranch as string }
    : undefined;
}

/** Every freshness anchor is mandatory, including schema-1 state.updatedAt. */
export function validateCaptureAnchors(errors: string[], intake: JsonRecord, inventory: JsonRecord, state: JsonRecord): number | undefined {
  const anchors = [intake.capturedAt, inventory.capturedAt, state.updatedAt].map(captureTime);
  const fields = ['intake.capturedAt', 'inventory.capturedAt', 'state.updatedAt'];
  anchors.forEach((time, index) => {
    if (time === null) errors.push(`${fields[index]} must be a real UTC timestamp`);
  });
  const [intakeTime, inventoryTime, stateTime] = anchors;
  if (intakeTime == null || inventoryTime == null || stateTime == null) return undefined;
  if (intakeTime > inventoryTime || inventoryTime > stateTime) {
    errors.push('capture anchors must be ordered intake.capturedAt <= inventory.capturedAt <= state.updatedAt');
    return undefined;
  }
  return stateTime;
}

/** Fail closed on mismatched, stale or future repository provenance, even for zero PRs. */
export function requireRepositorySnapshot(snapshot: RepositorySnapshot, identity: MilestoneIdentity, updatedAt: number, now: number): void {
  if (snapshot.repo !== identity.repo || snapshot.defaultBranch !== identity.defaultBranch) {
    throw new Error('GitHub repository snapshot does not match canonical repo/defaultBranch');
  }
  const capturedAt = captureTime(snapshot.capturedAt);
  if (capturedAt === null || capturedAt < updatedAt || capturedAt > now) {
    throw new Error('GitHub repository capture must be a real UTC timestamp between state.updatedAt and now');
  }
}
