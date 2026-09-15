/** Private Orchid join state. Neither credentials nor join keys are enumerable/public fields. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { DispatchEvidence } from "./dispatch-evidence.js";
import type { RunRecord } from "./model.js";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const keyFor = (source: string, identity: string) => digest(source + "\0" + identity);
const bindings = new WeakMap<DispatchEvidence, { key: string | null }>();
// Same bound for the private binding (which includes the profile) and snapshot reread.
const MAX_BYTES = 262_144;
async function readPrivate(file: string): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size > MAX_BYTES) throw new Error();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error();
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
/** Consume only the writer's dispatched Codex binding, tied to its reservation and selected route.
 * Writer contract: orchid a94ba978904354d2d13a632ad1806def81ac07ae,
 * cmd/divybot/matrix.go (reservation key) and native_identity.go (NativeSessionID).
 * Invalid/missing evidence leaves a dispatch-only row; no native value or exception is returned.
 */
export async function readOrchidNativeBinding(record: string, reservation: string, dispatch: DispatchEvidence): Promise<void> {
  bindings.set(dispatch, { key: null });
  try {
    if (dispatch.dispatchState !== "dispatched" || dispatch.source !== "codex") return;
    const raw = await readPrivate(join(record, "binding.json"));
    const binding = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const id = binding.NativeSessionID;
    // Match Orchid privateNativeID exactly, including its UTF-8 byte limit.
    if (typeof id !== "string" || Buffer.byteLength(id) === 0 || Buffer.byteLength(id) > 256 ||
        /^\p{White_Space}|\p{White_Space}$/u.test(id) || /[\x00\r\n\t /\\]/.test(id)) return;
    if (typeof binding.IssueID !== "string" || typeof binding.Repo !== "string" ||
        typeof binding.BriefDigest !== "string" || !/^[a-f0-9]{64}$/.test(binding.BriefDigest) ||
        digest(binding.IssueID + "\0" + binding.Repo + "\0" + binding.BriefDigest) !== reservation) return;
    const route = binding.Route as Record<string, unknown>;
    if (route.transport !== dispatch.source || route.provider !== dispatch.route.requested.provider.value ||
        route.model !== dispatch.route.requested.model.value || (route.effort || null) !== dispatch.route.requested.effort.value) return;
    // Invalidation clears the binding before publishing uncertain. Reject a changed dispatch snapshot.
    if (digest(await readPrivate(join(record, "dispatch.json"))) !== dispatch.revision) return;
    bindings.set(dispatch, { key: keyFor(dispatch.source, id) });
  } catch { /* Private failures are represented by unavailable ancestry, never exception text. */ }
}
/** Resolve only one same-source native root. Existing telemetry owns parent-chain traversal. */
export function resolveOrchidNativeRoot(dispatch: DispatchEvidence, runs: readonly RunRecord[]): RunRecord | null {
  const key = bindings.get(dispatch)?.key;
  const matches = runs.filter(run => keyFor(run.source, run.id) === key);
  return matches.length === 1 && matches[0]!.parentId === null ? matches[0]! : null;
}
/** Private reader rows cannot acquire credentials from the legacy exported DispatchResult surface. */
export function hasOrchidNativeBindingBoundary(dispatch: DispatchEvidence): boolean {
  return bindings.has(dispatch);
}
