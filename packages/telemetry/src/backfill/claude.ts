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
 *
 * Tolerant is not the same as silent. Every line this function declines to read is counted and
 * returned, because "nothing else happened in this session" and "I could not read the rest of this
 * session" are different answers and the operator is the one who has to tell them apart.
 *
 * ## What a run is on this seam
 *
 * A transcript states a `sessionId` on every line, and the store names each file after a session.
 * Those are not always the same session, and the difference is the subagent tree.
 *
 * A subagent is filed as its own transcript, named after itself, and every line inside it carries
 * the id of the session that *spawned* it. So reading the run id off the line — which is the only
 * thing this parser used to do — files every subagent under its parent's id, as a root, with the
 * parent's branch and the parent's issue links. On a store of 161 transcripts, 154 of them were
 * sidechains shaped exactly that way; the six roots were the only files whose stated id was their
 * own. That is not a rounding error in the board, it is the board.
 *
 * The rule below reads both shapes. A transcript whose lines are sidechains and whose stated id is
 * somebody else's is a subagent: its id is its own file's, and the stated id is its parent. Anything
 * else is a root and keeps the stated id, which covers a session that carries its subagents inline
 * and a session resumed into a second file — the latter deliberately, because both files are that
 * session and `snapshot.ts` is written to expect the repeat.
 */

import { basename } from "node:path";

import { linkedIssuesOf, type LaunchIdentity, type RunRecord, type RunUsage } from "../model.js";
import {
  NoteTally,
  type JsonObject,
  type ParsedTranscript,
  parseLineWithReason,
  typeLabel,
} from "./jsonl.js";

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
  readonly message?: unknown;
}

/**
 * The record types this store was observed to contain.
 *
 * This is a census, not a specification: it is what a scan of the local store actually found, and
 * the CLI is free to add to it tomorrow. That is precisely why an unrecognised type produces a note
 * instead of being ignored — the note is the signal to come back and extend this list, and until
 * someone does, an unread record is visibly unread rather than quietly absent.
 */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "assistant",
  "attachment",
  "atis-latch",
  "bridge-session",
  "custom-title",
  "last-prompt",
  "mode",
  "pr-link",
  "queue-operation",
  "system",
  "user",
]);

/** An unrecognised record type, as it appears in a note. */
export const unknownTypeNote = (type: unknown): string =>
  `unrecognised record type "${typeLabel(type)}"`;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const obj = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

/** Add only the fields the vendor actually reported: an absent count is not a zero. */
function addUsage(into: Record<string, number>, usage: JsonObject): void {
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
export function parseClaudeTranscript(
  text: string,
  origin: string,
): ParsedTranscript<RunRecord> {
  const tally = new NoteTally();
  let sessionId: string | null = null;
  let sidechain = false;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  // Read, used, and dropped: the title is the operator's own words, and all this function wants
  // from it is the issue numbers in it. See the note on `RunRecord`.
  let branch: string | null = null;
  let title: string | null = null;
  let model: string | null = null;
  let effort: string | null = null;
  const usage: Record<string, number> = {};

  for (const raw of text.split("\n")) {
    if (raw.trim().length === 0) continue;
    const parsed = parseLineWithReason(raw);
    if (parsed.line === null) {
      tally.bump(parsed.reason ?? "line(s) this parser could not read");
      continue;
    }
    const line = parsed.line as Line;

    sessionId ??= str(line.sessionId);
    // Any line, not every line: a transcript that holds a sidechain turn at all was written by a
    // subagent, and requiring unanimity would turn one unflagged housekeeping record into a run
    // filed under the wrong id.
    if (line.isSidechain === true) sidechain = true;
    branch = str(line.gitBranch) ?? branch;

    // A record whose type this parser does not understand must not move the session's clock. It is
    // read for identity — losing a session id to a schema addition would be worse — but a run's
    // `updatedAt` is a claim about when its agent last did something, and an unread record is not
    // evidence of that. Finding F-9 on #105.
    const known = typeof line.type === "string" && KNOWN_TYPES.has(line.type);
    if (!known) tally.bump(unknownTypeNote(line.type));

    const at = str(line.timestamp);
    if (at !== null && known) {
      firstAt ??= at;
      lastAt = at;
    }

    if (line.type === "custom-title") {
      // The CLI's own name for the session — the closest thing to a task title on this seam, and
      // written last-wins, so a renamed session reports the name it currently carries.
      title = str((line as { readonly customTitle?: unknown }).customTitle) ?? title;
    }

    if (line.type === "user" && title === null) {
      const content = obj(line.message)?.["content"];
      if (typeof content === "string") title = content.slice(0, 120);
    }

    if (line.type === "assistant") {
      // `message` arrives as whatever the file says: a null here is a JSON null, not an absent key,
      // and reaching through it without the guard is the same crash finding F-4 named.
      const message = obj(line.message);
      if (message !== null) {
        model = str(message["model"]) ?? model;
        effort = str(line.effort) ?? effort;
        const reported = obj(message["usage"]);
        if (reported !== null) addUsage(usage, reported);
      }
    }
  }

  const notes = tally.notes();
  if (sessionId === null || firstAt === null || lastAt === null) return { run: null, notes };

  // The store names each transcript after the session it records, so the file is the identity when
  // the lines inside are talking about somebody else. `.jsonl` is the whole test: the scan hands
  // this function nothing else, and a caller that passed a label rather than a path has no child
  // name to give, so it gets the stated id rather than a run filed under a word.
  const own = origin.endsWith(".jsonl") ? basename(origin, ".jsonl") : "";
  const subagent = sidechain && own.length > 0 && own !== sessionId;

  const identity: LaunchIdentity = {
    model,
    effort,
    provider: model === null ? null : "anthropic",
    // This seam records no lane, and inferring one from the title would be reading prose as data.
    profile: null,
  };
  return {
    run: {
      id: subagent ? own : sessionId,
      source: "claude",
      // The sidechain flag plus the file's own name is this seam's subagent tree. It is weaker
      // evidence than opencode's `parent_id` column — it is two facts read together rather than one
      // stated — but it is a fact the store wrote, not an inference from prose.
      parentId: subagent ? sessionId : null,
      startedAt: firstAt,
      updatedAt: lastAt,
      branch,
      identity,
      usage: usage as RunUsage,
      // The Claude store writes no completion marker: a finished session and a session whose process
      // died mid-turn produce the same file. Reporting `unknown` is the honest reading; a caller
      // with a clock can compare `updatedAt` against now, but that is a judgement, not a fact.
      outcome: "unknown",
      linkedIssues: linkedIssuesOf(branch, title),
      origin,
      quota: [],
    },
    notes,
  };
}
