import assert from "node:assert/strict";
import { test } from "node:test";
import { readAccountUsageDocument } from "./paid-account-usage.js";
import { unavailableAgentCost } from "./agent-observations.js";
import { readUsageCapabilities, USAGE_DIMENSIONS, USAGE_INVENTORY_CLIS, type UsageCapabilityRow } from "./usage-inventory.js";

const at = "2026-01-02T12:00:00.000Z", earlier = "2026-01-02T11:59:00.000Z";
const unsupported = (cli: UsageCapabilityRow["cli"], dimension: UsageCapabilityRow["dimension"]): UsageCapabilityRow =>
  ({ cli, dimension, capability: "unsupported", source: null, observedAt: null, reason: "no-native-source" });
/** Native-shaped: a codex poll that read, a claude store that is unbound, partial opencode history. */
const rows = (): UsageCapabilityRow[] => [
  { ...unsupported("claude", "subscription-quota"), reason: "direct-read-unsupported" },
  { cli: "claude", dimension: "run-usage", capability: "unreadable", source: "claude-session-store", observedAt: null, reason: "not-configured" },
  unsupported("claude", "metered-spend"),
  { cli: "codex", dimension: "subscription-quota", capability: "supported", source: "codex-app-server", observedAt: earlier, reason: null },
  { cli: "codex", dimension: "subscription-quota", capability: "supported", source: "codex-session-store", observedAt: earlier, reason: "partial-scan" },
  { cli: "codex", dimension: "run-usage", capability: "supported", source: "codex-session-store", observedAt: earlier, reason: "partial-scan" },
  unsupported("codex", "metered-spend"),
  unsupported("opencode", "subscription-quota"),
  { cli: "opencode", dimension: "run-usage", capability: "unreadable", source: "opencode-history", observedAt: earlier, reason: "partial-history" },
  { cli: "opencode", dimension: "metered-spend", capability: "unreadable", source: "opencode-history", observedAt: earlier, reason: "partial-history" },
  unsupported("agy", "subscription-quota"), unsupported("agy", "run-usage"), unsupported("agy", "metered-spend"),
];
const account = { schemaVersion: 1, generatedAt: at, quota: [], sessions: [], unattributed: [],
  coverage: ["codex", "claude"].map(vendor => ({ vendor, from: at, through: at, state: "unavailable", reason: "not-configured" })) };
const providers = { schemaVersion: 1, generatedAt: at, meters: [], prices: [], history: [],
  coverage: { githubBilling: "not-configured", openRouter: "not-configured", openCode: "not-configured" } };
const capacity = { ...unavailableAgentCost().localCapacity, source: "harness-telemetry.host-capacity", availability: "available", reason: null,
  measurement: { host: "fixture-node", ramUsedBytes: 100, ramTotalBytes: 200, vramUsedBytes: null, vramTotalBytes: null },
  observedAt: at, validUntil: "2026-01-02T12:00:30.000Z", revision: "c".repeat(64) };
const document = (patch: Record<string, unknown> = {}) =>
  ({ schemaVersion: 3, generatedAt: at, account, providers, capabilities: rows(), localCapacity: capacity, ...patch });
const refused = (value: unknown) => assert.equal(readAccountUsageDocument(value).ok, false);
const swap = (match: (r: UsageCapabilityRow) => boolean, patch: Partial<UsageCapabilityRow> | null) =>
  rows().flatMap(r => !match(r) ? [r] : patch === null ? [] : [{ ...r, ...patch }]);

test("schema 3 decodes every CLI and dimension, the host capacity and the unchanged schema 2 fields", () => {
  const read = readAccountUsageDocument(document());
  assert.equal(read.ok, true);
  if (!read.ok || read.document.schemaVersion !== 3) return assert.fail("schema 3 expected");
  assert.deepEqual(read.document.capabilities, rows());
  assert.notEqual(read.document.capabilities, document().capabilities);
  assert.deepEqual(new Set(read.document.capabilities.map(r => `${r.cli} ${r.dimension}`)).size, USAGE_INVENTORY_CLIS.length * USAGE_DIMENSIONS.length);
  assert.equal(read.document.localCapacity.availability, "available");
  assert.equal(readAccountUsageDocument(document({ localCapacity: unavailableAgentCost().localCapacity })).ok, true);
  const { capabilities: _c, localCapacity: _l, ...paid } = document();
  assert.equal(readAccountUsageDocument({ ...paid, schemaVersion: 2 }).ok, true);
  refused({ ...paid, schemaVersion: 3 });
  refused({ ...document(), schemaVersion: 2 });
});

test("an unread source cannot disappear: every CLI and dimension pair keeps a row", () => {
  refused(document({ capabilities: swap(r => r.cli === "agy" && r.dimension === "run-usage", null) }));
  refused(document({ capabilities: swap(r => r.cli === "claude" && r.dimension === "run-usage", null) }));
  refused(document({ capabilities: [] }));
  assert.equal(readUsageCapabilities(rows(), at)?.length, rows().length);
});

test("no source speaks for another vendor or another dimension", () => {
  refused(document({ capabilities: swap(r => r.source === "claude-session-store", { source: "codex-session-store" }) }));
  refused(document({ capabilities: swap(r => r.source === "codex-app-server", { source: "opencode-history" }) }));
  refused(document({ capabilities: swap(r => r.cli === "opencode" && r.dimension === "subscription-quota",
    { capability: "supported", source: "opencode-history", observedAt: earlier, reason: null }) }));
});

test("unsupported carries no source; a source is never unsupported and a pair is never both", () => {
  refused(document({ capabilities: swap(r => r.cli === "agy" && r.dimension === "run-usage", { source: "codex-session-store" }) }));
  refused(document({ capabilities: swap(r => r.source === "codex-app-server", { capability: "unsupported", observedAt: null, reason: "no-native-source" }) }));
  refused(document({ capabilities: swap(r => r.source === "codex-app-server", { source: null }) }));
  refused(document({ capabilities: [...rows(), { cli: "claude", dimension: "subscription-quota", capability: "unreadable",
    source: "claude-session-store", observedAt: null, reason: "not-configured" }] }));
});

test("a reading time and a reason agree with the capability, and nothing is from the future", () => {
  refused(document({ capabilities: swap(r => r.source === "codex-app-server", { observedAt: null }) }));
  refused(document({ capabilities: swap(r => r.source === "codex-app-server", { reason: "timeout" }) }));
  refused(document({ capabilities: swap(r => r.source === "codex-app-server", { observedAt: "2026-01-02T12:00:00.001Z" }) }));
  refused(document({ capabilities: swap(r => r.source === "claude-session-store", { observedAt: earlier }) }));
  refused(document({ capabilities: swap(r => r.source === "claude-session-store", { capability: "unreadable", reason: null }) }));
  refused(document({ capabilities: swap(r => r.cli === "agy" && r.dimension === "run-usage", { reason: "not-configured" }) }));
  refused(document({ capabilities: swap(r => r.cli === "opencode" && r.dimension === "run-usage", { reason: "direct-read-unsupported" }) }));
  assert.equal(readAccountUsageDocument(document({ capabilities: swap(r => r.source === "codex-app-server",
    { capability: "unreadable", reason: "timeout" }) })).ok, true);
});

test("closed shape: extra fields, duplicates, unknown vocabulary and invalid capacity are refused", () => {
  refused(document({ capabilities: rows().map((r, i) => i === 0 ? { ...r, accountId: "PRIVATE_CANARY" } : r) }));
  refused(document({ capabilities: [...rows(), rows()[3]] }));
  refused(document({ capabilities: swap(r => r.cli === "agy" && r.dimension === "run-usage", { cli: "gemini" as "agy" }) }));
  refused(document({ capabilities: swap(r => r.source === "codex-app-server", { capability: "available" as "supported" }) }));
  refused(document({ privateNote: "PRIVATE_CANARY" }));
  refused(document({ localCapacity: { ...capacity, measurement: null } }));
  refused(document({ localCapacity: { ...capacity, validUntil: "2026-01-02T11:59:59.000Z" } }));
  refused(document({ localCapacity: { ...capacity, measurement: { ...capacity.measurement, host: "fixture.invalid" } } }));
});
