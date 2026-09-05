/**
 * Backfill from the Claude transcript store: `~/.claude/projects/<slug>/<id>.jsonl`.
 *
 * A coordinator crash must not lose the history, so the recovery path cannot depend on any event
 * having been delivered anywhere. This reads the files the CLI already writes for its own resume
 * support, which means the record survives a crash of everything in this repository.
 *
 * The parse is deliberately tolerant: a transcript is an append-only log written by a live process,
 * so its last line is routinely a half-written one, and a strict parser would throw away a whole
 * session to save the operator from a truncated final record.
 */

import { linkedIssuesOf, type LaunchIdentity, type RunRecord, type RunUsage } from "../model.js";

/** One line of a transcript, reduced to the fields this package reads. */
interface Line {
  readonly type?: unknown;
  readonly uuid?: unknown;
  readonly sessionId?: unknown;
  readonly parentUuid?: unknown;
  readonly isSidechain?: unknown;
  readonly timestamp?: unknown;
  readonly cwd?: unknown;
  readonly gitBranch?: unknown;
  readonly effort?: unknown;
  readonly message?: {
    readonly role?: unknown;
    readonly model?: unknown;
    readonly content?: unknown;
    readonly usage?: Readonly<Record<string, unknown>>;
  };
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Add only the fields the vendor actually reported: an absent count is not a zero. */
function addUsage(into: Record<string, number>, usage: Readonly<Record<string, unknown>>): void {
  const map: Record<string, keyof RunUsage> = {
    input_tokens: "inputTokens",
    output_tokens: "outputTokens",
    cache_read_input_tokens: "cacheReadTokens",
    cache_creation_input_tokens: "cacheWriteTokens",
  };
  for (const [wire, field] of Object.entries(map)) {
    const value = num(usage[wire]);
    if (value !== undefined) into[field] = (into[field] ?? 0) + value;
  }
}

/**
 * Reduce one transcript file to a run record.
 *
 * `origin` is the path the text came from, passed in rather than read, so this function is testable
 * against a string and a snapshot is traceable back to a file.
 */
export function parseClaudeTranscript(text: string, origin: string): RunRecord | null {
  let sessionId: string | null = null;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let cwd: string | null = null;
  let branch: string | null = null;
  let title: string | null = null;
  let model: string | null = null;
  let effort: string | null = null;
  const usage: Record<string, number> = {};

  for (const raw of text.split("\n")) {
    if (raw.trim().length === 0) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      // A truncated tail is the normal state of a live transcript, not a corrupt file.
      continue;
    }

    sessionId ??= str(line.sessionId);
    cwd = str(line.cwd) ?? cwd;
    branch = str(line.gitBranch) ?? branch;

    const at = str(line.timestamp);
    if (at !== null) {
      firstAt ??= at;
      lastAt = at;
    }

    if (line.type === "custom-title") {
      // The CLI's own name for the session — the closest thing to a task title on this seam, and
      // written last-wins, so a renamed session reports the name it currently carries.
      title = str((line as { readonly customTitle?: unknown }).customTitle) ?? title;
    }

    if (line.type === "user" && title === null) {
      const content = line.message?.content;
      if (typeof content === "string") title = content.slice(0, 120);
    }

    if (line.type === "assistant" && line.message !== undefined) {
      model = str(line.message.model) ?? model;
      effort = str(line.effort) ?? effort;
      if (line.message.usage !== undefined) addUsage(usage, line.message.usage);
    }
  }

  if (sessionId === null || firstAt === null || lastAt === null) return null;

  const identity: LaunchIdentity = { model, effort, provider: model === null ? null : "anthropic" };
  return {
    id: sessionId,
    source: "claude",
    // The Claude store keeps subagents inline, flagged rather than filed separately, so a
    // transcript is always a root. The subagent tree on this seam is recovered from `isSidechain`
    // within the file, which is a different shape from opencode's and is reported as such.
    parentId: null,
    startedAt: firstAt,
    updatedAt: lastAt,
    title,
    cwd,
    branch,
    identity,
    usage: usage as RunUsage,
    // The Claude store writes no completion marker: a finished session and a session whose process
    // died mid-turn produce the same file. Reporting `unknown` is the honest reading; a caller with
    // a clock can compare `updatedAt` against now, but that is a judgement, not a fact in the file.
    outcome: "unknown",
    linkedIssues: linkedIssuesOf(branch, title),
    origin,
    quota: [],
  };
}
