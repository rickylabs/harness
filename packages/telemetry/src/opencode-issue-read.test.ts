/**
 * The OpenCode tree read over telemetry's server port. Every refused tree is valid except for the one
 * rule it breaks, so no other check can be what refuses it.
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { MAX_OPENCODE_ISSUE_BYTES, readOpenCodeIssue } from "./opencode-issue.js";
import { messagesOf, nowMs, recording, server, sessionOf } from "./fixtures/opencode-issue.js";

const { rootID, childID } = recording;
const read = (s: ReturnType<typeof server>, bounds: { maxBytes?: number; clock?: () => number } = {}) =>
  readOpenCodeIssue(s.reads, rootID, { limit: 20, maxBytes: bounds.maxBytes ?? MAX_OPENCODE_ISSUE_BYTES,
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
