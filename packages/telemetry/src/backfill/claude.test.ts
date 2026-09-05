/**
 * Fixtures here are shaped like the real store, not like the parser.
 *
 * The line types, the key names and the nesting were read off `~/.claude/projects/<slug>/*.jsonl`
 * on a live machine. A fixture invented from the parser proves only that the parser agrees with
 * itself, which is precisely the failure that made the title field worth checking on disk: it is
 * `customTitle`, not `title`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KNOWN_TYPES, parseClaudeTranscript, unknownTypeNote } from "./claude.js";
import { NOT_AN_OBJECT, NOT_JSON } from "./jsonl.js";

/** The record alone. Notes are asserted on directly in the degradation suite below. */
const parseRun = (text: string, origin = "o") => parseClaudeTranscript(text, origin).run;

const lines = (...records: readonly unknown[]): string =>
  records.map((r) => JSON.stringify(r)).join("\n");

const user = (text: string, over: Record<string, unknown> = {}) => ({
  parentUuid: null,
  isSidechain: false,
  type: "user",
  uuid: "u1",
  timestamp: "2026-09-04T22:00:00.000Z",
  sessionId: "5dc200b1-b629-4b56-b487-6990b69ef498",
  cwd: "/home/agent/projects/harness/repo",
  gitBranch: "orch/divybot-39",
  version: "2.0.0",
  message: { role: "user", content: text },
  ...over,
});

const assistant = (usage: Record<string, number>, over: Record<string, unknown> = {}) => ({
  parentUuid: "u1",
  isSidechain: false,
  type: "assistant",
  uuid: "a1",
  requestId: "req_1",
  timestamp: "2026-09-04T22:05:00.000Z",
  sessionId: "5dc200b1-b629-4b56-b487-6990b69ef498",
  cwd: "/home/agent/projects/harness/repo",
  gitBranch: "orch/divybot-39",
  effort: "medium",
  message: { role: "assistant", model: "claude-opus-5", usage },
  ...over,
});

describe("parseClaudeTranscript", () => {
  it("recovers identity, window and usage from a plain session", () => {
    const run = parseRun(
      lines(
        user("build the telemetry sink"),
        assistant({ input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 900, cache_creation_input_tokens: 7 }),
      ),
      "/store/a.jsonl",
    );

    assert.ok(run);
    assert.equal(run.id, "5dc200b1-b629-4b56-b487-6990b69ef498");
    assert.equal(run.source, "claude");
    assert.equal(run.startedAt, "2026-09-04T22:00:00.000Z");
    assert.equal(run.updatedAt, "2026-09-04T22:05:00.000Z");
    assert.equal(run.branch, "orch/divybot-39");
    assert.deepEqual(run.linkedIssues, [{ number: 39, from: "path" }]);
    assert.deepEqual(run.identity, {
      model: "claude-opus-5",
      effort: "medium",
      provider: "anthropic",
      // This seam records no lane. Reading one out of the title would be treating prose as data.
      profile: null,
    });
    assert.deepEqual(run.usage, {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 900,
      cacheWriteTokens: 7,
    });
    assert.equal(run.origin, "/store/a.jsonl");
  });

  it("sums usage across turns, because this seam reports a delta per turn", () => {
    // The opposite of Codex, which reports a running total. Getting the two the same way round is
    // the only reason the numbers on the two seams can be compared at all.
    const run = parseRun(
      lines(
        user("go"),
        assistant({ input_tokens: 10, output_tokens: 1 }),
        assistant({ input_tokens: 20, output_tokens: 2 }, { uuid: "a2", timestamp: "2026-09-04T22:09:00.000Z" }),
      ),
      "o",
    );
    assert.equal(run?.usage.inputTokens, 30);
    assert.equal(run?.usage.outputTokens, 3);
  });

  it("prefers the session's own name over the first prompt", () => {
    // Both are prose and neither survives onto the record, so the issue numbers are what makes the
    // precedence observable: #98 comes from the session name and #7 from the prompt it replaced.
    const run = parseRun(
      lines(
        user("some very long opening prompt about #7"),
        { type: "custom-title", customTitle: "telemetry sink #98", sessionId: "s1" },
      ),
      "o",
    );
    assert.deepEqual(run?.linkedIssues, [{ number: 39, from: "path" }, { number: 98, from: "prose" }]);
  });

  it("falls back to the first prompt when the session was never named", () => {
    const run = parseRun(lines(user("fix the label taxonomy in #42")), "o");
    assert.deepEqual(run?.linkedIssues, [{ number: 39, from: "path" }, { number: 42, from: "prose" }]);
  });

  it("puts none of the operator's words on the record it returns", () => {
    // The title and the working directory used to be fields on `RunRecord`. A run record is
    // printed, piped, pasted into issues and published by the board projection, so a field that can
    // hold a prompt eventually publishes one — finding F-5 on #105. Both are still read, and both
    // are dropped in the same function that read them.
    const run = parseRun(
      lines(user("the passphrase is hunter2", { cwd: "/home/someone/private/client-work" })),
      "o",
    );
    assert.ok(run);
    const published = JSON.stringify(run);
    assert.equal(published.includes("hunter2"), false, "the prompt reached the record");
    assert.equal(published.includes("client-work"), false, "the working directory reached the record");
  });

  it("survives a half-written last line, which is the normal state of a live transcript", () => {
    // Refusing the whole session to protest a truncated tail would lose the running work — the one
    // run an operator is most likely to be asking about.
    const text = `${lines(user("go"), assistant({ input_tokens: 5 }))}\n{"type":"assis`;
    const run = parseRun(text, "o");
    assert.ok(run);
    assert.equal(run.usage.inputTokens, 5);
  });

  it("reports an unknown outcome, because the store has no completion marker", () => {
    // A finished session and a session whose process was killed mid-turn produce the same file.
    // Claiming "complete" from the presence of an assistant turn would be inventing evidence.
    const run = parseRun(lines(user("go"), assistant({ input_tokens: 1 })), "o");
    assert.equal(run?.outcome, "unknown");
  });

  it("returns null for a file with no session identity rather than a half-empty record", () => {
    assert.equal(parseRun('{"type":"queue-operation"}', "o"), null);
    assert.equal(parseRun("", "o"), null);
  });

  it("leaves the model null when no assistant turn ever ran", () => {
    // A queued-but-never-dispatched session must not be reported as having run a model.
    const run = parseRun(lines(user("go")), "o");
    assert.deepEqual(run?.identity, { model: null, effort: null, provider: null, profile: null });
  });
});

describe("parseClaudeTranscript, on a transcript it cannot fully read", () => {
  it("survives a line that is JSON but not a record", () => {
    // Finding F-4 on #105. `JSON.parse("null")` returns null, the old parser cast it to Line and
    // read `.sessionId` off it, and the TypeError escaped the whole scan.
    const text = `${lines(user("go"))}\nnull\n${lines(assistant({ input_tokens: 1 }))}`;
    const { run, notes } = parseClaudeTranscript(text, "o");
    assert.equal(run?.id, "5dc200b1-b629-4b56-b487-6990b69ef498");
    assert.deepEqual(notes, [{ reason: NOT_AN_OBJECT, lines: 1 }]);
  });

  it("survives a record whose message is null rather than absent", () => {
    // `message !== undefined` is true for a JSON null, and the field read behind it threw.
    const text = lines(user("go"), assistant({ input_tokens: 1 }, { message: null }));
    const { run } = parseClaudeTranscript(text, "o");
    assert.equal(run?.identity.model, null);
    assert.deepEqual(run?.usage, {});
  });

  it("counts a truncated tail instead of passing it over in silence", () => {
    const text = `${lines(user("go"))}\n{"type":"assistant","timestamp":`;
    const { run, notes } = parseClaudeTranscript(text, "o");
    assert.equal(run?.updatedAt, "2026-09-04T22:00:00.000Z");
    assert.deepEqual(notes, [{ reason: NOT_JSON, lines: 1 }]);
  });

  it("reports a record type it does not understand", () => {
    // Finding F-9. The note is the signal to extend KNOWN_TYPES; until someone does, the unread
    // record is visibly unread rather than quietly absent.
    const text = lines(user("go"), { type: "warp-drive", timestamp: "2026-09-05T09:00:00.000Z" });
    const { notes } = parseClaudeTranscript(text, "o");
    assert.deepEqual(notes, [{ reason: unknownTypeNote("warp-drive"), lines: 1 }]);
  });

  it("does not let a record it could not read say when the run was last active", () => {
    // An unread record is not evidence that an agent did something, and `updatedAt` is exactly
    // that claim. Reporting activity at 09:00 on the strength of a record nobody parsed is how a
    // dead run looks alive on the board.
    const text = lines(user("go"), { type: "warp-drive", timestamp: "2026-09-05T09:00:00.000Z" });
    const { run } = parseClaudeTranscript(text, "o");
    assert.equal(run?.updatedAt, "2026-09-04T22:00:00.000Z");
  });

  it("says nothing when it read everything", () => {
    const { notes } = parseClaudeTranscript(lines(user("go"), assistant({})), "o");
    assert.deepEqual(notes, []);
  });

  it("reports every type the local store was observed to contain as known", () => {
    // The census this list came from. A type dropping out of KNOWN_TYPES would start producing
    // notes for ordinary traffic, which is the fastest way to teach an operator to ignore them.
    for (const type of [
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
    ]) {
      assert.equal(KNOWN_TYPES.has(type), true, `${type} is not in KNOWN_TYPES`);
    }
  });
});
