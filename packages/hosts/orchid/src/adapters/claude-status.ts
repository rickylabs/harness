/** Read only a current, exact-session Claude status observation from Orchid: working, or stopped at its prompt. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import { matchesOrchidNativeRootIdentity } from "../application/native-binding-registry.js";
import { exact } from "../domain/receipt-shape.js";
import { readPrivateJSON } from "./private-json.js";

export async function readOrchidClaudeStatus(record: string, dispatch: DispatchEvidence):
  Promise<{ readonly state: "working" | "idle"; readonly at: string } | null> {
  if (dispatch.source !== "claude" || dispatch.dispatchState !== "dispatched" ||
      dispatch.location === null || dispatch.location === undefined || dispatch.host === null || dispatch.host === undefined) return null;
  try {
    const [row, binding] = await Promise.all([
      readPrivateJSON(join(record, "claude-status.json"), 4096),
      readPrivateJSON(join(record, "binding.json"), 262_144),
    ]);
    if (row === null || binding === null || !exact(row, ["schemaVersion", "runId", "nativeSessionId",
      "host", "paneId", "workspaceId", "status", "observedAt"]) || row.schemaVersion !== 1 ||
      row.runId !== dispatch.runId || row.host !== dispatch.host ||
      row.paneId !== dispatch.location.paneId || row.workspaceId !== dispatch.location.workspaceId ||
      (row.status !== "working" && row.status !== "idle" && row.status !== "done") || typeof row.nativeSessionId !== "string" ||
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
    // herdr reports a Claude that has ended its turn as idle or done; both are stopped at the prompt.
    return { state: row.status === "working" ? "working" : "idle", at: new Date(ms).toISOString() };
  } catch { return null; }
}
