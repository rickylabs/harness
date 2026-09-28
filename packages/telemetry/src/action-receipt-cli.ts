/** Scoped, public-safe view of one Orchid action delivery receipt. */
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ORCHID_DISPATCH_ROOT } from "./orchid-dispatch.js";
import { AGENT_ACTION_ACCEPTED_REASONS, AGENT_ACTION_REJECTED_REASONS, type AgentActionKind } from "@rickylabs/harness-contracts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const agent = /^agent_[0-9a-f]{64}$/;
const assignment = /^assignment_[0-9a-f]{64}$/;
const message = /^message_[0-9a-f]{64}$/;
const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const actions = new Set(Object.keys(AGENT_ACTION_ACCEPTED_REASONS));
const acceptedReasons = new Set(Object.values(AGENT_ACTION_ACCEPTED_REASONS));
const rejectedReasons = new Set<string>(AGENT_ACTION_REJECTED_REASONS);
const unknownReasons = new Set(["delivery_unobserved", "receipt_missing_after_fence", "job_not_found", "dispatch_binding_unavailable",
  "dispatch_receipt_unavailable", "dispatch_binding_mismatch", "native_identity_invalid", "native_identity_unavailable",
  "seat_unavailable", "seat_observation_unavailable", "seat_identity_unavailable", "stop_fence_unavailable",
  "stop_delivery_unconfirmed", "prompt_delivery_unconfirmed", "goal_budget_update_unconfirmed",
  "goal_state_persistence_failed", "retry_fence_unavailable", "retry_reopen_unconfirmed", "retry_issue_changed",
  "retry_launch_unconfirmed"]);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;

export interface PublicActionReceipt {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly requestDigest: string | null;
  readonly repository: string | null;
  readonly issueNumber: number | null;
  readonly action: AgentActionKind | null;
  readonly agentId: string | null;
  readonly dispatchId: string | null;
  readonly outcome: "accepted" | "rejected" | "unknown";
  readonly reason: string;
  readonly observedAt: string | null;
  readonly replacementAgentId: string | null;
  /** Present on a source-proven accepted retry. Older receipts omit this additive field. */
  readonly replacementDispatchId?: string | null;
  readonly messageId: string | null;
}
export interface ActionReceiptScan {
  readonly receipts: readonly PublicActionReceipt[];
  /** False when the spool is absent, malformed, or exceeds this bounded reader. */
  readonly complete: boolean;
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
    return await readActionReceiptAtRoot(root, operationId, wanted);
  } catch (error) {
    return unavailable(operationId, wanted, (error as NodeJS.ErrnoException).code === "ENOENT" ? "receipt_missing" : "source_unavailable");
  }
}
async function readActionReceiptAtRoot(root: string, operationId: string, wanted: string | null): Promise<PublicActionReceipt> {
  try {
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
    const action = safeOptional(receipt.action, /^(stop|steer|retry|send|raise_budget)$/);
    const repo = safeOptional(receipt.repository, repository);
    const issueNumber = receipt.issueNumber === undefined || receipt.issueNumber === 0 ? null
      : Number.isSafeInteger(receipt.issueNumber) && (receipt.issueNumber as number) > 0 ? receipt.issueNumber as number : undefined;
    const agentId = safeOptional(receipt.agentId, agent), dispatchId = safeOptional(receipt.dispatchId, assignment);
    const replacementAgentId = safeOptional(receipt.replacementAgentId, agent);
    const replacementDispatchId = safeOptional(receipt.replacementDispatchId, assignment);
    const messageId = safeOptional(receipt.messageId, message);
    const observedAt = time(receipt.observedAt);
    if (action === undefined || repo === undefined || issueNumber === undefined || agentId === undefined || dispatchId === undefined || replacementAgentId === undefined || replacementDispatchId === undefined ||
        messageId === undefined || observedAt === null || (action !== null && !actions.has(action)) ||
        (outcome === "accepted" && (action === null || reason !== AGENT_ACTION_ACCEPTED_REASONS[action as AgentActionKind] ||
          repo === null || issueNumber === null || agentId === null || dispatchId === null ||
          (action === "retry" ? replacementAgentId === null || replacementDispatchId === null
            : replacementAgentId !== null || replacementDispatchId !== null))) ||
        (outcome !== "accepted" && (replacementAgentId !== null || replacementDispatchId !== null)))
      return unavailable(operationId, wanted, "receipt_invalid");
    return { schemaVersion: 1, operationId, requestDigest: receipt.requestDigest as string, repository: repo, issueNumber,
      action: action as PublicActionReceipt["action"],
      agentId, dispatchId, outcome, reason, observedAt, replacementAgentId, replacementDispatchId, messageId };
  } catch (error) {
    return unavailable(operationId, wanted, (error as NodeJS.ErrnoException).code === "ENOENT" ? "receipt_missing" : "source_unavailable");
  }
}

/** Bounded enumeration for the issue timeline; each row still passes the exact private reader. */
export async function readActionReceipts(root: string | undefined): Promise<ActionReceiptScan> {
  if (root === undefined) return { receipts: [], complete: false };
  try {
    if (!await privateRoot(root) || !await privateDir(join(root, "actions"))) return { receipts: [], complete: false };
    const entries: string[] = [];
    for await (const entry of await opendir(join(root, "actions"))) {
      if (!entry.isDirectory() || !uuid.test(entry.name) || entries.length === 128)
        return { receipts: [], complete: false };
      entries.push(entry.name);
    }
    const receipts: PublicActionReceipt[] = [];
    let complete = true;
    for (const operationId of entries) {
      const receipt = await readActionReceiptAtRoot(root, operationId, null);
      if (receipt.outcome === "unknown" &&
          (receipt.reason.startsWith("receipt_") || receipt.reason === "source_unavailable")) {
        complete = false; continue;
      }
      receipts.push(receipt);
    }
    return { receipts, complete };
  } catch { return { receipts: [], complete: false }; }
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
