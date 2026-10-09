/** Structural guards over parsed JSON, shared by the milestone validator and renderer. */
export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export function integers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0)
    : [];
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function oneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value as T[number]);
}

export function issueNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

export function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function timestamp(value: unknown): number | null {
  if (!nonEmpty(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function duplicateValues<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}
