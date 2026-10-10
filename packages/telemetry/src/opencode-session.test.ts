/**
 * The pure OpenCode projection over the recorded SDK replies (synthetic token counters). Every refused
 * case changes one recorded field and is otherwise valid, so the one rule it breaks is the one tested.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { openCodeRun, readOpenCodeSession, sessionTokens } from "./opencode-session.js";
import { messagesOf, nowMs, recording, sessionOf, type Entry } from "./fixtures/opencode-issue.js";

const head = (id = recording.rootID) => readOpenCodeSession(sessionOf(structuredClone(recording.replies), id), nowMs)!;
const entries = (id = recording.rootID): Entry[] => structuredClone(messagesOf(recording.replies, id));
const run = (list: readonly unknown[], windowed = false, id = recording.rootID) => openCodeRun(head(id), list, windowed, "origin", nowMs);

it("reads the session head and its token aggregate; a malformed aggregate is no reading, never zero", () => {
  const root = head();
  assert.deepEqual([root.id, root.parentID], [recording.rootID, null]);
  const aggregate = sessionOf(recording.replies, recording.rootID).tokens;
  assert.deepEqual(root.usage, { inputTokens: aggregate.input, outputTokens: aggregate.output, reasoningTokens: aggregate.reasoning,
    cacheReadTokens: aggregate.cache.read, cacheWriteTokens: aggregate.cache.write });
  assert.equal(head(recording.childID).parentID, recording.rootID);
  const tokens = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
  const { cache: _cache, ...noCache } = tokens;
  for (const bad of [undefined, null, "5", [], {}, noCache, { ...tokens, input: -1 }, { ...tokens, output: 1.5 },
    { ...tokens, reasoning: "3" }, { ...tokens, cache: { read: 4 } }, { ...tokens, cache: { ...tokens.cache, extra: 1 } },
    { ...tokens, extra: 1 }, { ...tokens, total: -1 }, { ...tokens, input: Number.MAX_SAFE_INTEGER + 1 }, { ...tokens, cache: null }]) {
    assert.deepEqual(sessionTokens(bad), {}, JSON.stringify(bad));
  }
  for (const bad of [{ id: "not-a-session" }, { parentID: recording.rootID }, { parentID: "not-a-session" }, { version: "" },
    { time: { created: nowMs + 1 } }]) {
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

it("carries a tool call's native lifecycle under one step identity; only a completed call says it ran", () => {
  const recorded = entries()[1]!, part = recorded.parts.find(p => p.type === "tool")!;
  const { input, time } = part.state, created = recorded.info.time.created;
  const iso = (ms: number) => new Date(ms).toISOString();
  const stepFor = (state: Record<string, unknown>) => {
    const list = entries(); list[1]!.parts.find(p => p.type === "tool")!.state = state;
    const record = run(list)!;
    assert.deepEqual(run(list), record, "a replay reads the same steps");
    return record.activitySteps!.find(step => step.toolName === "bash")!;
  };
  const pending = stepFor({ status: "pending", input, raw: "" });
  const running = stepFor({ status: "running", input, time: { start: time.start } });
  const completed = stepFor(part.state);
  const failed = stepFor({ status: "error", input, error: "PRIVATE-ERROR", time });
  assert.deepEqual([pending, running, completed, failed].map(step => [step.id, step.kind, step.commandHead, step.at,
    step.lifecycle, step.summary !== null]), [
    [completed.id, "command", "git status", iso(created), { state: "pending", startedAt: null, endedAt: null }, false],
    [completed.id, "command", "git status", iso(time.start), { state: "running", startedAt: iso(time.start), endedAt: null }, false],
    [completed.id, "command", "git status", iso(time.start), { state: "completed", startedAt: iso(time.start), endedAt: iso(time.end) }, true],
    [completed.id, "command", "git status", iso(time.start), { state: "error", startedAt: iso(time.start), endedAt: iso(time.end) }, false],
  ]);
});

it("refuses a started tool state without the clocks it defines", () => {
  const { input, time } = entries()[1]!.parts.find(p => p.type === "tool")!.state;
  for (const state of [{ status: "running", input }, { status: "completed", input, output: "", title: "", metadata: {},
    time: { start: time.start } }]) {
    const list = entries(); list[1]!.parts.find(p => p.type === "tool")!.state = state;
    assert.equal(run(list), null, JSON.stringify(state));
  }
});

it("refuses a message of another session, even when its parts name this one", () => {
  const list = entries(); list[1]!.info.sessionID = recording.childID;
  assert.equal(run(list), null);
});

it("refuses a message listed twice, even with fresh part ids", () => {
  const list = entries(), copy = structuredClone(list[0]!);
  copy.parts = copy.parts.map(part => ({ ...part, id: part.id + "copy" }));
  assert.equal(run([...list, copy]), null);
});

it("refuses a message older than its session", () => {
  const list = entries(), session = sessionOf(recording.replies, recording.rootID);
  list[0]!.info.time.created = session.time.created - 1;
  assert.equal(run(list), null);
});

it("refuses an assistant's provider, model or effort outside the native id grammar", () => {
  for (const [field, value] of [["providerID", "Open Code"], ["modelID", "big pickle"], ["modelID", 7], ["variant", "High Effort"]] as const) {
    const list = entries(); list.at(-1)!.info[field] = value;
    assert.equal(run(list), null, `${field} ${value}`);
  }
});

it("keeps a nested model id whole under its provider", () => {
  const list = entries(); list.at(-1)!.info.modelID = "vendor/family-model";
  assert.equal(run(list)!.identity.model, "opencode/vendor/family-model");
});

it("an answer to an earlier prompt does not end the latest turn", () => {
  const list = entries(), firstPrompt = list[0]!.info.id;
  list.at(-1)!.info.parentID = firstPrompt;
  assert.equal(run(list)!.outcome, "unknown");
});

const userSummary = { title: "PRIVATE-TITLE", body: "PRIVATE-BODY",
  diffs: [{ file: "src/a.ts", patch: "PRIVATE-PATCH", additions: 1, deletions: 0, status: "modified" }] };
const diff = userSummary.diffs[0]!;
const withSummary = (summary: unknown) => { const list = entries(); list[0]!.info.summary = summary; return run(list); };

it("reads a prompt's full diff summary and publishes none of it", () => {
  const record = withSummary(userSummary);
  assert.ok(record !== null && !JSON.stringify(record).includes("PRIVATE-"));
});
it("refuses a prompt summary with a field it does not define", () => assert.equal(withSummary({ ...userSummary, extra: 1 }), null));
it("refuses a prompt summary title that is not text", () => assert.equal(withSummary({ ...userSummary, title: 1 }), null));
it("refuses a prompt summary body that is not text", () => assert.equal(withSummary({ ...userSummary, body: 1 }), null));
it("refuses prompt summary diffs that are not a list", () => assert.equal(withSummary({ ...userSummary, diffs: {} }), null));
it("refuses a diff with a field it does not define", () =>
  assert.equal(withSummary({ ...userSummary, diffs: [{ ...diff, extra: 1 }] }), null));
it("refuses diff deletions that are not a number", () =>
  assert.equal(withSummary({ ...userSummary, diffs: [{ ...diff, deletions: "0" }] }), null));
it("refuses a diff file that is not text", () => assert.equal(withSummary({ ...userSummary, diffs: [{ ...diff, file: 1 }] }), null));
it("refuses a diff patch that is not text", () => assert.equal(withSummary({ ...userSummary, diffs: [{ ...diff, patch: 1 }] }), null));
it("refuses a diff status outside the native vocabulary", () =>
  assert.equal(withSummary({ ...userSummary, diffs: [{ ...diff, status: "renamed" }] }), null));

/** Message 1 under another id, its parts following it; or one of its parts under another id. */
const messageNamed = (id: string) => {
  const list = entries(); list[1]!.info.id = id;
  for (const part of list[1]!.parts) part.messageID = id;
  return run(list);
};
const partNamed = (id: string) => { const list = entries(); list[1]!.parts[1]!.id = id; return run(list); };
it("reads message and part ids of the native shape under any name", () => {
  assert.notEqual(messageNamed("msg_0renamedMessage01"), null); assert.notEqual(partNamed("prt_0renamedPart0001"), null);
});
it("refuses a message or part id without its native prefix", () => {
  assert.equal(messageNamed("prt_0renamedMessage01"), null); assert.equal(partNamed("msg_0renamedPart0001"), null);
});
it("refuses a message or part id outside the native id grammar", () => {
  assert.equal(messageNamed("msg_0renamed.Message"), null); assert.equal(partNamed("prt_0renamed.Part"), null);
});

it("refuses a native clock that is not a whole millisecond", () => {
  const list = entries(); list[1]!.info.time.created += 0.5;
  assert.equal(run(list), null);
});

it("refuses message parts that are not a list", () => {
  const list = entries(); list[1]!.parts = { 0: list[1]!.parts[0] } as unknown as Entry["parts"];
  assert.equal(run(list), null);
});

it("refuses an object field that is a list, text or null", () => {
  const bash = (change: (part: Record<string, any>) => void) => { const list = entries(); change(list[1]!.parts[1]!); return run(list); };
  assert.notEqual(bash(part => { part.metadata = {}; }), null);
  assert.equal(bash(part => { part.metadata = []; }), null);
  assert.equal(bash(part => { part.state.input = "git status"; }), null);
  const text = entries(); text.at(-1)!.parts.find(part => part.type === "text")!.time = null;
  assert.equal(run(text), null);
});

it("refuses prompt text that is not text", () => {
  const list = entries(); list[0]!.parts[0]!.text = 5;
  assert.equal(run(list), null);
});

it("an answer still streaming (a start, no end) reads as a running turn", () => {
  const list = entries(), last = list.at(-1)!;
  delete last.parts.find(part => part.type === "text")!.time.end; delete last.info.time.completed; delete last.info.finish;
  assert.equal(run(list)!.outcome, "running");
});

it("a native error of null is no error", () => {
  const list = entries(); list.at(-1)!.info.error = null;
  assert.equal(run(list)!.outcome, "complete");
});

it("publishes neither a compaction summary's text nor a tool call carried by a prompt", () => {
  const messages = (list: Entry[]) => run(list)!.activitySteps!.filter(step => step.kind === "message").length;
  const compaction = entries(); compaction.at(-1)!.info.summary = true;
  assert.deepEqual([messages(entries()), messages(compaction)], [2, 1]);
  const prompted = entries(), bash = structuredClone(prompted[1]!.parts[1]!);
  prompted[0]!.parts.push({ ...bash, id: "prt_0promptToolPart01", messageID: prompted[0]!.info.id });
  assert.equal(run(prompted)!.activitySteps!.filter(step => step.toolName === "bash").length, 1);
});

it("refuses a step stamped after the end of the turn that ends the run", () => {
  const list = entries(), end = list.at(-1)!.info.time.completed, bashTurn = list[1]!;
  delete bashTurn.info.time.completed;
  bashTurn.parts[1]!.state.time = { start: end + 1, end: end + 2 };
  assert.equal(run(list), null);
});

it("an OpenCode todo list publishes its one in-progress item as a plan step", () => {
  const list = entries(), part = list[1]!.parts[1]!;
  part.tool = "todowrite";
  part.state.input = { todos: [{ id: "1", content: "Run the tests", status: "in_progress", priority: "high" },
    { id: "2", content: "Open the pull request", status: "pending", priority: "low" }] };
  const step = run(list)!.activitySteps!.find(entry => entry.toolName === "todowrite")!;
  assert.deepEqual([step.kind, step.summary !== null], ["message", true]);
});
