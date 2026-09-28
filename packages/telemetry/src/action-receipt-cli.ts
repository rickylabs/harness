/** Scoped, public-safe view of one Orchid action delivery receipt. */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ORCHID_DISPATCH_ROOT } from "./orchid-dispatch.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const agent = /^agent_[0-9a-f]{64}$/;
const assignment = /^assignment_[0-9a-f]{64}$/;
const message = /^message_[0-9a-f]{64}$/;
const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const actions = new Set(["stop", "steer", "retry", "send"]);
const acceptedReasons = new Set(["workspace_close_delivered", "prompt_delivered"]);
const rejectedReasons = new Set(["digest_conflict", "request_invalid", "payload_invalid", "action_invalid", "repository_mismatch",
  "identity_mismatch", "agent_not_stoppable", "agent_not_running", "agent_not_live", "retry_requires_terminal_successor_contract"]);
const unknownReasons = new Set(["delivery_unobserved", "receipt_missing_after_fence", "job_not_found", "dispatch_binding_unavailable",
  "dispatch_receipt_unavailable", "dispatch_binding_mismatch", "native_identity_invalid", "native_identity_unavailable",
  "seat_unavailable", "seat_observation_unavailable", "seat_identity_unavailable", "stop_fence_unavailable",
  "stop_delivery_unconfirmed", "prompt_delivery_unconfirmed"]);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;

export interface PublicActionReceipt {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly requestDigest: string | null;
  readonly repository: string | null;
  readonly issueNumber: number | null;
  readonly action: "stop" | "steer" | "retry" | "send" | null;
  readonly agentId: string | null;
  readonly dispatchId: string | null;
  readonly outcome: "accepted" | "rejected" | "unknown";
  readonly reason: string;
  readonly observedAt: string | null;
  readonly replacementAgentId: string | null;
  readonly messageId: string | null;
}
const unavailable = (operationId: string, requestDigest: string | null, reason: string): PublicActionReceipt => ({
  schemaVersion: 1, operationId, requestDigest, repository: null, issueNumber: null, action: null, agentId: null, dispatchId: null,
  outcome: "unknown", reason, observedAt: null, replacementAgentId: null, messageId: null,
});

async function privateDir(path: string): Promise<boolean> {
  const stat = await lstat(path);
  return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o7777) === 0o700 && await realpath(path) === resolve(path);
}
async function privateRoot(path: string): Promise<boolean> {
  if (!isAbsolute(path) || !await privateDir(path)) return false;
  for (let dir = path;; dir = dirname(dir)) {
    try { await lstat(join(dir, ".git")); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false; }
    if (dirname(dir) === dir) break;
  }
  return true;
}
async function privateJSON(path: string): Promise<Record<string, unknown> | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size > 16_384) return null;
    const bytes = Buffer.alloc(16_385);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16_384) return null;
    try { return object(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"))); }
    catch { return null; }
  } finally { await file.close(); }
}
const safeOptional = (value: unknown, pattern: RegExp): string | null | undefined =>
  value === undefined || value === "" ? null : typeof value === "string" && pattern.test(value) ? value : undefined;
const time = (value: unknown): string | null => typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

/** Missing or malformed private evidence is unknown, never an accepted action. */
export async function readActionReceipt(root: string | undefined, operationId: string, requestDigest?: string): Promise<PublicActionReceipt> {
  const wanted = requestDigest ?? null;
  if (!uuid.test(operationId) || (wanted !== null && !digest.test(wanted))) throw Error("invalid request");
  if (root === undefined) return unavailable(operationId, wanted, "source_not_bound");
  try {
    if (!await privateRoot(root)) return unavailable(operationId, wanted, "source_unavailable");
    const actionsDir = join(root, "actions"), opDir = join(actionsDir, operationId);
    if (!await privateDir(actionsDir) || !await privateDir(opDir)) return unavailable(operationId, wanted, "receipt_missing");
    const intent = await privateJSON(join(opDir, "intent.json"));
    if (intent === null || !digest.test(intent.requestDigest as string)) return unavailable(operationId, wanted, "receipt_invalid");
    const primaryDigest = intent.requestDigest as string;
    const conflict = wanted !== null && wanted !== primaryDigest;
    const receipt = await privateJSON(join(opDir, conflict ? `conflict-${wanted}.json` : "result.json"));
    if (receipt === null) return unavailable(operationId, wanted, "receipt_invalid");
    if (receipt.schemaVersion !== 1 || receipt.operationId !== operationId ||
        receipt.requestDigest !== (conflict ? wanted : primaryDigest)) return unavailable(operationId, wanted, "receipt_invalid");
    const outcome = receipt.outcome;
    if (outcome !== "accepted" && outcome !== "rejected" && outcome !== "unknown") return unavailable(operationId, wanted, "receipt_invalid");
    const reason = receipt.reason;
    if (typeof reason !== "string" || !(outcome === "accepted" ? acceptedReasons : outcome === "rejected" ? rejectedReasons : unknownReasons).has(reason))
      return unavailable(operationId, wanted, "receipt_invalid");
    const action = safeOptional(receipt.action, /^(stop|steer|retry|send)$/);
    const repo = safeOptional(receipt.repository, repository);
    const issueNumber = receipt.issueNumber === undefined || receipt.issueNumber === 0 ? null
      : Number.isSafeInteger(receipt.issueNumber) && (receipt.issueNumber as number) > 0 ? receipt.issueNumber as number : undefined;
    const agentId = safeOptional(receipt.agentId, agent), dispatchId = safeOptional(receipt.dispatchId, assignment);
    const replacementAgentId = safeOptional(receipt.replacementAgentId, agent), messageId = safeOptional(receipt.messageId, message);
    const observedAt = time(receipt.observedAt);
    if (action === undefined || repo === undefined || issueNumber === undefined || agentId === undefined || dispatchId === undefined || replacementAgentId === undefined ||
        messageId === undefined || observedAt === null || (action !== null && !actions.has(action)) ||
        (outcome === "accepted" && ((action === "stop") !== (reason === "workspace_close_delivered") || action === null ||
          repo === null || issueNumber === null || agentId === null || dispatchId === null)))
      return unavailable(operationId, wanted, "receipt_invalid");
    return { schemaVersion: 1, operationId, requestDigest: receipt.requestDigest as string, repository: repo, issueNumber,
      action: action as PublicActionReceipt["action"],
      agentId, dispatchId, outcome, reason, observedAt, replacementAgentId, messageId };
  } catch (error) {
    return unavailable(operationId, wanted, (error as NodeJS.ErrnoException).code === "ENOENT" ? "receipt_missing" : "source_unavailable");
  }
}

/** No private path or text enters stdout or fixed diagnostics. */
export async function actionReceiptCommand(args: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  let operationId: string | undefined, requestDigest: string | undefined, json = false;
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--json" && !json) json = true;
      else if (args[i] === "--operation" && operationId === undefined) operationId = args[++i];
      else if (args[i] === "--digest" && requestDigest === undefined) requestDigest = args[++i];
      else throw Error();
    }
    if (!json || operationId === undefined || !uuid.test(operationId) || (requestDigest !== undefined && !digest.test(requestDigest))) throw Error();
  } catch { process.stderr.write("action-receipt: invalid command line\n"); return 2; }
  const result = await readActionReceipt(env[ORCHID_DISPATCH_ROOT], operationId, requestDigest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.outcome === "unknown" ? 3 : 0;
}
