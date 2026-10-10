/**
 * Decodes one agy conversation (its summary row and trajectory step rows) into the neutral
 * `AgyConversationSnapshot`. Every native code is interpreted here and nowhere else; a store whose
 * rows disagree with each other (payload, header, summary) is refused whole, never partly believed.
 */
import type { AgyConversationSnapshot, AgyStepKind, AgyStepStatus, AgyStopReason, AgySummaryState,
  AgyTrajectoryStep } from "@rickylabs/harness-contracts";
import { nested, numeric, protobuf, sameBytes, text, timestamp } from "./protobuf.js";

export const AGY_CONVERSATION_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const MAX_STEPS = 4096;
const USER = 14, PLANNER = 15, RESULT = 132;
/** Every status a trajectory step may carry; any other value refuses the conversation. */
const STATUSES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12];

export const agyStepKind = (type: number): AgyStepKind => type === USER ? "user" : type === PLANNER ? "planner" : type === RESULT ? "result" : "other";
export function agyStepStatus(status: number): AgyStepStatus {
  if ([1, 2, 8, 9, 11].includes(status)) return "pending";
  if (status === 3) return "done";
  if (status === 7) return "error";
  return [6, 12].includes(status) ? "cancelled" : "other";
}
/** STOP_PATTERN is the native explicit stop; 16 cancels; 13 and 17-20 are errors. */
export function agyStopReason(stop: number | null): AgyStopReason | null {
  if (stop === null) return null;
  if (stop === 2) return "explicit-stop";
  if (stop === 16) return "cancelled";
  return [13, 17, 18, 19, 20].includes(stop) ? "error" : "other";
}
const summaryState = (state: number): AgySummaryState => state === 1 ? "idle" : [2, 4].includes(state) ? "active" : "other";
const blob = (value: unknown): Uint8Array | null => value instanceof Uint8Array ? value : null;

export type StoreRow = Readonly<Record<string, unknown>>;

/** Pure decoding; titles, prompts, thinking and tool output are never selected. Null when incoherent. */
export function decodeAgyConversation(summary: StoreRow, rows: readonly StoreRow[], origin: string, nowMs: number,
  workspaceRoot: string | null): AgyConversationSnapshot | null {
  try {
    const id = summary["conversation_id"], parent = summary["parent_conversation_id"], stepCount = summary["step_count"];
    if (typeof id !== "string" || !AGY_CONVERSATION_ID.test(id) || (parent !== null && parent !== "" &&
        (!AGY_CONVERSATION_ID.test(parent as string) || parent === id))) return null;
    const raw = blob(summary["raw_summary"]);
    if (stepCount !== rows.length || rows.length > MAX_STEPS || raw === null) return null;
    const native = protobuf(raw), trajectory = summary["trajectory_id"];
    if (typeof trajectory !== "string" || !AGY_CONVERSATION_ID.test(trajectory) ||
        text(native, 4) !== trajectory || numeric(native, 2) !== stepCount) return null;
    // The native summary points to the trajectory. The SQL user-index column can lag by one in
    // 1.2.14; terminal authority comes from the protobuf summary and the actual steps.
    const nativeUserIndex = numeric(native, 16) ?? 0;
    const startedAt = timestamp(native, 7, nowMs);
    if (startedAt === null) return null;
    const steps: AgyTrajectoryStep[] = [];
    let updatedAt = startedAt, latestUser = -1;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!, type = row["step_type"], status = row["status"];
      if (row["idx"] !== index || row["step_format"] !== 0 || typeof type !== "number" ||
          typeof status !== "number" || !STATUSES.includes(status)) return null;
      const payload = blob(row["step_payload"]), metadata = blob(row["metadata"]);
      if (payload === null || metadata === null) return null;
      const frame = protobuf(payload), header = protobuf(metadata), embedded = frame.get(5);
      if (numeric(frame, 1) !== type || numeric(frame, 4) !== status || type === PLANNER && embedded === undefined ||
          embedded !== undefined && (!(embedded instanceof Uint8Array) || !sameBytes(embedded, metadata))) return null;
      const at = timestamp(header, 1, nowMs), completed = timestamp(header, 8, nowMs);
      if (at === null || at < startedAt || completed !== null && completed < at) return null;
      const recent = timestamp(header, 22, nowMs) ?? completed ?? at;
      if (recent > updatedAt) updatedAt = recent;
      if (type === USER) latestUser = index;
      const response = type === PLANNER ? nested(frame, 20) : null;
      const errorDetails = blob(row["error_details"]);
      steps.push({ index, kind: agyStepKind(type), status: agyStepStatus(status), createdAt: at, completedAt: completed,
        hasResponse: response !== null,
        responseText: response === null ? null : text(response, 8) ?? text(response, 1),
        stopReason: response === null ? null : agyStopReason(numeric(response, 12)),
        hasError: errorDetails !== null && errorDetails.length > 0 });
    }
    if (nativeUserIndex !== latestUser) return null;
    const modifiedAt = timestamp(native, 3, nowMs);
    if (modifiedAt === null || modifiedAt < updatedAt) return null;
    return { conversationId: id, parentId: typeof parent === "string" && parent !== "" ? parent : null, origin, startedAt, updatedAt,
      summaryState: summaryState(numeric(native, 5) ?? 0), summaryRunning: (numeric(native, 21) ?? 0) !== 0,
      childActive: (numeric(native, 18) ?? 0) !== 0, notFullyIdle: summary["not_fully_idle"] !== 0,
      killedColumn: summary["killed"] !== 0, killedNative: (numeric(native, 23) ?? 0) !== 0,
      interrupted: (numeric(native, 25) ?? 0) !== 0, steps, workspaceRoot };
  } catch { return null; }
}
