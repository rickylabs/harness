// A minimal synthetic Orchid-bound agy store for the issue-agents parity run: one root conversation
// (user turn, a planner step issuing one command, its result, a closing response), its transcript and
// the dispatch receipts. Built here, not imported from a package test, so the parity test stays the
// only cross-package test. No native data; argument values are private canaries.
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ROOT_ID = "00000000-0000-4000-8000-0000000000aa";
const TRAJECTORY_ID = "10000000-0000-4000-8000-0000000000aa";
const varint = n => { const out = []; do { const b = n % 128; n = Math.floor(n / 128); out.push(b | (n > 0 ? 128 : 0)); } while (n > 0); return Buffer.from(out); };
const int = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);
const len = (field, value) => { const b = Buffer.from(value); return Buffer.concat([varint(field * 8 + 2), varint(b.length), b]); };

/** Build the store, transcript and receipts under a fresh temp directory; returns the paths to use. */
export async function agyParityStore() {
  const base = await mkdtemp(join(tmpdir(), "agy-parity-"));
  const start = Math.floor(Date.now() / 1000) - 600, ts = (field, offset) => len(field, int(1, start + offset));
  const repo = "example/project", brief = "a".repeat(64), issueId = "fixture-42";
  const reservation = createHash("sha256").update(issueId + "\0" + repo + "\0" + brief).digest("hex");
  const parent = join(base, "work", ".divybot-native"), store = join(parent, reservation, "agy");
  await mkdir(join(store, "conversations"), { recursive: true, mode: 0o700 });
  for (const path of [parent, join(parent, reservation), store]) await chmod(path, 0o700);
  const meta = offset => Buffer.concat([ts(1, offset), ts(8, offset)]);
  const planner = (idx, message) => ({ idx, type: 15, metadata: meta(idx + 1), payload: Buffer.concat([int(1, 15), int(4, 3),
    len(5, meta(idx + 1)), len(20, Buffer.concat([len(1, message), int(12, 2)]))]) });
  const rows = [{ idx: 0, type: 14, metadata: meta(1), payload: Buffer.concat([int(1, 14), int(4, 3), len(19, len(1, "PRIVATE-USER-CANARY"))]) },
    planner(1, ""), { idx: 2, type: 132, metadata: meta(3), payload: Buffer.concat([int(1, 132), int(4, 3)]) }, planner(3, "The parity work is done.")];
  const summaries = new DatabaseSync(join(store, "conversation_summaries.db"));
  summaries.exec(`PRAGMA journal_mode=WAL; CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY, parent_conversation_id TEXT,
    step_count INTEGER, last_user_input_step_index INTEGER, not_fully_idle INTEGER, killed INTEGER, raw_summary BLOB);`);
  summaries.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?)").run(ROOT_ID, "", rows.length, 0, 0, 0,
    Buffer.concat([len(4, TRAJECTORY_ID), int(2, rows.length), int(5, 1), int(16, 0), ts(7, 0), ts(3, rows.length + 2)]));
  summaries.close();
  const trajectory = new DatabaseSync(join(store, "conversations", ROOT_ID + ".db"));
  trajectory.exec(`PRAGMA journal_mode=WAL; CREATE TABLE trajectory_meta(trajectory_id TEXT PRIMARY KEY, cascade_id TEXT);
    CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB, error_details BLOB, step_payload BLOB, step_format INTEGER);`);
  trajectory.prepare("INSERT INTO trajectory_meta VALUES(?,?)").run(TRAJECTORY_ID, ROOT_ID);
  for (const r of rows) trajectory.prepare("INSERT INTO steps VALUES(?,?,?,?,?,?,?)").run(r.idx, r.type, 3, r.metadata, null, r.payload, 0);
  trajectory.close();
  const logs = join(store, "brain", ROOT_ID, ".system_generated", "logs");
  await mkdir(logs, { recursive: true });
  const line = (idx, calls) => JSON.stringify({ step_index: idx, type: "PLANNER_RESPONSE", status: "DONE", tool_calls: calls });
  await writeFile(join(logs, "transcript.jsonl"), [line(1, [{ name: "run_command", args: { CommandLine: "git status PRIVATE-ARG-CANARY" } }]),
    line(3, [])].map(l => l + "\n").join(""));
  const record = join(base, "receipts", reservation, "record");
  await mkdir(record, { recursive: true, mode: 0o700 });
  await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + reservation, issue: { repo, number: 42 },
    parentRunId: null, source: "agy", provider: "fixture-provider", model: "fixture-model", effort: "high", state: "dispatched",
    observedAt: new Date(start * 1000).toISOString(), location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
  await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo, BriefDigest: brief,
    Route: { transport: "agy", provider: "fixture-provider", model: "fixture-model", effort: "high" },
    NativeSessionID: ROOT_ID, NativeStore: { source: "agy", directory: store } }), { mode: 0o600 });
  return { base, receipts: join(base, "receipts"), issue: `${repo}#42` };
}
