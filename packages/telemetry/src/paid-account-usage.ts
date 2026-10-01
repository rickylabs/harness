/** Provider adapters extend the existing descriptor/collector; they do not own another watch loop. */
import { readAccountUsageDocument, type AccountUsageDocument } from "@rickylabs/harness-contracts";
import { collectAccountUsage, readAccountUsageSource, type AccountUsageSource, type UsageCollectOptions } from "./account-usage.js";
import { collectProviderUsage, readProviderUsageSource, type ProviderUsageSource } from "./provider-usage.js";

export interface PaidAccountUsageSource {
  readonly schemaVersion: 2; readonly accountUsage: AccountUsageSource; readonly providers: ProviderUsageSource;
}
export type AccountUsageDocumentSource = AccountUsageSource | PaidAccountUsageSource;
export function readAccountUsageDocumentSource(value: unknown): AccountUsageDocumentSource {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid usage descriptor");
  const r = value as Record<string, unknown>;
  if (r["schemaVersion"] === 1) return readAccountUsageSource(value);
  if (r["schemaVersion"] !== 2 || Object.keys(r).sort().join(" ") !== "accountUsage providers schemaVersion") throw new Error("invalid usage descriptor");
  return { schemaVersion: 2, accountUsage: readAccountUsageSource(r["accountUsage"]), providers: readProviderUsageSource(r["providers"]) };
}
export async function collectAccountUsageDocument(source: AccountUsageDocumentSource, key: Uint8Array, options: UsageCollectOptions = {}): Promise<AccountUsageDocument> {
  if (source.schemaVersion === 1) return collectAccountUsage(source, key, options);
  const account = await collectAccountUsage(source.accountUsage, key, options);
  const providers = await collectProviderUsage(source.providers, key, (options.now ?? (() => new Date().toISOString()))());
  const document = { schemaVersion: 2, generatedAt: providers.generatedAt, account, providers };
  const read = readAccountUsageDocument(document);
  if (!read.ok) throw new Error("invalid usage projection");
  return read.document;
}
