/** Direct, private stop observation join. Delivery alone never ends a run. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DispatchEvidence } from "./dispatch-evidence.js";

const hash = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (row: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(row).sort().join(",") === [...fields].sort().join(",");
const opaque = (kind: "agent" | "assignment", runId: string) =>
  `${kind}_${createHash("sha256").update(kind + "\0" + runId).digest("hex")}`;
const stamp = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= Date.now() ? new Date(ms).toISOString() : null;
};
async function privateDir(path: string): Promise<boolean> {
  const stat = await lstat(path);
  return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o7777) === 0o700 && await realpath(path) === resolve(path);
}
async function privateJSON(path: string): Promise<Record<string, unknown> | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size < 2 || stat.size > 16_384) return null;
    const bytes = Buffer.alloc(16_385);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) return null;
    return object(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")));
  } finally { await file.close(); }
}
function observation(row: Record<string, unknown> | null, operationId: string, requestDigest: string,
  kind: "seat_absent" | "process_absent", after: string): string | null {
  if (row === null || !exact(row, ["schemaVersion", "operationId", "requestDigest", "kind", "observedAt"]) ||
    row.schemaVersion !== 1 || row.operationId !== operationId || row.requestDigest !== requestDigest || row.kind !== kind) return null;
  const at = stamp(row.observedAt);
  return at !== null && at >= after ? at : null;
}
export async function readOrchidStopObservation(root: string, record: string, expected: {
  readonly runId: string; readonly repository: string; readonly issueNumber: number;
  readonly host: string | null; readonly paneId: string; readonly workspaceId: string;
}): Promise<DispatchEvidence["stop"]> {
  try {
    const index = await privateJSON(join(record, "stop-action.json"));
    if (index === null || !exact(index, ["schemaVersion", "operationId", "requestDigest"]) || index.schemaVersion !== 1 ||
      typeof index.operationId !== "string" || !uuid.test(index.operationId) ||
      typeof index.requestDigest !== "string" || !hash.test(index.requestDigest)) return undefined;
    const actions = join(root, "actions"), dir = join(actions, index.operationId);
    if (!await privateDir(actions) || !await privateDir(dir)) return undefined;
    const intent = await privateJSON(join(dir, "intent.json"));
    const result = await privateJSON(join(dir, "result.json"));
    if (intent === null || !exact(intent, ["requestDigest"]) || intent.requestDigest !== index.requestDigest || result === null ||
      result.schemaVersion !== 1 || result.operationId !== index.operationId || result.requestDigest !== index.requestDigest ||
      result.action !== "stop" || result.outcome !== "accepted" || result.reason !== "workspace_close_delivered" ||
      result.repository !== expected.repository || result.issueNumber !== expected.issueNumber ||
      result.agentId !== opaque("agent", expected.runId) || result.dispatchId !== opaque("assignment", expected.runId) ||
      result.nativeRunId !== expected.runId || result.host !== expected.host ||
      result.paneId !== expected.paneId || result.workspaceId !== expected.workspaceId) return undefined;
    const after = stamp(result.observedAt);
    if (after === null) return undefined;
    const seat = await privateJSON(join(dir, "seat-observed.json")).catch(() => null);
    const process = await privateJSON(join(dir, "process-observed.json")).catch(() => null);
    const seatObservedAt = observation(seat, index.operationId, index.requestDigest, "seat_absent", after);
    const processObservedAt = observation(process, index.operationId, index.requestDigest, "process_absent", after);
    return { seatObservedAt, processObservedAt };
  } catch { return undefined; }
}
