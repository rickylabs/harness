/** Private ordinary-teardown evidence. Closure and delivery are never terminal proof. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { DispatchEvidence } from "./dispatch-evidence.js";

const hash = /^[a-f0-9]{64}$/;
const repository = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (row: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(row).sort().join(",") === [...fields].sort().join(",");
const stamp = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= Date.now() ? new Date(ms).toISOString() : null;
};
async function privateJSON(path: string, limit = 16_384): Promise<Record<string, unknown> | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size < 2 || stat.size > limit) return null;
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytesRead === stat.size ? object(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"))) : null;
  } finally { await file.close(); }
}
function observed(row: Record<string, unknown> | null, runId: string, kind: "seat_absent" | "process_absent", after: string): string | null {
  if (row === null || !exact(row, ["schemaVersion", "nativeRunId", "kind", "observedAt"]) ||
    row.schemaVersion !== 1 || row.nativeRunId !== runId || row.kind !== kind) return null;
  const at = stamp(row.observedAt);
  return at !== null && at >= after ? at : null;
}

export async function readOrchidTeardownObservation(record: string, expected: {
  readonly runId: string; readonly repository: string; readonly issueNumber: number;
  readonly host: string | null; readonly paneId: string; readonly workspaceId: string;
}): Promise<DispatchEvidence["teardown"]> {
  try {
    const key = expected.runId.startsWith("orchid-") ? expected.runId.slice(7) : "";
    if (!hash.test(key) || expected.host === null) return undefined;
    const intent = await privateJSON(join(record, "teardown-intent.json"));
    const anchor = await privateJSON(join(record, "teardown-anchor.json"), 65_536);
    const binding = await privateJSON(join(record, "binding.json"), 262_144);
    if (intent === null || !exact(intent, ["schemaVersion", "issue", "dispatchKey", "nativeRunId", "nativeSessionId",
      "host", "paneId", "workspaceId", "cause", "startedAt"]) ||
      intent.schemaVersion !== 1 || intent.issue !== expected.issueNumber || intent.dispatchKey !== key ||
      intent.nativeRunId !== expected.runId || intent.host !== expected.host ||
      intent.paneId !== expected.paneId || intent.workspaceId !== expected.workspaceId ||
      (intent.cause !== "operator-timeout" && intent.cause !== "teardown") ||
      typeof intent.nativeSessionId !== "string" || intent.nativeSessionId.length === 0 ||
      Buffer.byteLength(intent.nativeSessionId) > 256 || /[\x00\r\n\t /\\]/.test(intent.nativeSessionId) ||
      // The binding names the WORK repository Orchid resolved (an inbox issue's authoritative `repo:`
      // key), which differs from the inbox issue's own repository for a launch from a source outside
      // it. The dispatch key below binds that repository to this run; it is never compared to the
      // inbox issue's repository (harness#613).
      binding === null || binding.NativeSessionID !== intent.nativeSessionId ||
      typeof binding.Repo !== "string" || !repository.test(binding.Repo) ||
      binding.Host !== expected.host || typeof binding.IssueID !== "string" ||
      typeof binding.BriefDigest !== "string" || !hash.test(binding.BriefDigest) ||
      createHash("sha256").update(binding.IssueID + "\0" + binding.Repo + "\0" + binding.BriefDigest).digest("hex") !== key ||
      anchor === null || !exact(anchor, ["schemaVersion", "operationId", "requestDigest", "groupId", "rootPid", "members"]) ||
      anchor.schemaVersion !== 1 || anchor.operationId !== "" || anchor.requestDigest !== "" ||
      !Number.isSafeInteger(anchor.groupId) || (anchor.groupId as number) <= 1 ||
      !Number.isSafeInteger(anchor.rootPid) || (anchor.rootPid as number) <= 1 ||
      !Array.isArray(anchor.members) || anchor.members.length === 0 || anchor.members.length > 512 ||
      !anchor.members.every(member => { const row = object(member); return row !== null && exact(row, ["pid", "start"]) &&
        Number.isSafeInteger(row.pid) && (row.pid as number) > 1 && Number.isSafeInteger(row.start) && (row.start as number) > 0; }) ||
      !anchor.members.some(member => object(member)?.pid === anchor.rootPid)) return undefined;
    const after = stamp(intent.startedAt);
    if (after === null) return undefined;
    const seat = await privateJSON(join(record, "teardown-seat-observed.json")).catch(() => null);
    const process = await privateJSON(join(record, "teardown-process-observed.json")).catch(() => null);
    return { cause: intent.cause === "operator-timeout" ? "timeout" : "teardown",
      seatObservedAt: observed(seat, expected.runId, "seat_absent", after),
      processObservedAt: observed(process, expected.runId, "process_absent", after) };
  } catch { return undefined; }
}
