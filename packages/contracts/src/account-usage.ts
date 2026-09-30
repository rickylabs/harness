/** Subscription account usage. Token counts and quota percentages are independent measurements. */
export type UsageVendor = "codex" | "claude";
export type UsageWindow = "weekly" | "5h";
export type SessionRef = `sref:v1:${UsageVendor}:${string}`;
export type UsageAccountRef = `aref:v1:${UsageVendor}:${string}`;
export type UsageAvailability = "available" | "partial" | "unavailable";
export type UsageReason = "not-configured" | "no-reading" | "incomplete-tokens" | "partial-scan" |
  "direct-read-unsupported" | "request-failed" | "timeout" | "oversize" | "shape-mismatch";

export interface AccountQuotaSnapshot {
  readonly vendor: UsageVendor;
  readonly accountRef: UsageAccountRef | null;
  /** Vendor meter identifier; separate meters must never be blended. */
  readonly limitId: string | null;
  readonly window: UsageWindow;
  readonly usedPercent: number | null;
  readonly resetsAt: string | null;
  readonly observedAt: string | null;
  readonly observedBy: SessionRef | null;
  readonly source: "account-poll" | "session" | "unavailable";
  readonly availability: UsageAvailability;
  readonly reason: UsageReason | null;
}
export interface SessionUsage {
  readonly vendor: UsageVendor;
  readonly sessionRef: SessionRef;
  /** Explicit operator aliases, never derived from a hostname or directory path. */
  readonly seat: string;
  readonly cwdLabel: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly observedAt: string;
  readonly tokens: {
    readonly input: number | null; readonly cached: number | null;
    readonly cacheWrite: number | null; readonly output: number | null; readonly reasoning: number | null;
  };
  /** Codex input includes cached input; Claude input excludes cache reads and cache writes. */
  readonly inputIncludesCached: boolean;
  readonly availability: UsageAvailability;
  readonly reason: UsageReason | null;
}
export interface UnattributedUsage {
  readonly kind: "unattributed";
  readonly vendor: UsageVendor;
  readonly accountRef: UsageAccountRef;
  readonly limitId: string;
  readonly window: UsageWindow;
  readonly from: string;
  readonly to: string;
  readonly usedPercentDelta: number;
  readonly inferred: true;
  readonly reason: "no_observed_session_activity";
}
export interface UsageCoverage {
  readonly vendor: UsageVendor;
  readonly from: string;
  readonly through: string;
  readonly state: "complete" | "partial" | "unavailable";
  readonly reason: UsageReason | null;
}
export interface AccountUsageEnvelope {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly quota: readonly AccountQuotaSnapshot[];
  readonly sessions: readonly SessionUsage[];
  readonly unattributed: readonly UnattributedUsage[];
  /** Complete means all explicitly configured owned stores were read without gaps. */
  readonly coverage: readonly UsageCoverage[];
}

/** Missing Claude cache components cannot be silently treated as zero. Reasoning is already output. */
export function sessionProcessedTokens(session: SessionUsage): number | null {
  const t = session.tokens;
  const parts = session.vendor === "codex" ? [t.input, t.output] : [t.input, t.cached, t.cacheWrite, t.output];
  if (parts.some(n => n === null || !Number.isSafeInteger(n) || n < 0)) return null;
  const sum = (parts as number[]).reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(sum) ? sum : null;
}

const reasons: readonly string[] = ["not-configured", "no-reading", "incomplete-tokens", "partial-scan",
  "direct-read-unsupported", "request-failed", "timeout", "oversize", "shape-mismatch"];
function fail(): never { throw new Error("invalid account usage"); }
const label = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const time = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const nullable = (v: unknown, check: (x: unknown) => boolean): boolean => v === null || check(v);
const count = (v: unknown): boolean => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const percent = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const vendor = (v: unknown): v is UsageVendor => v === "codex" || v === "claude";
const window = (v: unknown): boolean => v === "weekly" || v === "5h";
const ref = (v: unknown, prefix: string, owner: unknown): boolean => typeof v === "string" &&
  new RegExp(`^${prefix}:v1:${owner}:[A-Za-z0-9_-]{43}$`).test(v);
function record(v: unknown, keys: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) fail();
  const names = keys.split(" ");
  if (Reflect.ownKeys(v).length !== names.length) fail();
  const out: Record<string, unknown> = {};
  for (const key of names) {
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (!d || !("value" in d) || !d.enumerable) fail();
    out[key] = d.value;
  }
  return out;
}
function list(v: unknown, cap: number): unknown[] {
  if (!Array.isArray(v)) fail();
  const length = Object.getOwnPropertyDescriptor(v, "length");
  if (!length || !("value" in length) || !count(length.value) || length.value > cap ||
      Reflect.ownKeys(v).length !== length.value + 1) fail();
  return Array.from({ length: length.value as number }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !("value" in d) || !d.enumerable) fail();
    return d.value as unknown;
  });
}
function availability(r: Record<string, unknown>): void {
  if (!["available", "partial", "unavailable"].includes(r["availability"] as string) ||
      !nullable(r["reason"], x => typeof x === "string" && reasons.includes(x)) ||
      ((r["availability"] === "available") !== (r["reason"] === null))) fail();
}

/** Closed, bounded, copying decoder: raw identities, paths and extra fields cannot cross this seam. */
export function readAccountUsageEnvelope(input: unknown):
  { readonly ok: true; readonly envelope: AccountUsageEnvelope } | { readonly ok: false; readonly reason: "invalid" } {
  try {
    const root = record(input, "schemaVersion generatedAt quota sessions unattributed coverage");
    if (root["schemaVersion"] !== 1 || !time(root["generatedAt"])) fail();
    const generated = root["generatedAt"] as string;
    const quota = list(root["quota"], 64).map(v => {
      const r = record(v, "vendor accountRef limitId window usedPercent resetsAt observedAt observedBy source availability reason");
      if (!vendor(r["vendor"]) || !window(r["window"]) || !nullable(r["accountRef"], x => ref(x, "aref", r["vendor"])) ||
          !nullable(r["limitId"], label) || !nullable(r["usedPercent"], percent) || !nullable(r["resetsAt"], time) ||
          !nullable(r["observedAt"], x => time(x) && x <= generated) || !nullable(r["observedBy"], x => ref(x, "sref", r["vendor"]))) fail();
      availability(r);
      if (!["account-poll", "session", "unavailable"].includes(r["source"] as string)) fail();
      if (r["source"] === "unavailable") {
        if (r["availability"] !== "unavailable" || [r["usedPercent"], r["resetsAt"], r["observedAt"], r["observedBy"]].some(x => x !== null)) fail();
      } else {
        if (r["observedAt"] === null || r["availability"] === "unavailable" ||
            (r["source"] === "session") !== (r["observedBy"] !== null)) fail();
        if (r["availability"] === "available" && (r["usedPercent"] === null || r["resetsAt"] === null)) fail();
      }
      return r;
    });
    const sessions = list(root["sessions"], 2000).map(v => {
      const r = record(v, "vendor sessionRef seat cwdLabel model effort startedAt endedAt observedAt tokens inputIncludesCached availability reason");
      if (!vendor(r["vendor"]) || !ref(r["sessionRef"], "sref", r["vendor"]) || !label(r["seat"]) || !label(r["cwdLabel"]) ||
          !nullable(r["model"], label) || !nullable(r["effort"], label) || !time(r["startedAt"]) ||
          !time(r["observedAt"]) || r["startedAt"] > r["observedAt"] || r["observedAt"] > generated ||
          !nullable(r["endedAt"], x => time(x) && x >= (r["startedAt"] as string) && x <= (r["observedAt"] as string)) ||
          r["inputIncludesCached"] !== (r["vendor"] === "codex")) fail();
      availability(r);
      const t = record(r["tokens"], "input cached cacheWrite output reasoning");
      if (Object.values(t).some(n => !nullable(n, count))) fail();
      if (r["vendor"] === "codex" && typeof t["input"] === "number" && typeof t["cached"] === "number" && t["cached"] > t["input"]) fail();
      if (typeof t["output"] === "number" && typeof t["reasoning"] === "number" && t["reasoning"] > t["output"]) fail();
      r["tokens"] = t;
      const processed = sessionProcessedTokens(r as unknown as SessionUsage);
      if (r["availability"] === "available" && processed === null) fail();
      if (r["availability"] === "unavailable" && Object.values(t).some(n => n !== null)) fail();
      return r;
    });
    const unattributed = list(root["unattributed"], 1000).map(v => {
      const r = record(v, "kind vendor accountRef limitId window from to usedPercentDelta inferred reason");
      if (r["kind"] !== "unattributed" || !vendor(r["vendor"]) || !ref(r["accountRef"], "aref", r["vendor"]) ||
          !label(r["limitId"]) || !window(r["window"]) || !time(r["from"]) || !time(r["to"]) ||
          r["from"] >= r["to"] || r["to"] > generated || !percent(r["usedPercentDelta"]) || r["usedPercentDelta"] <= 0 ||
          r["inferred"] !== true || r["reason"] !== "no_observed_session_activity") fail();
      return r;
    });
    const coverage = list(root["coverage"], 2).map(v => {
      const r = record(v, "vendor from through state reason");
      if (!vendor(r["vendor"]) || !time(r["from"]) || !time(r["through"]) || r["from"] > r["through"] || r["through"] > generated ||
          !["complete", "partial", "unavailable"].includes(r["state"] as string) ||
          !nullable(r["reason"], x => typeof x === "string" && reasons.includes(x)) ||
          ((r["state"] === "complete") !== (r["reason"] === null))) fail();
      return r;
    });
    if (coverage.length !== 2 || new Set(coverage.map(r => r["vendor"])).size !== 2) fail();
    if (new Set(sessions.map(r => r["sessionRef"])).size !== sessions.length ||
        new Set(quota.map(r => JSON.stringify([r["vendor"], r["accountRef"], r["limitId"], r["window"]]))).size !== quota.length) fail();
    return { ok: true, envelope: { schemaVersion: 1, generatedAt: generated, quota, sessions, unattributed, coverage } as unknown as AccountUsageEnvelope };
  } catch { return { ok: false, reason: "invalid" }; }
}
