/**
 * Backfill from the Codex rollout store: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 *
 * This seam is the richest of the three, and the only one that answers "why is nothing running"
 * without a second call: every `token_count` event carries the account's `rate_limits` block, so a
 * subscription window's position is recoverable from a transcript that was written for entirely
 * different reasons. Reading it here costs nothing and needs no credential.
 *
 * `turn_context` carries the model and the reasoning effort actually in force for the turn, which
 * is the harness invariant that launch identity is data rather than prose. A run that claims one
 * model in its brief and reports another here is a routing failure, and this is where it shows.
 */

import { linkedIssuesOf, type QuotaReading, type RunRecord, type RunUsage } from "../model.js";
import {
  isoFromMillis,
  NoteTally,
  type JsonObject,
  type ParsedTranscript,
  parseLineWithReason,
  typeLabel,
} from "./jsonl.js";

interface Envelope {
  readonly timestamp?: unknown;
  readonly type?: unknown;
  readonly payload?: unknown;
}

/**
 * The envelope types this store was observed to contain.
 *
 * Only the envelope is treated as a closed set. `payload.type` is an open union — one member per
 * item kind the model can emit, and a new tool adds one — so an unrecognised payload kind is
 * expected traffic rather than a gap in this reader. An unrecognised *envelope* is not: it means a
 * whole class of record is going unread, and the note is how that reaches an operator.
 */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "compacted",
  "event_msg",
  "response_item",
  "session_meta",
  "turn_context",
]);

/** An unrecognised envelope type, as it appears in a note. */
export const unknownTypeNote = (type: unknown): string =>
  `unrecognised record type "${typeLabel(type)}"`;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const obj = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;

/**
 * Convert the vendor's Unix second to ISO 8601.
 *
 * Returns `null` rather than an epoch string for a missing value: `1970-01-01` presented as a quota
 * reset time is worse than admitting the transcript did not say. It also returns `null` rather than
 * throwing for a value too large to be a date — `resets_at` is a number in a file this package does
 * not write, and one absurd value must not end a scan (finding F-4 on #105).
 */
export function isoFromUnixSeconds(seconds: unknown): string | null {
  const value = num(seconds);
  if (value === null) return null;
  return isoFromMillis(value * 1000);
}

/** Pull the account's window position out of a `token_count` event's `rate_limits` block. */
export function quotaFromRateLimits(
  rateLimits: JsonObject,
  observedAt: string,
): QuotaReading | null {
  const primary = obj(rateLimits["primary"]);
  const credits = obj(rateLimits["credits"]);
  if (primary === null && credits === null) return null;
  return {
    source: "codex",
    observedAt,
    limitId: str(rateLimits["limit_id"]),
    usedPercent: primary === null ? null : num(primary["used_percent"]),
    windowMinutes: primary === null ? null : num(primary["window_minutes"]),
    resetsAt: primary === null ? null : isoFromUnixSeconds(primary["resets_at"]),
    planType: str(rateLimits["plan_type"]),
    creditBalance: credits === null ? null : str(credits["balance"]),
  };
}

/** Reduce one rollout file to a run record. `origin` is the path it came from. */
export function parseCodexRollout(text: string, origin: string): ParsedTranscript<RunRecord> {
  const tally = new NoteTally();
  let id: string | null = null;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let cwd: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  let effort: string | null = null;
  let title: string | null = null;
  // The last thing the transcript said about its own state, which is exactly what can be claimed.
  // A rollout that starts a turn and stops mid-stream leaves `running` standing, and that is the
  // true reading: nothing in the file says it ever finished.
  let outcome: RunRecord["outcome"] = "unknown";
  const usage: Record<string, number> = {};
  const quota: QuotaReading[] = [];

  for (const raw of text.split("\n")) {
    if (raw.trim().length === 0) continue;
    const parsed = parseLineWithReason(raw);
    if (parsed.line === null) {
      tally.bump(parsed.reason ?? "line(s) this parser could not read");
      continue;
    }
    const line = parsed.line as Envelope;

    // An unread record does not get to say when this run was last active. Finding F-9 on #105.
    const known = typeof line.type === "string" && KNOWN_TYPES.has(line.type);
    if (!known) tally.bump(unknownTypeNote(line.type));

    const at = str(line.timestamp);
    if (at !== null && known) {
      firstAt ??= at;
      lastAt = at;
    }

    const payload = obj(line.payload);
    if (payload === null) continue;

    if (line.type === "session_meta") {
      id ??= str(payload["session_id"]) ?? str(payload["id"]);
      cwd = str(payload["cwd"]) ?? cwd;
      provider = str(payload["model_provider"]) ?? provider;
    }

    if (line.type === "turn_context") {
      model = str(payload["model"]) ?? model;
      cwd = str(payload["cwd"]) ?? cwd;
      const mode = obj(payload["collaboration_mode"]);
      const settings = mode === null ? null : obj(mode["settings"]);
      if (settings !== null) {
        effort = str(settings["reasoning_effort"]) ?? effort;
        model = str(settings["model"]) ?? model;
      }
    }

    const kind = str(payload["type"]);
    if (kind === "user_message" && title === null) {
      title = str(payload["message"])?.slice(0, 120) ?? null;
    }

    if (kind === "token_count") {
      const info = obj(payload["info"]);
      const total = info === null ? null : obj(info["total_token_usage"]);
      if (total !== null) {
        // Codex reports a running total rather than a delta, so this is an assignment. Summing it
        // would multiply the last turn's usage by the number of turns.
        const fields: Record<string, keyof RunUsage> = {
          input_tokens: "inputTokens",
          output_tokens: "outputTokens",
          reasoning_output_tokens: "reasoningTokens",
          cached_input_tokens: "cacheReadTokens",
        };
        for (const [wire, field] of Object.entries(fields)) {
          const value = num(total[wire]);
          if (value !== null) usage[field] = value;
        }
      }
      const limits = obj(payload["rate_limits"]);
      const reading = limits === null ? null : quotaFromRateLimits(limits, lastAt ?? "");
      if (reading !== null) quota.push(reading);
    }

    if (kind === "task_started") outcome = "running";
    if (kind === "task_complete") outcome = "complete";
    if (kind === "error" || kind === "stream_error" || kind === "turn_aborted") outcome = "failed";
  }

  const notes = tally.notes();
  if (id === null || firstAt === null || lastAt === null) return { run: null, notes };

  return {
    run: {
      id,
      source: "codex",
      parentId: null,
      startedAt: firstAt,
      updatedAt: lastAt,
      title,
      cwd,
      // A rollout does not record the branch; attribution on this seam comes from the working
      // directory the operator launched in, which the worktree layout makes meaningful.
      branch: null,
      identity: { model, effort, provider },
      usage: usage as RunUsage,
      outcome,
      linkedIssues: linkedIssuesOf(cwd, title),
      origin,
      quota,
    },
    notes,
  };
}
