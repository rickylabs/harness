/**
 * One verified conversation's tool-call descriptors and the receipt coverage is computed from. The log
 * names calls; it never decides their lifecycle, and its status and time fields are not read.
 */
import { join } from "node:path";
import type { NativeToolCallDescriptor, NativeToolCallRead } from "@rickylabs/harness-contracts";
import { describeCall } from "../domain/tool-vocabulary.js";
import { AGY_CONVERSATION_ID } from "../domain/trajectory.js";
import { decodeTranscriptLine, type TranscriptLine } from "../domain/transcript-line.js";
import type { TranscriptTail } from "../ports/transcript-tail.js";

export const MAX_TRANSCRIPT_TAIL_BYTES = 1_048_576;
const unread = (gap: Exclude<NativeToolCallRead["gap"], null | "tool-names-truncated">, bytesRead = 0): NativeToolCallRead =>
  ({ calls: [], decodedPlannerSteps: [], vendorTruncatedSteps: [], fromStart: false, fromStepIndex: null, bytesRead, gap });

/** The log path, derived only from a conversation id the caller has verified; null for any other id. */
export function agyTranscriptPath(storeRoot: string, conversationId: string): string | null {
  return AGY_CONVERSATION_ID.test(conversationId)
    ? join(storeRoot, "brain", conversationId, ".system_generated", "logs", "transcript.jsonl") : null;
}

export async function readAgyToolCalls(tail: TranscriptTail, storeRoot: string, conversationId: string,
  maxBytes: number, stepCount: number): Promise<NativeToolCallRead> {
  const path = agyTranscriptPath(storeRoot, conversationId);
  if (path === null || !Number.isSafeInteger(stepCount) || stepCount < 0) return unread("tool-names-source-missing");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return unread("tool-names-budget-exhausted");
  const read = await tail.read(storeRoot, path, Math.min(maxBytes, MAX_TRANSCRIPT_TAIL_BYTES));
  if (read.bytes === null) return unread("tool-names-source-missing");
  const bytesRead = read.bytes.length;
  let body = read.bytes;
  // A tail starts inside a line, and a writer may be mid-append: only whole lines count.
  if (!read.fromStart) body = body.subarray(body.indexOf(10) + 1);
  const last = body.lastIndexOf(10);
  body = body.subarray(0, last + 1);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { return unread("tool-names-source-invalid", bytesRead); }
  const lines = new Map<number, TranscriptLine>();
  let fromStepIndex = stepCount;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const decoded = decodeTranscriptLine(line);
    if (decoded === null) return unread("tool-names-source-invalid", bytesRead);
    if (decoded.stepIndex >= stepCount) continue;
    fromStepIndex = Math.min(fromStepIndex, decoded.stepIndex);
    lines.set(decoded.stepIndex, decoded); // The vendor rewrites a step by appending; the last line wins.
  }
  const calls: NativeToolCallDescriptor[] = [], decodedPlannerSteps: number[] = [], vendorTruncatedSteps: number[] = [];
  for (const line of [...lines.values()].sort((a, b) => a.stepIndex - b.stepIndex)) {
    if (!line.planner) continue;
    decodedPlannerSteps.push(line.stepIndex);
    if (line.vendorTruncated) { vendorTruncatedSteps.push(line.stepIndex); continue; }
    line.calls.forEach((call, index) => calls.push(describeCall(line.stepIndex, index, call)));
  }
  return { calls, decodedPlannerSteps, vendorTruncatedSteps, fromStart: read.fromStart,
    fromStepIndex, bytesRead, gap: null };
}
