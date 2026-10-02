/** Synthetic SQLite/protobuf only; never launch an agent or read native operator data. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";
import { agyConversation, scanAGYIssue } from "./agy.js";
import { collectIssueAgentTree } from "../issue-agent-feed-cli.js";
import { ORCHID_DISPATCH_ROOT } from "../orchid-dispatch.js";
import { openIssueFeedChanges } from "../issue-agent-feed-changes.js";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
const rootID = "00000000-0000-4000-8000-000000000001", childID = "00000000-0000-4000-8000-000000000002";
const trajectoryID = "10000000-0000-4000-8000-000000000001";
const seconds = 1_767_225_600;
const encode = (n: number): Buffer => {
  const bytes: number[] = [];
  do { const byte = n % 128; n = Math.floor(n / 128); bytes.push(byte | (n > 0 ? 128 : 0)); } while (n > 0);
  return Buffer.from(bytes);
};
const integer = (field: number, value: number) => Buffer.concat([encode(field * 8), encode(value)]);
const bytes = (field: number, value: string | Buffer) => {
  const b = Buffer.from(value); return Buffer.concat([encode(field * 8 + 2), encode(b.length), b]);
};
const time = (field: number, offset: number) => bytes(field, integer(1, seconds + offset));
type Options = { id?: string; parent?: string; active?: boolean; stop?: number; message?: string; status?: number;
  interrupted?: boolean; killed?: boolean; childActive?: boolean; staleSummary?: boolean; userIndex?: number;
  summaryState?: number; summaryRunning?: boolean; summaryNotIdle?: boolean };
function fixture(o: Options = {}) {
  const id = o.id ?? rootID, status = o.status ?? (o.active ? 2 : 3);
  const metadata = Buffer.concat([time(1, 1), ...(o.active ? [] : [time(8, 2)])]);
  const response = Buffer.concat([bytes(1, o.message ?? "The work is complete."), bytes(3, "PRIVATE-THINKING-CANARY"),
    bytes(16, "PRIVATE-RAW-THINKING-CANARY"), integer(12, o.stop ?? 2)]);
  const rows = [{ idx: 0, step_type: 14, status: 3, step_format: 0, metadata: time(1, 0), error_details: null,
    step_payload: Buffer.concat([integer(1, 14), integer(4, 3), bytes(19, bytes(1, "PRIVATE-USER-CANARY"))]) },
  { idx: 1, step_type: 15, status, step_format: 0, metadata, error_details: null,
    step_payload: Buffer.concat([integer(1, 15), integer(4, status), bytes(5, metadata), bytes(20, response)]) }];
  const summary = { conversation_id: id, parent_conversation_id: o.parent ?? "", step_count: rows.length,
    last_user_input_step_index: 0, not_fully_idle: o.active || o.summaryNotIdle ? 1 : 0, killed: o.killed ? 1 : 0,
    trajectory_id: trajectoryID,
    raw_summary: Buffer.concat([bytes(4, trajectoryID), integer(2, rows.length), integer(5, o.summaryState ?? (o.active ? 2 : 1)), integer(16, o.userIndex ?? 0),
      time(7, 0), time(3, o.staleSummary ? 0 : 3), integer(18, o.childActive ? 1 : 0),
      integer(21, o.active || o.summaryRunning ? 1 : 0), integer(23, o.killed ? 1 : 0), integer(25, o.interrupted ? 1 : 0)]) };
  return { rows, summary };
}
const captured = (seconds + 30) * 1000;
it("AGY typed response is screened, bounded and ends at the native completion timestamp", () => {
  const f = fixture(), run = agyConversation(f.summary, f.rows, "PRIVATE-ORIGIN-CANARY", captured)!;
  assert.equal(run.source, "agy"); assert.equal(run.outcome, "complete");
  assert.equal(run.terminalAt, new Date((seconds + 2) * 1000).toISOString());
  assert.equal(run.activitySteps?.length, 1); assert.equal(run.activitySteps?.[0]?.source, "agy-transcript");
  assert.equal(run.activitySteps?.[0]?.summary, "The work is complete.");
  assert.ok(!JSON.stringify(run.activitySteps).includes("PRIVATE-"));
  assert.deepEqual(run.identity, { model: null, provider: null, effort: null, profile: null });
  assert.deepEqual(run.usage, {}); assert.deepEqual(run.quota, []);
});
it("AGY streaming, empty, tool continuation, unknown finish and active children cannot pass as Done", () => {
  for (const o of [{ active: true }, { message: "" }, { stop: 10 }, { stop: 0 }, { stop: 15 },
    { childActive: true }, { killed: true }] satisfies Options[]) {
    const f = fixture(o), run = agyConversation(f.summary, f.rows, "private", captured)!;
    assert.notEqual(run.outcome, "complete"); assert.equal(run.terminalAt, undefined);
  }
  const f = fixture({ active: true });
  assert.equal(agyConversation(f.summary, f.rows, "private", captured)?.outcome, "running");
});
it("AGY cancellation and error keep their native timestamp and never become success", () => {
  for (const status of [6, 7, 12]) {
    const f = fixture({ status }), run = agyConversation(f.summary, f.rows, "private", captured)!;
    assert.equal(run.outcome, "failed"); assert.equal(run.terminalCause, status === 7 ? "error" : "cancelled");
    assert.equal(run.terminalAt, new Date((seconds + 2) * 1000).toISOString());
  }
  for (const stop of [13, 16, 17, 18, 19, 20]) {
    const f = fixture({ stop }), run = agyConversation(f.summary, f.rows, "private", captured)!;
    assert.equal(run.outcome, "failed"); assert.equal(run.terminalCause, stop === 16 ? "cancelled" : "error");
  }
});
it("AGY summary-only resumed activity clears every prior terminal outcome before trajectory updates", () => {
  for (const activity of [{ summaryState: 2 }, { summaryState: 4 }, { summaryRunning: true },
    { summaryNotIdle: true }, { childActive: true }]) {
    for (const terminal of [{ stop: 2 }, { stop: 16 }, { stop: 17 }, { status: 6 }, { status: 7 }, { interrupted: true }]) {
      const f = fixture({ ...activity, ...terminal });
      const run = agyConversation(f.summary, f.rows, "synthetic-origin", captured)!;
      assert.ok(run); assert.equal(run.outcome, "running");
      assert.equal(run.terminalAt, undefined); assert.equal(run.terminalCause, undefined);
    }
  }
});
it("AGY private text stays generic and payload/header/summary disagreements fail closed", () => {
  const unsafe = fixture({ message: "Read /home/private/file and token ghp_PRIVATECANARY." });
  assert.equal(agyConversation(unsafe.summary, unsafe.rows, "private", captured)?.activitySteps?.[0]?.summary, null);
  const bad = [fixture({ staleSummary: true }), fixture(), fixture(), fixture(), fixture(), fixture({ userIndex: 1 })];
  bad[1]!.rows[1]!.step_format = 1;
  bad[2]!.rows[1]!.step_type = 14;
  bad[3]!.rows[1]!.step_payload = Buffer.from([0x80]);
  bad[4]!.rows[1]!.metadata = Buffer.concat([time(1, 1), time(8, 100)]);
  for (const f of bad) assert.equal(agyConversation(f.summary, f.rows, "private", captured), null);
  const duplicate = fixture();
  duplicate.rows[1]!.step_payload = Buffer.concat([duplicate.rows[1]!.step_payload, integer(4, 3)]);
  assert.equal(agyConversation(duplicate.summary, duplicate.rows, "private", captured), null);
  const wrongWire = fixture();
  wrongWire.rows[1]!.step_payload = Buffer.concat([wrongWire.rows[1]!.step_payload, encode(4 * 8 + 5), Buffer.alloc(4)]);
  assert.equal(agyConversation(wrongWire.summary, wrongWire.rows, "private", captured), null);
});
it("AGY a newer user turn clears the prior end and success", () => {
  const f = fixture({ active: true });
  const prior = fixture();
  const rows = [...prior.rows, ...f.rows.map(r => ({ ...r, idx: r.idx + 2 }))];
  const summary = { ...f.summary, step_count: 4, last_user_input_step_index: 1,
    raw_summary: Buffer.concat([bytes(4, trajectoryID), integer(2, 4), integer(5, 2), integer(16, 2), time(7, 0), time(3, 4), integer(21, 1)]) };
  const run = agyConversation(summary, rows, "private", captured)!;
  assert.equal(run.outcome, "running"); assert.equal(run.terminalAt, undefined);
});
async function sqliteFixture(key = "b".repeat(64)) {
  const base = await mkdtemp(join(tmpdir(), "agy-native-store-"));
  const parent = join(base, ".divybot-native"), reservation = join(parent, key), root = join(reservation, "agy");
  await mkdir(join(root, "conversations"), { recursive: true, mode: 0o700 });
  for (const path of [parent, reservation, root]) await chmod(path, 0o700);
  const summaryDB = new DatabaseSync(join(root, "conversation_summaries.db"));
  summaryDB.exec(`PRAGMA journal_mode=WAL; CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY,
    parent_conversation_id TEXT,step_count INTEGER,last_user_input_step_index INTEGER,not_fully_idle INTEGER,killed INTEGER,raw_summary BLOB,
    title TEXT,preview TEXT);`);
  const add = (o: Options = {}) => {
    const f = fixture(o), s = f.summary;
    summaryDB.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?,? ,?)").run(s.conversation_id,
      s.parent_conversation_id, s.step_count, s.last_user_input_step_index, s.not_fully_idle, s.killed, s.raw_summary,
      "PRIVATE-TITLE-CANARY", "PRIVATE-PREVIEW-CANARY");
    const path = join(root, "conversations", s.conversation_id + ".db"), db = new DatabaseSync(path);
    db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE trajectory_meta(trajectory_id TEXT PRIMARY KEY,cascade_id TEXT);
      CREATE TABLE steps(idx INTEGER PRIMARY KEY,step_type INTEGER,status INTEGER,metadata BLOB,error_details BLOB,step_payload BLOB,step_format INTEGER);`);
    db.prepare("INSERT INTO trajectory_meta VALUES(?,?)").run(s.trajectory_id,s.conversation_id);
    for (const r of f.rows) db.prepare("INSERT INTO steps VALUES(?,?,?,?,?,?,?)").run(r.idx,r.step_type,r.status,r.metadata,r.error_details,r.step_payload,r.step_format);
    return { path, db };
  };
  const native = add(), dbs = [native.db];
  return { base, root, summaryDB, add: (o: Options) => { const n = add(o); dbs.push(n.db); return n; }, native,
    close: async () => { for (const db of dbs) db.close(); summaryDB.close(); await rm(base, { recursive: true, force: true }); } };
}
it("AGY read-only WAL scan joins one exact root, follows explicit children and drops unrelated sessions", async () => {
  const f = await sqliteFixture();
  try {
    f.add({ id: childID, parent: rootID });
    f.add({ id: "00000000-0000-4000-8000-000000000003" });
    const scan = await scanAGYIssue(f.root, id => id === rootID, 20, 4_194_304, captured);
    assert.equal(scan.reason, null); assert.equal(scan.runs.length, 2);
    assert.equal(scan.runs.find(r => r.id === childID)?.parentId, rootID);
    assert.ok(scan.files.includes(f.native.path + "-wal"));
    assert.ok(!JSON.stringify(scan.runs.map(r => r.activitySteps)).includes("PRIVATE-"));
    assert.equal((await scanAGYIssue(f.root, () => false, 20, 4_194_304, captured)).reason, "source_unavailable");
    assert.equal((await scanAGYIssue(f.root, id => id === rootID, 1, 4_194_304, captured)).reason, "scan_limit");
    assert.equal((await scanAGYIssue(f.root, id => id === rootID, 20, 1, captured)).reason, "scan_limit");
  } finally { await f.close(); }
});
it("AGY feed serves screened live text and exact Done while another issue stays unknown", async () => {
  const brief = "b".repeat(64), repo = "example/project", issueId = "fixture-42";
  const key = createHash("sha256").update(issueId + "\0" + repo + "\0" + brief).digest("hex");
  const f = await sqliteFixture(key);
  try {
    const receipts = join(f.base, "receipts");
    const issue = async (number: number, bound: boolean) => {
      const id = `fixture-${number}`;
      const reservation = createHash("sha256").update(id + "\0" + repo + "\0" + brief).digest("hex");
      const record = join(receipts, reservation, "record");
      await mkdir(record, { recursive: true, mode: 0o700 });
      await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + reservation,
        issue: { repo, number }, parentRunId: null, source: "agy", provider: "fixture-provider", model: "fixture-model", effort: "high",
        state: "dispatched", observedAt: new Date(seconds * 1000).toISOString(),
        location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
      await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: id, Repo: repo, BriefDigest: brief,
        Route: { transport: "agy", provider: "fixture-provider", model: "fixture-model", effort: "high" },
        ...(bound ? { NativeSessionID: rootID, NativeStore: { source: "agy", directory: f.root } } : {}) }), { mode: 0o600 });
    };
    await issue(42, true); await issue(43, false);
    const options = { home: f.base, limit: 20, now: new Date(captured).toISOString(), env: { [ORCHID_DISPATCH_ROOT]: receipts } };
    const snapshot = await collectIssueAgentTree(options);
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    const good = snapshot.issues.find(i => i.issueNumber === 42)!;
    const unavailable = snapshot.issues.find(i => i.issueNumber === 43)!;
    assert.equal(good.complete, true, JSON.stringify(good)); assert.equal(unavailable.complete, false);
    const agent = good.dispatches[0]?.agents[0]!;
    assert.equal(agent.harness.value, "agy"); assert.equal(agent.liveness.state, "ended");
    assert.equal(agent.terminalOutcome?.value, "succeeded");
    assert.equal(agent.endedAt, new Date((seconds + 2) * 1000).toISOString());
    assert.equal(agent.activity?.steps[0]?.summary, "The work is complete.");
    assert.ok(!JSON.stringify(snapshot).includes(rootID)); assert.ok(!JSON.stringify(snapshot).includes(f.base));
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
    const active = fixture({ active: true });
    f.summaryDB.prepare("UPDATE conversation_summaries SET raw_summary=?,not_fully_idle=1 WHERE conversation_id=?")
      .run(active.summary.raw_summary, rootID);
    const r = active.rows[1]!;
    f.native.db.prepare("UPDATE steps SET status=?,metadata=?,step_payload=? WHERE idx=1").run(r.status,r.metadata,r.step_payload);
    const streaming = await collectIssueAgentTree(options);
    const live = streaming.issues.find(i => i.issueNumber === 42)?.dispatches[0]?.agents[0]!;
    assert.equal(live.liveness.state, "running"); assert.equal(live.endedAt, null);
    assert.equal(live.activity?.steps[0]?.summary, "The work is complete.");
    // Summary-before-trajectory window: native summary remains active while the
    // trajectory still ends in an older cancellation/error. Both reads are stable.
    for (const stop of [2, 16, 17]) {
      const old = fixture({ stop }).rows[1]!;
      f.native.db.prepare("UPDATE steps SET status=?,metadata=?,step_payload=? WHERE idx=1")
        .run(old.status, old.metadata, old.step_payload);
      const resumed = await collectIssueAgentTree(options);
      assert.equal(readIssueAgentTreeSnapshot(resumed).ok, true);
      const current = resumed.issues.find(i => i.issueNumber === 42)?.dispatches[0]?.agents[0]!;
      assert.equal(current.liveness.state, "running"); assert.equal(current.endedAt, null);
      assert.equal(current.terminalOutcome.value, null);
      assert.equal(resumed.issues.find(i => i.issueNumber === 43)?.complete, false);
    }
  } finally { await f.close(); }
});
it("AGY bound native WAL changes wake the feed without watching other paths", async () => {
  const f = await sqliteFixture(), changes = openIssueFeedChanges(undefined, join(f.base, "unbound"));
  try {
    const scan = await scanAGYIssue(f.root, id => id === rootID, 20, 4_194_304, captured);
    const unrelated = join(f.base, "unrelated"); await writeFile(unrelated, "a");
    changes.setFiles(new Set([...scan.files, unrelated]), new Set([f.root]));
    await new Promise(resolve => setTimeout(resolve, 30)); changes.consume();
    await appendFile(unrelated, "b"); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(changes.consume(), false);
    f.native.db.prepare("UPDATE steps SET status=status WHERE idx=1").run();
    f.native.db.prepare("UPDATE steps SET error_details=? WHERE idx=1").run(Buffer.from([1]));
    let changed = false;
    for (let i = 0; i < 30 && !changed; i++) { await new Promise(resolve => setTimeout(resolve, 20)); changed = changes.consume(); }
    assert.equal(changed, true);
  } finally { changes.close(); await f.close(); }
});
it("AGY wrong native database identity, symlink stores and widened permissions stay unavailable", async () => {
  const f = await sqliteFixture();
  try {
    f.native.db.prepare("UPDATE trajectory_meta SET trajectory_id=?").run(childID);
    assert.equal((await scanAGYIssue(f.root, id => id === rootID, 20, 4_194_304, captured)).reason, "source_unavailable");
    f.native.db.prepare("UPDATE trajectory_meta SET trajectory_id=?").run(trajectoryID);
    f.native.db.prepare("UPDATE trajectory_meta SET cascade_id=?").run(childID);
    assert.equal((await scanAGYIssue(f.root, id => id === rootID, 20, 4_194_304, captured)).reason, "source_unavailable");
    f.native.db.prepare("UPDATE trajectory_meta SET cascade_id=?").run(rootID);
    await chmod(f.root, 0o755);
    assert.equal((await scanAGYIssue(f.root, id => id === rootID, 20, 4_194_304, captured)).reason, "source_unavailable");
    await chmod(f.root, 0o700);
    await symlink(f.root, join(f.base, "linked"));
    assert.equal((await scanAGYIssue(join(f.base, "linked"), id => id === rootID, 20, 4_194_304, captured)).reason, "source_unavailable");
  } finally { await f.close(); }
});
