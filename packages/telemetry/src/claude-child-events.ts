/** Private Claude hook observations. A Stop callback is not terminal evidence. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const CLAUDE_CHILD_EVENT_ROOT = "DSH_TELEMETRY_CLAUDE_CHILD_EVENT_ROOT";
const MAX_BYTES = 1_048_576;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
export const CLAUDE_CHILD_START_FRESH_MS = 90_000;
export const childEventKey = (sessionId: string, childId: string) => `${sessionId}\0${childId}`;

/**
 * A verified root's latest hook event per known child, reduced to the children whose latest event is
 * a Start. How fresh that Start must be is judged with the child's own transcript activity
 * (agent-observations.ts), not here: a child can work well past the Start window.
 */
export async function readClaudeChildStarts(root: string | undefined, sessionId: string,
  childIds: readonly string[], now: string, watchFiles?: Set<string>): Promise<ReadonlyMap<string, string>> {
  const unavailable = new Map<string, string>();
  if (!root || !isAbsolute(root) || !ID.test(sessionId) || childIds.some(id => !ID.test(id))) return unavailable;
  const nowMs = Date.parse(now);
  if (!ISO.test(now) || !Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) return unavailable;
  const known = new Set(childIds);
  if (known.size === 0) return unavailable;
  try {
    const directory = await lstat(root);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() ||
        (directory.mode & 0o7777) !== 0o700) return unavailable;
    const name = `${createHash("sha256").update(sessionId).digest("hex")}.jsonl`;
    const path = join(root, name);
    watchFiles?.add(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 ||
          (stat.mode & 0o7777) !== 0o600 || stat.size > MAX_BYTES) return unavailable;
      const bytes = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== stat.size || bytesRead > MAX_BYTES) return unavailable;
      const latest = new Map<string, { event: "SubagentStart" | "SubagentStop"; at: string }>();
      for (const line of bytes.subarray(0, bytesRead).toString("utf8").split("\n")) {
        if (line === "") continue;
        const row: unknown = JSON.parse(line);
        if (!row || typeof row !== "object" || Array.isArray(row)) return unavailable;
        const record = row as Record<string, unknown>;
        if (Object.keys(record).sort().join(",") !== "agentId,event,observedAt,sessionId" ||
            (record.event !== "SubagentStart" && record.event !== "SubagentStop") ||
            record.sessionId !== sessionId || typeof record.agentId !== "string" || !ID.test(record.agentId) ||
            typeof record.observedAt !== "string" || !ISO.test(record.observedAt)) return unavailable;
        const atMs = Date.parse(record.observedAt);
        if (!Number.isFinite(atMs) || new Date(atMs).toISOString() !== record.observedAt) return unavailable;
        // The file as it stood at the capture: a hook line appended after it is not in this frame
        // (see transcriptAsOf), and neither is anything written after that line.
        if (atMs > nowMs) break;
        // Claude's hook agent_id omits the literal prefix used by its transcript filename.
        // The issue scanner has already verified that each known child is a transcript run.
        const transcriptId = `agent-${record.agentId}`;
        if (!known.has(transcriptId)) continue; // Internal/unmatched Claude agents have no issue child.
        const prior = latest.get(transcriptId);
        if (prior && record.observedAt < prior.at) return unavailable;
        latest.set(transcriptId, { event: record.event, at: record.observedAt });
      }
      for (const [id, event] of latest) {
        if (event.event === "SubagentStart") unavailable.set(childEventKey(sessionId, id), event.at);
      }
    } finally { await handle.close(); }
  } catch { /* Missing or unsafe hook evidence never creates a child state. */ }
  return unavailable;
}
