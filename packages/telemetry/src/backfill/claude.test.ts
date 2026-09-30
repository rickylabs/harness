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

import { KNOWN_TYPES, OBSERVED_UNREAD_TYPES, parseClaudeTranscript, unknownTypeNote } from "./claude.js";
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
    // Used tokens count every processed input token: 10 uncached + 900 cache read + 7 cache write + 4 out.
    assert.deepEqual(run.tokenSamples?.points, [{ at: "2026-09-04T22:05:00.000Z", usedTokens: 921 }]);
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
    assert.deepEqual(run?.tokenSamples?.points, [
      { at: "2026-09-04T22:05:00.000Z", usedTokens: 11 },
      { at: "2026-09-04T22:09:00.000Z", usedTokens: 33 },
    ]);
  });

  it("counts a repeated assistant UUID once and retains sanitized tool activity", () => {
    const row = assistant({ input_tokens: 6, output_tokens: 2 }, {
      message: { role: "assistant", model: "claude-opus-5", usage: { input_tokens: 6, output_tokens: 2 },
        content: [{ type: "tool_use", name: "Read", input: { file_path: "src/index.ts" } }] },
    });
    const run = parseRun(lines(user("PRIVATE-PROMPT-CANARY"), row, row), "fixture-origin");
    assert.equal(run?.usage.inputTokens, 6);
    assert.equal(run?.usage.outputTokens, 2);
    assert.deepEqual(run?.tokenSamples?.points, [{ at: "2026-09-04T22:05:00.000Z", usedTokens: 8 }]);
    assert.equal(run?.activitySteps?.length, 1);
    assert.equal(run?.activitySteps?.[0]?.filePath, "src/index.ts");
    assert.ok(!JSON.stringify(run?.activitySteps).includes("PRIVATE-"));
  });

  it("counts one response once although Claude Code writes a line per content block", () => {
    // Each content block of one API response gets its own line and UUID, and every line repeats the
    // response's usage. Summing per line doubled Claude token counts on the live issue feed.
    const block = (uuid: string, at: string, usage: Record<string, number>, id = "msg_1") =>
      assistant(usage, { uuid, timestamp: at, message: { id, role: "assistant", model: "claude-opus-5", usage } });
    const full = { input_tokens: 4, output_tokens: 250, cache_read_input_tokens: 9000, cache_creation_input_tokens: 70 };
    const run = parseRun(
      lines(
        user("go"),
        block("a1", "2026-09-04T22:05:00.000Z", full),
        block("a2", "2026-09-04T22:05:01.000Z", full),
        block("a3", "2026-09-04T22:05:02.000Z", { ...full, output_tokens: 400 }),
        block("a4", "2026-09-04T22:05:03.000Z", { ...full, output_tokens: 300 }),
        block("b1", "2026-09-04T22:06:00.000Z", { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 9100 }, "msg_2"),
      ),
      "o",
    );
    // msg_1 counts once at its largest output; a later smaller line never subtracts. msg_2 adds.
    assert.deepEqual(run?.usage, { inputTokens: 5, outputTokens: 410, cacheReadTokens: 18100, cacheWriteTokens: 70 });
    assert.deepEqual(run?.tokenSamples?.points, [
      { at: "2026-09-04T22:05:00.000Z", usedTokens: 9324 },
      { at: "2026-09-04T22:05:02.000Z", usedTokens: 9474 },
      { at: "2026-09-04T22:06:00.000Z", usedTokens: 18585 },
    ]);
    assert.equal(run?.tokenSamples?.invalid, false);
  });

  it("reads a child's completion from the enqueued task-notification, ids, status and time only", () => {
    const header = (task: string, status: string) => `<task-notification>\n<task-id>${task}</task-id>\n` +
      `<tool-use-id>toolu_${task}</tool-use-id>\n<output-file>/PRIVATE/path/tasks/${task}.output</output-file>\n<status>${status}</status>\n`;
    const notice = (task: string, status: string, at: string, operation = "enqueue", content = header(task, status) +
      "<summary>PRIVATE-RESULT-CANARY</summary>\n<note>PRIVATE-NOTE</note>\n</task-notification>") =>
      ({ type: "queue-operation", operation, timestamp: at, sessionId: "5dc200b1-b629-4b56-b487-6990b69ef498", content });
    // The launch Claude itself records: the Agent tool result carries the child's own id.
    const launch = (task: string) => user("", { uuid: `launch-${task}`, toolUseResult: { status: "async_launched", agentId: task },
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${task}`, content: "PRIVATE-LAUNCH" }] } });
    const run = parseRun(lines(
      user("go"),
      assistant({ input_tokens: 1, output_tokens: 1 }),
      launch("a1b2"), launch("c3d4"), launch("e5f6"), launch("s1s2"), launch("k1k2"),
      notice("a1b2", "completed", "2026-09-04T22:06:00.000Z"),
      notice("a1b2", "completed", "2026-09-04T22:06:01.000Z", "remove"),  // queue bookkeeping, not a completion
      notice("c3d4", "completed", "2026-09-04T22:06:00.000Z"),
      notice("c3d4", "failed", "2026-09-04T22:07:00.000Z"),               // the latest notification decides
      notice("e5f6", "killed", "2026-09-04T22:06:00.000Z"),               // unmapped: recorded as other
      notice("b0b0", "completed", "2026-09-04T22:06:00.000Z"),            // a background shell task: never launched as an Agent
      // The child's own text cannot supply or override the status: no header status, or a second one.
      notice("s1s2", "completed", "2026-09-04T22:06:00.000Z", "enqueue", "<task-notification>\n<task-id>s1s2</task-id>\n" +
        "<tool-use-id>toolu_s1s2</tool-use-id>\n<output-file>o</output-file>\n<summary>x\n<status>completed</status>\ny</summary>\n"),
      notice("k1k2", "killed", "2026-09-04T22:06:00.000Z", "enqueue", header("k1k2", "killed") +
        "<result>\n<status>completed</status>\n</result>\n"),
      notice("i9j0", "completed", "not-a-time"),
    ), "o");
    assert.deepEqual(run?.childCompletions, [
      { childId: "agent-a1b2", status: "completed", at: "2026-09-04T22:06:00.000Z" },
      { childId: "agent-c3d4", status: "failed", at: "2026-09-04T22:07:00.000Z" },
      { childId: "agent-e5f6", status: "other", at: "2026-09-04T22:06:00.000Z" },
    ]);
    assert.ok(!JSON.stringify(run).includes("PRIVATE"));
    assert.equal(parseRun(lines(user("go"), assistant({ input_tokens: 1, output_tokens: 1 })), "o")?.childCompletions, undefined);
  });

  it("reads a completed last turn (turnEndedAt) only when the turn ended on the final answer and nothing began after", () => {
    const sessionId = "5dc200b1-b629-4b56-b487-6990b69ef498";
    const end = (timestamp: string) => ({ type: "system", subtype: "turn_duration", durationMs: 1000, timestamp, sessionId });
    const answer = assistant({ input_tokens: 1, output_tokens: 1 }, { message: { role: "assistant", model: "claude-opus-5",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Done." }] } });
    const toolCall = assistant({ input_tokens: 1, output_tokens: 1 }, { message: { role: "assistant", model: "claude-opus-5",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } });
    const at = "2026-09-04T22:05:01.000Z";
    assert.equal(parseRun(lines(user("go"), answer, end(at)))?.turnEndedAt, at);
    // Metadata after the turn end does not reopen it.
    assert.equal(parseRun(lines(user("go"), answer, end(at), { type: "pr-link", timestamp: "2026-09-04T22:06:00.000Z", sessionId }))?.turnEndedAt, at);
    // No turn end yet (mid-turn), an interrupted turn, and a turn that began after the end: none.
    assert.equal(parseRun(lines(user("go"), toolCall))?.turnEndedAt, undefined);
    assert.equal(parseRun(lines(user("go"), answer))?.turnEndedAt, undefined);
    assert.equal(parseRun(lines(user("go"), toolCall, user("[Request interrupted by user]", { uuid: "u2" }), end(at)))?.turnEndedAt, undefined);
    assert.equal(parseRun(lines(user("go"), answer, end(at), user("continue", { uuid: "u3", timestamp: "2026-09-04T22:31:04.000Z" })))?.turnEndedAt, undefined);
    assert.equal(parseRun(lines(user("go"), answer, end(at), { type: "queue-operation", operation: "enqueue", content: "x",
      timestamp: "2026-09-04T22:06:00.000Z", sessionId }))?.turnEndedAt, undefined);
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

describe("parseClaudeTranscript, on the subagent tree", () => {
  /**
   * The store names a subagent's file after the subagent and writes the *parent's* id on every line
   * inside it. A scan of a real store found 161 transcripts, of which 154 were shaped exactly this
   * way; reading the id off the line filed all 154 under six parents, as roots.
   */
  const child = (over: Record<string, unknown> = {}) => ({
    ...user("search the packages for the sink", { isSidechain: true }),
    ...over,
  });

  it("files a subagent under its own name and names the session that spawned it", () => {
    const run = parseRun(
      lines(child(), assistant({ input_tokens: 3 }, { isSidechain: true })),
      "/store/9f3c1d20-aaaa-bbbb-cccc-000000000001.jsonl",
    );
    assert.ok(run);
    assert.equal(run.id, "9f3c1d20-aaaa-bbbb-cccc-000000000001");
    assert.equal(run.parentId, "5dc200b1-b629-4b56-b487-6990b69ef498");
  });

  it("leaves a root transcript alone, id and all", () => {
    const run = parseRun(
      lines(user("go"), assistant({ input_tokens: 1 })),
      "/store/some-other-name.jsonl",
    );
    assert.ok(run);
    assert.equal(run.id, "5dc200b1-b629-4b56-b487-6990b69ef498");
    assert.equal(run.parentId, null);
  });

  it("keeps a session that carries its subagents inline as one root", () => {
    // Same file, sidechain turns inside it, but the file is named after the session its lines
    // state. Nothing here is somebody else's run, so splitting it would invent a second one.
    const run = parseRun(
      lines(user("go"), child(), assistant({ input_tokens: 1 })),
      "/store/5dc200b1-b629-4b56-b487-6990b69ef498.jsonl",
    );
    assert.ok(run);
    assert.equal(run.id, "5dc200b1-b629-4b56-b487-6990b69ef498");
    assert.equal(run.parentId, null);
  });

  it("takes one sidechain line as enough, because unanimity is not the store's promise", () => {
    // A single unflagged housekeeping record in an otherwise sidechain file must not hand the run
    // back to its parent's id — which is what requiring every line to agree would do.
    const run = parseRun(
      lines(child(), { type: "mode", sessionId: "5dc200b1-b629-4b56-b487-6990b69ef498" }),
      "/store/9f3c1d20-aaaa-bbbb-cccc-000000000001.jsonl",
    );
    assert.equal(run?.id, "9f3c1d20-aaaa-bbbb-cccc-000000000001");
  });

  it("still reads branch and issue links off the lines, which is where the subagent worked", () => {
    // The identity moves; the work does not. A subagent runs in its parent's checkout, so the
    // branch on its lines is its own branch and #39 is its own issue.
    const run = parseRun(lines(child()), "/store/9f3c1d20-aaaa-bbbb-cccc-000000000001.jsonl");
    assert.equal(run?.branch, "orch/divybot-39");
    assert.deepEqual(run?.linkedIssues, [{ number: 39, from: "path" }]);
  });

  it("stays a root when the caller passed an origin that is not a transcript path", () => {
    // `parseClaudeTranscript` takes the origin as an argument so it can be tested against a string,
    // and the scan is the only caller that passes a real one. A caller holding no file has no child
    // name to give, and filing a run under a label nothing in the store carries is worse than
    // filing it under the id the lines actually state.
    const run = parseRun(lines(child()), "o");
    assert.equal(run?.id, "5dc200b1-b629-4b56-b487-6990b69ef498");
    assert.equal(run?.parentId, null);
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

  it("says nothing about a type it was told not to read", () => {
    // A note means this package could not read something. Skipping a record by recorded decision is
    // a different claim, and reporting it as degradation is how nine thousand ordinary `ai-title`
    // records trained anyone reading notes to stop reading them.
    const text = lines(user("go"), { type: "ai-title", title: "irrelevant" });
    const { notes } = parseClaudeTranscript(text, "o");
    assert.deepEqual(notes, []);
  });

  it("still refuses to let a type it was told not to read move the clock", () => {
    // Quieter must not mean more trusting. The record is unread either way, so it is not evidence
    // that an agent did anything, and `updatedAt` is exactly that claim.
    const text = lines(user("go"), { type: "file-history-delta", timestamp: "2026-09-05T09:00:00.000Z" });
    const { run } = parseClaudeTranscript(text, "o");
    assert.equal(run?.updatedAt, "2026-09-04T22:00:00.000Z");
  });

  it("deliberately skips the three types from the earlier census without moving the clock", () => {
    for (const type of ["frame-link", "artifact-autoreact-ledger", "artifact-comment-monitor"]) {
      assert.equal(KNOWN_TYPES.has(type), false, `${type} must not be read as activity`);
      assert.ok(OBSERVED_UNREAD_TYPES.get(type)?.trim(), `${type} needs a reason`);
      const text = lines(user("go"), { type, timestamp: "2026-09-05T09:00:00.000Z" });
      const { run, notes } = parseClaudeTranscript(text, "o");
      assert.deepEqual(notes, [], `${type} is deliberately unread, not unknown`);
      assert.equal(run?.updatedAt, "2026-09-04T22:00:00.000Z");
    }
  });

  it("still reports a type in neither list, so a genuine discovery is not silenced", () => {
    const text = lines(user("go"), { type: "warp-drive", timestamp: "2026-09-05T09:00:00.000Z" });
    const { notes } = parseClaudeTranscript(text, "o");
    assert.deepEqual(notes, [{ reason: unknownTypeNote("warp-drive"), lines: 1 }]);
  });

  it("holds the two lists disjoint, so no type is both read and declared unread", () => {
    for (const type of KNOWN_TYPES) {
      assert.equal(OBSERVED_UNREAD_TYPES.has(type), false, `${type} is both read and declared unread`);
    }
  });

  it("gives every declared-unread type a non-empty reason", () => {
    // An exemption without a reason is an omission with extra steps.
    for (const [type, reason] of OBSERVED_UNREAD_TYPES) {
      assert.equal(typeof reason, "string", `${type} has no reason`);
      assert.ok(reason.trim().length > 0, `${type} has an empty reason`);
    }
  });

  it("reports every type the 2026-09-14 census found as read or as declared unread", () => {
    // The census this pair of lists came from. A type falling out of both would start producing
    // notes for ordinary traffic again, which is the regression this test exists to catch.
    for (const type of [
      "agent-name", "ai-title", "cost-state", "failed", "file-history-delta",
      "file-history-snapshot", "fork-context-ref", "launched", "permission-mode",
      "relocated", "result", "started", "worktree-state",
    ]) {
      assert.equal(OBSERVED_UNREAD_TYPES.has(type), true, `${type} is not declared unread`);
      assert.equal(KNOWN_TYPES.has(type), false, `${type} should not be read`);
    }
  });
});
