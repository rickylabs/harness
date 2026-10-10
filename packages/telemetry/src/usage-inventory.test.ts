/** Synthetic stores, polls and kernel files only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAccountUsageDocument, type AccountUsageDocument, type UsageCapabilityRow } from "@rickylabs/harness-contracts";
import type { QuotaPollResult } from "./account-quota.js";
import { collectAccountUsageDocument, readAccountUsageDocumentSource, type InventoriedAccountUsageSource } from "./paid-account-usage.js";

const at = "2026-01-02T12:00:00.000Z", key = new Uint8Array(32).fill(9);
const codexLimits = { accountId: "fixture-account", rateLimits: { limitId: "codex", primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1767358800 },
  secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1767916800 } } };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "usage-inventory-fixture-"));
  const store = join(root, "store"), drmRoot = join(root, "drm"), driver = join(root, "amdgpu"), meminfoPath = join(root, "meminfo");
  await mkdir(store); await mkdir(driver); await mkdir(join(drmRoot, "card0", "device"), { recursive: true });
  await symlink(driver, join(drmRoot, "card0", "device", "driver"));
  await writeFile(join(drmRoot, "card0", "device", "mem_info_vram_used"), "512\n");
  await writeFile(join(drmRoot, "card0", "device", "mem_info_vram_total"), "2048\n");
  await writeFile(meminfoPath, "MemTotal: 4096 kB\nMemAvailable: 1024 kB\n");
  const source = (patch: Partial<InventoriedAccountUsageSource> = {}, stores: readonly ("codex" | "claude")[] = ["codex"]): InventoriedAccountUsageSource =>
    ({ schemaVersion: 3, capacity: { host: "fixture-node" }, providers: { githubCopilot: null, openRouter: null, openCode: null }, ...patch,
      accountUsage: { schemaVersion: 1, keyFile: join(root, "key"), stateFile: join(root, "state"), codex: { bin: join(root, "codex"), home: null },
        stores: stores.map(vendor => ({ vendor, seat: "seat-a", cwdLabel: "project-a", root: vendor === "codex" ? store : join(root, "missing"), accountIdentity: null })),
        ...patch.accountUsage } });
  return { root, source, capacitySource: { meminfoPath, drmRoot }, close: () => rm(root, { recursive: true, force: true }) };
}
const v3 = (d: AccountUsageDocument) => d.schemaVersion === 3 ? d : assert.fail("schema 3 expected");
const row = (rows: readonly UsageCapabilityRow[], cli: string, dimension: string, source: string | null) =>
  rows.find(r => r.cli === cli && r.dimension === dimension && r.source === source) ?? assert.fail(`${cli} ${dimension} ${source}`);
const polls = (results: QuotaPollResult[]) => { let calls = 0; return { poll: async () => results[calls++]!, calls: () => calls }; };

test("schema 3 lists every CLI with its bound source, its unbound source or its unsupported reason", async () => {
  const f = await fixture();
  try {
    const p = polls([{ ok: true, result: codexLimits }]);
    const doc = v3(await collectAccountUsageDocument(f.source({}, ["codex", "claude"]), key, { now: () => at, poll: p.poll, capacitySource: f.capacitySource }));
    assert.equal(readAccountUsageDocument(JSON.parse(JSON.stringify(doc))).ok, true);
    const rows = doc.capabilities;
    assert.deepEqual(row(rows, "codex", "subscription-quota", "codex-app-server"), { cli: "codex", dimension: "subscription-quota",
      capability: "supported", source: "codex-app-server", observedAt: at, reason: null });
    assert.equal(row(rows, "codex", "run-usage", "codex-session-store").capability, "supported");
    // A configured store whose root cannot be read yields nothing: unreadable, never an empty supported reading.
    assert.deepEqual(row(rows, "claude", "run-usage", "claude-session-store"), { cli: "claude", dimension: "run-usage",
      capability: "unreadable", source: "claude-session-store", observedAt: at, reason: "partial-scan" });
    assert.equal(row(rows, "claude", "subscription-quota", null).reason, "direct-read-unsupported");
    assert.equal(row(rows, "opencode", "run-usage", "opencode-history").reason, "not-configured");
    for (const dimension of ["subscription-quota", "run-usage", "metered-spend"]) assert.equal(row(rows, "agy", dimension, null).capability, "unsupported");
    assert.deepEqual(doc.account.quota.filter(q => q.source === "account-poll").map(q => q.window).sort(), ["5h", "weekly"]);
    assert.equal(doc.localCapacity.availability, "available");
    assert.equal(p.calls(), 1);
  } finally { await f.close(); }
});

test("a failed poll is unreadable even while an earlier reading is carried forward", async () => {
  const f = await fixture();
  try {
    const p = polls([{ ok: true, result: codexLimits }, { ok: false, reason: "timeout" }]);
    const options = { now: () => at, poll: p.poll, capacitySource: f.capacitySource };
    const first = v3(await collectAccountUsageDocument(f.source(), key, options));
    const second = v3(await collectAccountUsageDocument(f.source(), key, { ...options, previous: first.account }));
    assert.ok(second.account.quota.some(q => q.source === "account-poll" && q.availability === "available"), "the earlier reading stays dated");
    assert.deepEqual(row(second.capabilities, "codex", "subscription-quota", "codex-app-server"), { cli: "codex", dimension: "subscription-quota",
      capability: "unreadable", source: "codex-app-server", observedAt: at, reason: "timeout" });
    const empty = v3(await collectAccountUsageDocument(f.source(), key, { ...options, poll: async () => ({ ok: true, result: {} }) }));
    assert.equal(row(empty.capabilities, "codex", "subscription-quota", "codex-app-server").reason, "no-reading");
    const unbound = v3(await collectAccountUsageDocument(f.source({ accountUsage: { ...f.source().accountUsage, codex: null } }), key, options));
    assert.deepEqual(row(unbound.capabilities, "codex", "subscription-quota", "codex-app-server"), { cli: "codex", dimension: "subscription-quota",
      capability: "unreadable", source: "codex-app-server", observedAt: null, reason: "not-configured" });
    assert.equal(p.calls(), 2);
  } finally { await f.close(); }
});

test("host capacity is its own reading: unbound, unreadable or measured, never zero", async () => {
  const f = await fixture();
  try {
    const options = { now: () => at, poll: async (): Promise<QuotaPollResult> => ({ ok: false, reason: "request-failed" }) };
    const unbound = v3(await collectAccountUsageDocument(f.source({ capacity: null }), key, { ...options, capacitySource: f.capacitySource }));
    assert.equal(unbound.localCapacity.reason, "source_not_bound");
    const missing = v3(await collectAccountUsageDocument(f.source(), key, { ...options, capacitySource: { ...f.capacitySource, meminfoPath: join(f.root, "absent") } }));
    assert.deepEqual([missing.localCapacity.availability, missing.localCapacity.measurement, missing.localCapacity.reason], ["unavailable", null, "source_unavailable"]);
    const measured = v3(await collectAccountUsageDocument(f.source(), key, { ...options, capacitySource: f.capacitySource, wireFamily: "harness" }));
    assert.equal(measured.localCapacity.source, "harness-telemetry.host-capacity");
    assert.deepEqual(measured.localCapacity.measurement, { host: "fixture-node", ramUsedBytes: 3072 * 1024, ramTotalBytes: 4096 * 1024,
      vramUsedBytes: 512, vramTotalBytes: 2048, cards: [{ card: "card0", vramUsedBytes: 512, vramTotalBytes: 2048 }] });
  } finally { await f.close(); }
});

test("schema 3 adds no vendor call to schema 2 and its descriptor is closed", async () => {
  const f = await fixture();
  try {
    const two = polls([{ ok: true, result: codexLimits }]), three = polls([{ ok: true, result: codexLimits }]);
    const { capacity: _c, ...base } = f.source();
    const paid = await collectAccountUsageDocument({ ...base, schemaVersion: 2 }, key, { now: () => at, poll: two.poll });
    assert.equal(paid.schemaVersion, 2);
    await collectAccountUsageDocument(f.source(), key, { now: () => at, poll: three.poll, capacitySource: f.capacitySource });
    assert.deepEqual([two.calls(), three.calls()], [1, 1]);
    const raw = JSON.parse(JSON.stringify(f.source()));
    assert.equal(readAccountUsageDocumentSource(raw).schemaVersion, 3);
    assert.equal(readAccountUsageDocumentSource({ ...raw, capacity: null }).schemaVersion, 3);
    for (const bad of [{ ...raw, capacity: undefined }, { ...raw, capacity: { host: "fixture.node" } }, { ...raw, capacity: { host: "fixture-node", path: "x" } },
      { ...raw, schemaVersion: 2 }, { ...raw, extra: true }]) assert.throws(() => readAccountUsageDocumentSource(JSON.parse(JSON.stringify(bad))));
  } finally { await f.close(); }
});

test("configured OpenCode history: a complete read is supported, an unread one unreadable, a gapped one partial", async () => {
  const f = await fixture();
  const database = new DatabaseSync(join(f.root, "opencode.db"));
  try {
    database.exec("CREATE TABLE session(id TEXT PRIMARY KEY, version TEXT); CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);");
    const from = "2026-01-01T00:00:00.000Z";
    const openCode = (databaseFile: string) => ({ databaseFile, from, versions: ["fixture-version"],
      providers: [{ provider: "fixture-provider", accountIdentity: "fixture-account" }] });
    const collect = async (databaseFile: string) => v3(await collectAccountUsageDocument(f.source({ providers: { githubCopilot: null, openRouter: null,
      openCode: openCode(databaseFile) } }), key, { now: () => at, poll: async () => ({ ok: false, reason: "timeout" }), capacitySource: f.capacitySource }));
    const history = (doc: Awaited<ReturnType<typeof collect>>) =>
      (["run-usage", "metered-spend"] as const).map(dimension => row(doc.capabilities, "opencode", dimension, "opencode-history"));
    const expect = (capability: string, reason: string | null) => (["run-usage", "metered-spend"] as const).map(dimension =>
      ({ cli: "opencode", dimension, capability, source: "opencode-history", observedAt: at, reason }));

    const empty = await collect(join(f.root, "opencode.db"));
    assert.equal(empty.providers.coverage.openCode, "complete");
    assert.deepEqual(history(empty), expect("supported", null));

    const missing = await collect(join(f.root, "absent.db"));
    assert.deepEqual([missing.providers.coverage.openCode, missing.providers.history.length], ["partial", 0]);
    assert.deepEqual(history(missing), expect("unreadable", "partial-history"));

    database.prepare("INSERT INTO session VALUES(?, ?)").run("fixture-session", "unvetted-version");
    database.prepare("INSERT INTO message VALUES(?, ?, ?, ?)").run("fixture-message", "fixture-session", Date.parse(from) + 1,
      JSON.stringify({ role: "assistant", providerID: "fixture-provider", modelID: "fixture-model", cost: 0.1,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }));
    const partial = await collect(join(f.root, "opencode.db"));
    assert.deepEqual([partial.providers.coverage.openCode, partial.providers.history.length], ["partial", 1]);
    assert.deepEqual(history(partial), expect("supported", "partial-history"));
  } finally { database.close(); await f.close(); }
});

test("an unbound session store is not-configured with no read time, never an empty or partial scan", async () => {
  const f = await fixture();
  try {
    const doc = v3(await collectAccountUsageDocument(f.source({}, []), key,
      { now: () => at, poll: async () => ({ ok: true, result: codexLimits }), capacitySource: f.capacitySource }));
    const unbound = (cli: string, dimension: string, source: string) => ({ cli, dimension, capability: "unreadable", source, observedAt: null, reason: "not-configured" });
    assert.deepEqual(row(doc.capabilities, "claude", "run-usage", "claude-session-store"), unbound("claude", "run-usage", "claude-session-store"));
    assert.deepEqual(row(doc.capabilities, "codex", "run-usage", "codex-session-store"), unbound("codex", "run-usage", "codex-session-store"));
    assert.deepEqual(row(doc.capabilities, "codex", "subscription-quota", "codex-session-store"), unbound("codex", "subscription-quota", "codex-session-store"));
    assert.equal(row(doc.capabilities, "codex", "subscription-quota", "codex-app-server").capability, "supported");
  } finally { await f.close(); }
});
