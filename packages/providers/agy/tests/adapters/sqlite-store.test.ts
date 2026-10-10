/** agy's retained SQLite store read through the provider: synthetic stores only, never native operator data. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { chmod, lstat, symlink } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join, relative } from "node:path";
import { it } from "node:test";
import { sqliteStore } from "../../src/adapters/sqlite-store.js";
import { readAgyStore } from "../../src/application/read-store.js";
import { decodeAgyConversation } from "../../src/domain/trajectory.js";
import { captured, childID, rootID, sqliteFixture, trajectoryID } from "../../test-fixtures/agy-store.js";

const read = (root: string, matches: (id: string) => boolean, limit = 20, maxBytes = 4_194_304) =>
  readAgyStore(sqliteStore(), root, matches, limit, maxBytes, captured);

// Moved with the store IO from telemetry's agy.test.ts; the assertions are unchanged, read from the decoded snapshots.
it("AGY read-only WAL scan joins one exact root, follows explicit children and drops unrelated sessions", async () => {
  const f = await sqliteFixture();
  try {
    f.add({ id: childID, parent: rootID });
    f.add({ id: "00000000-0000-4000-8000-000000000003" });
    const scan = await read(f.root, id => id === rootID);
    assert.equal(scan.reason, null); assert.equal(scan.conversations.length, 2);
    assert.equal(scan.conversations.find(c => c.conversationId === childID)?.parentId, rootID);
    assert.ok(scan.files.includes(f.native.path + "-wal"));
    assert.ok(!JSON.stringify(scan.conversations.map(c => c.steps)).includes("PRIVATE-"));
    assert.equal((await read(f.root, () => false)).reason, "source_unavailable");
    assert.equal((await read(f.root, id => id === rootID, 1)).reason, "scan_limit");
    assert.equal((await read(f.root, id => id === rootID, 20, 1)).reason, "scan_limit");
  } finally { await f.close(); }
});

it("AGY wrong native database identity, symlink stores and widened permissions stay unavailable", async () => {
  const f = await sqliteFixture();
  try {
    f.native.db.prepare("UPDATE trajectory_meta SET trajectory_id=?").run(childID);
    assert.equal((await read(f.root, id => id === rootID)).reason, "source_unavailable");
    f.native.db.prepare("UPDATE trajectory_meta SET trajectory_id=?").run(trajectoryID);
    f.native.db.prepare("UPDATE trajectory_meta SET cascade_id=?").run(childID);
    assert.equal((await read(f.root, id => id === rootID)).reason, "source_unavailable");
    f.native.db.prepare("UPDATE trajectory_meta SET cascade_id=?").run(rootID);
    await chmod(f.root, 0o755);
    assert.equal((await read(f.root, id => id === rootID)).reason, "source_unavailable");
    await chmod(f.root, 0o700);
    await symlink(f.root, join(f.base, "linked"));
    assert.equal((await read(join(f.base, "linked"), id => id === rootID)).reason, "source_unavailable");
  } finally { await f.close(); }
});

/** A valid single-root value of exactly `bytes` UTF-8 bytes, built from two-byte characters. */
function workspaceOf(bytes: number): string {
  const head = "file:///ws/", frame = Buffer.byteLength(JSON.stringify([head]));
  let body = "é".repeat(Math.floor((bytes - frame) / 2));
  if (frame + Buffer.byteLength(body) < bytes) body += "a";
  const value = JSON.stringify([head + body]);
  assert.equal(Buffer.byteLength(value), bytes, "fixture: exact byte length");
  return value;
}
it("caps workspace metadata in bytes, not characters, at exactly 4096", async () => {
  const roots = async (workspace: string) => {
    const f = await sqliteFixture("d".repeat(64), { workspaceColumn: true });
    try {
      f.replaceRoot({ steps: [{ kind: "user" }, { kind: "planner", message: "Done here now." }] }, workspace);
      const scan = await read(f.root, id => id === rootID);
      assert.equal(scan.reason, null);
      return scan.conversations[0]!.workspaceRoot;
    } finally { await f.close(); }
  };
  const atCap = workspaceOf(4096), overCap = workspaceOf(4097);
  assert.ok(atCap.length < 4096, "fixture: fewer characters than bytes");
  assert.equal(typeof await roots(atCap), "string", "exactly 4096 bytes is read");
  assert.equal(await roots(overCap), null, "4097 bytes in fewer than 4096 characters is never materialized");
});

const uid = process.getuid?.() ?? 0;
const readWith = (store: ReturnType<typeof sqliteStore>, root: string, nowMs = captured, maxBytes = 8 * 1_048_576) =>
  readAgyStore(store, root, id => id === rootID, 20, maxBytes, nowMs);
async function withStore(run: (f: Awaited<ReturnType<typeof sqliteFixture>>) => Promise<void>) {
  const f = await sqliteFixture();
  try { assert.equal((await read(f.root, id => id === rootID)).reason, null, "fixture: the store reads"); await run(f); } finally { await f.close(); }
}

it("refuses directories and databases owned by anyone else", () => withStore(async f => {
  assert.equal((await readWith(sqliteStore({ directoryOwner: uid + 1 }), f.root)).reason, "source_unavailable");
  assert.equal((await readWith(sqliteStore({ fileOwner: uid + 1 }), f.root)).reason, "source_unavailable");
}));

it("refuses a store reached through a symlinked ancestor above the checked directories", () => withStore(async f => {
  const alias = f.base + "-alias";
  await symlink(f.base, alias);
  try {
    assert.equal((await read(join(alias, relative(f.base, f.root)), id => id === rootID)).reason, "source_unavailable");
  } finally { rmSync(alias, { force: true }); }
}));

it("refuses a database that is not a regular file without opening it", async () => {
  const f = await sqliteFixture("c".repeat(64));
  try {
    // The open writer keeps the unlinked database; the path now names a FIFO, which an open would block on.
    for (const suffix of ["", "-wal", "-shm"]) rmSync(join(f.root, "conversation_summaries.db") + suffix, { force: true });
    execFileSync("mkfifo", [join(f.root, "conversation_summaries.db")]);
    assert.equal((await read(f.root, id => id === rootID)).reason, "source_unavailable");
  } finally { await f.close(); }
});

it("refuses a database swapped between its check and its open", () => withStore(async f => {
  const seen = new Map<string, number>();
  const swapping = (async (path: string) => {
    const s = await lstat(path), n = (seen.get(path) ?? 0) + 1;
    seen.set(path, n);
    return n % 2 === 0 && path.endsWith("conversation_summaries.db") ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { ino: s.ino + 1 }) : s;
  }) as typeof lstat;
  assert.equal((await readWith(sqliteStore({ lstat: swapping }), f.root)).reason, "source_unavailable");
}));

it("refuses more than 20 summaries and summaries that are missing or over the blob bound", () => withStore(async f => {
  const insert = f.summaryDB.prepare("INSERT INTO conversation_summaries(conversation_id,parent_conversation_id,step_count,last_user_input_step_index,not_fully_idle,killed,raw_summary) VALUES(?,?,?,?,?,?,?)");
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "9")}`;
  for (let n = 0; n < 19; n++) insert.run(id(n), "", 1, 0, 0, 0, Buffer.from([8, 1]));
  assert.equal((await read(f.root, i => i === rootID)).reason, null, "20 summaries read");
  insert.run(id(19), "", 1, 0, 0, 0, Buffer.from([8, 1]));
  assert.equal((await read(f.root, i => i === rootID)).reason, "scan_limit", "21 summaries are a scan limit");
  f.summaryDB.prepare("DELETE FROM conversation_summaries WHERE conversation_id<>?").run(rootID);
  insert.run(id(1), "", 1, 0, 0, 0, null);
  assert.equal((await read(f.root, i => i === rootID)).reason, "scan_limit", "a missing summary blob");
  f.summaryDB.prepare("UPDATE conversation_summaries SET raw_summary=? WHERE conversation_id=?").run(Buffer.alloc(1_048_577), id(1));
  assert.equal((await read(f.root, i => i === rootID)).reason, "scan_limit", "a summary blob over 1 MiB");
}));

it("refuses two matching roots, and a matching conversation that has a parent", () => withStore(async f => {
  f.add({ id: childID, parent: rootID });
  f.add({ id: "00000000-0000-4000-8000-000000000003" });
  assert.equal((await read(f.root, id => id === rootID || id === "00000000-0000-4000-8000-000000000003")).reason, "source_unavailable");
  assert.equal((await read(f.root, id => id === childID)).reason, "source_unavailable");
}));

it("never opens a path derived from a conversation id outside the grammar", () => withStore(async f => {
  const outside = new DatabaseSync(join(f.root, "outside.db")); outside.exec("CREATE TABLE trajectory_meta(trajectory_id TEXT,cascade_id TEXT)"); outside.close();
  f.summaryDB.prepare("DELETE FROM conversation_summaries").run();
  f.summaryDB.prepare("INSERT INTO conversation_summaries(conversation_id,parent_conversation_id,step_count,last_user_input_step_index,not_fully_idle,killed,raw_summary) VALUES(?,?,?,?,?,?,?)")
    .run("../outside", "", 1, 0, 0, 0, Buffer.from([8, 1]));
  const scan = await read(f.root, id => id === "../outside");
  assert.equal(scan.reason, "source_unavailable");
  assert.equal(scan.files.some(file => file.startsWith(join(f.root, "outside.db"))), false);
}));

it("refuses a trajectory database that names more than one trajectory", () => withStore(async f => {
  f.native.db.prepare("INSERT INTO trajectory_meta VALUES(?,?)").run("20000000-0000-4000-8000-000000000001", rootID);
  assert.equal((await read(f.root, id => id === rootID)).reason, "source_unavailable");
}));

it("treats a summary step count that disagrees with the rows, and more than 4096 rows, as a scan limit", async () => {
  await withStore(async f => {
    f.summaryDB.prepare("UPDATE conversation_summaries SET step_count=3 WHERE conversation_id=?").run(rootID);
    assert.equal((await read(f.root, id => id === rootID)).reason, "scan_limit");
  });
  const f = await sqliteFixture("e".repeat(64));
  try {
    f.replaceRoot({ steps: [{ kind: "user" }, ...Array.from({ length: 4096 }, () => ({ kind: "result" as const }))] });
    assert.equal((await readWith(sqliteStore(), f.root, Date.now())).reason, "scan_limit");
  } finally { await f.close(); }
});

it("treats a metadata, payload or error record over 1 MiB as a scan limit", () => withStore(async f => {
  const big = Buffer.alloc(1_048_577, 1);
  for (const column of ["error_details", "metadata", "step_payload"]) {
    const before = f.native.db.prepare(`SELECT ${column} AS v FROM steps WHERE idx=1`).get()!["v"];
    f.native.db.prepare(`UPDATE steps SET ${column}=? WHERE idx=1`).run(big);
    assert.equal((await readWith(sqliteStore(), f.root)).reason, "scan_limit", column);
    f.native.db.prepare(`UPDATE steps SET ${column}=? WHERE idx=1`).run(before as Buffer | null);
  }
}));

it("refuses a store whose summaries changed while the trajectories were read", () => withStore(async f => {
  const during = (change: () => void) => sqliteStore().scan(f.root, id => id === rootID, 20, 8 * 1_048_576,
    (summary, rows, origin) => { change(); return decodeAgyConversation(summary, rows, origin, captured, null); });
  const original = f.summaryDB.prepare("SELECT raw_summary FROM conversation_summaries WHERE conversation_id=?").get(rootID)!["raw_summary"] as Buffer;
  assert.equal((await during(() => f.summaryDB.prepare("UPDATE conversation_summaries SET not_fully_idle=1 WHERE conversation_id=?").run(rootID))).reason, "source_unavailable", "a scalar column");
  f.summaryDB.prepare("UPDATE conversation_summaries SET not_fully_idle=0 WHERE conversation_id=?").run(rootID);
  const sameLength = Buffer.from(original); sameLength[sameLength.indexOf(Buffer.from([5 * 8, 1])) + 1] = 3;
  assert.equal(sameLength.length, original.length, "fixture: only the blob's bytes change, not its length");
  assert.equal((await during(() => f.summaryDB.prepare("UPDATE conversation_summaries SET raw_summary=? WHERE conversation_id=?").run(sameLength, rootID))).reason, "source_unavailable", "the summary blob");
  f.summaryDB.prepare("UPDATE conversation_summaries SET raw_summary=? WHERE conversation_id=?").run(original, rootID);
  assert.equal((await during(() => f.summaryDB.prepare("INSERT OR IGNORE INTO conversation_summaries(conversation_id,parent_conversation_id,step_count,last_user_input_step_index,not_fully_idle,killed,raw_summary) VALUES(?,?,?,?,?,?,?)")
    .run("ffffffff-ffff-4fff-8fff-ffffffffffff", "", 1, 0, 0, 0, Buffer.from([8, 1])))).reason, "source_unavailable", "an appended summary");
}));
