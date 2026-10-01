import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, renameSync, utimesSync, statSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOpenCodeHistory } from "./provider-history.js";
import { collectProviderUsage, type ProviderUsageSource } from "./provider-usage.js";
const from = "2026-01-01T00:00:00.000Z", at = "2026-01-02T12:00:00.000Z", key = Buffer.alloc(32, 7);
const message = (change: Record<string, unknown> = {}) => ({ role: "assistant", providerID: "fixture-provider", modelID: "fixture-model", cost: 0.1,
  tokens: { input: 20, output: 5, reasoning: 2, cache: { read: 40, write: 20 } }, privateText: "PRIVATE_CANARY", ...change });
test("read-only SQLite sums exact model costs/cache once, retains unknown quota and never leaks native/text fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-history-fixture-")); let database: DatabaseSync | undefined;
  try {
    const file = join(root, "usage.db"); database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode=WAL; CREATE TABLE session(id TEXT PRIMARY KEY, version TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT);");
    database.prepare("INSERT INTO session VALUES(?,?)").run("private-session", "fixture-version");
    const insert = database.prepare("INSERT INTO message VALUES(?,?,?,?)");
    insert.run("private-message-a", "private-session", Date.parse(from) + 1, JSON.stringify(message()));
    insert.run("private-message-b", "private-session", Date.parse(from) + 2, JSON.stringify(message({ cost: 0.2 })));
    insert.run("private-message-user", "private-session", Date.parse(from) + 3, JSON.stringify({ role: "user", privateText: "PRIVATE_CANARY" }));
    const source: NonNullable<ProviderUsageSource["openCode"]> = { databaseFile: file, from, versions: ["fixture-version"],
      providers: [{ provider: "fixture-provider", accountIdentity: "private-account" }] };
    const before = database.prepare("SELECT count(*) AS n FROM message").get();
    const reading = await readOpenCodeHistory(source, key, at);
    assert.equal(reading.complete, true); assert.equal(reading.rows.length, 1);
    const row = reading.rows[0]!; assert.equal(row.costUsd, "0.3"); assert.equal(row.messages, 2);
    assert.deepEqual(row.tokens, { input: 40, output: 10, reasoning: 4, cacheRead: 80, cacheWrite: 40 }); assert.equal(row.cacheHitRate, 0.5);
    assert.deepEqual(database.prepare("SELECT count(*) AS n FROM message").get(), before);
    insert.run("private-message-alias", "private-session", Date.parse(from) + 4, JSON.stringify(message({ modelID: "~fixture/model" })));
    const aliased = await readOpenCodeHistory(source, key, at);
    assert.equal(aliased.complete, true);
    assert.equal(aliased.rows.find(r => r.model === "~fixture/model")?.costUsd, "0.1");
    assert.equal(aliased.rows.find(r => r.model === "fixture-model")?.costUsd, "0.3");
    for (const modelID of ["~", "~~fixture/model", "fixture/~model", "~fixture/model\n", "~f/" + "x".repeat(254)]) {
      database.prepare("UPDATE message SET data=? WHERE id=?").run(JSON.stringify(message({ modelID })), "private-message-alias");
      assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false });
    }
    database.prepare("UPDATE message SET data=? WHERE id=?").run(JSON.stringify(message({ modelID: "~fixture/model" })), "private-message-alias");
    const projection = await collectProviderUsage({ githubCopilot: null, openRouter: null, openCode: source }, key, at);
    assert.equal(projection.coverage.openCode, "complete");
    assert.equal(projection.meters.find(m => m.unit === "usd")?.grossUsd, "0.3");
    assert.equal(projection.meters.find(m => m.unit === "unknown")?.state, "unknown");
    assert.ok(projection.meters.every(m => m.state !== "known"));
    const text = JSON.stringify(projection); for (const privateValue of [root, "PRIVATE_CANARY", "private-session", "private-message", "private-account"]) assert.ok(!text.includes(privateValue));
    const wrong = await readOpenCodeHistory({ ...source, versions: ["other-version"] }, key, at);
    assert.equal(wrong.complete, false); assert.equal(wrong.rows[0]?.costUsd, "0.3"); assert.equal(wrong.rows[0]?.cacheHitRate, null);
    database.prepare("UPDATE message SET data=? WHERE id=?").run(JSON.stringify(message({ cost: 0.2, tokens: { input: 20 } })), "private-message-b");
    const partial = await readOpenCodeHistory(source, key, at); assert.equal(partial.complete, false); assert.equal(partial.rows[0]?.costUsd, "0.3");
    assert.deepEqual(partial.rows[0]?.tokens, { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null });
    const link = join(root, "link.db"); await symlink(file, link);
    assert.deepEqual(await readOpenCodeHistory({ ...source, databaseFile: link }, key, at), { rows: [], complete: false });
    assert.deepEqual(await readOpenCodeHistory({ ...source, databaseFile: join(root, "missing") }, key, at), { rows: [], complete: false });
    assert.deepEqual(await readOpenCodeHistory({ ...source, from: at }, key, at), { rows: [], complete: false });
    database.prepare("UPDATE message SET data=? WHERE id=?").run("PRIVATE_CANARY", "private-message-b");
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false });
  } finally { database?.close(); await rm(root, { recursive: true, force: true }); }
});
test("history cannot call an empty/unsupported store complete and overflows do not manufacture spend", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-history-bounds-")); let database: DatabaseSync | undefined;
  try {
    const file = join(root, "usage.db"); database = new DatabaseSync(file);
    database.exec("CREATE TABLE session(id TEXT PRIMARY KEY,version TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT);");
    database.prepare("INSERT INTO session VALUES(?,?)").run("private-session", "fixture-version");
    const source = { databaseFile: file, from, versions: ["fixture-version"], providers: [{ provider: "fixture-provider", accountIdentity: "private-account" }] };
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: true });
    const insert = database.prepare("INSERT INTO message VALUES(?,?,?,?)");
    insert.run("private-message", "missing-session", Date.parse(from) + 1, JSON.stringify(message()));
    assert.equal((await readOpenCodeHistory(source, key, at)).complete, false, "orphan rows must not disappear behind a join");
    database.exec("DELETE FROM message");
    insert.run("private-message", "private-session", Date.parse(from) + 1, JSON.stringify(message()));
    insert.run("private-message", "private-session", Date.parse(from) + 2, JSON.stringify(message()));
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false });
    database.exec("DELETE FROM message");
    insert.run("private-message", "private-session", Date.parse(from) + 1, JSON.stringify(message({ privateText: "x".repeat(1024 * 1024) })));
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false });
    database.exec("DELETE FROM message");
    insert.run("private-message", "private-session", Date.parse(from) + 1, JSON.stringify(message({ tokens: { input: Number.MAX_SAFE_INTEGER, output: 0, reasoning: 0, cache: { read: 1, write: 0 } } })));
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false });
  } finally { database?.close(); await rm(root, { recursive: true, force: true }); }
});
test("history inode, metadata and ownership changes withhold the entire scan", async t => {
  const root = await mkdtemp(join(tmpdir(), "provider-history-identity-")); let database: DatabaseSync | undefined;
  try {
    const file = join(root, "usage.db"); database = new DatabaseSync(file);
    database.exec("CREATE TABLE session(id TEXT PRIMARY KEY,version TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT);");
    database.prepare("INSERT INTO session VALUES(?,?)").run("private-session", "fixture-version");
    database.prepare("INSERT INTO message VALUES(?,?,?,?)").run("private-message", "private-session", Date.parse(from) + 1, JSON.stringify(message()));
    database.close(); database = undefined;
    const source = { databaseFile: file, from, versions: ["fixture-version"], providers: [{ provider: "fixture-provider", accountIdentity: "private-account" }] };
    assert.equal((await readOpenCodeHistory(source, key, at)).complete, true);
    const uidProcess = process as { getuid: () => number };
    const uid = uidProcess.getuid();
    t.mock.method(uidProcess, "getuid", () => uid + 1);
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false }); t.mock.restoreAll();
    let swapped = false;
    t.mock.method(uidProcess, "getuid", () => {
      if (!swapped) { swapped = true; renameSync(file, file + ".old"); copyFileSync(file + ".old", file); }
      return uid;
    });
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false }); assert.equal(swapped, true); t.mock.restoreAll();
    let touched = false;
    t.mock.method(uidProcess, "getuid", () => {
      if (!touched) { touched = true; const info = statSync(file); utimesSync(file, info.atime, new Date(info.mtimeMs + 1000)); }
      return uid;
    });
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false }); assert.equal(touched, true);
  } finally { t.mock.restoreAll(); database?.close(); await rm(root, { recursive: true, force: true }); }
});
test("bounded SQLite scan withholds over-limit rows and model cardinality", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-history-cardinality-")); let database: DatabaseSync | undefined;
  try {
    const file = join(root, "usage.db"); database = new DatabaseSync(file);
    database.exec("CREATE TABLE session(id TEXT PRIMARY KEY,version TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT);");
    database.prepare("INSERT INTO session VALUES(?,?)").run("private-session", "fixture-version");
    const insert = database.prepare("INSERT INTO message VALUES(?,?,?,?)"), source = { databaseFile: file, from, versions: ["fixture-version"], providers: [{ provider: "fixture-provider", accountIdentity: "private-account" }] };
    database.exec("BEGIN");
    for (let i = 0; i < 50_001; i++) insert.run(`private-${i}`, "private-session", Date.parse(from) + 1, JSON.stringify(message()));
    database.exec("COMMIT");
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false });
    database.exec("DELETE FROM message; BEGIN");
    for (let i = 0; i < 1025; i++) insert.run(`private-${i}`, "private-session", Date.parse(from) + 1, JSON.stringify(message({ modelID: `fixture-${i}` })));
    database.exec("COMMIT");
    assert.deepEqual(await readOpenCodeHistory(source, key, at), { rows: [], complete: false });
  } finally { database?.close(); await rm(root, { recursive: true, force: true }); }
});
