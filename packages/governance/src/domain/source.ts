/** The governance source descriptor and the pure value checks every leg shares. Configuration is operator-owned, never projected. */

export const USAGE_WINDOWS = ["rolling_five_hours", "weekly", "monthly"] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];
export const SPEND_WINDOWS = { total: "usage", daily: "usage_daily", weekly: "usage_weekly", monthly: "usage_monthly" } as const;
export interface UsageSource {
  readonly denoBin: string;
  readonly probe: string;
  readonly checkout: string;
  readonly model: string;
  readonly credentialEnv: string;
  /** The one host the usage probe may reach (Deno `--allow-net`): a bare hostname, operator-chosen. */
  readonly allowNet: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly windows: Readonly<Record<UsageWindow, { readonly label: string; readonly windowMinutes: number }>>;
}
export interface SpendSource {
  /** The metered spend endpoint, operator-chosen; the spend credential is sent to this exact URL and nowhere else. */
  readonly url: string;
  readonly credentialEnv: string;
  readonly window: keyof typeof SPEND_WINDOWS;
  readonly validForMs: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}
export interface CapacitySource {
  readonly cgroupRoot: string;
  readonly scopeLabel: string;
  readonly validForMs: number;
}
export interface GovernanceSource {
  readonly usage: UsageSource | null;
  readonly spend: SpendSource | null;
  readonly capacity: CapacitySource | null;
  readonly admissions: { readonly fromObservabilityLog: true } | null;
  /** The dispatcher's private per-transport availability snapshot (0.28.0). Optional in a descriptor. */
  readonly transportAvailability?: { readonly path: string } | null;
  readonly accountLabel: string;
}
export type SourceRefusal = "not-configured" | "credential-unbound" | "spawn-failed" | "timeout" |
  "oversize" | "non-json" | "shape-mismatch" | "request-failed" | "cgroup-unreadable" |
  "log-unreadable" | "no-admissions" | "admission-conflict" | "stale-source" | "future-source" |
  "invalid-descriptor" | "envelope-invalid" | "file-unreadable";
export class SourceError extends Error {
  constructor(readonly code: SourceRefusal) { super(code); }
}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SourceError("shape-mismatch");
  return value as Record<string, unknown>;
}
export function safeLabel(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new SourceError("shape-mismatch");
  return value;
}
export function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new SourceError("shape-mismatch");
  return value;
}
export function instant(value: unknown): string {
  if (typeof value !== "string") throw new SourceError("shape-mismatch");
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
  if (match === null || !Number.isFinite(Date.parse(value))) throw new SourceError("shape-mismatch");
  // Date.parse normalizes February 30 and 24:00; neither is an explicit valid decision instant.
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (days === undefined || day < 1 || day > days || Number(match[4]) > 23) throw new SourceError("shape-mismatch");
  return value;
}
export function expiry(at: string, duration: unknown): string {
  const result = Date.parse(instant(at)) + positive(duration);
  if (!Number.isFinite(new Date(result).getTime())) throw new SourceError("shape-mismatch");
  return new Date(result).toISOString();
}
export type Leg<T> = { readonly ok: true; readonly value: T; readonly observedAt: string; readonly validUntil: string } |
  { readonly ok: false; readonly code: SourceRefusal };
export function mapped<T>(map: () => Extract<Leg<T>, { ok: true }>): Leg<T> {
  try { return map(); } catch { return { ok: false, code: "shape-mismatch" }; }
}
