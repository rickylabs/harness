/** OpenCode 2.x run database projection. Each 2.x run owns one database, `opencode-v2-<session id>.db`
 * in the OpenCode data directory (Orchid sets it as `OPENCODE_DB`). It is read read-only, never through an
 * OpenCode host: every 2.x host start resumes the sessions its database left claimed, so a reader host
 * would become a second executor of a live or killed run. Row shapes are @opencode/client 2.1.2
 * `SessionInfo` and `SessionMessageInfo`. Only an exact private root and its children are read. */
import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nativeMessageActivity, recentActivity } from "../native-activity.js";
import type { RunRecord } from "../model.js";
import {
  holdPendingTrees, MAX_ISSUE_BYTES, MAX_ROW_BYTES, MAX_ROWS, millis, modelID, nativeID, nativeJSON, object,
  providerID, readNativeStore, sessionID, versionLabel, type OpenCodeIssueScan, type Row,
} from "./opencode-issue.js";

/** The run database file name Orchid sets in `OPENCODE_DB`, relative to the OpenCode data directory. */
export const OPENCODE_RUN_DB_PREFIX = "opencode-v2-";
/** The run database of one root session, or null for an id that cannot name one. */
export function openCodeRunStorePath(dataDirectory: string, root: string): string | null {
  return sessionID(root) ? join(dataDirectory, OPENCODE_RUN_DB_PREFIX + root + ".db") : null;
}
const RUN_STORE_NAME = /^opencode-v2-ses_[A-Za-z0-9_-]{1,252}\.db$/;
/** The newest run databases in the data directory by modification time, at most `limit`, never following links. */
export async function listOpenCodeRunStores(dataDirectory: string, limit: number): Promise<readonly string[]> {
  const names = (await readdir(dataDirectory).catch(() => [] as string[])).filter(name => RUN_STORE_NAME.test(name));
  const stores = await Promise.all(names.map(async name => {
    const stat = await lstat(join(dataDirectory, name)).catch(() => null);
    return stat?.isFile() ? { path: join(dataDirectory, name), at: stat.mtimeMs } : null;
  }));
  return stores.filter(store => store !== null).sort((a, b) => b.at - a.at || a.path.localeCompare(b.path))
    .slice(0, limit).map(store => store.path);
}
/** Every table and column this projection reads. A store missing any of them is not a 2.x run database. */
const RUN_COLUMNS = {
  session_v2: ["id", "parent_id", "version", "time_created"],
  session_message: ["id", "session_id", "type", "seq", "data"],
} as const;
/** The `SessionMessageInfo` members of 2.1.2. Any other type is refused, never guessed. */
const MESSAGE_TYPES = new Set(["user", "assistant", "idle", "synthetic", "system", "skill", "shell", "compaction",
  "agent-switched", "model-switched", "location-switched"]);
/** Inputs that start a new turn; the previous turn's end no longer describes the session. */
const TURN_STARTS = new Set(["user", "synthetic", "shell"]);
const TOOL_STATES = new Set(["streaming", "running", "completed", "error"]);
const VARIANT = /^[a-z][a-z0-9_-]{0,63}$/;
/** OpenCode records the absence of a variant as this name; it is not an effort. */
const DEFAULT_VARIANT = "default";

/** Pure typed projection of one 2.x session. The `idle` message is the turn's native end. */
export function openCodeRunConversation(session: Row, messages: readonly Row[], origin: string,
  nowMs: number): RunRecord | null {
  try {
    const id = session.id, parent = session.parent_id;
    if (!sessionID(id) || (parent !== null && (!sessionID(parent) || parent === id)) ||
        !versionLabel(session.version) || messages.length > MAX_ROWS) return null;
    const start = millis(session.time_created, 1, nowMs), seen = new Set<string>();
    const steps: NonNullable<RunRecord["activitySteps"]>[number][] = [];
    let identity: RunRecord["identity"] = { model: null, provider: null, effort: null, profile: null };
    let outcome: RunRecord["outcome"] = "unknown", terminalAt: string | undefined, terminalCause: RunRecord["terminalCause"];
    let updated = start, seq = -1, answered = false;
    for (const row of messages) {
      if (!nativeID(row.id, "msg_") || row.session_id !== id || seen.has(row.id) || !Number.isSafeInteger(row.seq) ||
          (row.seq as number) <= seq || !MESSAGE_TYPES.has(row.type as string)) return null;
      seen.add(row.id); seq = row.seq as number;
      const type = row.type as string, data = nativeJSON(row.data), time = object(data.time);
      if ((data.id !== undefined && data.id !== row.id) || (data.type !== undefined && data.type !== type)) return null;
      const created = millis(time.created, start, nowMs); updated = Math.max(updated, created);
      if (TURN_STARTS.has(type)) {
        outcome = "running"; terminalAt = undefined; terminalCause = undefined; answered = false;
      } else if (type === "assistant") {
        outcome = "running"; terminalAt = undefined; terminalCause = undefined; answered = false;
        const route = object(data.model);
        if (!providerID(route.providerID) || !modelID(route.id) ||
            (route.variant !== undefined && (typeof route.variant !== "string" || !VARIANT.test(route.variant)))) return null;
        identity = { provider: route.providerID, model: route.providerID + "/" + route.id,
          effort: typeof route.variant === "string" && route.variant !== DEFAULT_VARIANT ? route.variant : null, profile: null };
        if (!Array.isArray(data.content) || data.content.length > MAX_ROWS) return null;
        const at = time.streamed === undefined ? created : millis(time.streamed, created, nowMs);
        let nonempty = false, pending = false;
        data.content.forEach((value, index) => {
          const item = object(value);
          if (item.type === "text") {
            if (typeof item.text !== "string") throw Error();
            if (item.text.trim() === "") return;
            nonempty = true;
            const stable = createHash("sha256").update(id + "\0" + row.id + "\0" + index).digest("hex");
            const step = nativeMessageActivity("opencode-transcript", stable, 0, new Date(at).toISOString(), item.text);
            if (step !== null) steps.push(step);
          } else if (item.type === "tool") {
            const status = object(item.state).status as string;
            if (!TOOL_STATES.has(status)) throw Error();
            if (status === "streaming" || status === "running") pending = true;
          } else if (item.type !== "reasoning") throw Error();
        });
        if (time.completed !== undefined) {
          updated = Math.max(updated, millis(time.completed, at, nowMs));
          answered = (data.error === undefined || data.error === null) && data.finish === "stop" && nonempty && !pending;
        }
      } else if (type === "idle") {
        // An idle with no turn in progress before it proves nothing about this session's work.
        if (outcome !== "running") { outcome = "unknown"; continue; }
        if (data.outcome === "succeeded") outcome = answered ? "complete" : "unknown";
        else if (data.outcome === "failed") { outcome = "failed"; terminalCause = "error"; }
        else if (data.outcome === "interrupted") { outcome = "failed"; terminalCause = "cancelled"; }
        else return null;
        if (outcome !== "unknown") terminalAt = new Date(created).toISOString();
      }
    }
    const activitySteps = recentActivity(steps);
    if (terminalAt !== undefined && steps.some(step => step.at > terminalAt!)) return null;
    return { id, source: "opencode", parentId: parent as string | null, startedAt: new Date(start).toISOString(),
      updatedAt: new Date(updated).toISOString(), branch: null, identity, usage: {}, quota: [], linkedIssues: [], origin,
      activitySteps, outcome, ...(terminalAt === undefined ? {} : { terminalAt, terminalCause }) };
  } catch { return null; }
}

/** Indexed exact-root/parent queries and bounded message reads of one run database. */
export async function scanOpenCodeRunStore(path: string, root: string, limit: number, maxBytes: number,
  nowMs: number): Promise<OpenCodeIssueScan> {
  let bytesRead = 0;
  const files = [path, path + "-wal", dirname(path)];
  const fail = (reason: OpenCodeIssueScan["reason"]): OpenCodeIssueScan => ({ runs: [], bytesRead, reason, files });
  if (!sessionID(root) || limit < 1) return fail("source_unavailable");
  try {
    const scanned = await readNativeStore(path, (db): OpenCodeIssueScan => {
      try {
        // Structure before any row bytes: a store without the 2.x tables/columns is refused unread.
        for (const [table, required] of Object.entries(RUN_COLUMNS)) {
          const names = new Set(db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map(row => row.name));
          if (required.some(column => !names.has(column))) return fail("source_unavailable");
        }
        const columns = `CASE WHEN length(CAST(id AS BLOB)) <= 256 THEN id END AS id,
          CASE WHEN parent_id IS NULL OR length(CAST(parent_id AS BLOB)) <= 256 THEN parent_id END AS parent_id,
          length(CAST(parent_id AS BLOB)) AS parent_bytes,
          CASE WHEN length(CAST(version AS BLOB)) <= 64 THEN version END AS version,time_created`;
        const roots = db.prepare(`SELECT ${columns} FROM session_v2 WHERE id=? LIMIT 2`).all(root);
        if (roots.length !== 1 || roots[0]!.parent_id !== null || roots[0]!.parent_bytes !== null) return fail("source_unavailable");
        const sessions = [...roots], selected = new Set([root]), maxSessions = Math.min(limit, 20);
        for (let cursor = 0; cursor < sessions.length; cursor++) {
          const children = db.prepare(`SELECT ${columns} FROM session_v2 WHERE parent_id=? ORDER BY id LIMIT ?`)
            .all(sessions[cursor]!.id as string, maxSessions + 1);
          for (const child of children) {
            if (!sessionID(child.id) || selected.has(child.id)) return fail("source_unavailable");
            selected.add(child.id); sessions.push(child);
            if (sessions.length > maxSessions) return fail("scan_limit");
          }
        }
        const runs: RunRecord[] = [];
        let rowsRead = 0;
        for (const session of sessions) {
          const id = session.id as string;
          const sizes = db.prepare("SELECT length(CAST(data AS BLOB)) AS bytes FROM session_message WHERE session_id=? ORDER BY seq LIMIT ?")
            .all(id, MAX_ROWS - rowsRead + 1);
          if (sizes.length + rowsRead > MAX_ROWS || sizes.some(row => !Number.isSafeInteger(row.bytes) ||
              (row.bytes as number) < 0 || (row.bytes as number) > MAX_ROW_BYTES)) throw new RangeError();
          const bytes = sizes.reduce((sum, row) => sum + (row.bytes as number), 0);
          if (bytesRead + bytes > Math.min(maxBytes, MAX_ISSUE_BYTES)) throw new RangeError();
          rowsRead += sizes.length; bytesRead += bytes;
          const messages = db.prepare(`SELECT CASE WHEN length(CAST(id AS BLOB)) <= 256 THEN id END AS id,session_id,
            CASE WHEN length(CAST(type AS BLOB)) <= 64 THEN type END AS type,seq,CAST(data AS BLOB) AS data
            FROM session_message WHERE session_id=? ORDER BY seq LIMIT ?`).all(id, sizes.length);
          const run = openCodeRunConversation(session, messages, path, nowMs);
          if (run === null) return fail("source_unavailable");
          runs.push(run);
        }
        holdPendingTrees(runs);
        return { runs, bytesRead, reason: null, files };
      } catch (error) { return fail(error instanceof RangeError ? "scan_limit" : "source_unavailable"); }
    });
    return scanned ?? fail("source_unavailable");
  } catch { return fail("source_unavailable"); }
}
