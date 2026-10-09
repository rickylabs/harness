import { readAccountUsageEnvelope, type AccountUsageEnvelope } from "./account-usage.js";
import { readProviderUsageSnapshot, type ProviderUsageSnapshot } from "./provider-usage.js";
import { readUsageInventoryFields, type UsageInventoryFields } from "./usage-inventory.js";

/** Opt-in document. The native account measurement and its v1 wire shape stay unchanged. */
export interface PaidAccountUsageEnvelope {
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly account: AccountUsageEnvelope;
  readonly providers: ProviderUsageSnapshot;
}
/** Opt-in schema 3: schema 2 plus per-CLI source capabilities and the collector host capacity. */
export interface InventoriedAccountUsageEnvelope extends UsageInventoryFields {
  readonly schemaVersion: 3;
  readonly generatedAt: string;
  readonly account: AccountUsageEnvelope;
  readonly providers: ProviderUsageSnapshot;
}
export type AccountUsageDocument = AccountUsageEnvelope | PaidAccountUsageEnvelope | InventoriedAccountUsageEnvelope;
export function readAccountUsageDocument(value: unknown):
  { readonly ok: true; readonly document: AccountUsageDocument } | { readonly ok: false; readonly reason: "invalid" } {
  try {
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid");
    const schema = Object.getOwnPropertyDescriptor(value, "schemaVersion");
    if (!schema || !("value" in schema) || !schema.enumerable) throw new Error("invalid");
    if (schema.value === 1) {
      const read = readAccountUsageEnvelope(value);
      return read.ok ? { ok: true, document: read.envelope } : read;
    }
    const fields = ["schemaVersion", "generatedAt", "account", "providers", ...(schema.value === 3 ? ["capabilities", "localCapacity"] : [])];
    if ((schema.value !== 2 && schema.value !== 3) || Reflect.ownKeys(value).length !== fields.length) throw new Error("invalid");
    const r: Record<string, unknown> = {};
    for (const key of fields) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !("value" in d) || !d.enumerable) throw new Error("invalid");
      r[key] = d.value;
    }
    const at = r["generatedAt"];
    if (typeof at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) ||
        !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) throw new Error("invalid");
    const account = readAccountUsageEnvelope(r["account"]), providers = readProviderUsageSnapshot(r["providers"]);
    if (!account.ok || !providers.ok || account.envelope.generatedAt > at || providers.snapshot.generatedAt > at) throw new Error("invalid");
    const paid = { generatedAt: at, account: account.envelope, providers: providers.snapshot };
    if (schema.value === 2) return { ok: true, document: { schemaVersion: 2, ...paid } };
    const inventory = readUsageInventoryFields(r["capabilities"], r["localCapacity"], at);
    if (inventory === null) throw new Error("invalid");
    return { ok: true, document: { schemaVersion: 3, ...paid, ...inventory } };
  } catch { return { ok: false, reason: "invalid" }; }
}

/** Per-model budget decisions are separate from provider seat-capacity pools. Reader first. */
export interface ProviderBudgetDecision {
  readonly provider: string;
  /** Exact provider-native ID. Keep nested vendor/model suffixes; do not prepend provider. */
  readonly model: string;
  readonly observedAt: string; readonly validUntil: string;
  readonly available: boolean;
  readonly reason: "budget-reached" | "budget-unavailable" | null;
}
export function readProviderBudgetDecisions(value: unknown): readonly ProviderBudgetDecision[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 1024 ||
        Reflect.ownKeys(value).length !== value.length + 1) throw new Error("invalid");
    const seen = new Set<string>();
    return Array.from({ length: value.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !("value" in d) || !d.enumerable) throw new Error("invalid");
      const row: unknown = d.value;
      if (!row || typeof row !== "object" || Object.getPrototypeOf(row) !== Object.prototype || Reflect.ownKeys(row).length !== 6) throw new Error("invalid");
      const r: Record<string, unknown> = {};
      for (const key of ["provider", "model", "observedAt", "validUntil", "available", "reason"]) {
        const field = Object.getOwnPropertyDescriptor(row, key);
        if (!field || !("value" in field) || !field.enumerable) throw new Error("invalid");
        r[key] = field.value;
      }
      if (typeof r["provider"] !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(r["provider"]) ||
          typeof r["model"] !== "string" || r["model"].length > 256 || !/^~?[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(r["model"])) throw new Error("invalid");
      if (r["model"].startsWith(`${r["provider"]}/`)) throw new Error("invalid");
      const time = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
        Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
      if (!time(r["observedAt"]) || !time(r["validUntil"]) || r["observedAt"] >= r["validUntil"] || typeof r["available"] !== "boolean" ||
          (r["available"] ? r["reason"] !== null : !["budget-reached", "budget-unavailable"].includes(r["reason"] as string))) throw new Error("invalid");
      const id = JSON.stringify([r["provider"], r["model"]]);
      if (seen.has(id)) throw new Error("invalid"); seen.add(id);
      return r as unknown as ProviderBudgetDecision;
    });
  } catch { return null; }
}
