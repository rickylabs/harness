/** Synthetic agy stores for tests: SQLite/protobuf trajectories, transcripts and Orchid receipts. No real data. */
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const rootID = "00000000-0000-4000-8000-000000000001", childID = "00000000-0000-4000-8000-000000000002";
export const trajectoryID = "10000000-0000-4000-8000-000000000001";
export const seconds = 1_767_225_600;
export const captured = (seconds + 30) * 1000;
export const encode = (n: number): Buffer => {
  const bytes: number[] = [];
  do { const byte = n % 128; n = Math.floor(n / 128); bytes.push(byte | (n > 0 ? 128 : 0)); } while (n > 0);
  return Buffer.from(bytes);
};
export const integer = (field: number, value: number) => Buffer.concat([encode(field * 8), encode(value)]);
export const bytes = (field: number, value: string | Buffer) => {
  const b = Buffer.from(value); return Buffer.concat([encode(field * 8 + 2), encode(b.length), b]);
};
export const time = (field: number, offset: number) => bytes(field, integer(1, seconds + offset));
export type Options = { id?: string; parent?: string; active?: boolean; stop?: number; message?: string; status?: number;
  interrupted?: boolean; killed?: boolean; childActive?: boolean; staleSummary?: boolean; userIndex?: number;
  summaryState?: number; summaryRunning?: boolean; summaryNotIdle?: boolean };
type Row = { idx: number; step_type: number; status: number; step_format: number; metadata: Buffer; error_details: Buffer | null; step_payload: Buffer };
export interface Conversation { rows: Row[]; summary: Record<string, unknown> & { conversation_id: string; trajectory_id: string;
  raw_summary: Buffer; step_count: number; parent_conversation_id: string; last_user_input_step_index: number;
  not_fully_idle: number; killed: number } }

/** The original two-step conversation: one user turn and one typed response. */
export function fixture(o: Options = {}): Conversation {
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

export type StepSpec =
  | { kind: "user" }
  | { kind: "planner"; message?: string; status?: number; stop?: number; pad?: number }
  | { kind: "result"; status?: number; pad?: number }
  | { kind: "system" } | { kind: "checkpoint" };
export interface ConversationSpec {
  id?: string; parent?: string; steps: readonly StepSpec[];
  /** Native summary state (1 idle, 2 running); `notIdle` and `running` mirror the resume flags. */
  summaryState?: number; notIdle?: boolean; running?: boolean;
}
const PENDING = [1, 2, 8, 9, 11];
const TYPES = { user: 14, planner: 15, result: 132, system: 101, checkpoint: 23 } as const;

/** Any step sequence: step i is created at offset i+1 and, unless in progress, completed then too. */
export function conversation(spec: ConversationSpec): Conversation {
  const id = spec.id ?? rootID;
  const rows: Row[] = spec.steps.map((step, idx) => {
    const type = TYPES[step.kind];
    const status = step.kind === "planner" || step.kind === "result" ? step.status ?? 3 : 3;
    const metadata = Buffer.concat([time(1, idx + 1), ...(PENDING.includes(status) ? [] : [time(8, idx + 1)])]);
    const pad = "pad" in step && step.pad ? [bytes(31, Buffer.alloc(step.pad, 0x61))] : [];
    const body = step.kind === "user" ? [bytes(19, bytes(1, "PRIVATE-USER-CANARY"))]
      : step.kind === "planner" ? [bytes(5, metadata), bytes(20, Buffer.concat([bytes(1, step.message ?? ""),
        integer(12, step.stop ?? 2)]))] : [];
    return { idx, step_type: type, status, step_format: 0, metadata, error_details: null,
      step_payload: Buffer.concat([integer(1, type), integer(4, status), ...body, ...pad]) };
  });
  const userIndex = Math.max(-1, ...rows.filter(r => r.step_type === 14).map(r => r.idx));
  const state = spec.summaryState ?? 1;
  return { rows, summary: { conversation_id: id, parent_conversation_id: spec.parent ?? "", step_count: rows.length,
    last_user_input_step_index: userIndex, not_fully_idle: spec.notIdle ? 1 : 0, killed: 0, trajectory_id: trajectoryID,
    raw_summary: Buffer.concat([bytes(4, trajectoryID), integer(2, rows.length), integer(5, state), integer(16, userIndex),
      time(7, 0), time(3, rows.length + 2), integer(18, 0), integer(21, spec.running ? 1 : 0), integer(23, 0), integer(25, 0)]) } };
}

/** Transcript lines in the measured 1.3.2 shape; argument values are private canaries. */
export const transcript = {
  planner: (stepIndex: number, calls: readonly { name: string; args?: Record<string, unknown> }[] = [], extra: Record<string, unknown> = {}) =>
    JSON.stringify({ step_index: stepIndex, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-01-01T00:00:00Z",
      tool_calls: calls.map(call => ({ name: call.name, args: call.args ?? {} })), ...extra }),
  step: (stepIndex: number, type: string, status = "DONE") => JSON.stringify({ step_index: stepIndex, source: "MODEL", type, status,
    created_at: "2026-01-01T00:00:00Z", content: "PRIVATE-OUTPUT-CANARY" }),
  lines: (...lines: string[]) => lines.map(line => line + "\n").join(""),
};

/** A private `.divybot-native/<key>/agy` store with WAL databases, as Orchid binds it. */
export async function sqliteFixture(key = "b".repeat(64), options: { workspaceColumn?: boolean } = {}) {
  const base = await mkdtemp(join(tmpdir(), "agy-native-store-"));
  const parent = join(base, ".divybot-native"), reservation = join(parent, key), root = join(reservation, "agy");
  await mkdir(join(root, "conversations"), { recursive: true, mode: 0o700 });
  for (const path of [parent, reservation, root]) await chmod(path, 0o700);
  const summaryDB = new DatabaseSync(join(root, "conversation_summaries.db"));
  summaryDB.exec(`PRAGMA journal_mode=WAL; CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY,
    parent_conversation_id TEXT,step_count INTEGER,last_user_input_step_index INTEGER,not_fully_idle INTEGER,killed INTEGER,raw_summary BLOB,
    title TEXT,preview TEXT${options.workspaceColumn ? ",workspace_uris TEXT" : ""});`);
  const dbs: DatabaseSync[] = [];
  const insert = (f: Conversation, workspace?: string | null) => {
    const s = f.summary;
    summaryDB.prepare(`INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?,?,?${options.workspaceColumn ? ",?" : ""})`).run(s.conversation_id,
      s.parent_conversation_id, s.step_count, s.last_user_input_step_index, s.not_fully_idle, s.killed, s.raw_summary,
      "PRIVATE-TITLE-CANARY", "PRIVATE-PREVIEW-CANARY", ...(options.workspaceColumn ? [workspace ?? null] : []));
    const path = join(root, "conversations", s.conversation_id + ".db"), db = new DatabaseSync(path);
    db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE trajectory_meta(trajectory_id TEXT PRIMARY KEY,cascade_id TEXT);
      CREATE TABLE steps(idx INTEGER PRIMARY KEY,step_type INTEGER,status INTEGER,metadata BLOB,error_details BLOB,step_payload BLOB,step_format INTEGER);`);
    db.prepare("INSERT INTO trajectory_meta VALUES(?,?)").run(s.trajectory_id, s.conversation_id);
    for (const r of f.rows) db.prepare("INSERT INTO steps VALUES(?,?,?,?,?,?,?)").run(r.idx, r.step_type, r.status, r.metadata, r.error_details, r.step_payload, r.step_format);
    dbs.push(db);
    return { path, db };
  };
  const native = insert(fixture());
  return { base, root, summaryDB, native,
    add: (o: Options) => insert(fixture(o)),
    addConversation: (spec: ConversationSpec, workspace?: string | null) => insert(conversation(spec), workspace),
    /** Replace the default root conversation (inserted first) by a spec. */
    replaceRoot: (spec: ConversationSpec, workspace?: string | null) => {
      dbs.shift()!.close();
      for (const suffix of ["", "-wal", "-shm"]) rmSync(native.path + suffix, { force: true });
      summaryDB.prepare("DELETE FROM conversation_summaries WHERE conversation_id=?").run(rootID);
      return insert(conversation({ ...spec, id: rootID }), workspace);
    },
    writeTranscript: async (id: string, text: string) => {
      const logs = join(root, "brain", id, ".system_generated", "logs");
      await mkdir(logs, { recursive: true }); await writeFile(join(logs, "transcript.jsonl"), text);
      return join(logs, "transcript.jsonl");
    },
    close: async () => { for (const db of dbs) db.close(); summaryDB.close(); await rm(base, { recursive: true, force: true }); } };
}

/** An Orchid dispatch and binding receipt for issue `number`, bound to `root` when given. */
export async function bindAgyIssue(receipts: string, o: { number: number; root?: string; observedAt?: string;
  repo?: string; brief?: string; nativeID?: string }) {
  const repo = o.repo ?? "example/project", brief = o.brief ?? "b".repeat(64), id = `fixture-${o.number}`;
  const reservation = createHash("sha256").update(id + "\0" + repo + "\0" + brief).digest("hex");
  const record = join(receipts, reservation, "record");
  await mkdir(record, { recursive: true, mode: 0o700 });
  await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + reservation,
    issue: { repo, number: o.number }, parentRunId: null, source: "agy", provider: "fixture-provider", model: "fixture-model", effort: "high",
    state: "dispatched", observedAt: o.observedAt ?? new Date(seconds * 1000).toISOString(),
    location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
  await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: id, Repo: repo, BriefDigest: brief,
    Route: { transport: "agy", provider: "fixture-provider", model: "fixture-model", effort: "high" },
    ...(o.root ? { NativeSessionID: o.nativeID ?? rootID, NativeStore: { source: "agy", directory: o.root } } : {}) }), { mode: 0o600 });
  return reservation;
}
/** The store key Orchid derives for a fixture issue, so a store can be created before its receipt. */
export const agyReservation = (number: number, repo = "example/project", brief = "b".repeat(64)) =>
  createHash("sha256").update(`fixture-${number}` + "\0" + repo + "\0" + brief).digest("hex");
