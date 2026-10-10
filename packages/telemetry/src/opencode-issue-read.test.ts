/**
 * The OpenCode tree read over telemetry's server port. Every refused tree is valid except for the one
 * rule it breaks, so no other check can be what refuses it.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { MAX_OPENCODE_ISSUE_BYTES, readOpenCodeIssue } from "./opencode-issue.js";
import { messagesOf, nowMs, recording, server, sessionOf } from "./fixtures/opencode-issue.js";

const { rootID, childID } = recording;
const read = (s: ReturnType<typeof server>,
  bounds: { maxBytes?: number; clock?: () => number; root?: string; limit?: number } = {}) =>
  readOpenCodeIssue(s.reads, bounds.root ?? rootID, { limit: bounds.limit ?? 20, maxBytes: bounds.maxBytes ?? MAX_OPENCODE_ISSUE_BYTES,
    clock: bounds.clock ?? (() => nowMs), signal: new AbortController().signal });
const outcome = (scan: Awaited<ReturnType<typeof read>>) => [scan.reason, scan.runs.length];

it("reads the bound root and its explicit child, root first", async () => {
  const scan = await read(server());
  assert.deepEqual([scan.reason, scan.sessions, scan.runs.map(run => [run.id, run.parentId]), scan.observedMs],
    [null, [rootID, childID], [[rootID, null], [childID, rootID]], nowMs]);
});

it("refuses a root reply that names another session, though that session is whole and consistent", async () => {
  const other = "ses_0anotherRootSession0", s = server();
  const rekey = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll(rootID, other));
  s.replies[`/session/${rootID}`] = { status: 200, body: rekey(sessionOf(s.replies, rootID)) };
  s.replies[`/session/${other}/children`] = { status: 200, body: [] };
  s.replies[`/session/${other}/message`] = { status: 200, body: rekey(messagesOf(s.replies, rootID)) };
  assert.deepEqual(outcome(await read(s)), ["source_unavailable", 0]);
});

it("refuses a bound root that has a parent of its own", async () => {
  const s = server();
  sessionOf(s.replies, rootID).parentID = "ses_0someOtherParent00";
  assert.deepEqual(outcome(await read(s)), ["source_unavailable", 0]);
});

it("refuses a children reply that is not a list", async () => {
  const s = server();
  s.replies[`/session/${rootID}/children`]!.body = { items: [] };
  assert.deepEqual(outcome(await read(s)), ["source_unavailable", 0]);
});

it("refuses a child listed twice", async () => {
  const s = server(), children = s.replies[`/session/${rootID}/children`]!.body as unknown[];
  children.push(structuredClone(children[0]));
  assert.deepEqual(outcome(await read(s)), ["source_unavailable", 0]);
});

it("issues no request once the budget is spent", async () => {
  const s = server(), rootBytes = Buffer.byteLength(JSON.stringify(sessionOf(s.replies, rootID)));
  assert.deepEqual(outcome(await read(s, { maxBytes: rootBytes })), ["scan_limit", 0]);
  assert.deepEqual(s.calls.map(call => call.path), [`/session/${rootID}`]);
});

it("reads the observation clock once, after the last reply", async () => {
  const order: string[] = [];
  const s = server(path => { order.push(path); });
  const scan = await read(s, { clock: () => { order.push("clock"); return nowMs; } });
  assert.equal(scan.reason, null);
  assert.deepEqual([order.filter(entry => entry === "clock").length, order.at(-1)], [1, "clock"]);
});

it("refuses a bound root id outside the native grammar without asking the server", async () => {
  const s = server(), scan = await read(s, { root: "not-a-session" });
  assert.deepEqual([scan.reason, s.calls.length], ["source_unavailable", 0]);
});

it("a spent session bound is scan_limit, without asking the server", async () => {
  const s = server(), scan = await read(s, { limit: 0 });
  assert.deepEqual([scan.reason, s.calls.length], ["scan_limit", 0]);
});

it("a root that failed natively keeps its end, even with a descendant observed running", async () => {
  const s = server();
  messagesOf(s.replies, rootID).at(-1)!.info.error = { name: "APIError", data: {} };
  delete messagesOf(s.replies, childID).at(-1)!.info.time.completed;
  assert.deepEqual((await read(s)).runs.map(run => run.outcome), ["failed", "running"]);
});

it("judges a child's own header at the clock read after the reads", async () => {
  const s = server(), child = (s.replies[`/session/${rootID}/children`]!.body as Record<string, any>[])[0]!;
  s.replies[`/session/${childID}/message`]!.body = [];
  child.time.created = nowMs + 1;
  assert.deepEqual(outcome(await read(s)), ["source_unavailable", 0]);
});
