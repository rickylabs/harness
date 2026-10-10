/**
 * agy activity beyond assistant text: provider-named tool calls joined to the native trajectory, which
 * stays the only authority for which steps exist, when they happened and how they ended. A call is
 * never paired with a result (that correlation is unproven): a named call is a `requested` plan whose
 * state is `unknown`; only a native result row is `executed`.
 * State, unnamed result steps and coverage appear only when lifecycle publication is requested.
 */
import { AGENT_ACTIVITY_GAPS, MAX_AGENT_ACTIVITY_STEPS, type AgentActivityGap, type AgyConversationSnapshot,
  type NativeToolCallRead } from "@rickylabs/harness-contracts";
import { MAX_TRANSCRIPT_TAIL_BYTES, unreadToolCalls } from "@rickylabs/provider-agy";
import type { AgyNativeReads } from "../agy-reads.js";
import type { RunRecord } from "../model.js";
import { nativeToolActivity, recentActivity } from "../native-activity.js";
import { agyResultState } from "./agy-status.js";

/** One accepted conversation: its run and the decoded authority its descriptor read is joined against. */
export interface AgyDescriptorTarget {
  readonly run: RunRecord;
  readonly storeRoot: string;
  readonly conversation: AgyConversationSnapshot;
}

/** Disjoint id slots: messages keep part 0 (unchanged ids), calls take 1..64, results 1000. */
export const agyActivitySlot = { message: 0, call: (index: number) => 1 + index, result: 1000 } as const;
/** A descriptor read smaller than this is skipped as budget-exhausted rather than taken partially. */
export const MIN_DESCRIPTOR_READ_BYTES = 65_536;

/** Join one conversation's descriptor read to its authority facts. */
export function agyActivity(target: AgyDescriptorTarget, read: NativeToolCallRead, lifecycle: boolean): RunRecord {
  const { run, conversation: { conversationId, workspaceRoot, steps: trajectory } } = target;
  const plannerAt = new Map(trajectory.filter(s => s.kind === "planner").map(s => [s.index, s.createdAt]));
  const window = [...plannerAt.keys()].sort((a, b) => b - a).slice(0, MAX_AGENT_ACTIVITY_STEPS);
  // A decoded planner step the trajectory does not hold is an incoherent log: no name from it is used.
  const gap: AgentActivityGap | null = read.gap ?? (read.decodedPlannerSteps.some(i => !plannerAt.has(i)) ? "tool-names-source-invalid" : null);
  // With no planner step in the window there is nothing to name, so a source problem narrows nothing.
  const gaps = new Set<AgentActivityGap>(gap === null || window.length === 0 ? [] : [gap]);
  if (gap === null && read.fromStepIndex !== null) {
    const decoded = new Set(read.decodedPlannerSteps), truncated = new Set(read.vendorTruncatedSteps);
    for (const idx of window) {
      if (!decoded.has(idx)) gaps.add(!read.fromStart && idx < read.fromStepIndex ? "tool-names-truncated" : "tool-names-lines-missing");
      if (truncated.has(idx)) gaps.add("tool-names-vendor-truncated");
    }
  }
  const inWindow = new Set(window);
  const relative = (path: string | null) => path !== null && workspaceRoot !== null && path.startsWith(workspaceRoot + "/")
    ? path.slice(workspaceRoot.length + 1) : null;
  const named = (gap === null ? read.calls : []).flatMap(call => {
    if (!inWindow.has(call.stepIndex)) return [];
    const step = nativeToolActivity("agy-transcript", conversationId, call.stepIndex, agyActivitySlot.call(call.callIndex),
      plannerAt.get(call.stepIndex)!, { kind: call.kind, toolName: call.toolName, commandLine: call.commandLine,
        relativePath: relative(call.path) }, "requested", lifecycle ? "unknown" : undefined);
    return step === null ? [] : [step];
  });
  const inProgress = new Set<string>();
  const results = !lifecycle ? [] : trajectory.filter(s => s.kind === "result").flatMap(s => {
    const step = nativeToolActivity("agy-transcript", conversationId, s.index, agyActivitySlot.result, s.createdAt, null, "executed",
      agyResultState(s.status));
    if (step !== null && s.status === "pending") inProgress.add(step.id);
    return step === null ? [] : [step];
  });
  if (named.length === 0 && !lifecycle) return run;
  const steps = recentActivity([...(run.activitySteps ?? []), ...named, ...results]);
  if (!lifecycle) return { ...run, activitySteps: steps };
  const namedIds = new Set(named.map(step => step.id));
  if (steps.some(step => namedIds.has(step.id))) gaps.add("call-lifecycle-unproven");
  if (steps.some(step => inProgress.has(step.id))) gaps.add("in-progress-unattributed");
  return { ...run, activitySteps: steps, activityCoverage: { gaps: AGENT_ACTIVITY_GAPS.filter(g => gaps.has(g)) } };
}

export interface AgyDescriptorPhase {
  /** The replacement for each conversation's run. */
  readonly runs: ReadonlyMap<RunRecord, RunRecord>;
  /** Transcript bytes read, which the composition root deducts from the shared budget. */
  readonly bytesRead: number;
}

/**
 * The lowest-priority read of an issue group, run after every authority read: newest dispatch first,
 * each read at most `min(1 MiB, remaining - reserve)`, skipped below the minimum. Authority reads that
 * follow in later groups therefore keep at least the reserve.
 */
export async function attachAgyDescriptors(conversations: readonly AgyDescriptorTarget[], reads: AgyNativeReads,
  options: { readonly lifecycle: boolean; readonly remainingBytes: number; readonly reserveBytes: number;
    readonly watchFiles?: Set<string> }): Promise<AgyDescriptorPhase> {
  const runs = new Map<RunRecord, RunRecord>();
  let remaining = options.remainingBytes, bytesRead = 0;
  for (const conversation of conversations) {
    const allowance = Math.min(MAX_TRANSCRIPT_TAIL_BYTES, remaining - options.reserveBytes);
    const read = allowance < MIN_DESCRIPTOR_READ_BYTES ? unreadToolCalls("tool-names-budget-exhausted")
      : await reads.readToolCalls(conversation.storeRoot, conversation.conversation.conversationId, allowance, conversation.conversation.steps.length);
    remaining -= read.bytesRead; bytesRead += read.bytesRead;
    const path = reads.transcriptPath(conversation.storeRoot, conversation.conversation.conversationId);
    if (path !== null && read.gap !== "tool-names-source-missing" && read.gap !== "tool-names-budget-exhausted") options.watchFiles?.add(path);
    runs.set(conversation.run, agyActivity(conversation, read, options.lifecycle));
  }
  return { runs, bytesRead };
}
