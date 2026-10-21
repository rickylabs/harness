/** Synthetic 2.x run databases only. No native launch, provider request, prompts or operator files. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { collectIssueAgentTree } from "../issue-agent-feed-cli.js";
import { backfillFromDisk } from "./index.js";
import { OPERATOR_ENV } from "../operator-environment.js";
import { OPENCODE_RUN_DB_PREFIX, openCodeRunStorePath } from "./opencode-run-store.js";

const rootID = "ses_fixture_run", epoch = Date.parse("2026-01-01T00:00:00.000Z");
const provider = "fixture-provider", model = "nested/model:1", qualified = provider + "/" + model;
const now = new Date(epoch + 30_000).toISOString();
type Turn = { outcome?: string; finish?: string; text?: string; tool?: string; variant?: string; idle?: boolean };
/** One 2.x run database with the @opencode/client 2.1.2 message shapes, plus an Orchid receipt bound to it. */
async function fixture(turn: Turn = {}) {
  const base = await mkdtemp(join(tmpdir(), "opencode-run-store-"));
  const data = join(base, ".local/share/opencode"); await mkdir(data, { recursive: true, mode: 0o700 });
  const path = openCodeRunStorePath(data, rootID)!, db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session_v2(id TEXT PRIMARY KEY,project_id TEXT,parent_id TEXT,directory TEXT,title TEXT,version TEXT,
      agent TEXT,model TEXT,cost REAL,tokens_input INTEGER,tokens_output INTEGER,tokens_reasoning INTEGER,
      tokens_cache_read INTEGER,tokens_cache_write INTEGER,time_created INTEGER,time_updated INTEGER,time_suspended INTEGER);
    CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,
      time_updated INTEGER,data TEXT);`);
  db.prepare("INSERT INTO session_v2 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(rootID, "prj_fixture", null,
    "/PRIVATE/WORKSPACE", "PRIVATE-TITLE-CANARY", "2.1.2", null, JSON.stringify({ id: model, providerID: provider }), 0.25,
    1200, 300, 0, 50, 0, epoch, epoch + 25_000, null);
  let seq = 0;
  const message = (id: string, type: string, body: object, at: number) =>
    db.prepare("INSERT INTO session_message VALUES(?,?,?,?,?,?,?)").run(id, rootID, type, ++seq, at, at, JSON.stringify(body));
  message("msg_fixture_user", "user", { time: { created: epoch }, text: "PRIVATE-USER-CANARY", files: [] }, epoch);
  message("msg_fixture_assistant", "assistant", { time: { created: epoch + 1000, streamed: epoch + 2000, completed: epoch + 3000 },
    agent: "build", model: { id: model, providerID: provider, variant: turn.variant ?? "default" },
    content: [{ type: "reasoning", text: "PRIVATE-THINKING-CANARY" }, { type: "text", text: turn.text ?? "The work is complete." },
      ...(turn.tool === undefined ? [] : [{ type: "tool", id: "call_fixture", name: "shell", state: { status: turn.tool,
        input: { command: "PRIVATE-TOOL-CANARY" }, metadata: {} }, time: { created: epoch + 1500 } }])],
    finish: turn.finish ?? "stop" }, epoch + 1000);
  if (turn.idle !== false) message("msg_fixture_idle", "idle", { time: { created: epoch + 3100 }, outcome: turn.outcome ?? "succeeded" }, epoch + 3100);
  const receipts = join(base, "receipts"), issueId = "fixture-42", brief = "b".repeat(64), repo = "example/project";
  const key = createHash("sha256").update(issueId + "\0" + repo + "\0" + brief).digest("hex");
  const record = join(receipts, key, "record"); await mkdir(record, { recursive: true, mode: 0o700 });
  await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + key,
    issue: { repo, number: 42 }, parentRunId: null, source: "opencode", provider, model: qualified, effort: "provider_default",
    state: "dispatched", observedAt: new Date(epoch).toISOString(),
    location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
  await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo, BriefDigest: brief,
    Route: { transport: "opencode", provider, model: qualified, effort: "provider_default" }, NativeSessionID: rootID }), { mode: 0o600 });
  const collect = () => collectIssueAgentTree({ home: base, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: receipts } });
  const close = async () => { db.close(); await rm(base, { recursive: true, force: true }); };
  return { base, path, collect, close };
}
const agent = (snapshot: Awaited<ReturnType<typeof collectIssueAgentTree>>) => snapshot.issues[0]?.dispatches[0]?.agents[0];

it("OpenCode 2.x run database serves the session's activity, route and native end on the issue page", async () => {
  const f = await fixture();
  try {
    assert.ok(f.path.endsWith("/" + OPENCODE_RUN_DB_PREFIX + rootID + ".db"));
    const snapshot = await f.collect(); assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    assert.equal(snapshot.issues[0]?.complete, true);
    const a = agent(snapshot)!;
    assert.equal(a.harness.value, "opencode"); assert.equal(a.model.value, qualified);
    assert.equal(a.observation.route.observed.provider.value, provider);
    assert.equal(a.observation.route.observed.model.value, qualified);
    assert.equal(a.observation.route.observed.effort.value, null);
    assert.equal(a.terminalOutcome.value, "succeeded"); assert.equal(a.endedAt, new Date(epoch + 3100).toISOString());
    assert.equal(a.activity?.steps[0]?.source, "opencode-transcript");
    assert.equal(a.activity?.steps[0]?.summary, "The work is complete.");
    assert.equal(a.activity?.steps.length, 1);
    const wire = JSON.stringify(snapshot);
    for (const privateValue of [rootID, f.base, "PRIVATE-", "msg_fixture"]) assert.ok(!wire.includes(privateValue));
  } finally { await f.close(); }
});
it("OpenCode 2.x turns without a succeeded native end, a final answer or settled tools never become Done", async () => {
  for (const turn of [{ idle: false }, { outcome: "failed" }, { outcome: "interrupted" }, { finish: "tool-calls" },
    { text: "  " }, { tool: "running" }] satisfies Turn[]) {
    const f = await fixture(turn);
    try {
      const a = agent(await f.collect());
      assert.notEqual(a?.terminalOutcome.value, "succeeded", JSON.stringify(turn));
    } finally { await f.close(); }
  }
  const f = await fixture({ variant: "high" });
  try { assert.equal(agent(await f.collect())?.observation.route.observed.effort.value, "high"); }
  finally { await f.close(); }
});
it("OpenCode 2.x run databases join the backfill runs with their session usage, never the legacy store's rows", async () => {
  const f = await fixture();
  try {
    const result = await backfillFromDisk({ opencodeData: dirname(f.path) }, { limit: 5 });
    const runs = result.runs.filter(run => run.source === "opencode");
    assert.equal(runs.length, 1); assert.equal(runs[0]!.id, rootID); assert.equal(runs[0]!.origin, f.path);
    assert.equal(runs[0]!.identity.model, model); assert.equal(runs[0]!.identity.provider, provider);
    assert.equal(runs[0]!.usage.inputTokens, 1200); assert.equal(runs[0]!.usage.outputTokens, 300);
  } finally { await f.close(); }
});
