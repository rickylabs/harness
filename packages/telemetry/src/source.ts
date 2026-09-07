/** Pure validation at the live-source boundary. Configuration is operator-owned, never projected. */
import { isAbsolute } from "node:path";

export const USAGE_WINDOWS = ["rolling_five_hours", "weekly", "monthly"] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];
export const SPEND_URL = "https://openrouter.ai/api/v1/key";
export const SPEND_WINDOWS = { total: "usage", daily: "usage_daily", weekly: "usage_weekly", monthly: "usage_monthly" } as const;
export interface UsageSource {
  readonly denoBin: string;
  readonly probe: string;
  readonly checkout: string;
  readonly model: string;
  readonly credentialEnv: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly windows: Readonly<Record<UsageWindow, { readonly label: string; readonly windowMinutes: number }>>;
}
export interface SpendSource {
  readonly url: typeof SPEND_URL;
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
  readonly accountLabel: string;
}
export type SourceRefusal = "not-configured" | "credential-unbound" | "spawn-failed" | "timeout" |
  "oversize" | "non-json" | "shape-mismatch" | "request-failed" | "cgroup-unreadable" |
  "log-unreadable" | "no-admissions" | "admission-conflict" | "stale-source" | "future-source" |
  "invalid-descriptor" | "envelope-invalid";
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
function path(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw new SourceError("shape-mismatch");
  return value;
}
function credential(value: unknown): string {
  // Deny runtime-control environment names (PATH, NODE_OPTIONS, etc.) structurally.
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || /^(?:DENO_|NODE_|LD_|DYLD_)/.test(value) || ["HOME", "PATH", "USERPROFILE", "TMPDIR", "XDG_CACHE_HOME"].includes(value)) throw new SourceError("shape-mismatch");
  return value;
}
function fields(value: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(value).length !== names.length || names.some(name => !(name in value))) throw new SourceError("shape-mismatch");
}
export function parseSource(value: unknown): GovernanceSource {
  try {
    const input = object(value);
    fields(input, ["usage", "spend", "capacity", "admissions", "accountLabel"]);
    let usage: UsageSource | null = null;
    if (input.usage !== null) {
      const u = object(input.usage);
      fields(u, ["denoBin", "probe", "checkout", "model", "credentialEnv", "timeoutMs", "maxBytes", "windows"]);
      if (typeof u.model !== "string" || u.model.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)+$/.test(u.model)) throw new SourceError("shape-mismatch");
      const w = object(u.windows);
      fields(w, USAGE_WINDOWS);
      const windows = {} as Record<UsageWindow, { label: string; windowMinutes: number }>;
      for (const id of USAGE_WINDOWS) {
        const row = object(w[id]);
        fields(row, ["label", "windowMinutes"]);
        windows[id] = { label: safeLabel(row.label), windowMinutes: positive(row.windowMinutes) };
      }
      if (new Set(Object.values(windows).map(w => w.label)).size !== USAGE_WINDOWS.length) throw new SourceError("shape-mismatch");
      usage = { denoBin: path(u.denoBin), probe: path(u.probe), checkout: path(u.checkout), model: u.model,
        credentialEnv: credential(u.credentialEnv), timeoutMs: positive(u.timeoutMs, 60_000), maxBytes: positive(u.maxBytes, 4_194_304), windows };
    }
    let spend: SpendSource | null = null;
    if (input.spend !== null) {
      const s = object(input.spend);
      fields(s, ["url", "credentialEnv", "window", "validForMs", "timeoutMs", "maxBytes"]);
      if (s.url !== SPEND_URL || typeof s.window !== "string" || !Object.hasOwn(SPEND_WINDOWS, s.window)) throw new SourceError("shape-mismatch");
      spend = { url: SPEND_URL, credentialEnv: credential(s.credentialEnv), window: s.window as SpendSource["window"],
        validForMs: positive(s.validForMs), timeoutMs: positive(s.timeoutMs, 60_000), maxBytes: positive(s.maxBytes, 4_194_304) };
    }
    let capacity: CapacitySource | null = null;
    if (input.capacity !== null) {
      const c = object(input.capacity);
      fields(c, ["cgroupRoot", "scopeLabel", "validForMs"]);
      capacity = { cgroupRoot: path(c.cgroupRoot), scopeLabel: safeLabel(c.scopeLabel), validForMs: positive(c.validForMs) };
    }
    if (input.admissions !== null) {
      const a = object(input.admissions);
      fields(a, ["fromObservabilityLog"]);
      if (a.fromObservabilityLog !== true) throw new SourceError("shape-mismatch");
    }
    return { usage, spend, capacity, admissions: input.admissions === null ? null : { fromObservabilityLog: true }, accountLabel: safeLabel(input.accountLabel) };
  } catch { throw new SourceError("invalid-descriptor"); }
}

export type Leg<T> = { readonly ok: true; readonly value: T; readonly observedAt: string; readonly validUntil: string } |
  { readonly ok: false; readonly code: SourceRefusal };
export function mapped<T>(map: () => Extract<Leg<T>, { ok: true }>): Leg<T> {
  try { return map(); } catch { return { ok: false, code: "shape-mismatch" }; }
}
