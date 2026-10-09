/** agy's retained SQLite store read through the provider: synthetic stores only, never native operator data. */
import assert from "node:assert/strict";
import { chmod, symlink } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { sqliteStore } from "../../src/adapters/sqlite-store.js";
import { readAgyStore } from "../../src/application/read-store.js";
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
