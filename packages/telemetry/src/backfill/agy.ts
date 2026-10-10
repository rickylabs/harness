/**
 * agy runs from the provider's decoded store reads (`AgyStoreRead`, owned by contracts). Every native
 * read and code lives in `@rickylabs/provider-agy`; this module applies the completion rules and maps
 * the bound conversations into runs. Display text is only the screened typed response.
 */
import { MAX_AGENT_ACTIVITY_STEPS, type AgyConversationSnapshot } from "@rickylabs/harness-contracts";
import type { AgyNativeReads } from "../agy-reads.js";
import { nativeMessageActivity } from "../native-activity.js";
import type { RunRecord } from "../model.js";
import type { AgyDescriptorTarget } from "./agy-activity.js";

export interface AGYScan {
  readonly runs: readonly RunRecord[];
  readonly bytesRead: number;
  readonly reason: "scan_limit" | "source_unavailable" | null;
  readonly files: readonly string[];
  /** Per accepted conversation, the authority facts the descriptor phase joins against. */
  readonly conversations: readonly AgyDescriptorTarget[];
}

/** The completion rules over one decoded conversation. Idle, mtime and an empty response never prove Done. */
export function agyRun(conversation: AgyConversationSnapshot): RunRecord {
  const { conversationId: id, steps: trajectory, startedAt, updatedAt } = conversation;
  const steps: NonNullable<RunRecord["activitySteps"]>[number][] = [];
  let pending = false;
  let final: { at: string; step: AgyConversationSnapshot["steps"][number] } | null = null;
  for (const step of trajectory) {
    // The decoder guarantees a user turn; each one starts a new turn, so only its own steps can be pending.
    if (step.kind === "user") pending = false;
    if (step.status === "pending") pending = true;
    if (step.hasResponse) {
      const activity = nativeMessageActivity("agy-transcript", id, step.index, step.createdAt, step.responseText);
      if (activity !== null) steps.push(activity);
    }
    final = step.completedAt === null ? null : { at: step.completedAt, step };
  }
  // Running, child and not-fully-idle flags make the conversation active, and the killed column makes it killed.
  const idle = conversation.summaryState === "idle";
  const killed = conversation.killedNative || conversation.killedColumn;
  // The summary can publish a resumed turn before its trajectory is updated.
  // Current native activity invalidates every prior end, including error/cancel.
  const active = conversation.summaryState === "active" || conversation.summaryRunning || conversation.childActive ||
    conversation.notFullyIdle;
  let outcome: RunRecord["outcome"] = active ? "running" : "unknown";
  let terminalAt: string | undefined, terminalCause: RunRecord["terminalCause"];
  if (!active && !pending && final !== null && final.at >= updatedAt) {
    const { step } = final, nonempty = step.responseText !== null && step.responseText.trim() !== "";
    if (step.status === "cancelled" || conversation.interrupted || step.stopReason === "cancelled") {
      outcome = "failed"; terminalCause = "cancelled"; terminalAt = final.at;
    } else if (step.status === "error" || step.hasError || step.stopReason === "error") {
      outcome = "failed"; terminalCause = "error"; terminalAt = final.at;
    // Only the native explicit stop (planner responses alone carry a stop reason) on a non-empty, done
    // response is success; an unknown, function-call, length, filtered, partial or empty response never is.
    } else if (idle && !killed && step.status === "done" && nonempty && step.stopReason === "explicit-stop") {
      outcome = "complete"; terminalAt = final.at;
    }
  }
  return { id, source: "agy", parentId: conversation.parentId, startedAt, updatedAt, branch: null,
    identity: { provider: null, model: null, effort: null, profile: null }, usage: {}, quota: [], linkedIssues: [],
    origin: conversation.origin, outcome,
    activitySteps: steps.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, MAX_AGENT_ACTIVITY_STEPS),
    ...(terminalAt === undefined ? {} : { terminalAt }), ...(terminalCause === undefined ? {} : { terminalCause }) };
}

/** One bound store through the provider port; a refused read carries its reason and no runs. */
export async function scanAGYIssue(reads: AgyNativeReads, root: string, matches: (id: string) => boolean,
  limit: number, maxBytes: number, nowMs: number): Promise<AGYScan> {
  const read = await reads.readStore(root, matches, limit, maxBytes, nowMs);
  if (read.reason !== null) return { runs: [], bytesRead: read.bytesRead, reason: read.reason, files: read.files, conversations: [] };
  const conversations = read.conversations.map(conversation => ({ run: agyRun(conversation), storeRoot: root, conversation }));
  return { runs: conversations.map(c => c.run), bytesRead: read.bytesRead, reason: null, files: read.files, conversations };
}
