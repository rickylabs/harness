/**
 * OpenCode session projection: one `GET /session/:id` reply (SDK `Session`) and its latest messages
 * (SDK `{ info: Message, parts: Part[] }[]`) into a run record. Pure; `opencode-issue.ts` does the
 * reads. The SDK's types describe the server's replies and do not check them, so every field read
 * here is checked, and a reply that is not what was assumed is no run at all (`null`), never a guess.
 *
 * Native header and part clocks are authoritative, checked against the caller's observation clock.
 * Assistant text and typed tool calls become public activity through the shared screen
 * (`native-activity.ts`), each tool call with its native lifecycle (`pending` | `running` |
 * `completed` | `error`) and the clocks that state defines; user text, reasoning, tool output and
 * tool titles are never read into a record. Tokens are the server's own session aggregate.
 */
import { createHash } from "node:crypto";
import type { AgentToolLifecycle } from "@rickylabs/harness-contracts";
import { nativeMessageActivity, openCodeToolActivity, recentActivity } from "./native-activity.js";
import type { RunRecord, RunUsage } from "./model.js";

export const sessionID = (v: unknown): v is string => typeof v === "string" && /^ses_[A-Za-z0-9_-]{1,252}$/.test(v);
const nativeID = (v: unknown, prefix: string): v is string => typeof v === "string" &&
  v.startsWith(prefix) && /^[A-Za-z0-9_-]{1,256}$/.test(v);
const providerID = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const modelID = (v: unknown): v is string => typeof v === "string" && /^~?[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v);
/** Bounded and non-empty only: the label is never a family or compatibility decision. */
const versionLabel = (v: unknown): boolean => typeof v === "string" && v.length > 0 && v.length <= 64;
const object = (v: unknown): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw Error();
  return v as Record<string, unknown>;
};
const boolean = (v: unknown): boolean => { if (v !== undefined && typeof v !== "boolean") throw Error(); return v === true; };
function millis(value: unknown, start: number, now: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < start || (value as number) > now ||
      !Number.isFinite(new Date(value as number).getTime())) throw Error();
  return value as number;
}
const knownErrors = new Set(["ProviderAuthError", "UnknownError", "MessageOutputLengthError", "MessageAbortedError",
  "StructuredOutputError", "ContextOverflowError", "ContentFilterError", "APIError"]);
const knownParts = new Set(["text", "reasoning", "tool", "step-start", "step-finish", "patch", "snapshot", "file",
  "agent", "retry", "compaction", "subtask"]);

/** SDK `UserMessage.summary` has descriptive diff metadata; only `AssistantMessage.summary` is a
 * boolean (compaction). Validate the metadata, then discard it rather than publishing its text.
 */
function messageSummary(value: unknown, assistant: boolean): boolean {
  if (assistant) return boolean(value);
  if (value === undefined) return false;
  const summary = object(value);
  if (Object.keys(summary).some(key => !["title", "body", "diffs"].includes(key)) ||
      (summary.title !== undefined && typeof summary.title !== "string") ||
      (summary.body !== undefined && typeof summary.body !== "string") || !Array.isArray(summary.diffs)) throw Error();
  for (const entry of summary.diffs) {
    const diff = object(entry);
    if (Object.keys(diff).some(key => !["file", "patch", "additions", "deletions", "status"].includes(key)) ||
        !Number.isFinite(diff.additions) || !Number.isFinite(diff.deletions) ||
        (diff.file !== undefined && typeof diff.file !== "string") ||
        (diff.patch !== undefined && typeof diff.patch !== "string") ||
        (diff.status !== undefined && !["added", "deleted", "modified"].includes(diff.status as string))) throw Error();
  }
  return false;
}

const tokenCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
/**
 * SDK `Session.tokens` ({input, output, reasoning, cache: {read, write}}): the server's sum over the
 * session's assistant messages, so the reading does not depend on how many messages were read.
 * Absent or malformed is no reading (`{}`), never zero.
 */
export function sessionTokens(value: unknown): RunUsage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const tokens = value as Record<string, unknown>, cache = tokens.cache as Record<string, unknown> | null | undefined;
  if (Object.keys(tokens).some(key => !["total", "input", "output", "reasoning", "cache"].includes(key)) ||
      cache === null || typeof cache !== "object" || Array.isArray(cache) ||
      Object.keys(cache).some(key => key !== "read" && key !== "write") ||
      ![tokens.input, tokens.output, tokens.reasoning, cache.read, cache.write].every(tokenCount) ||
      (tokens.total !== undefined && !tokenCount(tokens.total))) return {};
  return { inputTokens: tokens.input as number, outputTokens: tokens.output as number,
    reasoningTokens: tokens.reasoning as number, cacheReadTokens: cache.read as number, cacheWriteTokens: cache.write as number };
}

export interface OpenCodeSessionHead {
  readonly id: string;
  readonly parentID: string | null;
  readonly createdMs: number;
  readonly usage: RunUsage;
}
/** One SDK `Session`, or null when it is not one. */
export function readOpenCodeSession(value: unknown, nowMs: number): OpenCodeSessionHead | null {
  try {
    const session = object(value), time = object(session.time);
    if (!sessionID(session.id) || (session.parentID !== undefined && (!sessionID(session.parentID) ||
        session.parentID === session.id)) || !versionLabel(session.version)) return null;
    return { id: session.id, parentID: session.parentID ?? null, createdMs: millis(time.created, 1, nowMs),
      usage: sessionTokens(session.tokens) };
  } catch { return null; }
}

/** A tool's file argument inside the session's own root, made relative; anything else is left for the screen to refuse. */
function rootRelative(input: Record<string, unknown>, root: unknown): Record<string, unknown> {
  const file = input.filePath;
  if (typeof root !== "string" || root === "" || typeof file !== "string" || !file.startsWith(root + "/")) return input;
  return { ...input, filePath: file.slice(root.length + 1) };
}

/**
 * The run one session's latest messages describe. `windowed` says older messages exist that were not
 * read: then the first in-window assistant's parent may be an unread prompt, which is still the latest
 * prompt because nothing newer is outside the window. Done needs a native `stop` with text, no
 * pending tool continuation and the latest prompt as parent; a known native error keeps its clock.
 */
export function openCodeRun(head: OpenCodeSessionHead, value: unknown, windowed: boolean, origin: string,
  nowMs: number): RunRecord | null {
  try {
    const { id, createdMs: start } = head;
    if (!Array.isArray(value)) return null;
    const rows = value.map(entry => {
      const { info, parts } = object(entry);
      const data = object(info), time = object(data.time), created = millis(time.created, start, nowMs);
      if (!nativeID(data.id, "msg_") || data.sessionID !== id || !Array.isArray(parts)) throw Error();
      return { message: data.id, data, created, time, parts: parts.map(object) };
    }).sort((a, b) => a.created - b.created || a.message.localeCompare(b.message));
    const seen = new Set<string>(), seenParts = new Set<string>();
    const steps: NonNullable<RunRecord["activitySteps"]>[number][] = [];
    let latestUser: string | null = null, updated = start;
    let identity: RunRecord["identity"] = { model: null, provider: null, effort: null, profile: null };
    let outcome: RunRecord["outcome"] = "unknown", terminalAt: string | undefined, terminalCause: RunRecord["terminalCause"];
    for (const { message, data, created, time, parts } of rows) {
      if (seen.has(message)) return null; seen.add(message); updated = Math.max(updated, created);
      const assistant = data.role === "assistant";
      if (data.role !== "user" && !assistant) return null;
      let nonempty = false, continuation = false, lastPart = created;
      const summary = messageSummary(data.summary, assistant);
      const root = assistant && data.path !== undefined ? object(data.path).root : undefined;
      for (const part of parts) {
        if (!knownParts.has(part.type as string) || !nativeID(part.id, "prt_") || seenParts.has(part.id) ||
            part.messageID !== message || part.sessionID !== id) return null;
        seenParts.add(part.id);
        const stable = createHash("sha256").update(id + "\0" + message + "\0" + part.id).digest("hex");
        if (part.type === "text") {
          const synthetic = boolean(part.synthetic), ignored = boolean(part.ignored);
          if (typeof part.text !== "string") return null;
          const clock = part.time === undefined ? null : object(part.time);
          const at = clock === null ? created : millis(clock.start, created, nowMs);
          const end = clock?.end === undefined ? at : millis(clock.end, at, nowMs);
          lastPart = Math.max(lastPart, end); updated = Math.max(updated, end);
          if (assistant && !summary && !synthetic && !ignored && part.text.trim() !== "") {
            nonempty = true;
            const step = nativeMessageActivity("opencode-transcript", stable, 0, new Date(at).toISOString(), part.text);
            if (step !== null) steps.push(step);
          }
        } else if (part.type === "tool") {
          const state = object(part.state), metadata = part.metadata === undefined ? {} : object(part.metadata);
          const status = state.status;
          if (status !== "pending" && status !== "running" && status !== "completed" && status !== "error") return null;
          // A requested call has not run: no clock. Every later state carries the native ones it defines.
          const clock = status === "pending" ? null : object(state.time);
          const at = clock === null ? created : millis(clock.start, created, nowMs);
          const end = clock === null || status === "running" ? at : millis(clock.end, at, nowMs);
          lastPart = Math.max(lastPart, end); updated = Math.max(updated, end);
          if (assistant) {
            const input = state.input === undefined ? {} : object(state.input);
            const iso = (ms: number) => new Date(ms).toISOString();
            const lifecycle: AgentToolLifecycle = status === "pending" ? { state: status, startedAt: null, endedAt: null }
              : status === "running" ? { state: status, startedAt: iso(at), endedAt: null }
                : { state: status, startedAt: iso(at), endedAt: iso(end) };
            const step = openCodeToolActivity(stable, iso(at), part.tool, rootRelative(input, root), lifecycle);
            if (step !== null) steps.push(step);
          }
          // Even completed tool calls normally need a subsequent model turn.
          const stateMetadata = state.metadata === undefined ? {} : object(state.metadata);
          const orphan = state.status === "error" && boolean(stateMetadata.interrupted);
          if (assistant && !boolean(metadata.providerExecuted) && !orphan) continuation = true;
        }
      }
      outcome = "running"; terminalAt = undefined; terminalCause = undefined;
      if (!assistant) { latestUser = message; continue; }
      if (!providerID(data.providerID) || !modelID(data.modelID) || (data.variant !== undefined &&
          (typeof data.variant !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(data.variant)))) return null;
      identity = { provider: data.providerID, model: data.providerID + "/" + data.modelID,
        effort: typeof data.variant === "string" ? data.variant : null, profile: null };
      if (windowed && latestUser === null && nativeID(data.parentID, "msg_")) latestUser = data.parentID;
      if (latestUser === null || data.parentID !== latestUser || summary) { outcome = "unknown"; continue; }
      if (time.completed === undefined) continue;
      const completed = millis(time.completed, Math.max(created, lastPart), nowMs); updated = Math.max(updated, completed);
      const error = data.error === undefined || data.error === null ? null : object(data.error);
      if (error !== null && knownErrors.has(error.name as string)) {
        outcome = "failed"; terminalCause = error.name === "MessageAbortedError" ? "cancelled" : "error";
        terminalAt = new Date(completed).toISOString();
      } else if (error === null && data.finish === "stop" && nonempty && !continuation) {
        outcome = "complete"; terminalAt = new Date(completed).toISOString();
      } else outcome = "unknown";
    }
    const activitySteps = recentActivity(steps);
    if (terminalAt !== undefined && steps.some(step => step.at > terminalAt!)) return null;
    return { id, source: "opencode", parentId: head.parentID, startedAt: new Date(start).toISOString(),
      updatedAt: new Date(updated).toISOString(), branch: null, identity, usage: head.usage, quota: [], linkedIssues: [],
      origin, activitySteps, outcome, ...(terminalAt === undefined ? {} : { terminalAt, terminalCause }) };
  } catch { return null; }
}
