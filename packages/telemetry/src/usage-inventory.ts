/** Per-CLI usage-source capability, derived from one collection's own reads. No extra source is touched. */
import { USAGE_DIMENSIONS, USAGE_INVENTORY_CLIS, type AccountUsageEnvelope, type ProviderUsageSnapshot,
  type UsageCapabilityRow, type UsageCapabilitySource, type UsageDimension, type UsageInventoryCli } from "@rickylabs/harness-contracts";
import type { AccountUsageSource, CodexPollRead } from "./account-usage.js";
import type { ProviderUsageSource } from "./provider-usage.js";

export interface CollectionReads {
  readonly account: AccountUsageEnvelope;
  readonly providers: ProviderUsageSnapshot;
  readonly codexPoll: CodexPollRead | null;
}
type Unsupported = { readonly unsupported: "no-native-source" | "direct-read-unsupported" };
/**
 * The sources this collector owns, per CLI and dimension. `direct-read-unsupported`: Claude exposes no
 * sessionless quota read (packages/telemetry/docs/native-reads.md); Orchid's governor reading is a separate
 * producer. OpenCode Go and AGY publish no usage API, and the measured AGY store carries no token usage.
 */
const SOURCES: Readonly<Record<UsageInventoryCli, Readonly<Record<UsageDimension, readonly UsageCapabilitySource[] | Unsupported>>>> = {
  claude: { "subscription-quota": { unsupported: "direct-read-unsupported" }, "run-usage": ["claude-session-store"],
    "metered-spend": { unsupported: "no-native-source" } },
  codex: { "subscription-quota": ["codex-app-server", "codex-session-store"], "run-usage": ["codex-session-store"],
    "metered-spend": { unsupported: "no-native-source" } },
  opencode: { "subscription-quota": { unsupported: "no-native-source" }, "run-usage": ["opencode-history"],
    "metered-spend": ["opencode-history"] },
  agy: { "subscription-quota": { unsupported: "no-native-source" }, "run-usage": { unsupported: "no-native-source" },
    "metered-spend": { unsupported: "no-native-source" } },
};

type Capability = Omit<UsageCapabilityRow, "cli" | "dimension">;
const unbound = (source: UsageCapabilitySource): Capability =>
  ({ capability: "unreadable", source, observedAt: null, reason: "not-configured" });
/** A partial read that produced rows is supported with its gap named; one that produced nothing is unreadable. */
function partial(source: UsageCapabilitySource, at: string, read: boolean, reason: "partial-scan" | "partial-history"): Capability {
  return { capability: read ? "supported" : "unreadable", source, observedAt: at, reason };
}
function sourceCapability(source: UsageCapabilitySource, descriptor: AccountUsageSource, providers: ProviderUsageSource,
  reads: CollectionReads): Capability {
  if (source === "codex-app-server") {
    if (reads.codexPoll === null) return unbound(source);
    const { attemptedAt, reason } = reads.codexPoll;
    return reason === null ? { capability: "supported", source, observedAt: attemptedAt, reason: null }
      : { capability: "unreadable", source, observedAt: attemptedAt, reason };
  }
  if (source === "opencode-history") {
    if (providers.openCode === null) return unbound(source);
    const at = reads.providers.generatedAt;
    return reads.providers.coverage.openCode === "complete" ? { capability: "supported", source, observedAt: at, reason: null }
      : partial(source, at, reads.providers.history.length > 0, "partial-history");
  }
  const vendor = source === "codex-session-store" ? "codex" : "claude";
  const coverage = reads.account.coverage.find(c => c.vendor === vendor);
  if (!descriptor.stores.some(s => s.vendor === vendor) || coverage === undefined) return unbound(source);
  return coverage.state === "complete" ? { capability: "supported", source, observedAt: coverage.through, reason: null }
    : partial(source, coverage.through, reads.account.sessions.some(s => s.vendor === vendor), "partial-scan");
}

/** One row per CLI, dimension and source, in a fixed order; an unsupported pair has exactly one row. */
export function usageCapabilities(descriptor: AccountUsageSource, providers: ProviderUsageSource, reads: CollectionReads): UsageCapabilityRow[] {
  return USAGE_INVENTORY_CLIS.flatMap(cli => USAGE_DIMENSIONS.flatMap((dimension): UsageCapabilityRow[] => {
    const sources = SOURCES[cli][dimension];
    if ("unsupported" in sources) {
      return [{ cli, dimension, capability: "unsupported", source: null, observedAt: null, reason: sources.unsupported }];
    }
    return sources.map(source => ({ cli, dimension, ...sourceCapability(source, descriptor, providers, reads) }));
  }));
}
