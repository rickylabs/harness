/** Provider billing, local accounting and current prices remain independent measurements. */
export const PROVIDER_METER_UNITS = ["premium_requests", "ai_credits", "usd", "unknown"] as const;
export const PROVIDER_USAGE_REASONS = ["no-plan-read-credential", "request-failed", "timeout", "oversize",
  "shape-mismatch", "account-source-unavailable", "partial-history", "unsupported-token-schema",
  "unsupported-pricing", "model-unpriced"] as const;
export type ProviderMeterUnit = (typeof PROVIDER_METER_UNITS)[number];
export type ProviderUsageReason = (typeof PROVIDER_USAGE_REASONS)[number];
/** Nonnegative fixed-point decimal, at most nine integral and nine fractional digits. */
export type PaidQuantity = string;
export interface ProviderMeterRow {
  readonly provider: string; readonly model: string | null; readonly accountRef: string;
  readonly unit: ProviderMeterUnit; readonly period: "day" | "month" | "history";
  readonly from: string; readonly through: string;
  readonly observedAt: string | null;
  /** Fetch time is not proof that all charges through that time have settled. */
  readonly reportedThrough: string | null;
  readonly source: "github-billing" | "opencode-history" | "unmetered";
  readonly state: "known" | "partial" | "unknown"; readonly reason: ProviderUsageReason | null;
  readonly grossQuantity: PaidQuantity | null; readonly includedQuantity: PaidQuantity | null;
  readonly netQuantity: PaidQuantity | null;
  readonly grossUsd: PaidQuantity | null; readonly includedUsd: PaidQuantity | null;
  readonly netUsd: PaidQuantity | null; readonly pricePerUnitUsd: PaidQuantity | null;
}
export interface ModelPriceRates {
  /** USD per million tokens. Missing is unknown, never a free price. */
  readonly input: PaidQuantity | null; readonly output: PaidQuantity | null;
  readonly cacheRead: PaidQuantity | null; readonly cacheWrite: PaidQuantity | null;
}
export interface ModelPriceOverride {
  readonly minPromptTokens: number | null;
  readonly utcStart: string | null; readonly utcEnd: string | null;
  readonly utcDays: readonly number[] | null; readonly rates: ModelPriceRates;
}
export interface ModelPriceRow {
  readonly provider: "openrouter"; readonly model: string;
  readonly observedAt: string | null; readonly source: "models-endpoint";
  readonly state: "known" | "partial" | "unknown"; readonly reason: ProviderUsageReason | null;
  readonly rates: ModelPriceRates; readonly overrides: readonly ModelPriceOverride[];
  /** These dimensions are present but not priced by the four-column preview. */
  readonly additionalCharges: readonly string[];
}
export interface ProviderHistoryRow {
  readonly provider: string; readonly model: string; readonly accountRef: string;
  readonly from: string; readonly through: string; readonly observedAt: string;
  readonly messages: number;
  readonly costUsd: PaidQuantity | null;
  readonly costSource: "local-reported";
  /** Normalized OpenCode counts are additive; reasoning is separate from output. */
  readonly tokens: { readonly input: number | null; readonly output: number | null;
    readonly reasoning: number | null; readonly cacheRead: number | null; readonly cacheWrite: number | null };
  readonly cacheHitRate: number | null;
  readonly coverage: "complete" | "partial"; readonly reason: ProviderUsageReason | null;
}
export interface ProviderUsageSnapshot {
  readonly schemaVersion: 1; readonly generatedAt: string;
  readonly meters: readonly ProviderMeterRow[]; readonly prices: readonly ModelPriceRow[];
  readonly history: readonly ProviderHistoryRow[];
  readonly coverage: { readonly githubBilling: "not-configured" | "known" | "partial" | "unknown";
    readonly openRouter: "not-configured" | "known" | "partial" | "unknown";
    readonly openCode: "not-configured" | "complete" | "partial" };
}

const decimal = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{0,8}[1-9])?$/;
export function paidQuantityNano(value: unknown): bigint | null {
  if (typeof value !== "string" || !decimal.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}
export function paidQuantityFromNano(value: bigint): PaidQuantity | null {
  if (value < 0n || value >= 1_000_000_000_000_000_000n) return null;
  const whole = value / 1_000_000_000n, fraction = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
const providerId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const modelId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v);
const account = (v: unknown): v is string => typeof v === "string" && /^paccount_[a-f0-9]{64}$/.test(v);
const instant = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nullable = (v: unknown, check: (x: unknown) => boolean): boolean => v === null || check(v);
function fail(): never { throw new Error("invalid provider usage"); }
function record(value: unknown, names: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const keys = names.split(" ");
  if (Reflect.ownKeys(value).length !== keys.length) fail();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable) fail();
    out[key] = d.value;
  }
  return out;
}
function list(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !count(length.value) || length.value > cap || Reflect.ownKeys(value).length !== length.value + 1) fail();
  return Array.from({ length: length.value }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) fail();
    return d.value as unknown;
  });
}
function unique<T>(rows: readonly T[], key: (row: T) => string): void {
  if (new Set(rows.map(key)).size !== rows.length) fail();
}
function state(r: Record<string, unknown>, generatedAt: string): void {
  if (!["known", "partial", "unknown"].includes(r["state"] as string) ||
      !nullable(r["reason"], x => PROVIDER_USAGE_REASONS.includes(x as ProviderUsageReason)) ||
      ((r["state"] === "known") !== (r["reason"] === null)) ||
      !nullable(r["observedAt"], x => instant(x) && x <= generatedAt) ||
      ((r["state"] === "unknown") !== (r["observedAt"] === null))) fail();
}
function span(r: Record<string, unknown>): void {
  if (!instant(r["from"]) || !instant(r["through"]) || r["from"] >= r["through"]) fail();
}
const rateKeys = "input output cacheRead cacheWrite";
function rates(value: unknown): ModelPriceRates {
  const r = record(value, rateKeys);
  if (Object.values(r).some(x => !nullable(x, x => paidQuantityNano(x) !== null))) fail();
  return r as unknown as ModelPriceRates;
}
const chargeFields = ["request", "internal_reasoning", "input_cache_write_1h", "image", "image_output",
  "audio", "audio_output", "input_audio_cache", "web_search", "unsupported"] as const;
function override(value: unknown): ModelPriceOverride {
  const r = record(value, "minPromptTokens utcStart utcEnd utcDays rates");
  if (!nullable(r["minPromptTokens"], count)) fail();
  const clock = (v: unknown): boolean => typeof v === "string" && /^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/.test(v);
  if (!nullable(r["utcStart"], clock) || !nullable(r["utcEnd"], clock) || (r["utcStart"] === null) !== (r["utcEnd"] === null)) fail();
  const days = r["utcDays"] === null ? null : list(r["utcDays"], 7).map(x => {
    if (!count(x) || x > 6) fail(); return x;
  });
  if (days !== null && (!days.length || new Set(days).size !== days.length)) fail();
  if (r["minPromptTokens"] === null && r["utcStart"] === null && days === null) fail();
  return { minPromptTokens: r["minPromptTokens"] as number | null, utcStart: r["utcStart"] as string | null,
    utcEnd: r["utcEnd"] as string | null, utcDays: days, rates: rates(r["rates"]) };
}

/** Closed copying boundary. Getter/Proxy errors and raw private fields never escape. */
export function readProviderUsageSnapshot(value: unknown):
  { readonly ok: true; readonly snapshot: ProviderUsageSnapshot } | { readonly ok: false; readonly reason: "invalid" } {
  try {
    const root = record(value, "schemaVersion generatedAt meters prices history coverage");
    if (root["schemaVersion"] !== 1 || !instant(root["generatedAt"])) fail();
    const generatedAt = root["generatedAt"];
    const meters = list(root["meters"], 1024).map(value => {
      const r = record(value, "provider model accountRef unit period from through observedAt reportedThrough source state reason grossQuantity includedQuantity netQuantity grossUsd includedUsd netUsd pricePerUnitUsd");
      if (!providerId(r["provider"]) || !nullable(r["model"], modelId) || !account(r["accountRef"]) ||
          !PROVIDER_METER_UNITS.includes(r["unit"] as ProviderMeterUnit) || !["day", "month", "history"].includes(r["period"] as string) ||
          !["github-billing", "opencode-history", "unmetered"].includes(r["source"] as string)) fail();
      state(r, generatedAt); span(r);
      if (!nullable(r["reportedThrough"], x => instant(x) && r["observedAt"] !== null && x <= (r["observedAt"] as string))) fail();
      const quantities = ["grossQuantity", "includedQuantity", "netQuantity", "grossUsd", "includedUsd", "netUsd", "pricePerUnitUsd"];
      if (quantities.some(k => !nullable(r[k], x => paidQuantityNano(x) !== null))) fail();
      if (r["state"] === "unknown" && quantities.some(k => r[k] !== null)) fail();
      if (r["source"] === "github-billing") {
        if (r["provider"] !== "github-copilot" || !["premium_requests", "ai_credits"].includes(r["unit"] as string) || r["period"] === "history") fail();
        if (r["state"] !== "unknown") {
          if (quantities.filter(k => k !== "pricePerUnitUsd").some(k => r[k] === null) ||
              paidQuantityNano(r["grossQuantity"]) !== paidQuantityNano(r["includedQuantity"])! + paidQuantityNano(r["netQuantity"])! ||
              paidQuantityNano(r["grossUsd"]) !== paidQuantityNano(r["includedUsd"])! + paidQuantityNano(r["netUsd"])!) fail();
        }
      } else if (r["source"] === "opencode-history") {
        if (r["unit"] !== "usd" || r["period"] !== "history" || r["state"] !== "partial" || r["reason"] !== "partial-history" ||
            r["reportedThrough"] !== null || r["includedQuantity"] !== null || r["netQuantity"] !== null || r["includedUsd"] !== null || r["netUsd"] !== null) fail();
      } else if (r["unit"] !== "unknown" || r["state"] !== "unknown") fail();
      return r as unknown as ProviderMeterRow;
    });
    unique(meters, r => JSON.stringify([r.provider, r.model, r.accountRef, r.unit, r.period, r.from, r.through]));
    const prices = list(root["prices"], 2048).map(value => {
      const r = record(value, "provider model observedAt source state reason rates overrides additionalCharges");
      if (r["provider"] !== "openrouter" || !modelId(r["model"]) || r["source"] !== "models-endpoint") fail();
      state(r, generatedAt);
      const base = rates(r["rates"]), overrides = list(r["overrides"], 64).map(override);
      const additionalCharges = list(r["additionalCharges"], chargeFields.length).map(x => {
        if (!chargeFields.includes(x as typeof chargeFields[number])) fail(); return x as string;
      });
      unique(additionalCharges, x => x);
      if (r["state"] === "known" && (Object.values(base).some(x => x === null) || overrides.some(o => Object.values(o.rates).some(x => x === null)) || additionalCharges.length)) fail();
      if (r["state"] === "unknown" && (Object.values(base).some(x => x !== null) || overrides.length || additionalCharges.length)) fail();
      return { ...r, rates: base, overrides, additionalCharges } as unknown as ModelPriceRow;
    });
    unique(prices, r => r.model);
    const history = list(root["history"], 1024).map(value => {
      const r = record(value, "provider model accountRef from through observedAt messages costUsd costSource tokens cacheHitRate coverage reason");
      if (!providerId(r["provider"]) || !modelId(r["model"]) || !account(r["accountRef"]) || !count(r["messages"]) ||
          !instant(r["observedAt"]) || r["observedAt"] > generatedAt || r["costSource"] !== "local-reported" ||
          !nullable(r["costUsd"], x => paidQuantityNano(x) !== null)) fail();
      span(r);
      if ((r["through"] as string) > generatedAt || !["complete", "partial"].includes(r["coverage"] as string) ||
          !nullable(r["reason"], x => PROVIDER_USAGE_REASONS.includes(x as ProviderUsageReason)) ||
          ((r["coverage"] === "complete") !== (r["reason"] === null))) fail();
      const tokens = record(r["tokens"], "input output reasoning cacheRead cacheWrite");
      if (Object.values(tokens).some(x => !nullable(x, count))) fail();
      const prompt = [tokens["input"], tokens["cacheRead"], tokens["cacheWrite"]];
      const total = prompt.some(x => x === null) ? null : (prompt as number[]).reduce((a, b) => a + b, 0);
      if (total !== null && !Number.isSafeInteger(total)) fail();
      const ratio = total === null || total === 0 ? null : (tokens["cacheRead"] as number) / total;
      if (r["cacheHitRate"] !== ratio || (r["coverage"] === "complete" && (Object.values(tokens).some(x => x === null) || r["costUsd"] === null))) fail();
      return { ...r, tokens } as unknown as ProviderHistoryRow;
    });
    unique(history, r => JSON.stringify([r.provider, r.model, r.accountRef, r.from, r.through]));
    const coverage = record(root["coverage"], "githubBilling openRouter openCode");
    if (!["not-configured", "known", "partial", "unknown"].includes(coverage["githubBilling"] as string) ||
        !["not-configured", "known", "partial", "unknown"].includes(coverage["openRouter"] as string) ||
        !["not-configured", "complete", "partial"].includes(coverage["openCode"] as string)) fail();
    const billing = meters.filter(r => r.source === "github-billing");
    if (coverage["githubBilling"] === "not-configured" ? billing.length !== 0 : billing.length === 0) fail();
    if (coverage["githubBilling"] === "known" && billing.some(r => r.state !== "known")) fail();
    if (coverage["githubBilling"] === "unknown" && billing.some(r => r.state !== "unknown")) fail();
    if (coverage["openRouter"] === "not-configured" && prices.length !== 0) fail();
    if (coverage["openRouter"] === "known" && (!prices.length || prices.some(r => r.state !== "known"))) fail();
    if (coverage["openRouter"] === "unknown" && prices.some(r => r.state !== "unknown")) fail();
    if (coverage["openCode"] === "not-configured" && history.length !== 0) fail();
    if (coverage["openCode"] === "complete" && history.some(r => r.coverage !== "complete")) fail();
    return { ok: true, snapshot: { schemaVersion: 1, generatedAt, meters, prices, history,
      coverage: coverage as unknown as ProviderUsageSnapshot["coverage"] } };
  } catch { return { ok: false, reason: "invalid" }; }
}
