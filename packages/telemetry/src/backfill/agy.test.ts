/** Synthetic SQLite/protobuf only; never launch an agent or read native operator data. */
import assert from "node:assert/strict";
import { appendFile, chmod, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { agyConversation, scanAGYIssue } from "./agy.js";
import { collectIssueAgentTree } from "../issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "../operator-environment.js";
import { openIssueFeedChanges } from "../issue-agent-feed-changes.js";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { agyReservation, bindAgyIssue, bytes, captured, childID, encode, fixture, integer, rootID, seconds, sqliteFixture, time,
  trajectoryID, type Options } from "../fixtures/agy-store.js";
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
  const f = await sqliteFixture(agyReservation(42));
  try {
    const receipts = join(f.base, "receipts");
    await bindAgyIssue(receipts, { number: 42, root: f.root }); await bindAgyIssue(receipts, { number: 43 });
    const options = { home: f.base, limit: 20, now: new Date(captured).toISOString(), env: { [OPERATOR_ENV.dispatchRoot]: receipts } };
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
