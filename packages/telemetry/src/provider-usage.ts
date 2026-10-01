import { createHmac } from "node:crypto";
import { isAbsolute } from "node:path";
import { paidQuantityFromNano, paidQuantityNano, readProviderUsageSnapshot,
  type ModelPriceRow, type ModelPriceRates, type ModelPriceOverride, type ProviderMeterRow,
  type ProviderUsageReason, type ProviderUsageSnapshot, type ProviderHistoryRow } from "@rickylabs/harness-contracts";
import { usageFile } from "./account-usage.js";
import { readOpenCodeHistory } from "./provider-history.js";

export const PLAN_READ_CREDENTIAL_KEY = "GITHUB_COPILOT_PLAN_READ_TOKEN";
export interface ProviderUsageSource {
  readonly githubCopilot: { readonly username: string; readonly credentialFile: string | null;
    /** Exact native-model to billing-model mapping. Names and multipliers are not code. */
    readonly models: readonly { readonly model: string; readonly billingModel: string }[] } | null;
  readonly openRouter: { readonly models: readonly string[] } | null;
  readonly openCode: { readonly databaseFile: string; readonly from: string;
    readonly versions: readonly string[];
    readonly providers: readonly { readonly provider: string; readonly accountIdentity: string }[] } | null;
}
const providerId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const modelId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v);
const path = (v: unknown): v is string => typeof v === "string" && v.length < 4096 && isAbsolute(v) && !/[\x00-\x1f\x7f]/.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) throw new Error("invalid provider source");
  return v as Record<string, unknown>;
};
const exact = (r: Record<string, unknown>, names: string): void => {
  if (Object.keys(r).sort().join(" ") !== names.split(" ").sort().join(" ")) throw new Error("invalid provider source");
};
const bounded = (v: unknown, cap: number): unknown[] => {
  if (!Array.isArray(v) || v.length > cap) throw new Error("invalid provider source"); return v;
};
export function readProviderUsageSource(value: unknown): ProviderUsageSource {
  const r = object(value); exact(r, "githubCopilot openRouter openCode");
  let githubCopilot: ProviderUsageSource["githubCopilot"] = null;
  if (r["githubCopilot"] !== null) {
    const g = object(r["githubCopilot"]); exact(g, "username credentialFile models");
    if (typeof g["username"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(g["username"]) ||
        !(g["credentialFile"] === null || path(g["credentialFile"]))) throw new Error("invalid provider source");
    const models = bounded(g["models"], 128).map(v => {
      const m = object(v); exact(m, "model billingModel");
      if (!modelId(m["model"]) || typeof m["billingModel"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,255}$/.test(m["billingModel"])) throw new Error("invalid provider source");
      return { model: m["model"], billingModel: m["billingModel"] };
    });
    if (new Set(models.map(m => m.model)).size !== models.length || new Set(models.map(m => m.billingModel)).size !== models.length) throw new Error("invalid provider source");
    githubCopilot = { username: g["username"], credentialFile: g["credentialFile"], models };
  }
  let openRouter: ProviderUsageSource["openRouter"] = null;
  if (r["openRouter"] !== null) {
    const o = object(r["openRouter"]); exact(o, "models");
    const models = bounded(o["models"], 128).map(v => { if (!modelId(v) || !v.includes("/")) throw new Error("invalid provider source"); return v; });
    if (new Set(models).size !== models.length) throw new Error("invalid provider source");
    openRouter = { models };
  }
  let openCode: ProviderUsageSource["openCode"] = null;
  if (r["openCode"] !== null) {
    const o = object(r["openCode"]); exact(o, "databaseFile from versions providers");
    if (!path(o["databaseFile"]) || !instant(o["from"])) throw new Error("invalid provider source");
    const versions = bounded(o["versions"], 32).map(v => {
      if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v)) throw new Error("invalid provider source"); return v;
    });
    if (!versions.length || new Set(versions).size !== versions.length) throw new Error("invalid provider source");
    const providers = bounded(o["providers"], 128).map(v => {
      const p = object(v); exact(p, "provider accountIdentity");
      if (!providerId(p["provider"]) || typeof p["accountIdentity"] !== "string" || !p["accountIdentity"].length || p["accountIdentity"].length > 1024) throw new Error("invalid provider source");
      return { provider: p["provider"], accountIdentity: p["accountIdentity"] };
    });
    if (new Set(providers.map(p => p.provider)).size !== providers.length) throw new Error("invalid provider source");
    openCode = { databaseFile: o["databaseFile"], from: o["from"], versions, providers };
  }
  return { githubCopilot, openRouter, openCode };
}
export function providerAccountRef(provider: string, identity: string, key: Uint8Array): string {
  return `paccount_${createHmac("sha256", key).update(JSON.stringify([provider, identity])).digest("hex")}`;
}
/** Convert decimal JSON quantities without rounding or treating missing/non-finite as zero. */
export function providerDecimal(value: unknown, million = false): string | null {
  if (!(typeof value === "string" || typeof value === "number") || (typeof value === "number" && !Number.isFinite(value))) return null;
  let raw = String(value);
  const scientific = /^([0-9]+)(?:\.([0-9]+))?e([+-]?[0-9]+)$/.exec(raw);
  if (scientific) {
    const digits = scientific[1]! + (scientific[2] ?? ""), position = scientific[1]!.length + Number(scientific[3]);
    if (!Number.isSafeInteger(position) || Math.abs(position) > 30) return null;
    raw = position <= 0 ? `0.${"0".repeat(-position)}${digits}` : position >= digits.length ? digits + "0".repeat(position - digits.length) : `${digits.slice(0, position)}.${digits.slice(position)}`;
  }
  const match = /^(0|[1-9][0-9]{0,14})(?:\.([0-9]{1,15}))?$/.exec(raw);
  if (!match) return null;
  const scale = million ? 15 : 9, fraction = match[2] ?? "";
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) return null;
  const nano = BigInt(match[1]!) * (10n ** BigInt(scale)) + BigInt(fraction.slice(0, scale).padEnd(scale, "0"));
  return paidQuantityFromNano(nano);
}
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type JsonResult = { ok: true; value: unknown } | { ok: false; reason: ProviderUsageReason };
/** One bounded, timeout-covered GET. No redirect, raw error or response text escape. */
export async function providerJson(url: string, headers: Record<string, string>, fetcher: Fetcher = fetch): Promise<JsonResult> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  controller.signal.addEventListener("abort", () => { if (reader) void reader.cancel().catch(() => {}); }, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<JsonResult>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ ok: false, reason: "timeout" }); }, 10_000); });
  const request = (async (): Promise<JsonResult> => {
    try {
      const response = await fetcher(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
      if (response.redirected || !response.ok) {
        void response.body?.cancel().catch(() => {});
        return { ok: false, reason: [401, 403, 404].includes(response.status) && url.startsWith("https://api.github.com/") ? "no-plan-read-credential" : "request-failed" };
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 4 * 1024 * 1024)) {
        void response.body?.cancel().catch(() => {});
        return { ok: false, reason: "oversize" };
      }
      reader = response.body?.getReader();
      if (!reader) return { ok: false, reason: "shape-mismatch" };
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.length;
        if (bytes > 4 * 1024 * 1024) return { ok: false, reason: "oversize" };
        chunks.push(next.value);
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      return { ok: true, value };
    } catch { return { ok: false, reason: controller.signal.aborted ? "timeout" : "request-failed" }; }
    finally { if (reader) void reader.cancel().catch(() => {}); }
  })();
  try { return await Promise.race([request, timeout]); } finally { clearTimeout(timer); controller.abort(); }
}
async function planCredential(file: string | null): Promise<string | null> {
  if (file === null) return null;
  try {
    const r = object(JSON.parse((await usageFile(file, 4096, true)).toString("utf8"))); exact(r, PLAN_READ_CREDENTIAL_KEY);
    const value = r[PLAN_READ_CREDENTIAL_KEY];
    return typeof value === "string" && /^(?:github_pat_|ghu_)[A-Za-z0-9_]{16,1024}$/.test(value) ? value : null;
  } catch { return null; }
}
const emptyQuantities = { grossQuantity: null, includedQuantity: null, netQuantity: null,
  grossUsd: null, includedUsd: null, netUsd: null, pricePerUnitUsd: null } as const;
function period(now: string, daily: boolean): { from: string; through: string; year: number; month: number; day: number } {
  const d = new Date(now), year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
  return { from: new Date(Date.UTC(year, month - 1, daily ? day : 1)).toISOString(),
    through: new Date(Date.UTC(year, daily ? month - 1 : month, daily ? day + 1 : 1)).toISOString(), year, month, day };
}
export async function githubBilling(source: NonNullable<ProviderUsageSource["githubCopilot"]>, key: Uint8Array, now: string, fetcher: Fetcher = fetch): Promise<ProviderMeterRow[]> {
  const credential = await planCredential(source.credentialFile), accountRef = providerAccountRef("github-copilot", source.username.toLowerCase(), key);
  const rows: ProviderMeterRow[] = [];
  for (const unit of ["premium_requests", "ai_credits"] as const) for (const daily of [false, true]) {
    const p = period(now, daily), base = { provider: "github-copilot", accountRef, unit, period: daily ? "day" as const : "month" as const,
      from: p.from, through: p.through, reportedThrough: null, source: "github-billing" as const };
    const unknown = (reason: ProviderUsageReason): void => {
      for (const model of [null, ...source.models.map(m => m.model)]) rows.push({ ...base, model, observedAt: null, state: "unknown", reason, ...emptyQuantities });
    };
    if (!credential) { unknown("no-plan-read-credential"); continue; }
    const endpoint = unit === "premium_requests" ? "premium_request" : "ai_credit";
    const url = `https://api.github.com/users/${encodeURIComponent(source.username)}/settings/billing/${endpoint}/usage?year=${p.year}&month=${p.month}${daily ? `&day=${p.day}` : ""}`;
    const result = await providerJson(url, { Accept: "application/vnd.github+json", Authorization: `Bearer ${credential}`, "X-GitHub-Api-Version": "2026-03-10" }, fetcher);
    if (!result.ok) { unknown(result.reason); continue; }
    try {
      const r = object(result.value), time = object(r["timePeriod"]);
      if (r["user"] !== source.username || time["year"] !== p.year || time["month"] !== p.month || (daily ? time["day"] !== p.day : Object.hasOwn(time, "day"))) throw new Error("invalid billing scope");
      const items = bounded(r["usageItems"], 1024);
      const totals = new Map<string | null, bigint[]>();
      for (const model of [null, ...source.models.map(m => m.model)]) totals.set(model, [...Array<bigint>(6).fill(0n), -2n]);
      for (const item of items) {
        const row = object(item);
        if (typeof row["product"] !== "string" || !row["product"].startsWith("Copilot") ||
            row["unitType"] !== (unit === "premium_requests" ? "requests" : "ai-credits") || typeof row["model"] !== "string") throw new Error("invalid billing unit");
        const values = ["grossQuantity", "discountQuantity", "netQuantity", "grossAmount", "discountAmount", "netAmount", "pricePerUnit"].map(k => {
          const value = providerDecimal(row[k]); if (value === null) throw new Error("invalid billing quantity"); return paidQuantityNano(value)!;
        });
        if (values[0] !== values[1]! + values[2]! || values[3] !== values[4]! + values[5]!) throw new Error("invalid billing split");
        const model = source.models.find(m => m.billingModel === row["model"])?.model;
        for (const id of [null, ...(model === undefined ? [] : [model])]) {
          const previous = totals.get(id)!;
          for (let i = 0; i < 6; i++) previous[i] = previous[i]! + values[i]!;
          // An aggregate unit price is not a model price. Track a model's single consistent rate.
          previous[6] = previous[6] === -2n || previous[6] === values[6] ? values[6]! : -1n;
        }
      }
      const output: ProviderMeterRow[] = [];
      for (const [model, values] of totals) {
        const mapped = values.slice(0, 6).map(n => { const v = paidQuantityFromNano(n); if (v === null) throw new Error("billing bound"); return v; });
        // The public model-null row retains billing totals; no fictitious blended price.
        output.push({ ...base, model, observedAt: now, state: "known", reason: null,
          grossQuantity: mapped[0]!, includedQuantity: mapped[1]!, netQuantity: mapped[2]!,
          grossUsd: mapped[3]!, includedUsd: mapped[4]!, netUsd: mapped[5]!,
          pricePerUnitUsd: model === null || values[6]! < 0n ? null : paidQuantityFromNano(values[6]!) });
      }
      rows.push(...output);
    } catch { unknown("shape-mismatch"); }
  }
  return rows;
}

const noRates: ModelPriceRates = { input: null, output: null, cacheRead: null, cacheWrite: null };
const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function priceRates(r: Record<string, unknown>): ModelPriceRates {
  return { input: providerDecimal(r["prompt"], true), output: providerDecimal(r["completion"], true),
    cacheRead: providerDecimal(r["input_cache_read"], true), cacheWrite: providerDecimal(r["input_cache_write"], true) };
}
export async function openRouterPrices(source: NonNullable<ProviderUsageSource["openRouter"]>, now: string, fetcher: Fetcher = fetch): Promise<ModelPriceRow[]> {
  const unknown = (reason: ProviderUsageReason): ModelPriceRow[] => source.models.map(model => ({ provider: "openrouter", model, observedAt: null,
    source: "models-endpoint", state: "unknown", reason, rates: noRates, overrides: [], additionalCharges: [] }));
  const result = await providerJson("https://openrouter.ai/api/v1/models", {}, fetcher);
  if (!result.ok) return unknown(result.reason);
  try {
    const root = object(result.value), items = bounded(root["data"], 2048);
    if (root["total_count"] !== items.length || object(root["links"])["next"]) throw new Error("partial catalog");
    const seen = new Set<string>(), rows: ModelPriceRow[] = [];
    for (const item of items) {
      const m = object(item);
      if (!modelId(m["id"]) || !m["id"].includes("/") || seen.has(m["id"])) throw new Error("invalid model identity");
      seen.add(m["id"]);
      if (source.models.length && !source.models.includes(m["id"])) continue;
      const pricing = object(m["pricing"]), rates = priceRates(pricing);
      const additionalCharges = Object.keys(pricing).filter(k => !["prompt", "completion", "input_cache_read", "input_cache_write", "overrides"].includes(k))
        .map(k => ["request", "internal_reasoning", "input_cache_write_1h", "image", "image_output", "audio", "audio_output", "input_audio_cache", "web_search"].includes(k) ? k : "unsupported");
      const overrides = pricing["overrides"] === undefined ? [] : bounded(pricing["overrides"], 64).map(v => {
        const o = object(v);
        if (Object.keys(o).some(k => !["prompt", "completion", "input_cache_read", "input_cache_write", "min_prompt_tokens", "utc_start", "utc_end", "utc_days"].includes(k))) additionalCharges.push("unsupported");
        const days = o["utc_days"] === undefined ? null : bounded(o["utc_days"], 7).map(v => {
          const day = typeof v === "string" ? dayNames.indexOf(v) : -1; if (day < 0) throw new Error("invalid override day"); return day;
        });
        return { minPromptTokens: o["min_prompt_tokens"] ?? null, utcStart: o["utc_start"] ?? null, utcEnd: o["utc_end"] ?? null,
          utcDays: days, rates: priceRates({ ...pricing, ...o }) } as ModelPriceOverride;
      });
      const partial = Object.values(rates).some(v => v === null) || overrides.some(o => Object.values(o.rates).some(v => v === null)) || additionalCharges.length > 0;
      rows.push({ provider: "openrouter", model: m["id"], observedAt: now, source: "models-endpoint",
        state: partial ? "partial" : "known", reason: partial ? "unsupported-pricing" : null,
        rates, overrides, additionalCharges: [...new Set(additionalCharges)] });
    }
    for (const model of source.models) if (!seen.has(model)) rows.push({ provider: "openrouter", model, observedAt: null,
      source: "models-endpoint", state: "unknown", reason: "model-unpriced", rates: noRates, overrides: [], additionalCharges: [] });
    // Validate conditional clocks, rates and duplicates before exposing anything.
    if (!readProviderUsageSnapshot({ schemaVersion: 1, generatedAt: now, meters: [], prices: rows, history: [],
      coverage: { githubBilling: "not-configured", openRouter: "partial", openCode: "not-configured" } }).ok) throw new Error("invalid catalog");
    return rows;
  } catch { return unknown("shape-mismatch"); }
}
export async function collectProviderUsage(source: ProviderUsageSource, key: Uint8Array, now: string,
  options: { readonly fetcher?: Fetcher; readonly history?: () => Promise<readonly ProviderHistoryRow[]> } = {}): Promise<ProviderUsageSnapshot> {
  if (!instant(now)) throw new Error("invalid provider clock");
  const meters = source.githubCopilot === null ? [] : await githubBilling(source.githubCopilot, key, now, options.fetcher);
  const prices = source.openRouter === null ? [] : await openRouterPrices(source.openRouter, now, options.fetcher);
  const historyRead = source.openCode === null ? { rows: [], complete: true } :
    options.history ? { rows: [...await options.history()], complete: false } : await readOpenCodeHistory(source.openCode, key, now);
  const history = historyRead.rows;
  for (const row of history) meters.push({ provider: row.provider, model: row.model, accountRef: row.accountRef, unit: "usd", period: "history",
    from: row.from, through: row.through, observedAt: now, reportedThrough: null, source: "opencode-history",
    state: "partial", reason: "partial-history", ...emptyQuantities, grossUsd: row.costUsd });
  if (source.openCode !== null) for (const p of source.openCode.providers) {
    const accountRef = providerAccountRef(p.provider, p.accountIdentity, key);
    meters.push({ provider: p.provider, model: null, accountRef, unit: "unknown", period: "history",
      from: source.openCode.from, through: now, observedAt: null, reportedThrough: null, source: "unmetered",
      state: "unknown", reason: "account-source-unavailable", ...emptyQuantities });
  }
  const billing = meters.filter(r => r.source === "github-billing");
  const read = readProviderUsageSnapshot({ schemaVersion: 1, generatedAt: now, meters, prices, history,
    coverage: { githubBilling: source.githubCopilot === null ? "not-configured" : billing.every(r => r.state === "known") ? "known" : billing.every(r => r.state === "unknown") ? "unknown" : "partial",
      openRouter: source.openRouter === null ? "not-configured" : prices.length && prices.every(r => r.state === "known") ? "known" : prices.every(r => r.state === "unknown") ? "unknown" : "partial",
      openCode: source.openCode === null ? "not-configured" : historyRead.complete ? "complete" : "partial" } });
  if (!read.ok) throw new Error("invalid provider projection");
  return read.snapshot;
}
