/** Synthetic stores only. No native launch, provider request, prompts or operator files. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { collectIssueAgentTree } from "../issue-agent-feed-cli.js";
import { ORCHID_DISPATCH_ROOT, readOrchidDispatches } from "../orchid-dispatch.js";
import { verifyOrchidOpenCodeBinding } from "../orchid-native-binding.js";
import { openCodeConversation, scanOpenCodeIssue } from "./opencode-issue.js";

const rootID = "ses_fixture_root", epoch = Date.parse("2026-01-01T00:00:00.000Z");
const provider = "fixture-provider", model = "nested/model:1", qualified = provider + "/" + model;
const now = new Date(epoch + 30_000).toISOString();
type FixtureOptions = { finish?: string; completed?: boolean; text?: string; error?: string; tool?: boolean;
  userSummary?: unknown; assistantSummary?: unknown; version?: string; tokens?: unknown };
async function fixture(o: FixtureOptions = {}) {
  const base = await mkdtemp(join(tmpdir(), "opencode-reader-"));
  const store = join(base, ".local/share/opencode"); await mkdir(store, { recursive: true, mode: 0o700 });
  const path = join(store, "opencode.db"), db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,version TEXT,time_created INTEGER,time_updated INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);`);
  db.prepare("INSERT INTO session VALUES(?,?,?,?,?)").run(rootID, null, o.version ?? "1.18.34", epoch, epoch + 25_000);
  const message = (id: string, data: object, session = rootID, at = epoch) =>
    db.prepare("INSERT INTO message VALUES(?,?,?,?,?)").run(id, session, at, epoch + 25_000, JSON.stringify(data));
  const part = (id: string, msg: string, data: object, session = rootID) =>
    db.prepare("INSERT INTO part VALUES(?,?,?,?,?,?)").run(id, msg, session, epoch, epoch + 25_000, JSON.stringify(data));
  message("msg_fixture_user", { role: "user", time: { created: epoch }, model: { providerID: provider, modelID: model },
    ...(o.userSummary === undefined ? {} : { summary: o.userSummary }) });
  part("prt_fixture_user", "msg_fixture_user", { type: "text", text: "PRIVATE-USER-CANARY" });
  const assistant = () => ({ role: "assistant",
    ...(o.assistantSummary === undefined ? {} : { summary: o.assistantSummary }), parentID: "msg_fixture_user", providerID: provider, modelID: model,
    time: { created: epoch + 1000, ...(o.completed === false ? {} : { completed: epoch + 3000 }) },
    ...(o.finish === "absent" ? {} : { finish: o.finish ?? "stop" }),
    ...(o.error === undefined ? {} : { error: { name: o.error, data: { message: "PRIVATE-ERROR-CANARY" } } }),
    ...(o.tokens === undefined ? {} : { tokens: o.tokens }),
    path: { cwd: "/PRIVATE/WORKSPACE", root: "/PRIVATE/WORKSPACE" } });
  message("msg_fixture_assistant", assistant(), rootID, epoch + 1000);
  part("prt_fixture_text", "msg_fixture_assistant", { type: "text", text: o.text ?? "The work is complete.",
    time: { start: epoch + 1000, end: epoch + 2000 } });
  part("prt_fixture_reasoning", "msg_fixture_assistant", { type: "reasoning", text: "PRIVATE-THINKING-CANARY" });
  if (o.tool) part("prt_fixture_tool", "msg_fixture_assistant", { type: "tool", tool: "fixture", state: {
    status: "completed", input: { text: "PRIVATE-TOOL-CANARY" }, output: "PRIVATE-TOOL-OUTPUT" } });
  const receipts = join(base, "receipts");
  const issue = async (number: number, id: string | null = rootID, patch: Record<string, unknown> = {}) => {
    const issueId = `fixture-${number}`, brief = "b".repeat(64), repo = "example/project";
    const key = createHash("sha256").update(issueId + "\0" + repo + "\0" + brief).digest("hex");
    const record = join(receipts, key, "record"); await mkdir(record, { recursive: true, mode: 0o700 });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + key,
      issue: { repo, number }, parentRunId: null, source: "opencode", provider, model: qualified, effort: "provider_default",
      state: "dispatched", observedAt: new Date(epoch).toISOString(),
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo, BriefDigest: brief,
      Route: { transport: "opencode", provider, model: qualified, effort: "provider_default" },
      ...(id === null ? {} : { NativeSessionID: id }), ...patch }), { mode: 0o600 });
    return record;
  };
  const record = await issue(42);
  const options = { home: base, limit: 20, now, env: { [ORCHID_DISPATCH_ROOT]: receipts } };
  const collect = () => collectIssueAgentTree(options);
  const close = async () => { db.close(); await rm(base, { recursive: true, force: true }); };
  return { base, path, store, db, message, part, issue, record, options, collect, close };
}
it("OpenCode bound feed serves persisted assistant text and exact native end, without private data", async () => {
  const f = await fixture();
  try {
    const snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    assert.equal(snapshot.issues[0]?.complete, true);
    const mixed = structuredClone(snapshot);
    Object.assign(mixed.issues[0]!.dispatches[0]!.agents[0]!.observation.route.observed.model,
      { source: "thread/start.result.model" });
    assert.equal(readIssueAgentTreeSnapshot(mixed).ok, false);
    const a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.harness.value, "opencode"); assert.equal(a.router.value, "direct");
    assert.equal(a.model.value, qualified); assert.equal(a.liveness.state, "ended");
    assert.equal(a.observation.route.observed.provider.value, provider);
    assert.equal(a.observation.route.observed.provider.source, "opencode.message.providerID");
    assert.equal(a.observation.route.observed.model.value, qualified);
    assert.equal(a.observation.route.observed.effort.value, null);
    assert.equal(a.terminalOutcome.value, "succeeded"); assert.equal(a.endedAt, new Date(epoch + 3000).toISOString());
    assert.equal(a.terminalOutcome.observedAt, a.endedAt);
    assert.equal(a.activity?.steps[0]?.source, "opencode-transcript");
    assert.equal(a.activity?.steps[0]?.summary, "The work is complete.");
    assert.equal(a.activity?.steps.length, 1);
    assert.equal(a.tokenUsage?.usedTokens, null);
    const wire = JSON.stringify(snapshot);
    for (const privateValue of [rootID, f.base, "PRIVATE-", "msg_fixture", "prt_fixture"]) assert.ok(!wire.includes(privateValue));
  } finally { await f.close(); }
});
it("OpenCode persisted parts appear before completion; a newer native turn clears the old end", async () => {
  const f = await fixture({ completed: false });
  try {
    let a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.activity?.steps[0]?.summary, "The work is complete."); assert.equal(a.liveness.state, "running");
    assert.equal(a.endedAt, null);
    f.db.prepare("UPDATE message SET data=json_set(data,'$.time.completed',?) WHERE id=?").run(epoch + 3000, "msg_fixture_assistant");
    a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!; assert.equal(a.terminalOutcome.value, "succeeded");
    f.message("msg_fixture_later_user", { role: "user", time: { created: epoch + 4000 } }, rootID, epoch + 4000);
    a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.notEqual(a.terminalOutcome.value, "succeeded"); assert.equal(a.endedAt, null);
    f.message("msg_fixture_later_assistant", { role: "assistant", parentID: "msg_fixture_user", providerID: provider,
      modelID: model, finish: "stop", time: { created: epoch + 5000, completed: epoch + 7000 } }, rootID, epoch + 5000);
    f.part("prt_fixture_later_text", "msg_fixture_later_assistant", { type: "text", text: "The later work is complete.",
      time: { start: epoch + 5000, end: epoch + 6000 } });
    a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.notEqual(a.terminalOutcome.value, "succeeded"); assert.equal(a.endedAt, null);
    f.db.prepare("UPDATE message SET data=json_set(data,'$.parentID',?) WHERE id=?")
      .run("msg_fixture_later_user", "msg_fixture_later_assistant");
    a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.terminalOutcome.value, "succeeded"); assert.equal(a.endedAt, new Date(epoch + 7000).toISOString());
  } finally { await f.close(); }
});
it("OpenCode empty/unknown/tool/length finishes never become success", async () => {
  for (const o of [{ text: "" }, { finish: "unknown" }, { finish: "tool-calls" }, { finish: "length" },
    { finish: "content-filter" }, { finish: "absent" }, { tool: true }]) {
    const f = await fixture(o);
    try {
      const a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
      assert.ok(a); assert.notEqual(a.terminalOutcome.value, "succeeded", JSON.stringify(o)); assert.equal(a.endedAt, null);
    } finally { await f.close(); }
  }
});
it("OpenCode native error/cancellation retain their exact end and screened response", async () => {
  for (const [error, expected] of [["APIError", "failed"], ["MessageAbortedError", "cancelled"], ["FutureUnknownError", null]] as const) {
    const f = await fixture({ error, text: "Read /PRIVATE/path and token ghp_PRIVATECANARY." });
    try {
      const a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!; assert.ok(a);
      assert.equal(a.terminalOutcome.value, expected); assert.equal(a.activity?.steps[0]?.summary, null);
      assert.equal(a.endedAt, expected === null ? null : new Date(epoch + 3000).toISOString());
    } finally { await f.close(); }
  }
});
it("OpenCode provider-executed tools and explicit cleanup orphans do not require continuation", async () => {
  const f = await fixture({ tool: true });
  try {
    for (const part of [{ type: "tool", state: { status: "completed" }, metadata: { providerExecuted: true } },
      { type: "tool", state: { status: "error", metadata: { interrupted: true } } }]) {
      f.db.prepare("UPDATE part SET data=? WHERE id=?").run(JSON.stringify(part), "prt_fixture_tool");
      assert.equal((await f.collect()).issues[0]?.dispatches[0]?.agents[0]?.terminalOutcome.value, "succeeded");
    }
  } finally { await f.close(); }
});
it("OpenCode observed route comes from typed native metadata, never requested argv", async () => {
  const f = await fixture();
  try {
    const prior = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]?.observation.revision;
    f.db.prepare("UPDATE message SET data=json_set(data,'$.providerID',?) WHERE id=?").run("other-provider", "msg_fixture_assistant");
    const a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.observation.route.requested.provider.value, provider);
    assert.equal(a.observation.route.observed.provider.value, "other-provider");
    assert.equal(a.observation.route.observed.model.source, "opencode.message.providerID+modelID");
    assert.equal(a.observation.route.observed.model.value, "other-provider/" + model);
    assert.ok(a.observation.route.mismatches.includes("provider"));
    assert.notEqual(a.observation.revision, prior);
  } finally { await f.close(); }
});
it("OpenCode missing/private-invalid binding is isolated from a healthy issue", async () => {
  const f = await fixture();
  try {
    await f.issue(43, null); await f.issue(44, rootID, { Repo: "other/project" });
    const snapshot = await f.collect();
    assert.equal(snapshot.issues.find(i => i.issueNumber === 42)?.complete, true);
    for (const n of [43, 44]) assert.equal(snapshot.issues.find(i => i.issueNumber === n)?.complete, false);
  } finally { await f.close(); }
});
it("OpenCode native neighbours do not join; explicit children must finish before the root is Done", async () => {
  const f = await fixture();
  try {
    f.db.prepare("INSERT INTO session VALUES(?,?,?,?,?)").run("ses_foreign", null, "1.18.34", epoch, epoch);
    f.message("msg_foreign", { role: "assistant", time: { created: epoch }, providerID: provider, modelID: model }, "ses_foreign");
    f.part("prt_foreign", "msg_foreign", { type: "text", text: "PRIVATE-FOREIGN-CANARY" }, "ses_foreign");
    let scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
    assert.equal(scan.reason, null); assert.equal(scan.runs.length, 1);
    f.db.prepare("INSERT INTO session VALUES(?,?,?,?,?)").run("ses_child", rootID, "1.18.34", epoch + 4000, epoch + 4000);
    f.message("msg_child_user", { role: "user", time: { created: epoch + 4000 } }, "ses_child", epoch + 4000);
    scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
    assert.equal(scan.reason, null); assert.equal(scan.runs.length, 2);
    assert.equal(scan.runs[0]?.outcome, "running"); assert.equal(scan.runs[0]?.terminalAt, undefined);
    assert.equal((await scanOpenCodeIssue(f.path, rootID, 1, 8_388_608, epoch + 30_000)).reason, "scan_limit");
    assert.ok(!JSON.stringify((await f.collect())).includes("PRIVATE-FOREIGN"));
  } finally { await f.close(); }
});
it("OpenCode family detection fails closed only for bound next/mixed rows; legacy need not have next tables", async () => {
  const f = await fixture();
  try {
    const scan = () => scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
    assert.equal((await scan()).reason, null);
    f.db.exec("CREATE TABLE session_message(session_id TEXT); CREATE TABLE session_input(session_id TEXT,prompt TEXT)");
    f.db.prepare("INSERT INTO session_message VALUES(?)").run("ses_foreign");
    assert.equal((await scan()).reason, null);
    f.db.prepare("INSERT INTO session_input VALUES(?,?)").run(rootID, "PRIVATE-NEXT-PROMPT");
    assert.equal((await scan()).reason, "source_unavailable");
    // Removing the bound next-family row restores the legacy read: the decision is the rows, not a label.
    f.db.exec("DELETE FROM session_input; DELETE FROM session_message");
    assert.equal((await scan()).reason, null);
  } finally { await f.close(); }
});
it("OpenCode duplicate JSON keys, foreign parts and contradictory/future clocks cannot produce Done", async () => {
  const f = await fixture();
  try {
    const statement = f.db.prepare("SELECT data FROM message WHERE id=?"), original = statement.get("msg_fixture_assistant")!.data as string;
    for (const data of [original.replace('"finish":"stop"', '"finish":"stop","finish":"stop"'),
      original.replace(String(epoch + 3000), String(epoch + 500)), original.replace(String(epoch + 3000), String(epoch + 60_000))]) {
      f.db.prepare("UPDATE message SET data=? WHERE id=?").run(data, "msg_fixture_assistant");
      assert.equal((await f.collect()).issues[0]?.complete, false);
      assert.equal((await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000)).reason, "source_unavailable");
    }
    f.db.prepare("UPDATE message SET data=? WHERE id=?").run(original, "msg_fixture_assistant");
    f.db.prepare("UPDATE part SET message_id=? WHERE id=?").run("msg_absent", "prt_fixture_text");
    assert.equal((await f.collect()).issues[0]?.complete, false);
    f.db.prepare("UPDATE part SET message_id=? WHERE id=?").run("msg_fixture_assistant", "prt_fixture_text");
    f.db.prepare("UPDATE part SET data=? WHERE id=?").run('{"type":"text","text":"OK","synthetic":true}', "prt_fixture_text");
    assert.notEqual((await f.collect()).issues[0]?.dispatches[0]?.agents[0]?.terminalOutcome.value, "succeeded");
  } finally { await f.close(); }
});
it("OpenCode private binding and dispatch changes invalidate an in-flight native read", async () => {
  const f = await fixture();
  try {
    let dispatch = (await readOrchidDispatches(f.options.env[ORCHID_DISPATCH_ROOT])).dispatches[0]!;
    assert.equal(await verifyOrchidOpenCodeBinding(dispatch), true);
    const binding = join(f.record, "binding.json");
    const bytes = await import("node:fs/promises").then(fs => fs.readFile(binding));
    await writeFile(binding, JSON.stringify({ ...JSON.parse(bytes.toString()), extra: "changed" }), { mode: 0o600 });
    assert.equal(await verifyOrchidOpenCodeBinding(dispatch), false);
    await writeFile(binding, bytes, { mode: 0o600 });
    dispatch = (await readOrchidDispatches(f.options.env[ORCHID_DISPATCH_ROOT])).dispatches[0]!;
    await writeFile(join(f.record, "dispatch.json"), "{}", { mode: 0o600 });
    assert.equal(await verifyOrchidOpenCodeBinding(dispatch), false);
  } finally { await f.close(); }
});
it("OpenCode fixed read budgets reject oversized JSON and excess rows before projecting a prefix", async () => {
  const f = await fixture();
  try {
    const scan = (budget = 8_388_608) => scanOpenCodeIssue(f.path, rootID, 20, budget, epoch + 30_000);
    assert.equal((await scan(1)).reason, "scan_limit");
    const original = f.db.prepare("SELECT data FROM part WHERE id=?").get("prt_fixture_text")!.data as string;
    f.db.prepare("UPDATE part SET data=? WHERE id=?").run(JSON.stringify({ type: "text", text: "a".repeat(1_048_576) }), "prt_fixture_text");
    assert.equal((await scan()).reason, "scan_limit");
    f.db.prepare("UPDATE part SET data=? WHERE id=?").run(original, "prt_fixture_text");
    f.db.exec("BEGIN");
    for (let i = 0; i < 4097; i++) f.part("prt_extra_" + i, "msg_fixture_user", { type: "text", text: "fixture" });
    f.db.exec("COMMIT"); assert.equal((await scan()).reason, "scan_limit");
  } finally { await f.close(); }
});
it("OpenCode WAL updates keep stable activity IDs; missing/symlink/writable stores are unavailable", async () => {
  const f = await fixture();
  try {
    const scan = () => scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
    const first = await scan(); assert.equal(first.reason, null); assert.ok(first.files.includes(f.path + "-wal"));
    f.db.prepare("UPDATE part SET data=json_set(data,'$.text',?) WHERE id=?").run("The next result is ready.", "prt_fixture_text");
    const next = await scan(); assert.equal(next.runs[0]?.activitySteps?.[0]?.id, first.runs[0]?.activitySteps?.[0]?.id);
    assert.equal(next.runs[0]?.activitySteps?.[0]?.summary, "The next result is ready.");
    assert.equal((await scanOpenCodeIssue(join(f.store, "missing.db"), rootID, 20, 8_388_608, epoch + 30_000)).reason, "source_unavailable");
    const link = join(f.store, "link.db"); await symlink(f.path, link);
    assert.equal((await scanOpenCodeIssue(link, rootID, 20, 8_388_608, epoch + 30_000)).reason, "source_unavailable");
    await chmod(f.path, 0o666); assert.equal((await scan()).reason, "source_unavailable");
  } finally { await f.close(); }
});

it("OpenCode real user-summary shape remains readable without becoming assistant activity or Done evidence", async () => {
  const cases = JSON.parse(await readFile(new URL("../../src/backfill/fixtures/opencode-user-summary.json", import.meta.url), "utf8")) as {
    observed: object; populated: object;
  };
  for (const userSummary of [cases.observed, cases.populated]) {
    const f = await fixture({ userSummary });
    try {
      const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
      assert.equal(scan.reason, null, "native user summary object must remain readable");
      assert.equal(scan.runs[0]?.outcome, "complete");
      const snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
      assert.equal(snapshot.issues[0]?.complete, true);
      const a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
      assert.equal(a.terminalOutcome.value, "succeeded"); assert.equal(a.endedAt, new Date(epoch + 3000).toISOString());
      assert.equal(a.activity?.steps.length, 1); assert.equal(a.activity?.steps[0]?.summary, "The work is complete.");
      assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-SUMMARY"));
      f.db.prepare("DELETE FROM message WHERE id=?").run("msg_fixture_assistant");
      f.db.prepare("DELETE FROM part WHERE message_id=?").run("msg_fixture_assistant");
      const userOnly = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
      assert.equal(userOnly.liveness.state, "running"); assert.equal(userOnly.endedAt, null);
      assert.equal(userOnly.activity?.steps.length ?? 0, 0);
    } finally { await f.close(); }
  }
});
it("OpenCode rejects malformed user summary metadata and non-boolean assistant summaries", async () => {
  const diff = { additions: 1, deletions: 0 };
  const badUsers: unknown[] = [null, false, true, "summary", [], {}, { diffs: null }, { diffs: "diffs" },
    { diffs: [], extra: true }, { diffs: [], title: 1 }, { diffs: [], body: false },
    { diffs: [null] }, { diffs: [[]] }, { diffs: [{}] }, { diffs: [{ additions: "1", deletions: 0 }] },
    { diffs: [{ additions: null, deletions: 0 }] }, { diffs: [{ additions: 1, deletions: null }] },
    { diffs: [{ ...diff, file: 1 }] }, { diffs: [{ ...diff, patch: [] }] },
    { diffs: [{ ...diff, status: "future" }] }, { diffs: [{ ...diff, extra: true }] }];
  for (const [role, values] of [["user", badUsers], ["assistant", [null, {}, { diffs: [] }, [], "false", 0]]] as const) {
    for (const summary of values) {
      const f = await fixture(role === "user" ? { userSummary: summary } : { assistantSummary: summary });
      try {
        assert.equal((await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000)).reason,
          "source_unavailable", role + " must refuse " + JSON.stringify(summary));
      } finally { await f.close(); }
    }
  }
});
it("OpenCode assistant compaction remains boolean and clears earlier native success", async () => {
  for (const assistantSummary of [false, true]) {
    const f = await fixture({ userSummary: { diffs: [] }, assistantSummary });
    try {
      const run = (await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000)).runs[0]!;
      assert.equal(run.outcome, assistantSummary ? "unknown" : "complete");
      assert.equal(run.activitySteps?.length ?? 0, assistantSummary ? 0 : 1);
      assert.equal(run.terminalAt, assistantSummary ? undefined : new Date(epoch + 3000).toISOString());
      f.message("msg_fixture_compaction", { role: "assistant", parentID: "msg_fixture_user", providerID: provider,
        modelID: model, summary: true, finish: "stop", time: { created: epoch + 4000, completed: epoch + 6000 } }, rootID, epoch + 4000);
      f.part("prt_fixture_compaction", "msg_fixture_compaction", { type: "text", text: "PRIVATE-SUMMARY-COMPACTION",
        time: { start: epoch + 4000, end: epoch + 5000 } });
      const later = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
      assert.equal(later.terminalOutcome.value, null); assert.equal(later.endedAt, null);
      assert.ok(!JSON.stringify(later).includes("PRIVATE-SUMMARY"));
    } finally { await f.close(); }
  }
});
it("OpenCode duplicate nested summary keys and trailing summary JSON remain refused", async () => {
  const f = await fixture({ userSummary: { diffs: [] } });
  try {
    const original = f.db.prepare("SELECT data FROM message WHERE id=?").get("msg_fixture_user")!.data as string;
    for (const data of [original.replace('"diffs":[]', '"diffs":[],"diffs":[]'),
      original.replace('"diffs":[]', '"diffs":[{"additions":0,"additions":0,"deletions":0}]'), original + "{}"] ) {
      f.db.prepare("UPDATE message SET data=? WHERE id=?").run(data, "msg_fixture_user");
      assert.equal((await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000)).reason, "source_unavailable");
    }
  } finally { await f.close(); }
});

/** Reads the fixture rows exactly as scanOpenCodeIssue selects them, for the pure projection. */
function nativeRows(db: DatabaseSync) {
  const session = db.prepare("SELECT id,parent_id,version,time_created FROM session WHERE id=?").get(rootID)!;
  const messages = db.prepare("SELECT id,session_id,CAST(data AS BLOB) AS data FROM message WHERE session_id=? ORDER BY id").all(rootID);
  const parts = db.prepare("SELECT id,message_id,session_id,CAST(data AS BLOB) AS data FROM part WHERE session_id=? ORDER BY id").all(rootID);
  return { session, messages, parts };
}
it("OpenCode 1.18.35 recorded session decodes on the issue page with outcome, model and activity", async () => {
  const f = await fixture({ version: "1.18.35", completed: false });
  try {
    // Shaped like a live 1.18.35 run mid-turn: assistant header without time.completed, a text part and a running tool part.
    f.part("prt_fixture_tool", "msg_fixture_assistant", { type: "tool", callID: "call_fixture", tool: "bash",
      state: { status: "running", input: { command: "PRIVATE-TOOL-CANARY" }, time: { start: epoch + 2000 } } });
    const rows = nativeRows(f.db);
    assert.equal(rows.session.version, "1.18.35");
    const run = openCodeConversation(rows.session, rows.messages, rows.parts, f.path, epoch + 30_000);
    assert.ok(run, "a 1.18.35 session must decode");
    assert.equal(run.outcome, "running"); assert.equal(run.terminalAt, undefined);
    assert.equal(run.identity.provider, provider); assert.equal(run.identity.model, qualified);
    assert.equal(run.activitySteps?.length, 1); assert.equal(run.activitySteps?.[0]?.summary, "The work is complete.");
    const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
    assert.equal(scan.reason, null); assert.equal(scan.runs[0]?.outcome, "running");
    const snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    const a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.harness.value, "opencode"); assert.equal(a.model.value, qualified);
    assert.equal(a.observation.route.observed.model.value, qualified);
    assert.equal(a.liveness.state, "running"); assert.equal(a.endedAt, null);
    assert.equal(a.activity?.steps[0]?.summary, "The work is complete.");
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
    // The same 1.18.35 rows reach the existing native Done rule once the turn completes.
    f.db.prepare("DELETE FROM part WHERE id=?").run("prt_fixture_tool");
    f.db.prepare("UPDATE message SET data=json_set(data,'$.time.completed',?) WHERE id=?").run(epoch + 3000, "msg_fixture_assistant");
    const done = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(done.terminalOutcome.value, "succeeded"); assert.equal(done.endedAt, new Date(epoch + 3000).toISOString());
  } finally { await f.close(); }
});
it("OpenCode legacy-shaped stores read identically whatever the CLI version label, older or newer", async () => {
  const read = async (version: string) => {
    const f = await fixture({ version, completed: false });
    try {
      f.part("prt_fixture_tool", "msg_fixture_assistant", { type: "tool", callID: "call_fixture", tool: "bash",
        state: { status: "running", input: { command: "PRIVATE-TOOL-CANARY" }, time: { start: epoch + 2000 } } });
      const rows = nativeRows(f.db);
      const run = openCodeConversation(rows.session, rows.messages, rows.parts, f.path, epoch + 30_000);
      assert.ok(run, version);
      const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
      const snapshot = await f.collect();
      assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true, version);
      assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"), version);
      // Each fixture lives in its own temporary store; the origin path is the only per-store value.
      const { origin: _origin, ...decoded } = run;
      return { decoded, reason: scan.reason, bytes: scan.bytesRead, issue: snapshot.issues[0] };
    } finally { await f.close(); }
  };
  const reference = await read("1.18.34");
  assert.equal(reference.reason, null); assert.equal(reference.decoded.outcome, "running");
  assert.equal(reference.issue?.dispatches[0]?.agents[0]?.liveness.state, "running");
  for (const version of ["1.17.0", "1.18.3", "1.18.35", "1.18.36"]) {
    assert.deepEqual(await read(version), reference, version);
  }
});
it("OpenCode version label is only bounded and non-empty", async () => {
  for (const version of ["", "x".repeat(65)]) {
    const f = await fixture({ version });
    try {
      const rows = nativeRows(f.db);
      assert.equal(openCodeConversation(rows.session, rows.messages, rows.parts, f.path, epoch + 30_000), null);
      assert.equal((await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000)).reason, "source_unavailable");
      assert.ok(!JSON.stringify(await f.collect()).includes("PRIVATE-"));
    } finally { await f.close(); }
  }
});
it("OpenCode store structure fails closed before reading any row: missing table or column", async () => {
  const cases: [string, string][] = [
    ["missing part table", "DROP TABLE part"],
    ["missing part.data column", "ALTER TABLE part DROP COLUMN data"],
    ["missing message.session_id column", "ALTER TABLE message DROP COLUMN session_id"],
    ["missing session.version column", "ALTER TABLE session DROP COLUMN version"],
  ];
  for (const [name, change] of cases) {
    const f = await fixture();
    try {
      f.db.exec(change);
      const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
      assert.equal(scan.reason, "source_unavailable", name); assert.equal(scan.runs.length, 0, name);
      // Refused on structure alone: not one row byte was read.
      assert.equal(scan.bytesRead, 0, name);
      const snapshot = await f.collect();
      assert.equal(snapshot.issues[0]?.complete, false, name);
      const wire = JSON.stringify(snapshot);
      assert.ok(!wire.includes("The work is complete."), name); assert.ok(!wire.includes("PRIVATE-"), name);
    } finally { await f.close(); }
  }
});
it("OpenCode unknown part types, unknown roles and bound next-family rows fail closed, never a fabricated timeline", async () => {
  const cases: [string, (f: Awaited<ReturnType<typeof fixture>>) => void][] = [
    ["unknown part type", f => f.part("prt_fixture_unknown", "msg_fixture_assistant",
      { type: "PRIVATE-NEW-PART", text: "PRIVATE-UNKNOWN-CANARY" })],
    ["unknown role", f => f.db.prepare("UPDATE message SET data=json_set(data,'$.role','PRIVATE-ROLE') WHERE id=?")
      .run("msg_fixture_user")],
    ["bound next-family row", f => {
      f.db.exec("CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,time_updated INTEGER,data TEXT)");
      f.db.prepare("INSERT INTO session_message(id,session_id,data) VALUES(?,?,?)").run("smg_fixture", rootID, "PRIVATE-NEXT-CANARY");
    }],
  ];
  for (const [name, change] of cases) {
    const f = await fixture();
    try {
      // Control: the untouched store reads.
      assert.equal((await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000)).reason, null, name);
      change(f);
      const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
      assert.equal(scan.reason, "source_unavailable", name); assert.equal(scan.runs.length, 0, name);
      const snapshot = await f.collect();
      assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true, name);
      assert.equal(snapshot.issues[0]?.complete, false, name);
      const wire = JSON.stringify(snapshot);
      assert.ok(!wire.includes("The work is complete."), name); assert.ok(!wire.includes("PRIVATE-"), name);
    } finally { await f.close(); }
  }
});

const nativeTokens = { total: 555, input: 100, output: 20, reasoning: 30, cache: { read: 400, write: 5 } };
it("OpenCode issue tree reads native assistant tokens as opencode-usage, summed across assistant headers", async () => {
  const f = await fixture({ tokens: nativeTokens });
  try {
    const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
    assert.equal(scan.reason, null);
    assert.deepEqual(scan.runs[0]?.usage, { inputTokens: 100, outputTokens: 20, reasoningTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 5 });
    let snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    let a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
    assert.deepEqual(a.tokenUsage, { usedTokens: 555, budgetTokens: null, observedAt: a.tokenUsage?.observedAt, source: "opencode-usage", reason: null });
    assert.ok(a.tokenUsage?.observedAt);
    assert.equal(a.resourceHistory?.tokens.source, "unavailable");
    assert.deepEqual(a.observation.cost.runTokens.measurement, scan.runs[0]?.usage);
    // A later turn's header adds its own reading; the total is the sum, not the last header.
    f.message("msg_fixture_later_user", { role: "user", time: { created: epoch + 4000 } }, rootID, epoch + 4000);
    f.message("msg_fixture_later_assistant", { role: "assistant", parentID: "msg_fixture_later_user", providerID: provider,
      modelID: model, finish: "stop", time: { created: epoch + 5000, completed: epoch + 7000 },
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 3, write: 0 } } }, rootID, epoch + 5000);
    f.part("prt_fixture_later_text", "msg_fixture_later_assistant", { type: "text", text: "The later work is complete.",
      time: { start: epoch + 5000, end: epoch + 6000 } });
    snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.tokenUsage?.usedTokens, 561); assert.equal(a.tokenUsage?.source, "opencode-usage");
  } finally { await f.close(); }
});
it("OpenCode without a whole native token reading is unavailable, never labelled claude-usage", async () => {
  const { cache: _cache, ...noCache } = nativeTokens;
  for (const tokens of [undefined, null, "555", [], {}, noCache, { ...nativeTokens, input: -1 }, { ...nativeTokens, output: 1.5 },
    { ...nativeTokens, reasoning: "30" }, { ...nativeTokens, cache: { read: 400 } }, { ...nativeTokens, cache: { ...nativeTokens.cache, extra: 1 } },
    { ...nativeTokens, extra: 1 }, { ...nativeTokens, total: -1 }, { ...nativeTokens, input: Number.MAX_SAFE_INTEGER + 1 }]) {
    const f = await fixture(tokens === undefined ? {} : { tokens });
    try {
      // A missing or malformed token reading never costs the run its timeline.
      const scan = await scanOpenCodeIssue(f.path, rootID, 20, 8_388_608, epoch + 30_000);
      assert.equal(scan.reason, null, JSON.stringify(tokens)); assert.deepEqual(scan.runs[0]?.usage, {}, JSON.stringify(tokens));
      const snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
      const a = snapshot.issues[0]?.dispatches[0]?.agents[0]!;
      assert.equal(a.terminalOutcome.value, "succeeded");
      assert.deepEqual(a.tokenUsage, { usedTokens: null, budgetTokens: null, observedAt: null, source: "unavailable",
        reason: "measurement_missing" }, JSON.stringify(tokens));
      assert.ok(!JSON.stringify(snapshot).includes("claude-usage"));
    } finally { await f.close(); }
  }
  // One header with a reading and a later one without is not a total.
  const f = await fixture({ tokens: nativeTokens });
  try {
    f.message("msg_fixture_later_user", { role: "user", time: { created: epoch + 4000 } }, rootID, epoch + 4000);
    f.message("msg_fixture_later_assistant", { role: "assistant", parentID: "msg_fixture_later_user", providerID: provider,
      modelID: model, time: { created: epoch + 5000 } }, rootID, epoch + 5000);
    const a = (await f.collect()).issues[0]?.dispatches[0]?.agents[0]!;
    assert.equal(a.tokenUsage?.source, "unavailable"); assert.equal(a.tokenUsage?.usedTokens, null);
  } finally { await f.close(); }
});
