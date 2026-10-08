/** OpenCode legacy message/part projection for the native versions in OPENCODE_SUPPORTED_VERSIONS.
 * Only an exact private root is read. */
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { nativeMessageActivity, recentActivity } from "../native-activity.js";
import type { RunRecord } from "../model.js";

const MAX_ROWS = 4096, MAX_ROW_BYTES = 1_048_576, MAX_ISSUE_BYTES = 8 * MAX_ROW_BYTES;
const sessionID = (v: unknown): v is string => typeof v === "string" && /^ses_[A-Za-z0-9_-]{1,252}$/.test(v);
const nativeID = (v: unknown, prefix: string): v is string => typeof v === "string" &&
  v.startsWith(prefix) && /^[A-Za-z0-9_-]{1,256}$/.test(v);
const providerID = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const modelID = (v: unknown): v is string => typeof v === "string" && /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v);
type Row = Readonly<Record<string, unknown>>;
/** Each entry is a native version whose message/part rows were verified against this projection; any other version reads as unavailable. */
export const OPENCODE_SUPPORTED_VERSIONS: ReadonlySet<string> = new Set(["1.18.34", "1.18.35"]);
const object = (v: unknown): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw Error();
  return v as Record<string, unknown>;
};
/** JSON.parse validates grammar; the bounded token walk rejects duplicate keys before projection.
 * It never evaluates code. Decode blob bytes strictly, not SQLite's replacement-character text.
 */
function nativeJSON(value: unknown): Record<string, unknown> {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_ROW_BYTES) throw Error();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  const parsed: unknown = JSON.parse(text);
  const stack: (Set<string> | null)[] = [];
  let keys = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[") { stack.push(c === "{" ? new Set() : null); if (stack.length > 64) throw Error(); }
    else if (c === "}" || c === "]") stack.pop();
    else if (c === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      let next = i + 1; while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === ":") {
        const key = JSON.parse(text.slice(start, i + 1)) as string, seen = stack.at(-1);
        if (!seen || seen.has(key) || ++keys > 4096) throw Error();
        seen.add(key);
      }
    }
  }
  return object(parsed);
}
function millis(value: unknown, start: number, now: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < start || (value as number) > now ||
      !Number.isFinite(new Date(value as number).getTime())) throw Error();
  return value as number;
}
const knownErrors = new Set(["ProviderAuthError", "UnknownError", "MessageOutputLengthError", "MessageAbortedError",
  "StructuredOutputError", "ContextOverflowError", "ContentFilterError", "APIError"]);
const knownParts = new Set(["text", "reasoning", "tool", "step-start", "step-finish", "patch", "snapshot", "file",
  "agent", "retry", "compaction", "subtask"]);
const boolean = (v: unknown): boolean => { if (v !== undefined && typeof v !== "boolean") throw Error(); return v === true; };

/** Native v1/session.User has descriptive FileDiff metadata; only Assistant's boolean
 * marks compaction. Validate metadata, then discard it rather than publishing its private text.
 */
function messageSummary(value: unknown, assistant: boolean): boolean {
  if (assistant) return boolean(value);
  if (value === undefined) return false;
  const summary = object(value);
  if (Object.keys(summary).some(key => !["title", "body", "diffs"].includes(key)) ||
      (summary.title !== undefined && typeof summary.title !== "string") ||
      (summary.body !== undefined && typeof summary.body !== "string") || !Array.isArray(summary.diffs)) throw Error();
  for (const entry of summary.diffs) {
    const diff = object(entry);
    if (Object.keys(diff).some(key => !["file", "patch", "additions", "deletions", "status"].includes(key)) ||
        !Number.isFinite(diff.additions) || !Number.isFinite(diff.deletions) ||
        (diff.file !== undefined && typeof diff.file !== "string") ||
        (diff.patch !== undefined && typeof diff.patch !== "string") ||
        (diff.status !== undefined && !["added", "deleted", "modified"].includes(diff.status as string))) throw Error();
  }
  return false;
}

/** Pure typed projection. Native header/part clocks are authoritative; SQL update time is not. */
export function openCodeConversation(session: Row, messages: readonly Row[], parts: readonly Row[],
  origin: string, nowMs: number): RunRecord | null {
  try {
    const id = session.id, parent = session.parent_id;
    if (!sessionID(id) || (parent !== null && (!sessionID(parent) || parent === id)) ||
        typeof session.version !== "string" || !OPENCODE_SUPPORTED_VERSIONS.has(session.version) ||
        messages.length + parts.length > MAX_ROWS) return null;
    const start = millis(session.time_created, 1, nowMs), byMessage = new Map<string, Row[]>();
    const seenParts = new Set<string>();
    for (const part of parts) {
      if (!nativeID(part.id, "prt_") || !nativeID(part.message_id, "msg_") || part.session_id !== id || seenParts.has(part.id)) return null;
      seenParts.add(part.id);
      const list = byMessage.get(part.message_id) ?? []; list.push(part); byMessage.set(part.message_id, list);
    }
    const rows = messages.map(row => {
      if (!nativeID(row.id, "msg_") || row.session_id !== id) throw Error();
      const data = nativeJSON(row.data), time = object(data.time), created = millis(time.created, start, nowMs);
      if ((data.id !== undefined && data.id !== row.id) || (data.sessionID !== undefined && data.sessionID !== id)) throw Error();
      return { row, data, created, time };
    }).sort((a, b) => a.created - b.created || String(a.row.id).localeCompare(String(b.row.id)));
    const seen = new Set<string>();
    const steps: NonNullable<RunRecord["activitySteps"]>[number][] = [];
    let latestUser: string | null = null, updated = start;
    let identity: RunRecord["identity"] = { model: null, provider: null, effort: null, profile: null };
    let outcome: RunRecord["outcome"] = "unknown", terminalAt: string | undefined, terminalCause: RunRecord["terminalCause"];
    for (const { row, data, created, time } of rows) {
      const message = row.id as string;
      if (seen.has(message)) return null; seen.add(message); updated = Math.max(updated, created);
      const assistant = data.role === "assistant";
      if (data.role !== "user" && !assistant) return null;
      let nonempty = false, continuation = false, lastPart = created;
      const summary = messageSummary(data.summary, assistant);
      for (const part of byMessage.get(message) ?? []) {
        const value = nativeJSON(part.data);
        if (!knownParts.has(value.type as string) || (value.id !== undefined && value.id !== part.id) ||
            (value.messageID !== undefined && value.messageID !== message) || (value.sessionID !== undefined && value.sessionID !== id)) return null;
        if (value.type === "text") {
          const synthetic = boolean(value.synthetic), ignored = boolean(value.ignored);
          if (typeof value.text !== "string") return null;
          const clock = value.time === undefined ? null : object(value.time);
          const at = clock === null ? created : millis(clock.start, created, nowMs);
          const end = clock?.end === undefined ? at : millis(clock.end, at, nowMs);
          lastPart = Math.max(lastPart, end); updated = Math.max(updated, end);
          if (assistant && !summary && !synthetic && !ignored && value.text.trim() !== "") {
            nonempty = true;
            const stable = createHash("sha256").update(id + "\0" + message + "\0" + part.id).digest("hex");
            const step = nativeMessageActivity("opencode-transcript", stable, 0, new Date(at).toISOString(), value.text);
            if (step !== null) steps.push(step);
          }
        } else if (value.type === "tool") {
          const state = object(value.state), metadata = value.metadata === undefined ? {} : object(value.metadata);
          if (!["pending", "running", "completed", "error"].includes(state.status as string)) return null;
          // Even completed tool calls normally need a subsequent model turn (native prompt.ts:1103).
          const stateMetadata = state.metadata === undefined ? {} : object(state.metadata);
          const orphan = state.status === "error" && boolean(stateMetadata.interrupted);
          if (assistant && !boolean(metadata.providerExecuted) && !orphan) continuation = true;
        }
      }
      outcome = "running"; terminalAt = undefined; terminalCause = undefined;
      if (!assistant) { latestUser = message; continue; }
      if (!providerID(data.providerID) || !modelID(data.modelID) || (data.variant !== undefined &&
          (typeof data.variant !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(data.variant)))) return null;
      identity = { provider: data.providerID, model: data.providerID + "/" + data.modelID,
        effort: typeof data.variant === "string" ? data.variant : null, profile: null };
      if (latestUser === null || data.parentID !== latestUser || summary) { outcome = "unknown"; continue; }
      if (time.completed === undefined) continue;
      const completed = millis(time.completed, Math.max(created, lastPart), nowMs); updated = Math.max(updated, completed);
      const error = data.error === undefined || data.error === null ? null : object(data.error);
      if (error !== null && knownErrors.has(error.name as string)) {
        outcome = "failed"; terminalCause = error.name === "MessageAbortedError" ? "cancelled" : "error";
        terminalAt = new Date(completed).toISOString();
      } else if (error === null && data.finish === "stop" && nonempty && !continuation) {
        outcome = "complete"; terminalAt = new Date(completed).toISOString();
      } else outcome = "unknown";
    }
    if ([...byMessage.keys()].some(key => !seen.has(key))) return null;
    const activitySteps = recentActivity(steps);
    if (terminalAt !== undefined && steps.some(step => step.at > terminalAt!)) return null;
    return { id, source: "opencode", parentId: parent as string | null, startedAt: new Date(start).toISOString(),
      updatedAt: new Date(updated).toISOString(), branch: null, identity, usage: {}, quota: [], linkedIssues: [], origin,
      activitySteps, outcome, ...(terminalAt === undefined ? {} : { terminalAt, terminalCause }) };
  } catch { return null; }
}
export interface OpenCodeIssueScan {
  readonly runs: readonly RunRecord[]; readonly bytesRead: number;
  readonly reason: "scan_limit" | "source_unavailable" | null; readonly files: readonly string[];
}
/** No global session scan: indexed exact-root/parent queries and bounded message/part reads. */
export async function scanOpenCodeIssue(path: string, root: string, limit: number, maxBytes: number,
  nowMs: number): Promise<OpenCodeIssueScan> {
  let bytesRead = 0;
  const files = [path, path + "-wal", dirname(path)];
  const fail = (reason: OpenCodeIssueScan["reason"]): OpenCodeIssueScan => ({ runs: [], bytesRead, reason, files });
  try {
    if (!isAbsolute(path) || normalize(path) !== path || !sessionID(root) || limit < 1) return fail("source_unavailable");
    for (const candidate of [dirname(path), path, path + "-wal", path + "-shm"]) {
      let stat;
      try { stat = await lstat(candidate); }
      catch (error) { if (candidate !== path && candidate !== dirname(path) && (error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0 ||
          (candidate === dirname(path) ? !stat.isDirectory() : !stat.isFile()) || await realpath(candidate) !== candidate) return fail("source_unavailable");
    }
    const before = await lstat(path), { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path, { readOnly: true, timeout: 200 });
    try {
      const opened = await lstat(path);
      if (before.ino !== opened.ino || before.dev !== opened.dev) return fail("source_unavailable");
      db.exec("PRAGMA query_only=ON; BEGIN");
      const columns = `CASE WHEN length(CAST(id AS BLOB)) <= 256 THEN id END AS id,
        CASE WHEN parent_id IS NULL OR length(CAST(parent_id AS BLOB)) <= 256 THEN parent_id END AS parent_id,
        length(CAST(parent_id AS BLOB)) AS parent_bytes,
        CASE WHEN length(CAST(version AS BLOB)) <= 64 THEN version END AS version,time_created`;
      const roots = db.prepare(`SELECT ${columns} FROM session WHERE id=? LIMIT 2`).all(root);
      if (roots.length !== 1 || roots[0]!.parent_id !== null || roots[0]!.parent_bytes !== null) return fail("source_unavailable");
      const sessions = [...roots], selected = new Set([root]);
      const maxSessions = Math.min(limit, 20);
      for (let cursor = 0; cursor < sessions.length; cursor++) {
        const children = db.prepare(`SELECT ${columns} FROM session WHERE parent_id=? ORDER BY id LIMIT ?`)
          .all(sessions[cursor]!.id as string, maxSessions + 1);
        for (const child of children) {
          if (!sessionID(child.id) || selected.has(child.id)) return fail("source_unavailable");
          selected.add(child.id); sessions.push(child);
          if (sessions.length > maxSessions) return fail("scan_limit");
        }
      }
      const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('session_message','session_input')").all().map(row => row.name));
      const runs: RunRecord[] = [];
      let rowsRead = 0;
      for (const session of sessions) {
        const id = session.id as string;
        for (const table of ["session_message", "session_input"] as const) {
          if (tables.has(table) && db.prepare(table === "session_message"
            ? "SELECT 1 FROM session_message WHERE session_id=? LIMIT 1"
            : "SELECT 1 FROM session_input WHERE session_id=? LIMIT 1").get(id)) return fail("source_unavailable");
        }
        const read = (parts: boolean): Row[] => {
          const sizes = db.prepare(parts
            ? "SELECT length(CAST(data AS BLOB)) AS bytes FROM part WHERE session_id=? ORDER BY id LIMIT ?"
            : "SELECT length(CAST(data AS BLOB)) AS bytes FROM message WHERE session_id=? ORDER BY id LIMIT ?")
            .all(id, MAX_ROWS - rowsRead + 1);
          if (sizes.length + rowsRead > MAX_ROWS || sizes.some(row => !Number.isSafeInteger(row.bytes) ||
              (row.bytes as number) < 0 || (row.bytes as number) > MAX_ROW_BYTES)) throw new RangeError();
          const bytes = sizes.reduce((sum, row) => sum + (row.bytes as number), 0);
          if (bytesRead + bytes > Math.min(maxBytes, MAX_ISSUE_BYTES)) throw new RangeError();
          rowsRead += sizes.length; bytesRead += bytes;
          return db.prepare(parts
            ? `SELECT CASE WHEN length(CAST(id AS BLOB)) <= 256 THEN id END AS id,
                CASE WHEN length(CAST(message_id AS BLOB)) <= 256 THEN message_id END AS message_id,
                session_id,CAST(data AS BLOB) AS data FROM part WHERE session_id=? ORDER BY id LIMIT ?`
            : "SELECT CASE WHEN length(CAST(id AS BLOB)) <= 256 THEN id END AS id,session_id,CAST(data AS BLOB) AS data FROM message WHERE session_id=? ORDER BY id LIMIT ?")
            .all(id, sizes.length);
        };
        const messages = read(false), parts = read(true), run = openCodeConversation(session, messages, parts, path, nowMs);
        if (run === null) return fail("source_unavailable");
        runs.push(run);
      }
      // A pending descendant cannot make a root/tree appear fully Done.
      for (let i = 0; i < runs.length; i++) if (runs[i]!.outcome === "complete" && runs.some(run => {
        let parent = run.parentId;
        for (let depth = 0; parent !== null && depth < 20; depth++) {
          if (parent === runs[i]!.id) return run.outcome !== "complete" && run.outcome !== "failed";
          parent = runs.find(candidate => candidate.id === parent)?.parentId ?? null;
        }
        return false;
      })) { const { terminalAt: _at, terminalCause: _cause, ...run } = runs[i]!; runs[i] = { ...run, outcome: "running" }; }
      const after = await lstat(path);
      if (after.ino !== before.ino || after.dev !== before.dev || await realpath(path) !== path) return fail("source_unavailable");
      return { runs, bytesRead, reason: null, files };
    } catch (error) { return fail(error instanceof RangeError ? "scan_limit" : "source_unavailable"); }
    finally { db.close(); }
  } catch { return fail("source_unavailable"); }
}
