/** The OpenCode issue reader end to end: a recorded `opencode serve` session (provenance in the fixture)
 * through the real SDK adapter, Orchid receipts and the published decoder. No socket, no native store. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { readIssueAgentTreeSnapshot, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { OPERATOR_ENV } from "./operator-environment.js";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
import { MAX_OPENCODE_MESSAGES } from "./opencode-issue.js";
import { bound, messagesOf, now, qualified, recording, server, sessionOf } from "./fixtures/opencode-issue.js";

const agents = (snapshot: IssueAgentTreeSnapshot, issue = 42) =>
  snapshot.issues.find(row => row.issueNumber === issue)?.dispatches[0]?.agents ?? [];
const issueOf = (snapshot: IssueAgentTreeSnapshot, issue = 42) => snapshot.issues.find(row => row.issueNumber === issue);

it("a recorded 1.18.35 session reads through the SDK as state, model, timeline, tokens and end state", async () => {
  const f = await bound(), s = server();
  try {
    const snapshot = await f.collect(s.binding);
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    assert.equal(issueOf(snapshot)?.complete, true);
    const [root, child, ...rest] = agents(snapshot);
    assert.ok(root && child); assert.equal(rest.length, 0);
    assert.equal(root.harness.value, "opencode"); assert.equal(root.model.value, qualified);
    assert.equal(root.observation.route.observed.model.value, qualified);
    assert.equal(root.observation.route.observed.provider.source, "opencode.message.providerID");
    // End state: the resumed turn's native stop, after its subagent finished.
    assert.equal(root.liveness.state, "ended"); assert.equal(root.terminalOutcome.value, "succeeded");
    const last = messagesOf(recording.replies, recording.rootID).at(-1)!.info;
    assert.equal(root.endedAt, new Date(last.time.completed).toISOString());
    // Timeline: assistant messages, a command, a repository file and the subagent tool call, newest first. The
    // last answer names a file, which the public text screen refuses, so its step carries no summary.
    const steps = root.activity?.steps ?? [];
    assert.equal(root.activity?.availability, "available");
    assert.deepEqual(steps.map(step => [step.kind, step.toolName, step.commandHead, step.filePath, step.summary]), [
      ["message", null, null, null, null],
      ["tool", "task", null, null, "Used task"],
      ["tool", "task", null, null, "Used task"],
      ["message", null, null, null, "The repository contains a demo project."],
      ["file", "read", null, "README.md", "Opened a repository file"],
      ["command", "bash", "git status", null, "Ran git status"],
    ]);
    assert.ok(steps.every(step => step.source === "opencode-transcript"));
    assert.deepEqual(steps.find(step => step.kind === "command")?.target, { kind: "command", value: "git status" });
    // Tokens: the server's session aggregate, which the recording proves equals its assistant messages' sum.
    const tokens = sessionOf(recording.replies, recording.rootID).tokens;
    const fields = ["input", "output", "reasoning"] as const;
    for (const field of fields) assert.equal(tokens[field], messagesOf(recording.replies, recording.rootID)
      .reduce((sum, entry) => sum + (entry.info.tokens?.[field] ?? 0), 0));
    assert.deepEqual(root.tokenUsage, { usedTokens: 6800 + 34064 + 0 + 133 + 572, budgetTokens: root.budget.tokenLimit,
      observedAt: root.tokenUsage?.observedAt, source: "opencode-usage", reason: null });
    assert.equal(child.tokenUsage?.usedTokens, 4610 + 8064 + 40 + 14);
    assert.equal(child.parentAgentId, root.observation.agentId); assert.equal(child.terminalOutcome.value, "succeeded");
    // Bounded reads, no listing: root, each session's children, each session's latest window.
    const window = `?limit=${MAX_OPENCODE_MESSAGES + 1}`;
    assert.deepEqual(s.requests.sort(), [`/session/${recording.childID}/children`, `/session/${recording.childID}/message${window}`,
      `/session/${recording.rootID}`, `/session/${recording.rootID}/children`, `/session/${recording.rootID}/message${window}`]);
    const wire = JSON.stringify(snapshot);
    for (const value of [recording.rootID, recording.childID, f.base, "/workspace", "msg_", "prt_", "Use the bash tool", "Run the bash command"]) {
      assert.ok(!wire.includes(value), value);
    }
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
    assert.ok(s.requests.includes(`/session/${recording.unknownID}`));
    assert.ok(!s.requests.some(path => path.startsWith(`/session/${recording.unknownID}/`)), "nothing past the 404 is read");
    // The healthy neighbour keeps its tree.
    assert.equal(issueOf(snapshot, 42)?.complete, true); assert.equal(agents(snapshot, 42).length, 2);
  } finally { await f.close(); }
});

it("no server, an unusable url, a server that is down or slow, and a bad reply are each unavailable, never empty", async () => {
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
    const down = server(); down.replies[`/session/${recording.rootID}`] = { status: 503, body: {} };
    assert.equal(await reasonFor(down.binding), "source_unavailable");
    const abort = new AbortController(); abort.abort();
    assert.equal(issueOf(await f.collect(server().binding, { signal: abort.signal }))?.reason, "source_unavailable");
    const html = server(); html.replies[`/session/${recording.rootID}/message`] = { status: 200, body: "<html>" };
    assert.equal(await reasonFor(html.binding), "source_unavailable");
  } finally { await f.close(); }
});

it("a run mid-turn is running with its activity; a pending subagent keeps the root from Done", async () => {
  const f = await bound();
  try {
    const midTurn = server(), last = messagesOf(midTurn.replies, recording.rootID).at(-1)!;
    delete last.info.time.completed; delete last.info.finish;
    let root = agents(await f.collect(midTurn.binding))[0]!;
    assert.equal(root.liveness.state, "running"); assert.equal(root.endedAt, null); assert.equal(root.terminalOutcome.value, null);
    assert.equal(root.activity?.steps.length, 6); assert.equal(root.activity?.steps[0]?.kind, "message");
    const pendingChild = server(), childLast = messagesOf(pendingChild.replies, recording.childID).at(-1)!;
    delete childLast.info.time.completed;
    root = agents(await f.collect(pendingChild.binding))[0]!;
    assert.notEqual(root.terminalOutcome.value, "succeeded"); assert.equal(root.endedAt, null);
  } finally { await f.close(); }
});

it("native error and cancellation keep their own clock; unknown finishes never become success", async () => {
  const f = await bound();
  try {
    for (const [error, expected] of [["APIError", "failed"], ["MessageAbortedError", "cancelled"], ["FutureUnknownError", null]] as const) {
      const s = server(), last = messagesOf(s.replies, recording.rootID).at(-1)!;
      last.info.error = { name: error, data: { message: "PRIVATE-ERROR-CANARY" } };
      const root = agents(await f.collect(s.binding))[0]!;
      assert.equal(root.terminalOutcome.value, expected, error);
      assert.ok(!JSON.stringify(root).includes("PRIVATE-"));
    }
    for (const finish of ["tool-calls", "length", "unknown", undefined]) {
      const s = server(), last = messagesOf(s.replies, recording.rootID).at(-1)!;
      if (finish === undefined) delete last.info.finish; else last.info.finish = finish;
      assert.notEqual(agents(await f.collect(s.binding))[0]!.terminalOutcome.value, "succeeded", String(finish));
    }
  } finally { await f.close(); }
});

it("replies that are not what was recorded fail closed: wrong ids, foreign parts, future clocks, unknown parts", async () => {
  const f = await bound();
  const mutations: [string, (r: ReturnType<typeof server>["replies"]) => void][] = [
    ["root reply names another session", r => { sessionOf(r, recording.rootID).id = recording.childID; }],
    ["bound root has a parent", r => { sessionOf(r, recording.rootID).parentID = recording.childID; }],
    ["child of another parent", r => { (r[`/session/${recording.rootID}/children`]!.body as any[])[0].parentID = "ses_other"; }],
    ["part of a foreign session", r => { messagesOf(r, recording.rootID)[1]!.parts[1]!.sessionID = "ses_other"; }],
    ["part of another message", r => { messagesOf(r, recording.rootID)[1]!.parts[1]!.messageID = "msg_other"; }],
    ["duplicate part id", r => { const m = messagesOf(r, recording.rootID); m[2]!.parts[0]!.id = m[1]!.parts[0]!.id; }],
    ["future clock", r => { messagesOf(r, recording.rootID).at(-1)!.info.time.completed = Date.parse(now) + 60_000; }],
    ["end before its parts", r => { const m = messagesOf(r, recording.rootID).at(-1)!; m.info.time.completed = m.info.time.created; }],
    ["unknown part type", r => { messagesOf(r, recording.rootID)[1]!.parts[0]!.type = "future-part"; }],
    ["unknown role", r => { messagesOf(r, recording.rootID)[0]!.info.role = "system"; }],
    ["unknown tool state", r => { messagesOf(r, recording.rootID)[1]!.parts[1]!.state.status = "paused"; }],
    ["messages not a list", r => { r[`/session/${recording.childID}/message`]!.body = { items: [] }; }],
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
    const big = server(); messagesOf(big.replies, recording.rootID)[3]!.parts[1]!.text = "a".repeat(9 * 1_048_576);
    assert.equal(issueOf(await f.collect(big.binding))?.reason, "scan_limit");
    // A turn longer than the window: its prompt is no longer read, and the latest messages still decide.
    const long = server(), messages = messagesOf(long.replies, recording.rootID), template = messages[6]!;
    const fillers = Array.from({ length: MAX_OPENCODE_MESSAGES }, (_, i) => {
      const entry = structuredClone(template), id = template.info.id + String(i).padStart(4, "0");
      entry.info.id = id; entry.parts = entry.parts.map((part, j) => ({ ...part, id: `${part.id}${i}x${j}`, messageID: id }));
      return entry;
    });
    // The server returns the latest `limit` messages, oldest first; the fake applies that rule.
    long.replies[`/session/${recording.rootID}/message`]!.body =
      [...messages.slice(0, 7), ...fillers, messages[7]!].slice(-(MAX_OPENCODE_MESSAGES + 1));
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
