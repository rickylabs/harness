/** AGY 1.2.14's bounded, read-only native conversation store. Raw protobuf stays private. */
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { MAX_AGENT_ACTIVITY_STEPS } from "@rickylabs/harness-contracts";
import { nativeMessageActivity } from "../native-activity.js";
import type { RunRecord } from "../model.js";
import { agyWorkspaceRoot, type AgyConversationRead, type AgyStepFact } from "./agy-activity.js";
import { AGY_CANCELLED_STATUSES, AGY_DONE_STATUS, AGY_ERROR_STATUS, AGY_PENDING_STATUSES, AGY_STEP_STATUSES,
  AGY_STEP_TYPE } from "./agy-status.js";

const ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const MAX_SESSIONS = 20, MAX_STEPS = 4096, MAX_BLOB = 1_048_576;
/** Workspace metadata above this is never materialized; it only relativizes paths, so it is optional. */
export const MAX_WORKSPACE_URIS_BYTES = 4096;
type Field = number | Uint8Array;
type Fields = ReadonlyMap<number, Field>;
/** Wire definitions measured in installed 1.2.14: gemini_coder.Step and CortexStepPlannerResponse.
 * Step: type=1,status=4,metadata=5,planner_response=20. Response: response=1,
 * modified_response=8; thinking=3/raw_thinking=16 are never selected.
 * sqlite_store.go:781 decomposeStep marshals the whole Step into step_payload.
 */
function protobuf(bytes: Uint8Array): Fields {
  if (bytes.length > MAX_BLOB) throw new Error();
  let cursor = 0;
  const fields = new Map<number, Field>();
  const repeated = new Set<number>();
  const integer = (): number => {
    let value = 0n, shift = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = bytes[cursor++];
      if (byte === undefined || (i === 9 && byte > 1)) throw new Error();
      value |= BigInt(byte & 127) << shift;
      if ((byte & 128) === 0) {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
        return Number(value);
      }
      shift += 7n;
    }
    throw new Error();
  };
  for (let count = 0; cursor < bytes.length; count++) {
    if (count >= 4096) throw new Error();
    const tag = integer(), number = Math.floor(tag / 8), wire = tag % 8;
    if (number === 0 || number > 536_870_911) throw new Error();
    let value: Field;
    if (wire === 0) value = integer();
    else if (wire === 2) {
      const length = integer();
      if (cursor + length > bytes.length) throw new Error();
      value = bytes.subarray(cursor, cursor + length); cursor += length;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      if (cursor + length > bytes.length) throw new Error();
      cursor += length; value = NaN;
    } else throw new Error();
    // Repeated vendor fields can be skipped, but a repeated scalar we consume
    // must not silently change native type/status/text/time authority.
    if (repeated.has(number)) continue;
    if (fields.has(number)) { fields.set(number, NaN); repeated.add(number); }
    else fields.set(number, value);
  }
  return fields;
}
const numeric = (fields: Fields, key: number): number | null => {
  const value = fields.get(key);
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error();
  return value;
};
const nested = (fields: Fields, key: number): Fields | null => {
  const value = fields.get(key);
  if (value === undefined) return null;
  if (!(value instanceof Uint8Array)) throw new Error();
  return protobuf(value);
};
const text = (fields: Fields, key: number): string | null => {
  const value = fields.get(key);
  if (value === undefined) return null;
  if (!(value instanceof Uint8Array)) throw new Error();
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
};
function timestamp(fields: Fields | null, key: number, nowMs: number): string | null {
  const value = fields === null ? null : nested(fields, key);
  if (value === null) return null;
  const seconds = numeric(value, 1) ?? 0, nanos = numeric(value, 2) ?? 0;
  if (value.has(2) && numeric(value, 2) === null) return null;
  const ms = seconds * 1000 + Math.floor(nanos / 1_000_000);
  if (seconds <= 0 || nanos < 0 || nanos > 999_999_999 || !Number.isSafeInteger(ms) || ms > nowMs ||
      !Number.isFinite(new Date(ms).getTime())) throw new Error();
  return new Date(ms).toISOString();
}
const blob = (value: unknown): Uint8Array | null => value instanceof Uint8Array ? value : null;
type Row = Readonly<Record<string, unknown>>;
export interface AGYScan {
  readonly runs: readonly RunRecord[];
  readonly bytesRead: number;
  readonly reason: "scan_limit" | "source_unavailable" | null;
  readonly files: readonly string[];
  /** Per accepted conversation, the authority facts the descriptor phase joins against. */
  readonly conversations: readonly AgyConversationRead[];
}

/** Pure mapping, intentionally drops titles, prompts, thinking, tool output, IDs from display text. */
export function agyConversation(summary: Row, rows: readonly Row[], origin: string, nowMs: number,
  facts?: AgyStepFact[]): RunRecord | null {
  try {
    const id = summary.conversation_id, parent = summary.parent_conversation_id;
    if (typeof id !== "string" || !ID.test(id) || (parent !== null && parent !== "" &&
        (typeof parent !== "string" || !ID.test(parent) || parent === id))) return null;
    if (!Number.isSafeInteger(summary.step_count) || summary.step_count !== rows.length || rows.length === 0 ||
        rows.length > MAX_STEPS || !(blob(summary.raw_summary))) return null;
    const native = protobuf(blob(summary.raw_summary)!);
    if (typeof summary.trajectory_id !== "string" || !ID.test(summary.trajectory_id) ||
        text(native, 4) !== summary.trajectory_id || numeric(native, 2) !== summary.step_count) return null;
    // Native summary points to the trajectory. The SQL user-index column can
    // lag by one in 1.2.14; terminal authority comes from protobuf + actual Step.
    const nativeUserIndex = numeric(native, 16) ?? 0;
    const startedAt = timestamp(native, 7, nowMs);
    if (startedAt === null) return null;
    const steps: NonNullable<RunRecord["activitySteps"]>[number][] = [];
    const observed: AgyStepFact[] = [];
    let updatedAt = startedAt, latestUser = -1, pending = false;
    let final: { at: string; status: number; type: number; nonempty: boolean; stop: number | null; error: boolean } | null = null;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      if (row.idx !== index || row.step_format !== 0 || !Number.isSafeInteger(row.step_type) ||
          !AGY_STEP_STATUSES.includes(row.status as number)) return null;
      const payload = blob(row.step_payload), metadata = blob(row.metadata);
      if (payload === null || metadata === null) return null;
      const frame = protobuf(payload), header = protobuf(metadata);
      if (numeric(frame, 1) !== row.step_type || numeric(frame, 4) !== row.status || row.step_type === AGY_STEP_TYPE.planner && !frame.has(5) ||
          frame.has(5) && (!(frame.get(5) instanceof Uint8Array) ||
            !Buffer.from(frame.get(5) as Uint8Array).equals(metadata))) return null;
      const at = timestamp(header, 1, nowMs), completed = timestamp(header, 8, nowMs);
      if (at === null || at < startedAt || completed !== null && completed < at) return null;
      const recent = timestamp(header, 22, nowMs) ?? completed ?? at;
      if (recent > updatedAt) updatedAt = recent;
      observed.push({ idx: index, type: row.step_type as number, status: row.status as number, at });
      if (row.step_type === AGY_STEP_TYPE.user) { latestUser = index; pending = false; final = null; }
      if (latestUser >= 0 && AGY_PENDING_STATUSES.includes(row.status as number)) pending = true;
      const response = row.step_type === AGY_STEP_TYPE.planner ? nested(frame, 20) : null;
      let responseText: string | null = null, stop: number | null = null;
      if (response !== null) {
        responseText = text(response, 8) ?? text(response, 1);
        stop = numeric(response, 12);
        const activity = nativeMessageActivity("agy-transcript", id, index, at, responseText);
        if (activity !== null) steps.push(activity);
      }
      if (latestUser >= 0) final = completed === null ? null : { at: completed, status: row.status as number,
        type: row.step_type as number, nonempty: responseText !== null && responseText.trim() !== "",
        stop, error: blob(row.error_details)?.length !== undefined && blob(row.error_details)!.length > 0 };
    }
    if (nativeUserIndex !== latestUser) return null;
    const modifiedAt = timestamp(native, 3, nowMs);
    if (modifiedAt === null || modifiedAt < updatedAt) return null;
    const state = numeric(native, 5) ?? 0;
    const idle = state === 1 && (numeric(native, 21) ?? 0) === 0 && (numeric(native, 18) ?? 0) === 0 &&
      summary.not_fully_idle === 0 && summary.killed === 0;
    const interrupted = (numeric(native, 25) ?? 0) !== 0;
    const killed = (numeric(native, 23) ?? 0) !== 0 || summary.killed !== 0;
    // The summary can publish a resumed turn before its trajectory is updated.
    // Current native activity invalidates every prior end, including error/cancel.
    const active = [2, 4].includes(state) || (numeric(native, 21) ?? 0) !== 0 ||
      (numeric(native, 18) ?? 0) !== 0 || summary.not_fully_idle !== 0;
    let outcome: RunRecord["outcome"] = active ? "running" : "unknown";
    let terminalAt: string | undefined, terminalCause: RunRecord["terminalCause"];
    if (!active && !pending && final !== null && final.at >= updatedAt) {
      if (AGY_CANCELLED_STATUSES.includes(final.status) || interrupted || final.stop === 16) { outcome = "failed"; terminalCause = "cancelled"; terminalAt = final.at; }
      else if (final.status === AGY_ERROR_STATUS || final.error || [13, 17, 18, 19, 20].includes(final.stop ?? 0)) { outcome = "failed"; terminalCause = "error"; terminalAt = final.at; }
      // STOP_PATTERN is the native explicit stop enum; unknown, function-call,
      // length, filtered, partial or empty responses never become success.
      else if (idle && !killed && final.type === AGY_STEP_TYPE.planner && final.status === AGY_DONE_STATUS && final.nonempty && final.stop === 2) {
        outcome = "complete"; terminalAt = final.at;
      }
    }
    facts?.push(...observed);
    return { id, source: "agy", parentId: typeof parent === "string" && parent !== "" ? parent : null,
      startedAt, updatedAt, branch: null, identity: { provider: null, model: null, effort: null, profile: null },
      usage: {}, quota: [], linkedIssues: [], origin, outcome,
      activitySteps: steps.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, MAX_AGENT_ACTIVITY_STEPS),
      ...(terminalAt === undefined ? {} : { terminalAt }), ...(terminalCause === undefined ? {} : { terminalCause }) };
  } catch { return null; }
}

/** Each bound store is an independent read. SQLite always observes WAL, never checkpoints it. */
export async function scanAGYIssue(root: string, matches: (id: string) => boolean,
  limit: number, maxBytes: number, nowMs: number): Promise<AGYScan> {
  let bytesRead = 0;
  const files: string[] = [];
  const fail = (reason: AGYScan["reason"]): AGYScan => ({ runs: [], bytesRead, reason, files, conversations: [] });
  try {
    for (const path of [root, join(root, ".."), join(root, "../.."), join(root, "conversations")].map(path => join(path))) {
      const s = await lstat(path);
      if (!s.isDirectory() || s.uid !== process.getuid?.() || path !== join(root, "conversations") && (s.mode & 0o7777) !== 0o700 ||
          await realpath(path) !== path) return fail("source_unavailable");
    }
    const { DatabaseSync } = await import("node:sqlite");
    const open = async (path: string) => {
      const before = await lstat(path);
      if (!before.isFile() || before.uid !== process.getuid?.() || await realpath(path) !== path) throw new Error();
      const db = new DatabaseSync(path, { readOnly: true, timeout: 200 });
      const after = await lstat(path);
      if (before.dev !== after.dev || before.ino !== after.ino) { db.close(); throw new Error(); }
      try { db.exec("PRAGMA query_only=ON; BEGIN"); }
      catch (error) { db.close(); throw error; }
      files.push(path, path + "-wal"); return db;
    };
    files.push(root, join(root, "conversations"));
    const summaries = await open(join(root, "conversation_summaries.db"));
    let candidates: Row[], summaryQuery: string;
    try {
      // Older stores have no workspace column; paths then stay unrelativized, never the scan unavailable.
      const workspace = summaries.prepare("SELECT 1 FROM pragma_table_info('conversation_summaries') WHERE name='workspace_uris'").get()
        ? `length(workspace_uris) AS workspace_bytes,
      CASE WHEN length(workspace_uris) <= ${MAX_WORKSPACE_URIS_BYTES} THEN workspace_uris ELSE NULL END AS workspace_uris`
        : "NULL AS workspace_bytes,NULL AS workspace_uris";
      summaryQuery = `SELECT conversation_id,parent_conversation_id,step_count,
      last_user_input_step_index,not_fully_idle,killed,length(raw_summary) AS summary_bytes,
      CASE WHEN length(raw_summary) <= 1048576 THEN raw_summary ELSE NULL END AS raw_summary,${workspace}
      FROM conversation_summaries ORDER BY conversation_id LIMIT ?`;
      candidates = summaries.prepare(summaryQuery).all(MAX_SESSIONS + 1);
    } finally { summaries.close(); }
    if (candidates.length > MAX_SESSIONS) return fail("scan_limit");
    if (candidates.some(row => typeof row.summary_bytes !== "number" || row.summary_bytes > MAX_BLOB)) return fail("scan_limit");
    const selected = new Set(candidates.filter(row => typeof row.conversation_id === "string" &&
      matches(row.conversation_id) && (row.parent_conversation_id === "" || row.parent_conversation_id === null)).map(row => row.conversation_id));
    if (selected.size !== 1) return fail("source_unavailable");
    for (let changed = true; changed;) {
      changed = false;
      for (const row of candidates) if (selected.has(row.parent_conversation_id) && !selected.has(row.conversation_id)) {
        selected.add(row.conversation_id); changed = true;
      }
    }
    if (selected.size > limit) return fail("scan_limit");
    const runs: RunRecord[] = [], conversations: AgyConversationRead[] = [];
    for (const summary of candidates.filter(row => selected.has(row.conversation_id))) {
      if (typeof summary.conversation_id !== "string" || !ID.test(summary.conversation_id)) return fail("source_unavailable");
      if (!Number.isSafeInteger(summary.step_count) || (summary.step_count as number) > MAX_STEPS) return fail("scan_limit");
      const path = join(root, "conversations", summary.conversation_id + ".db");
      const db = await open(path);
      try {
        const identities = db.prepare("SELECT trajectory_id,cascade_id FROM trajectory_meta LIMIT 2").all();
        if (identities.length !== 1 || identities[0]!.cascade_id !== summary.conversation_id ||
            typeof identities[0]!.trajectory_id !== "string" || !ID.test(identities[0]!.trajectory_id)) return fail("source_unavailable");
        const sizes = db.prepare(`SELECT count(*) AS count,coalesce(sum(length(metadata)+length(step_payload)+coalesce(length(error_details),0)),0) AS bytes,
          coalesce(max(length(metadata)),0) AS metadata_max,coalesce(max(length(step_payload)),0) AS payload_max,
          coalesce(max(length(error_details)),0) AS error_max
          FROM (SELECT metadata,step_payload,error_details FROM steps ORDER BY idx LIMIT ?)`).get(MAX_STEPS + 1);
        const summarySize = blob(summary.raw_summary)?.length;
        // Only what was materialized is counted: an oversized value was never read (and is NULL).
        const workspaceBytes = typeof summary.workspace_uris === "string" ? Buffer.byteLength(summary.workspace_uris) : 0;
        if (!sizes || typeof sizes.bytes !== "number" || !Number.isSafeInteger(sizes.bytes) || sizes.bytes < 0 || summarySize === undefined) return fail("source_unavailable");
        if (sizes.count !== summary.step_count || (sizes.count as number) > MAX_STEPS ||
            (sizes.metadata_max as number) > MAX_BLOB || (sizes.payload_max as number) > MAX_BLOB || (sizes.error_max as number) > MAX_BLOB ||
            summarySize > MAX_BLOB || bytesRead + sizes.bytes + summarySize + workspaceBytes > maxBytes) return fail("scan_limit");
        const rows = db.prepare("SELECT idx,step_type,status,metadata,error_details,step_payload,step_format FROM steps ORDER BY idx LIMIT ?").all(MAX_STEPS + 1);
        bytesRead += sizes.bytes + summarySize + workspaceBytes;
        const facts: AgyStepFact[] = [];
        const run = agyConversation({ ...summary, trajectory_id: identities[0]!.trajectory_id }, rows, path, nowMs, facts);
        if (run === null) return fail("source_unavailable");
        runs.push(run);
        conversations.push({ run, storeRoot: root, conversationId: summary.conversation_id, stepCount: rows.length,
          facts, workspaceRoot: agyWorkspaceRoot(summary.workspace_uris) });
      } finally { db.close(); }
    }
    // The summary and trajectory are separate databases. Reopen the summary
    // after reading their snapshots; a concurrent resume/update must wait for
    // a coherent later scan rather than retain an old success.
    const verify = await open(join(root, "conversation_summaries.db"));
    try {
      const current = verify.prepare(summaryQuery).all(MAX_SESSIONS + 1);
      if (current.length !== candidates.length || candidates.some((row, index) => {
        const other = current[index]!;
        return Object.keys(row).some(key => key === "raw_summary"
          ? !(blob(other[key])) || !Buffer.from(blob(row[key])!).equals(blob(other[key])!)
          : row[key] !== other[key]);
      })) return fail("source_unavailable");
    } finally { verify.close(); }
    return { runs, bytesRead, reason: null, files, conversations };
  } catch { return fail("source_unavailable"); }
}
