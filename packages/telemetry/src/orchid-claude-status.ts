/** Read only a current, exact-session Claude working observation from Orchid. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { matchesOrchidNativeRootIdentity } from "./orchid-native-binding.js";
import type { DispatchEvidence } from "./dispatch-evidence.js";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (row: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(row).sort().join(",") === [...fields].sort().join(",");
async function privateJSON(path: string, limit: number): Promise<Record<string, unknown> | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size < 2 || stat.size > limit) return null;
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytesRead === stat.size ? object(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"))) : null;
  } finally { await file.close(); }
}

export async function readOrchidClaudeStatus(record: string, dispatch: DispatchEvidence): Promise<string | null> {
  if (dispatch.source !== "claude" || dispatch.dispatchState !== "dispatched" ||
      dispatch.location === null || dispatch.location === undefined || dispatch.host === null || dispatch.host === undefined) return null;
  try {
    const [row, binding] = await Promise.all([
      privateJSON(join(record, "claude-status.json"), 4096),
      privateJSON(join(record, "binding.json"), 262_144),
    ]);
    if (row === null || binding === null || !exact(row, ["schemaVersion", "runId", "nativeSessionId",
      "host", "paneId", "workspaceId", "status", "observedAt"]) || row.schemaVersion !== 1 ||
      row.runId !== dispatch.runId || row.host !== dispatch.host ||
      row.paneId !== dispatch.location.paneId || row.workspaceId !== dispatch.location.workspaceId ||
      row.status !== "working" || typeof row.nativeSessionId !== "string" ||
      row.nativeSessionId !== binding.NativeSessionID ||
      !matchesOrchidNativeRootIdentity(dispatch, row.nativeSessionId, "claude") ||
      typeof dispatch.revision !== "string") return null;
    // A changed dispatch cannot reuse an observation from its previous occupant.
    const handle = await open(join(record, "dispatch.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size > 16_384) return null;
      bytes = Buffer.alloc(stat.size);
      const read = await handle.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead !== stat.size) return null;
    } finally { await handle.close(); }
    if (createHash("sha256").update(bytes).digest("hex") !== dispatch.revision) return null;
    const at = row.observedAt;
    if (typeof at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z$/.test(at)) return null;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms) || ms > Date.now()) return null;
    return new Date(ms).toISOString();
  } catch { return null; }
}
