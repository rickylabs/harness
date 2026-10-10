/** agy's retained SQLite store, read-only. Each bound store is an independent read; WAL is observed, never checkpointed. */
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { AGY_CONVERSATION_ID, MAX_BLOB, MAX_STEPS, type StoreRow } from "../domain/trajectory.js";
import type { StoreScan, StoreSource } from "../ports/store-source.js";

const MAX_SESSIONS = 20;
/** Workspace metadata above this many bytes is never materialized; it only relativizes paths. */
export const MAX_WORKSPACE_URIS_BYTES = 4096;
const blob = (value: unknown): Uint8Array | null => value instanceof Uint8Array ? value : null;

export function sqliteStore(): StoreSource {
  return { scan };
}

async function scan<T>(root: string, matches: (id: string) => boolean, limit: number, maxBytes: number,
  decode: (summary: StoreRow, rows: readonly StoreRow[], origin: string) => T | null): Promise<StoreScan<T>> {
  let bytesRead = 0;
  const files: string[] = [];
  const fail = (reason: "scan_limit" | "source_unavailable"): StoreScan<T> => ({ conversations: [], bytesRead, reason, files });
  try {
    for (const path of [root, join(root, ".."), join(root, "../.."), join(root, "conversations")].map(path => join(path))) {
      const s = await lstat(path);
      if (s.uid !== process.getuid?.() || path !== join(root, "conversations") && (s.mode & 0o7777) !== 0o700 ||
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
    let candidates: StoreRow[], summaryQuery: string;
    try {
      // Older stores have no workspace column: paths then stay unrelativized, never the scan unavailable.
      // The cap is in bytes: SQLite's length() of TEXT counts characters, of a BLOB counts bytes.
      const workspace = summaries.prepare("SELECT 1 FROM pragma_table_info('conversation_summaries') WHERE name='workspace_uris'").get()
        ? `length(CAST(workspace_uris AS BLOB)) AS workspace_bytes,
      CASE WHEN length(CAST(workspace_uris AS BLOB)) <= ${MAX_WORKSPACE_URIS_BYTES} THEN workspace_uris ELSE NULL END AS workspace_uris`
        : "NULL AS workspace_bytes,NULL AS workspace_uris";
      summaryQuery = `SELECT conversation_id,parent_conversation_id,step_count,
      last_user_input_step_index,not_fully_idle,killed,length(raw_summary) AS summary_bytes,
      CASE WHEN length(raw_summary) <= 1048576 THEN raw_summary ELSE NULL END AS raw_summary,${workspace}
      FROM conversation_summaries ORDER BY conversation_id LIMIT ?`;
      candidates = summaries.prepare(summaryQuery).all(MAX_SESSIONS + 1) as StoreRow[];
    } finally { summaries.close(); }
    if (candidates.length > MAX_SESSIONS) return fail("scan_limit");
    if (candidates.some(row => typeof row["summary_bytes"] !== "number" || row["summary_bytes"] > MAX_BLOB)) return fail("scan_limit");
    const selected = new Set(candidates.filter(row => typeof row["conversation_id"] === "string" &&
      matches(row["conversation_id"]) && (row["parent_conversation_id"] === "" || row["parent_conversation_id"] === null)).map(row => row["conversation_id"]));
    if (selected.size !== 1) return fail("source_unavailable");
    for (let changed = true; changed;) {
      changed = false;
      for (const row of candidates) if (selected.has(row["parent_conversation_id"]) && !selected.has(row["conversation_id"])) {
        selected.add(row["conversation_id"]); changed = true;
      }
    }
    if (selected.size > limit) return fail("scan_limit");
    const conversations: T[] = [];
    for (const summary of candidates.filter(row => selected.has(row["conversation_id"]))) {
      const id = summary["conversation_id"], stepCount = summary["step_count"];
      if (typeof id !== "string" || !AGY_CONVERSATION_ID.test(id)) return fail("source_unavailable");
      const path = join(root, "conversations", id + ".db");
      const db = await open(path);
      try {
        const identities = db.prepare("SELECT trajectory_id,cascade_id FROM trajectory_meta LIMIT 2").all();
        // The trajectory id's grammar is the decoder's; here only one row naming this conversation.
        if (identities.length !== 1 || identities[0]!["cascade_id"] !== id) return fail("source_unavailable");
        const sizes = db.prepare(`SELECT count(*) AS count,coalesce(sum(length(metadata)+length(step_payload)+coalesce(length(error_details),0)),0) AS bytes,
          coalesce(max(length(metadata)),0) AS metadata_max,coalesce(max(length(step_payload)),0) AS payload_max,
          coalesce(max(length(error_details)),0) AS error_max
          FROM (SELECT metadata,step_payload,error_details FROM steps ORDER BY idx LIMIT ?)`).get(MAX_STEPS + 1);
        const summarySize = blob(summary["raw_summary"])?.length ?? 0;
        // Only what was materialized is counted: an oversized value was never read (and is NULL).
        const workspaceBytes = typeof summary["workspace_uris"] === "string" ? Buffer.byteLength(summary["workspace_uris"]) : 0;
        if (!sizes) return fail("source_unavailable");
        if (sizes["count"] !== stepCount || (sizes["count"] as number) > MAX_STEPS ||
            (sizes["metadata_max"] as number) > MAX_BLOB || (sizes["payload_max"] as number) > MAX_BLOB || (sizes["error_max"] as number) > MAX_BLOB ||
            bytesRead + (sizes["bytes"] as number) + summarySize + workspaceBytes > maxBytes) return fail("scan_limit");
        const rows = db.prepare("SELECT idx,step_type,status,metadata,error_details,step_payload,step_format FROM steps ORDER BY idx LIMIT ?").all(MAX_STEPS + 1);
        bytesRead += (sizes["bytes"] as number) + summarySize + workspaceBytes;
        const conversation = decode({ ...summary, trajectory_id: identities[0]!["trajectory_id"] }, rows, path);
        if (conversation === null) return fail("source_unavailable");
        conversations.push(conversation);
      } finally { db.close(); }
    }
    // The summary and trajectory are separate databases. Reopen the summary after reading their
    // snapshots; a concurrent resume/update must wait for a coherent later scan, not keep an old success.
    const verify = await open(join(root, "conversation_summaries.db"));
    try {
      const current = verify.prepare(summaryQuery).all(MAX_SESSIONS + 1) as StoreRow[];
      if (current.length !== candidates.length || candidates.some((row, index) => {
        const other = current[index]!;
        return Object.keys(row).some(key => key === "raw_summary"
          ? !(blob(other[key])) || !Buffer.from(blob(row[key])!).equals(blob(other[key])!)
          : row[key] !== other[key]);
      })) return fail("source_unavailable");
    } finally { verify.close(); }
    return { conversations, bytesRead, reason: null, files };
  } catch { return fail("source_unavailable"); }
}
