/**
 * agy activity beyond assistant text: provider-named tool calls joined to the native trajectory, which
 * stays the only authority for which steps exist, when they happened and how they ended. A call is
 * never paired with a result (that correlation is unproven), so a named call's state is `unknown`.
 * State, unnamed result steps and coverage appear only when lifecycle publication is requested.
 */
import { isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_ACTIVITY_GAPS, MAX_AGENT_ACTIVITY_STEPS, type AgentActivityGap, type NativeToolCallRead } from "@rickylabs/harness-contracts";
import { MAX_TRANSCRIPT_TAIL_BYTES } from "@rickylabs/provider-agy";
import type { AgyNativeReads } from "../agy-reads.js";
import type { RunRecord } from "../model.js";
import { nativeToolActivity, recentActivity } from "../native-activity.js";
import { agyResultState, AGY_PENDING_STATUSES, AGY_STEP_TYPE } from "./agy-status.js";

/** One trajectory row as the completion authority accepted it. */
export interface AgyStepFact { readonly idx: number; readonly type: number; readonly status: number; readonly at: string }
/** One accepted conversation and the private facts its descriptor read is joined against. */
export interface AgyConversationRead {
  readonly run: RunRecord;
  readonly storeRoot: string;
  readonly conversationId: string;
  readonly stepCount: number;
  readonly facts: readonly AgyStepFact[];
  /** The single local workspace root, or null: paths are then never published. */
  readonly workspaceRoot: string | null;
}

/** Disjoint id slots: messages keep part 0 (unchanged ids), calls take 1..64, results 1000. */
export const agyActivitySlot = { message: 0, call: (index: number) => 1 + index, result: 1000 } as const;
/** A descriptor read smaller than this is skipped as budget-exhausted rather than taken partially. */
export const MIN_DESCRIPTOR_READ_BYTES = 65_536;

/** Exactly one `file:///` root, absolute and normalized; anything else relativizes nothing. */
export function agyWorkspaceRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const roots: unknown = JSON.parse(value);
    if (!Array.isArray(roots) || roots.length !== 1 || typeof roots[0] !== "string" || !roots[0].startsWith("file:///")) return null;
    // The URL parser resolves dot segments; the stored text itself must already be the normalized path.
    const path = fileURLToPath(roots[0]);
    return decodeURIComponent(roots[0].slice("file://".length)) === path && isAbsolute(path) && normalize(path) === path &&
      path !== "/" && !/[\x00-\x1f\x7f]/.test(path) ? path : null;
  } catch { return null; }
}

const budgetExhausted: NativeToolCallRead = { calls: [], decodedPlannerSteps: [], vendorTruncatedSteps: [], fromStart: false,
  fromStepIndex: null, bytesRead: 0, gap: "tool-names-budget-exhausted" };

/** Join one conversation's descriptor read to its authority facts. */
export function agyActivity(conversation: AgyConversationRead, read: NativeToolCallRead, lifecycle: boolean): RunRecord {
  const { run, facts, conversationId, workspaceRoot } = conversation;
  const plannerAt = new Map(facts.filter(f => f.type === AGY_STEP_TYPE.planner).map(f => [f.idx, f.at]));
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
    if (!inWindow.has(call.stepIndex) || call.callIndex >= 64) return [];
    const step = nativeToolActivity("agy-transcript", conversationId, call.stepIndex, agyActivitySlot.call(call.callIndex),
      plannerAt.get(call.stepIndex)!, { kind: call.kind, toolName: call.toolName, commandLine: call.commandLine,
        relativePath: relative(call.path) }, lifecycle ? "unknown" : undefined);
    return step === null ? [] : [step];
  });
  const inProgress = new Set<string>();
  const results = !lifecycle ? [] : facts.filter(f => f.type === AGY_STEP_TYPE.result).flatMap(f => {
    const step = nativeToolActivity("agy-transcript", conversationId, f.idx, agyActivitySlot.result, f.at, null, agyResultState(f.status));
    if (step !== null && AGY_PENDING_STATUSES.includes(f.status)) inProgress.add(step.id);
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
export async function attachAgyDescriptors(conversations: readonly AgyConversationRead[], reads: AgyNativeReads,
  options: { readonly lifecycle: boolean; readonly remainingBytes: number; readonly reserveBytes: number;
    readonly watchFiles?: Set<string> }): Promise<AgyDescriptorPhase> {
  const runs = new Map<RunRecord, RunRecord>();
  let remaining = options.remainingBytes, bytesRead = 0;
  for (const conversation of conversations) {
    const allowance = Math.min(MAX_TRANSCRIPT_TAIL_BYTES, remaining - options.reserveBytes);
    const read = allowance < MIN_DESCRIPTOR_READ_BYTES ? budgetExhausted
      : await reads.readToolCalls(conversation.storeRoot, conversation.conversationId, allowance, conversation.stepCount);
    remaining -= read.bytesRead; bytesRead += read.bytesRead;
    const path = reads.transcriptPath(conversation.storeRoot, conversation.conversationId);
    if (path !== null && read.gap !== "tool-names-source-missing" && read.gap !== "tool-names-budget-exhausted") options.watchFiles?.add(path);
    runs.set(conversation.run, agyActivity(conversation, read, options.lifecycle));
  }
  return { runs, bytesRead };
}
