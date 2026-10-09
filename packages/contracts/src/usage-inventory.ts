/** Usage-source capability per supported CLI. A capability is a fact about a source, never a reading. */
import { readLocalCapacityRow, type AgentCost } from "./agent-observations.js";

/** Every launcher Harness discovers; a parity test keeps this equal to routing's launcher list. */
export const USAGE_INVENTORY_CLIS = ["claude", "codex", "opencode", "agy"] as const;
export const USAGE_DIMENSIONS = ["subscription-quota", "run-usage", "metered-spend"] as const;
export const USAGE_CAPABILITIES = ["supported", "unsupported", "unreadable"] as const;
export const USAGE_CAPABILITY_SOURCES = ["codex-app-server", "codex-session-store", "claude-session-store", "opencode-history"] as const;
/** `unsupported` reasons: no official programmatic source exists for this CLI and dimension. */
export const USAGE_UNSUPPORTED_REASONS = ["no-native-source", "direct-read-unsupported"] as const;
/** `unreadable` reasons: the source exists but is unbound (`not-configured`) or its last read failed. */
export const USAGE_UNREADABLE_REASONS = ["not-configured", "no-reading", "partial-scan", "partial-history",
  "request-failed", "timeout", "oversize", "shape-mismatch"] as const;
/** A `supported` source read in part keeps its reading and names the gap. */
export const USAGE_PARTIAL_REASONS = ["partial-scan", "partial-history"] as const;
export type UsageInventoryCli = (typeof USAGE_INVENTORY_CLIS)[number];
export type UsageDimension = (typeof USAGE_DIMENSIONS)[number];
export type UsageCapability = (typeof USAGE_CAPABILITIES)[number];
export type UsageCapabilitySource = (typeof USAGE_CAPABILITY_SOURCES)[number];
export type UsageCapabilityReason = (typeof USAGE_UNSUPPORTED_REASONS)[number] | (typeof USAGE_UNREADABLE_REASONS)[number];

/** Which CLI and dimensions each source can speak for. A source never carries another vendor's meter. */
export const USAGE_SOURCE_SCOPE: Readonly<Record<UsageCapabilitySource, { readonly cli: UsageInventoryCli; readonly dimensions: readonly UsageDimension[] }>> = {
  "codex-app-server": { cli: "codex", dimensions: ["subscription-quota"] },
  "codex-session-store": { cli: "codex", dimensions: ["subscription-quota", "run-usage"] },
  "claude-session-store": { cli: "claude", dimensions: ["run-usage"] },
  "opencode-history": { cli: "opencode", dimensions: ["run-usage", "metered-spend"] },
};

export interface UsageCapabilityRow {
  readonly cli: UsageInventoryCli;
  readonly dimension: UsageDimension;
  readonly capability: UsageCapability;
  /** Null exactly when the capability is `unsupported`. */
  readonly source: UsageCapabilitySource | null;
  /** When the source was last read or attempted; null when unsupported or not configured. */
  readonly observedAt: string | null;
  readonly reason: UsageCapabilityReason | null;
}

const instant = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const among = (v: unknown, choices: readonly string[]): boolean => typeof v === "string" && choices.includes(v);
function fail(): never { throw new Error("invalid usage inventory"); }
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
  if (!length || typeof length.value !== "number" || length.value > cap || Reflect.ownKeys(value).length !== length.value + 1) fail();
  return Array.from({ length: length.value }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !("value" in d) || !d.enumerable) fail();
    return d.value as unknown;
  });
}
function row(value: unknown, generatedAt: string): UsageCapabilityRow {
  const r = record(value, "cli dimension capability source observedAt reason");
  if (!among(r["cli"], USAGE_INVENTORY_CLIS) || !among(r["dimension"], USAGE_DIMENSIONS) || !among(r["capability"], USAGE_CAPABILITIES) ||
      !(r["observedAt"] === null || (instant(r["observedAt"]) && r["observedAt"] <= generatedAt))) fail();
  if (r["capability"] === "unsupported") {
    if (r["source"] !== null || r["observedAt"] !== null || !among(r["reason"], USAGE_UNSUPPORTED_REASONS)) fail();
  } else {
    const scope = among(r["source"], USAGE_CAPABILITY_SOURCES) ? USAGE_SOURCE_SCOPE[r["source"] as UsageCapabilitySource] : fail();
    if (scope.cli !== r["cli"] || !scope.dimensions.includes(r["dimension"] as UsageDimension)) fail();
    if (r["capability"] === "supported") {
      if (r["observedAt"] === null || !(r["reason"] === null || among(r["reason"], USAGE_PARTIAL_REASONS))) fail();
    } else if (!among(r["reason"], USAGE_UNREADABLE_REASONS) || (r["reason"] === "not-configured") !== (r["observedAt"] === null)) fail();
  }
  return r as unknown as UsageCapabilityRow;
}

/**
 * Closed copying decoder. Every CLI and dimension pair is present, so an unread source cannot vanish;
 * an `unsupported` pair is the pair's only row, and each source appears once per pair.
 */
export function readUsageCapabilities(value: unknown, generatedAt: string): readonly UsageCapabilityRow[] | null {
  try {
    if (!instant(generatedAt)) fail();
    const rows = list(value, 64).map(v => row(v, generatedAt));
    const pair = (r: UsageCapabilityRow) => `${r.cli} ${r.dimension}`;
    if (new Set(rows.map(r => `${pair(r)} ${r.source}`)).size !== rows.length) fail();
    for (const cli of USAGE_INVENTORY_CLIS) for (const dimension of USAGE_DIMENSIONS) {
      const members = rows.filter(r => r.cli === cli && r.dimension === dimension);
      if (members.length === 0 || (members.length > 1 && members.some(r => r.capability === "unsupported"))) fail();
    }
    return rows;
  } catch { return null; }
}

/** Fields schema 3 adds to the schema 2 usage document; both decode or the document is refused. */
export interface UsageInventoryFields {
  readonly capabilities: readonly UsageCapabilityRow[];
  /** The collector host's own capacity reading; independent of quota and spend. */
  readonly localCapacity: AgentCost["localCapacity"];
}
export function readUsageInventoryFields(capabilities: unknown, localCapacity: unknown, generatedAt: string): UsageInventoryFields | null {
  const rows = readUsageCapabilities(capabilities, generatedAt);
  const capacity = rows === null ? null : readLocalCapacityRow(localCapacity, generatedAt);
  return rows === null || capacity === null ? null : { capabilities: rows, localCapacity: capacity };
}
