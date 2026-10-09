/** A synthetic OpenCode SQLite store bound to one Orchid issue dispatch. Test support only. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectIssueAgentTree } from "../issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "../operator-environment.js";

export const rootID = "ses_fixture_root", epoch = Date.parse("2026-01-01T00:00:00.000Z");
export const provider = "fixture-provider", model = "nested/model:1", qualified = provider + "/" + model;
const now = new Date(epoch + 30_000).toISOString();
export type FixtureOptions = { finish?: string; completed?: boolean; text?: string; error?: string; tool?: boolean;
  userSummary?: unknown; assistantSummary?: unknown; version?: string; tokens?: unknown };
export async function fixture(o: FixtureOptions = {}) {
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
  const options = { home: base, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: receipts } };
  const collect = () => collectIssueAgentTree(options);
  const close = async () => { db.close(); await rm(base, { recursive: true, force: true }); };
  return { base, path, store, db, message, part, issue, record, options, collect, close };
}
