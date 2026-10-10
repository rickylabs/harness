/**
 * Strict decoding of one `transcript.jsonl` line, the conversation log whose path agy's hooks publish
 * as `transcriptPath`. The vendor documents the path, not the schema: the keys read here were measured
 * on agy 1.3.2, and anything outside these bounds makes the whole read invalid rather than guessed.
 */
import type { TranscriptCall } from "./tool-vocabulary.js";

export const MAX_LINE_BYTES = 262_144;
export const MAX_STEP_INDEX = 4096;
export const MAX_CALLS_PER_LINE = 64;
export const MAX_ARGUMENT_CHARS = 4096;
const MAX_TRUNCATED_FIELDS = 16, MAX_FIELD_CHARS = 64, MAX_NAME_CHARS = 128;
/** Vendor truncation of prose never touches a call; any other truncated field might. */
const PROSE_FIELDS: ReadonlySet<string> = new Set(["content", "thinking"]);

export type TranscriptLine =
  | { readonly stepIndex: number; readonly planner: false }
  | { readonly stepIndex: number; readonly planner: true; readonly calls: readonly TranscriptCall[];
      readonly vendorTruncated: boolean };

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const argument = (value: unknown): string | null =>
  typeof value === "string" && value.length <= MAX_ARGUMENT_CHARS ? value : null;

/** One line, or null when it breaks a bound; a single invalid line invalidates the read. */
export function decodeTranscriptLine(line: string): TranscriptLine | null {
  if (new TextEncoder().encode(line).length > MAX_LINE_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!plain(value)) return null;
  const stepIndex = value["step_index"], type = value["type"], truncated = value["truncated_fields"];
  if (typeof stepIndex !== "number" || !Number.isSafeInteger(stepIndex) || stepIndex < 0 ||
      stepIndex > MAX_STEP_INDEX || typeof type !== "string") return null;
  if (truncated !== undefined && (!Array.isArray(truncated) || truncated.length > MAX_TRUNCATED_FIELDS ||
      truncated.some(field => typeof field !== "string" || field.length > MAX_FIELD_CHARS))) return null;
  if (type !== "PLANNER_RESPONSE") return { stepIndex, planner: false };
  const raw = value["tool_calls"] ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_CALLS_PER_LINE) return null;
  const calls: TranscriptCall[] = [];
  for (const call of raw) {
    if (!plain(call) || typeof call["name"] !== "string" || call["name"].length > MAX_NAME_CHARS) return null;
    const args = call["args"] ?? {};
    if (!plain(args)) return null;
    calls.push({ name: call["name"], commandLine: argument(args["CommandLine"]),
      path: argument(args["AbsolutePath"] ?? args["TargetFile"]) });
  }
  const vendorTruncated = ((truncated ?? []) as string[]).some(field => !PROSE_FIELDS.has(field));
  return { stepIndex, planner: true, calls, vendorTruncated };
}
