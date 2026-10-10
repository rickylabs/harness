/**
 * The OpenCode issue feed over telemetry's server port: the provider's recorded session (synthetic token
 * counters) served by a fake of the port, Orchid receipts and the published decoder. The SDK adapter
 * under the port is the provider's to test; the composition through it is `tests/parity`'s.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { readIssueAgentTreeSnapshot, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { OPERATOR_ENV } from "./operator-environment.js";
import { collectIssueAgentTree, openCodeServerBinding, SAFETY_RESCAN_MS } from "./issue-agent-feed-cli.js";
import { MAX_OPENCODE_MESSAGES } from "./opencode-issue.js";
import { bound, messagesOf, now, nowMs, qualified, recording, server, sessionOf } from "./fixtures/opencode-issue.js";

const { rootID, childID } = recording;
const issueOf = (snapshot: IssueAgentTreeSnapshot, issue = 42) => snapshot.issues.find(row => row.issueNumber === issue);
const agents = (snapshot: IssueAgentTreeSnapshot, issue = 42) => issueOf(snapshot, issue)?.dispatches[0]?.agents ?? [];
const iso = (ms: number) => new Date(ms).toISOString();
/** Processed input + output, as `opencode-usage` counts the session aggregate. */
const used = (tokens: Record<string, any>) =>
  tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning;

it("a recorded session reads as state, model, timeline with tool lifecycle, tokens and end state", async () => {
  const f = await bound(), s = server();
  try {
    const snapshot = await f.collect(s.binding);
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    assert.equal(issueOf(snapshot)?.complete, true);
    const [root, child, ...rest] = agents(snapshot);
    assert.ok(root && child); assert.equal(rest.length, 0);
    assert.deepEqual([root.harness.value, root.model.value, root.observation.route.observed.model.value,
      root.observation.route.observed.provider.source], ["opencode", qualified, qualified, "opencode.message.providerID"]);
    // End state: the resumed turn's native stop, after its subagent finished.
    const last = messagesOf(recording.replies, rootID).at(-1)!.info;
    assert.deepEqual([root.liveness.state, root.terminalOutcome.value, root.endedAt], ["ended", "succeeded", iso(last.time.completed)]);
    // Newest first. Only a completed call carries a summary; the errored subagent call carries its state instead.
    const steps = root.activity?.steps ?? [];
    assert.deepEqual(steps.map(step => [step.kind, step.toolName, step.commandHead, step.filePath, step.summary !== null,
      step.lifecycle?.state ?? null, step.source]), [
      ["message", null, null, null, false, null, "opencode-transcript"],
      ["tool", "task", null, null, true, "completed", "opencode-transcript"],
      ["tool", "task", null, null, false, "error", "opencode-transcript"],
      ["message", null, null, null, true, null, "opencode-transcript"],
      ["file", "read", null, "README.md", true, "completed", "opencode-transcript"],
      ["command", "bash", "git status", null, true, "completed", "opencode-transcript"],
    ]);
    const bash = messagesOf(recording.replies, rootID)[1]!.parts.find(part => part.tool === "bash")!.state.time;
    assert.deepEqual(steps.at(-1)?.lifecycle, { state: "completed", startedAt: iso(bash.start), endedAt: iso(bash.end) });
    assert.deepEqual(steps.at(-1)?.target, { kind: "command", value: "git status" });
    // Tokens: the server's session aggregate, which equals the sum over its assistant messages.
    for (const id of [rootID, childID]) {
      const tokens = sessionOf(recording.replies, id).tokens, assistants = messagesOf(recording.replies, id).filter(e => e.info.role === "assistant");
      for (const field of ["input", "output", "reasoning"]) {
        assert.equal(tokens[field], assistants.reduce((sum, entry) => sum + entry.info.tokens[field], 0), field);
      }
    }
    assert.deepEqual(root.tokenUsage, { usedTokens: used(sessionOf(recording.replies, rootID).tokens), budgetTokens: root.budget.tokenLimit,
      observedAt: root.tokenUsage?.observedAt, source: "opencode-usage", reason: null });
    assert.equal(child.tokenUsage?.usedTokens, used(sessionOf(recording.replies, childID).tokens));
    assert.equal(child.parentAgentId, root.observation.agentId); assert.equal(child.terminalOutcome.value, "succeeded");
    // Bounded reads, no listing: the root, each session's children, each session's latest window.
    assert.deepEqual(s.calls.map(call => call.path).sort(), [`/session/${childID}/children`, `/session/${childID}/message`,
      `/session/${rootID}`, `/session/${rootID}/children`, `/session/${rootID}/message`]);
    const wire = JSON.stringify(snapshot);
    for (const value of [rootID, childID, f.base, "/workspace", "msg_", "prt_", "PRIVATE-"]) assert.ok(!wire.includes(value), value);
  } finally { await f.close(); }
});

it("negative control: an unknown session stays unavailable and never shows a timeline", async () => {
  const f = await bound(), s = server();
  try {
    await f.issue(43, recording.unknownID);
    const snapshot = await f.collect(s.binding);
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    assert.deepEqual([issueOf(snapshot, 43)?.complete, issueOf(snapshot, 43)?.reason, issueOf(snapshot, 43)?.dispatches],
      [false, "binding_unavailable", []]);
    assert.ok(s.calls.some(call => call.path === `/session/${recording.unknownID}`));
    assert.ok(!s.calls.some(call => call.path.startsWith(`/session/${recording.unknownID}/`)), "nothing past the 404 is read");
    assert.equal(issueOf(snapshot, 42)?.complete, true); assert.equal(agents(snapshot, 42).length, 2);
  } finally { await f.close(); }
});

it("an unusable server url builds no reader; no url is not bound", () => {
  for (const url of ["", "not a url"]) assert.deepEqual(openCodeServerBinding(url), { reason: "source_unavailable" });
  assert.deepEqual(openCodeServerBinding(undefined), { reason: "source_not_bound" });
  assert.ok("reads" in openCodeServerBinding("http://opencode.example.invalid"));
});

it("no server, an unusable url, a server that is down, an aborted read and a bad reply are each unavailable, never empty", async () => {
  const f = await bound();
  try {
    const reasonFor = async (openCode?: Parameters<typeof f.collect>[0], env: Record<string, string> = {}) => {
      const snapshot = await collectIssueAgentTree({ home: f.base, limit: 20, now,
        env: { [OPERATOR_ENV.dispatchRoot]: f.receipts, ...env }, ...(openCode === undefined ? {} : { openCode }) });
      assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
      assert.deepEqual(issueOf(snapshot)?.dispatches, []);
      return issueOf(snapshot)?.reason;
    };
    assert.equal(await reasonFor(), "source_not_bound");
    assert.equal(await reasonFor(undefined, { [OPERATOR_ENV.openCodeServer]: "not a url" }), "source_unavailable");
    const down = server(); down.replies[`/session/${rootID}`] = { status: 503, body: {} };
    assert.equal(await reasonFor(down.binding), "source_unavailable");
    const abort = new AbortController(); abort.abort();
    assert.equal(issueOf(await f.collect(server().binding, { signal: abort.signal }))?.reason, "source_unavailable");
    const html = server(); html.replies[`/session/${rootID}/message`] = { status: 200, body: "<html>" };
    assert.equal(await reasonFor(html.binding), "source_unavailable");
  } finally { await f.close(); }
});

it("a server that never answers is abandoned at a deadline well inside the safety rescan", { timeout: 10_000 }, async () => {
  const f = await bound(), requested: number[] = [];
  const hung = server(async (_path, signal) => {
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
  });
  try {
    const deadline = (ms: number) => { requested.push(ms); return AbortSignal.abort(); };
    const snapshot = await f.collect(hung.binding, { deadline });
    assert.equal(issueOf(snapshot)?.reason, "source_unavailable");
    assert.ok(requested.length === 1 && requested[0]! > 0 && requested[0]! < SAFETY_RESCAN_MS, String(requested));
  } finally { await f.close(); }
});

it("a run mid-turn is running with its activity; a subagent observed running holds the root open", async () => {
  const f = await bound();
  try {
    const midTurn = server(), last = messagesOf(midTurn.replies, rootID).at(-1)!;
    delete last.info.time.completed; delete last.info.finish;
    let root = agents(await f.collect(midTurn.binding))[0]!;
    assert.deepEqual([root.liveness.state, root.endedAt, root.terminalOutcome.value], ["running", null, null]);
    assert.equal(root.activity?.steps.length, 6); assert.equal(root.activity?.steps[0]?.kind, "message");
    const runningChild = server(), childLast = messagesOf(runningChild.replies, childID).at(-1)!;
    delete childLast.info.time.completed;
    const [held, child] = agents(await f.collect(runningChild.binding));
    root = held!;
    assert.deepEqual([root.liveness.state, root.endedAt, root.terminalOutcome.value, child?.liveness.state],
      ["running", null, null, "running"]);
  } finally { await f.close(); }
});

it("a subagent that is only registered, or ended in a way not known, stays unknown and never reopens its root", async () => {
  const f = await bound();
  try {
    const ended = iso(messagesOf(recording.replies, rootID).at(-1)!.info.time.completed);
    const cases: [string, (s: ReturnType<typeof server>) => void][] = [
      ["registered, no messages", s => { s.replies[`/session/${childID}/message`]!.body = []; }],
      ["unknown finish", s => { messagesOf(s.replies, childID).at(-1)!.info.finish = "length"; }],
    ];
    for (const [name, change] of cases) {
      const s = server(); change(s);
      const snapshot = await f.collect(s.binding);
      assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true, name);
      const [root, child] = agents(snapshot);
      assert.deepEqual([root?.liveness.state, root?.terminalOutcome.value, root?.endedAt], ["ended", "succeeded", ended], name);
      assert.deepEqual([child?.liveness.state, child?.terminalOutcome.value, child?.endedAt], ["unknown", null, null], name);
    }
  } finally { await f.close(); }
});

it("a fact the server wrote while it was read is judged at the clock read after the reads, and stamps the frame", async () => {
  const f = await bound();
  try {
    let clock = nowMs;
    const finishAt = (completed: number) => {
      const s = server(() => { clock += 5; });
      messagesOf(s.replies, rootID).at(-1)!.info.time.completed = completed;
      return s;
    };
    // Completed 1 ms after the scan began: in the past by the time it was read.
    let snapshot = await f.collect(finishAt(nowMs + 1).binding, { clock: () => clock });
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    assert.deepEqual([agents(snapshot)[0]?.terminalOutcome.value, agents(snapshot)[0]?.endedAt, snapshot.observedAt],
      ["succeeded", iso(nowMs + 1), iso(clock)]);
    // A clock that steps back during the read never stamps the frame before the scan began.
    snapshot = await f.collect(server().binding, { clock: () => nowMs - 1_000 });
    assert.deepEqual([readIssueAgentTreeSnapshot(snapshot).ok, snapshot.observedAt], [true, now]);
    // Still later than the clock read after the reads: from the future, so refused.
    clock = nowMs;
    snapshot = await f.collect(finishAt(nowMs + 60_000).binding, { clock: () => clock });
    assert.deepEqual([issueOf(snapshot)?.reason, issueOf(snapshot)?.dispatches], ["source_unavailable", []]);
  } finally { await f.close(); }
});

it("native error and cancellation keep their own clock; unknown finishes never become success", async () => {
  const f = await bound();
  try {
    for (const [error, expected] of [["APIError", "failed"], ["MessageAbortedError", "cancelled"], ["FutureUnknownError", null]] as const) {
      const s = server(), last = messagesOf(s.replies, rootID).at(-1)!;
      last.info.error = { name: error, data: { message: "PRIVATE-ERROR-CANARY" } };
      const root = agents(await f.collect(s.binding))[0]!;
      assert.equal(root.terminalOutcome.value, expected, error);
      assert.ok(!JSON.stringify(root).includes("PRIVATE-"));
    }
    for (const finish of ["tool-calls", "length", "unknown", undefined]) {
      const s = server(), last = messagesOf(s.replies, rootID).at(-1)!;
      if (finish === undefined) delete last.info.finish; else last.info.finish = finish;
      assert.notEqual(agents(await f.collect(s.binding))[0]!.terminalOutcome.value, "succeeded", String(finish));
    }
  } finally { await f.close(); }
});

it("replies that are not what was recorded fail closed, each breaking one rule", async () => {
  const f = await bound();
  const mutations: [string, (r: ReturnType<typeof server>["replies"]) => void][] = [
    ["child of another parent", r => { (r[`/session/${rootID}/children`]!.body as any[])[0].parentID = "ses_other"; }],
    ["part of a foreign session", r => { messagesOf(r, rootID)[1]!.parts[1]!.sessionID = "ses_other"; }],
    ["part of another message", r => { messagesOf(r, rootID)[1]!.parts[1]!.messageID = "msg_other"; }],
    ["duplicate part id", r => { const m = messagesOf(r, rootID); m[2]!.parts[0]!.id = m[1]!.parts[0]!.id; }],
    ["future clock", r => { messagesOf(r, rootID).at(-1)!.info.time.completed = nowMs + 60_000; }],
    ["end before its parts", r => { const m = messagesOf(r, rootID).at(-1)!; m.info.time.completed = m.info.time.created; }],
    ["unknown part type", r => { messagesOf(r, rootID)[1]!.parts[0]!.type = "future-part"; }],
    ["unknown role", r => { messagesOf(r, rootID)[0]!.info.role = "system"; }],
    ["unknown tool state", r => { messagesOf(r, rootID)[1]!.parts[1]!.state.status = "paused"; }],
    ["messages not a list", r => { r[`/session/${childID}/message`]!.body = { items: [] }; }],
  ];
  try {
    for (const [name, mutate] of mutations) {
      const s = server(); mutate(s.replies);
      const snapshot = await f.collect(s.binding);
      assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true, name);
      assert.deepEqual([issueOf(snapshot)?.complete, issueOf(snapshot)?.dispatches], [false, []], name);
    }
  } finally { await f.close(); }
});

it("reads stay inside their bounds: bytes, sessions and the message window", async () => {
  const f = await bound();
  try {
    assert.equal(issueOf(await f.collect(server().binding, { limit: 1 }))?.reason, "scan_limit");
    const big = server(); messagesOf(big.replies, rootID)[3]!.parts[1]!.text = "a".repeat(9 * 1_048_576);
    assert.equal(issueOf(await f.collect(big.binding))?.reason, "scan_limit");
    // A turn longer than the window: its prompt is no longer read, and the latest messages still decide.
    const long = server(), messages = messagesOf(long.replies, rootID), template = messages[6]!;
    const fillers = Array.from({ length: MAX_OPENCODE_MESSAGES }, (_, i) => {
      const entry = structuredClone(template), id = template.info.id + String(i).padStart(4, "0");
      entry.info.id = id; entry.parts = entry.parts.map((part, j) => ({ ...part, id: `${part.id}${i}x${j}`, messageID: id }));
      return entry;
    });
    long.replies[`/session/${rootID}/message`]!.body = [...messages.slice(0, 7), ...fillers, messages[7]!];
    const root = agents(await f.collect(long.binding))[0]!;
    assert.equal(root.terminalOutcome.value, "succeeded"); assert.equal(root.activity?.steps[0]?.kind, "message");
  } finally { await f.close(); }
});

it("a binding or dispatch receipt that changes during the server read invalidates the issue", async () => {
  const f = await bound();
  try {
    const binding = join(f.record, "binding.json"), original = await readFile(binding);
    const s = server(async path => {
      if (path.endsWith("/message")) await writeFile(binding, JSON.stringify({ ...JSON.parse(original.toString()), extra: 1 }), { mode: 0o600 });
    });
    const snapshot = await f.collect(s.binding);
    assert.deepEqual([issueOf(snapshot)?.complete, issueOf(snapshot)?.reason, issueOf(snapshot)?.dispatches], [false, "binding_unavailable", []]);
  } finally { await f.close(); }
});
