/** Version-one normalized provider evidence: amounts are advisory; only inference outcomes refuse. */
export const PROVIDER_LIMIT_WARNING_PERCENT = 90;
export const MAX_PROVIDER_LIMIT_SOURCE_ROWS = 1024;
export const MAX_PROVIDER_LIMIT_SOURCE_BYTES = 4 * 1024 * 1024;
export const SUBSCRIPTION_PROVIDERS = ["claude", "codex", "opencode-go", "ollama-cloud", "github-copilot", "agy"] as const;
export interface ProviderLimitMeterV1 {
  readonly provider: string;
  readonly scope: "subscription" | "key";
  readonly keyName: string | null;
  readonly accountRef: string | null;
  readonly limitId: string | null;
  readonly model: string | null;
  readonly launchModels: readonly string[];
  readonly window: "5h" | "weekly" | "daily" | "monthly" | "total" | "unknown";
  readonly unit: "percent" | "usd" | null;
  readonly used: number | null;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly usedPercent: number | null;
  readonly state: "known" | "partial" | "unknown";
  readonly source: "harness-account" | "orchid-governor" | "openrouter-key" | "unavailable";
  readonly reason: "source_not_configured" | "source_unavailable" | "unsupported" | "measurement_missing" | "source_stale" | "window_reset" | "source_partial" | "identity_ambiguous" | null;
  readonly observedAt: string | null;
  readonly resetsAt: string | null;
}
export interface ProviderOutcomeV1 {
  readonly provider: string;
  readonly keyName: string | null;
  readonly accountRef: string | null;
  readonly model: string | null;
  readonly outcome: "refused" | "succeeded";
  readonly reason: "quota_exhausted" | "payment_required" | "rate_limited" | null;
  readonly source: "provider-run" | "inference-probe";
  readonly observedAt: string;
  readonly resetsAt: string | null;
}
export interface ProviderLimitSnapshotV1 {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly meters: readonly ProviderLimitMeterV1[];
  readonly outcomes: readonly ProviderOutcomeV1[];
}
const meterKeys = "provider scope keyName accountRef limitId model launchModels window unit used limit remaining usedPercent state source reason observedAt resetsAt";
const outcomeKeys = "provider keyName accountRef model outcome reason source observedAt resetsAt";
const provider = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const model = (v: unknown): v is string => typeof v === "string" && v.length <= 256 && /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v);
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v);
const account = (v: unknown): v is string => typeof v === "string" && /^(?:aref:v1:(?:claude|codex):[A-Za-z0-9_-]{43}|paccount_[a-f0-9]{64})$/.test(v);
const time = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const nullable = (v: unknown, check: (value: unknown) => boolean) => v === null || check(v);
const oneOf = (v: unknown, choices: string) => typeof v === "string" && choices.split(" ").includes(v);
function fail(): never { throw new Error("invalid provider limits"); }
function record(input: unknown, keys: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const names = keys.split(" ");
  if (Reflect.ownKeys(input).length !== names.length) fail();
  const copy: Record<string, unknown> = {};
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(input, name);
    if (!d || !("value" in d) || !d.enumerable) fail();
    copy[name] = d.value as unknown;
  }
  return copy;
}
function list(input: unknown, max: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > max || Reflect.ownKeys(input).length !== input.length + 1) fail();
  return Array.from({ length: input.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d || !("value" in d) || !d.enumerable) fail();
    return d.value as unknown;
  });
}
/** Closed copying decoder, wire-compatible with Cockpit's merged version-one schema. */
export function readProviderLimitSnapshot(input: unknown): { readonly ok: true; readonly snapshot: ProviderLimitSnapshotV1 } | { readonly ok: false; readonly reason: "invalid" } {
  try {
    const root = record(input, "schemaVersion generatedAt meters outcomes");
    if (root["schemaVersion"] !== 1 || !time(root["generatedAt"])) fail();
    const generated = Date.parse(root["generatedAt"]);
    const bindings = new Map<string, string>(), identities = new Set<string>();
    const meters = list(root["meters"], MAX_PROVIDER_LIMIT_SOURCE_ROWS).map(v => {
      const r = record(v, meterKeys);
      if (!provider(r["provider"]) || !oneOf(r["scope"], "subscription key") || !nullable(r["keyName"], key) || !nullable(r["accountRef"], account) ||
          !nullable(r["limitId"], x => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)) || !nullable(r["model"], model) ||
          !oneOf(r["window"], "5h weekly daily monthly total unknown") || !nullable(r["unit"], x => oneOf(x, "percent usd")) ||
          !["used", "limit"].every(k => nullable(r[k], amount)) || !nullable(r["remaining"], x => typeof x === "number" && Number.isFinite(x) && x <= Number.MAX_SAFE_INTEGER) ||
          !nullable(r["usedPercent"], x => amount(x) && x <= 100) || !oneOf(r["state"], "known partial unknown") ||
          !oneOf(r["source"], "harness-account orchid-governor openrouter-key unavailable") ||
          !nullable(r["reason"], x => oneOf(x, "source_not_configured source_unavailable unsupported measurement_missing source_stale window_reset source_partial identity_ambiguous")) ||
          !nullable(r["observedAt"], x => time(x) && Date.parse(x) <= generated) || !nullable(r["resetsAt"], time)) fail();
      const routes = list(r["launchModels"], 256);
      if (!routes.every(model) || new Set(routes).size !== routes.length) fail();
      const paid = r["scope"] === "key";
      if (paid ? r["provider"] !== "openrouter" || r["model"] !== null || (r["keyName"] === null && (r["state"] !== "unknown" || routes.length !== 0)) || routes.some(id => !(id as string).startsWith("openrouter/")) :
          r["keyName"] !== null || (routes.length !== 0 && (r["accountRef"] === null || routes.some(id => !(id as string).startsWith(`${r["provider"] as string}/`))))) fail();
      if (r["state"] === "unknown") {
        if (["used", "limit", "remaining", "usedPercent"].some(k => r[k] !== null) || r["reason"] === null) fail();
      } else {
        if (r["source"] === "unavailable" || r["observedAt"] === null || ((r["state"] === "known") !== (r["reason"] === null))) fail();
        if (!paid ? r["unit"] !== "percent" || r["usedPercent"] === null || ["used", "limit", "remaining"].some(k => r[k] !== null) :
            r["unit"] !== "usd" || r["usedPercent"] !== null || r["used"] === null || (r["limit"] === null ? r["remaining"] !== null :
            r["remaining"] === null || (r["remaining"] as number) > (r["limit"] as number) || Math.abs((r["used"] as number) - ((r["limit"] as number) - (r["remaining"] as number))) > Math.max(1, r["used"] as number) * Number.EPSILON * 8)) fail();
      }
      const identity = JSON.stringify([r["provider"], r["scope"], r["keyName"], r["accountRef"], r["limitId"], r["model"], r["window"]]);
      if (identities.has(identity)) fail();
      identities.add(identity);
      const binding = JSON.stringify([r["provider"], r["scope"], paid ? r["keyName"] : r["accountRef"]]);
      for (const route of routes as string[]) {
        if (bindings.has(route) && bindings.get(route) !== binding) fail();
        bindings.set(route, binding);
      }
      return { ...r, launchModels: routes };
    });
    const outcomes = list(root["outcomes"], MAX_PROVIDER_LIMIT_SOURCE_ROWS).map(v => {
      const r = record(v, outcomeKeys);
      if (!provider(r["provider"]) || !nullable(r["keyName"], key) || !nullable(r["accountRef"], account) || !nullable(r["model"], model) ||
          !oneOf(r["outcome"], "refused succeeded") || !nullable(r["reason"], x => oneOf(x, "quota_exhausted payment_required rate_limited")) ||
          !oneOf(r["source"], "provider-run inference-probe") || !time(r["observedAt"]) || Date.parse(r["observedAt"]) > generated || !nullable(r["resetsAt"], time) ||
          ((r["outcome"] === "refused") !== (r["reason"] !== null)) || (r["keyName"] !== null && r["provider"] !== "openrouter")) fail();
      return r;
    });
    const snapshot = { schemaVersion: 1, generatedAt: root["generatedAt"], meters, outcomes } as unknown as ProviderLimitSnapshotV1;
    if (/(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{12,}|\bBearer\s+\S+|\.ts\.net\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:\/home\/|\/Users\/|\/root\/|\/tmp\/|~\/|[A-Za-z]:\\|\\\\)/i.test(JSON.stringify(snapshot))) fail();
    return { ok: true, snapshot };
  } catch { return { ok: false, reason: "invalid" }; }
}
