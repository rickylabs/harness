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

import { parseClaudeTranscript } from "./claude.js";

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
    const run = parseClaudeTranscript(
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
    assert.deepEqual(run.linkedIssues, [39]);
    assert.deepEqual(run.identity, { model: "claude-opus-5", effort: "medium", provider: "anthropic" });
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
    const run = parseClaudeTranscript(
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
    const run = parseClaudeTranscript(
      lines(
        user("some very long opening prompt"),
        { type: "custom-title", customTitle: "telemetry sink", sessionId: "s1" },
      ),
      "o",
    );
    assert.equal(run?.title, "telemetry sink");
  });

  it("falls back to the first prompt when the session was never named", () => {
    const run = parseClaudeTranscript(lines(user("fix the label taxonomy")), "o");
    assert.equal(run?.title, "fix the label taxonomy");
  });

  it("survives a half-written last line, which is the normal state of a live transcript", () => {
    // Refusing the whole session to protest a truncated tail would lose the running work — the one
    // run an operator is most likely to be asking about.
    const text = `${lines(user("go"), assistant({ input_tokens: 5 }))}\n{"type":"assis`;
    const run = parseClaudeTranscript(text, "o");
    assert.ok(run);
    assert.equal(run.usage.inputTokens, 5);
  });

  it("reports an unknown outcome, because the store has no completion marker", () => {
    // A finished session and a session whose process was killed mid-turn produce the same file.
    // Claiming "complete" from the presence of an assistant turn would be inventing evidence.
    const run = parseClaudeTranscript(lines(user("go"), assistant({ input_tokens: 1 })), "o");
    assert.equal(run?.outcome, "unknown");
  });

  it("returns null for a file with no session identity rather than a half-empty record", () => {
    assert.equal(parseClaudeTranscript('{"type":"queue-operation"}', "o"), null);
    assert.equal(parseClaudeTranscript("", "o"), null);
  });

  it("leaves the model null when no assistant turn ever ran", () => {
    // A queued-but-never-dispatched session must not be reported as having run a model.
    const run = parseClaudeTranscript(lines(user("go")), "o");
    assert.deepEqual(run?.identity, { model: null, effort: null, provider: null });
  });
});
