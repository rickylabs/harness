/** The pure OpenCode projection over the recorded SDK replies; every case changes one recorded field. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { openCodeRun, readOpenCodeSession, sessionTokens } from "./opencode-session.js";
import { messagesOf, nowMs, recording, sessionOf, type Entry } from "./fixtures/opencode-issue.js";

const head = (id = recording.rootID) => readOpenCodeSession(sessionOf(structuredClone(recording.replies), id), nowMs)!;
const entries = (id = recording.rootID): Entry[] => structuredClone(messagesOf(recording.replies, id));
const run = (list: unknown, windowed = false, id = recording.rootID) => openCodeRun(head(id), list, windowed, "origin", nowMs);

it("reads the session head and its token aggregate; a malformed aggregate is no reading, never zero", () => {
  const root = head();
  assert.deepEqual([root.id, root.parentID], [recording.rootID, null]);
  assert.deepEqual(root.usage, { inputTokens: 6800, outputTokens: 133, reasoningTokens: 572, cacheReadTokens: 34064, cacheWriteTokens: 0 });
  assert.equal(head(recording.childID).parentID, recording.rootID);
  const tokens = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
  const { cache: _cache, ...noCache } = tokens;
  for (const bad of [undefined, null, "5", [], {}, noCache, { ...tokens, input: -1 }, { ...tokens, output: 1.5 },
    { ...tokens, reasoning: "3" }, { ...tokens, cache: { read: 4 } }, { ...tokens, cache: { ...tokens.cache, extra: 1 } },
    { ...tokens, extra: 1 }, { ...tokens, total: -1 }, { ...tokens, input: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.deepEqual(sessionTokens(bad), {}, JSON.stringify(bad));
  }
  for (const bad of [{ id: "not-a-session" }, { parentID: recording.rootID }, { version: "" }, { time: { created: nowMs + 1 } }]) {
    assert.equal(readOpenCodeSession({ ...sessionOf(recording.replies, recording.rootID), ...bad }, nowMs), null, JSON.stringify(bad));
  }
});

it("publishes the typed tool call only: never its output, title, error, or a path outside the session root", () => {
  const list = entries(), read = list[2]!.parts[1]!;
  Object.assign(read.state, { title: "PRIVATE-TITLE", output: "PRIVATE-OUTPUT" });
  list[5]!.parts[1]!.state.error = "PRIVATE-ERROR";
  let record = run(list)!;
  assert.ok(!JSON.stringify(record).includes("PRIVATE-"));
  assert.equal(record.activitySteps?.find(step => step.toolName === "read")?.filePath, "README.md");
  // Outside the root, including a sibling directory that merely shares the root's prefix.
  for (const outside of ["/elsewhere/README.md", "/workspace/project-fork/README.md"]) {
    read.state.input.filePath = outside;
    record = run(list)!;
    const step = record.activitySteps?.find(step => step.toolName === "read");
    assert.deepEqual([step?.kind, step?.filePath], ["tool", null], outside);
  }
});

it("provider-executed tools and interrupted orphans need no continuation; any other tool call does", () => {
  const withTool = (part: Record<string, unknown>) => {
    const list = entries(), last = list.at(-1)!;
    last.parts.push({ id: "prt_0extra", sessionID: recording.rootID, messageID: last.info.id, type: "tool", callID: "call_0",
      tool: "bash", state: { status: "completed", input: { command: "ls" }, output: "", title: "", metadata: {},
        time: { start: last.info.time.created, end: last.info.time.created } }, ...part });
    return run(list)!.outcome;
  };
  assert.equal(withTool({}), "unknown");
  assert.equal(withTool({ metadata: { providerExecuted: true } }), "complete");
  const last = entries().at(-1)!;
  assert.equal(withTool({ state: { status: "error", input: {}, error: "x", metadata: { interrupted: true },
    time: { start: last.info.time.created, end: last.info.time.created } } }), "complete");
});

it("assistant text is the only prose read: synthetic, ignored, compaction and empty text never become Done", () => {
  for (const change of [{ synthetic: true }, { ignored: true }, { text: "  " }]) {
    const list = entries(); Object.assign(list.at(-1)!.parts[1]!, change);
    assert.notEqual(run(list)!.outcome, "complete", JSON.stringify(change));
  }
  const compaction = entries(); compaction.at(-1)!.info.summary = true;
  assert.notEqual(run(compaction)!.outcome, "complete");
  const notBoolean = entries(); notBoolean.at(-1)!.info.summary = "yes";
  assert.equal(run(notBoolean), null);
  // A user summary is diff metadata: validated, then dropped.
  const user = entries(); user[0]!.info.summary = { title: "PRIVATE-TITLE", diffs: [{ file: "a", additions: 1, deletions: 0 }] };
  assert.ok(!JSON.stringify(run(user)).includes("PRIVATE-"));
  user[0]!.info.summary = { diffs: [{ file: "a", additions: "1", deletions: 0 }] };
  assert.equal(run(user), null);
});

it("a window that starts mid-turn takes its first assistant's prompt as the latest; a full read does not guess", () => {
  const tail = entries().slice(5);
  assert.equal(run(tail, true)!.outcome, "complete");
  assert.equal(run(tail, false)!.outcome, "unknown");
  // A newer prompt inside the window still wins: the earlier answer is no longer the latest turn's.
  const resumed = [...entries().slice(1, 4), entries()[4]!];
  assert.equal(run(resumed, true)!.outcome, "running");
});
