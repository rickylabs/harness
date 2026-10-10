/** Provider adapters extend the existing descriptor/collector; they do not own another watch loop. */
import { readAccountUsageDocument, type AccountUsageDocument } from "@rickylabs/harness-contracts";
import { collectAccountUsage, collectAccountUsageReads, readAccountUsageSource, type AccountUsageSource, type UsageCollectOptions } from "./account-usage.js";
import { hostAlias, readLocalHostCapacity, type HostCapacitySource } from "./host-capacity.js";
import { producerAgentCost, type TelemetryWireFamily } from "./producer-names.js";
import { collectProviderUsage, readProviderUsageSource, type ProviderUsageSource } from "./provider-usage.js";
import { usageCapabilities } from "./usage-inventory.js";

export interface PaidAccountUsageSource {
  readonly schemaVersion: 2; readonly accountUsage: AccountUsageSource; readonly providers: ProviderUsageSource;
}
/** Schema 2 plus an optional host alias for the collector's own capacity reading. */
export interface InventoriedAccountUsageSource {
  readonly schemaVersion: 3; readonly accountUsage: AccountUsageSource; readonly providers: ProviderUsageSource;
  readonly capacity: { readonly host: string } | null;
}
export type AccountUsageDocumentSource = AccountUsageSource | PaidAccountUsageSource | InventoriedAccountUsageSource;
export function readAccountUsageDocumentSource(value: unknown): AccountUsageDocumentSource {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid usage descriptor");
  const r = value as Record<string, unknown>;
  if (r["schemaVersion"] === 1) return readAccountUsageSource(value);
  const keys = Object.keys(r).sort().join(" ");
  if (r["schemaVersion"] === 2 && keys === "accountUsage providers schemaVersion") {
    return { schemaVersion: 2, accountUsage: readAccountUsageSource(r["accountUsage"]), providers: readProviderUsageSource(r["providers"]) };
  }
  if (r["schemaVersion"] !== 3 || keys !== "accountUsage capacity providers schemaVersion") throw new Error("invalid usage descriptor");
  const c = r["capacity"] as Record<string, unknown> | null;
  if (c !== null && (typeof c !== "object" || Array.isArray(c) || Object.keys(c).join(" ") !== "host" ||
      !hostAlias(c["host"]))) throw new Error("invalid usage descriptor");
  return { schemaVersion: 3, accountUsage: readAccountUsageSource(r["accountUsage"]), providers: readProviderUsageSource(r["providers"]),
    capacity: c === null ? null : { host: c["host"] as string } };
}
export interface UsageDocumentCollectOptions extends UsageCollectOptions {
  /** Synthetic kernel paths for tests only; production reads the fixed kernel paths. */
  readonly capacitySource?: HostCapacitySource;
  readonly wireFamily?: TelemetryWireFamily;
}
export async function collectAccountUsageDocument(source: AccountUsageDocumentSource, key: Uint8Array, options: UsageDocumentCollectOptions = {}): Promise<AccountUsageDocument> {
  if (source.schemaVersion === 1) return collectAccountUsage(source, key, options);
  const now = options.now ?? (() => new Date().toISOString());
  const { envelope: account, codexPoll } = await collectAccountUsageReads(source.accountUsage, key, options);
  const providers = await collectProviderUsage(source.providers, key, now());
  let document: unknown = { schemaVersion: 2, generatedAt: providers.generatedAt, account, providers };
  if (source.schemaVersion === 3) {
    // Capacity is read last, so its short validity covers the document's own generation time.
    const localCapacity = source.capacity === null ? producerAgentCost("source_not_bound", options.wireFamily).localCapacity
      : (await readLocalHostCapacity(now(), source.capacity.host, options.capacitySource, options.wireFamily)).cost;
    document = { schemaVersion: 3, generatedAt: now(), account, providers, localCapacity,
      capabilities: usageCapabilities(source.accountUsage, source.providers, { account, providers, codexPoll }) };
  }
  const read = readAccountUsageDocument(document);
  if (!read.ok) throw new Error("invalid usage projection");
  return read.document;
}
