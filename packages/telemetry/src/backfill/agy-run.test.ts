/** The agy completion rules over neutral snapshots: each condition of an end on its own. */
import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgyConversationSnapshot, AgyStoreRead, AgyTrajectoryStep } from "@rickylabs/harness-contracts";
import { agyNativeReads, unreadToolCalls } from "@rickylabs/provider-agy";
import { rootID, seconds } from "@rickylabs/provider-agy/test-fixtures";
import type { AgyNativeReads } from "../agy-reads.js";
import { agyRun, scanAGYIssue } from "./agy.js";
import { agyActivity, attachAgyDescriptors } from "./agy-activity.js";

const at = (offset: number) => new Date((seconds + offset) * 1000).toISOString();
const step = (index: number, kind: AgyTrajectoryStep["kind"], status: AgyTrajectoryStep["status"], over: Partial<AgyTrajectoryStep> = {}): AgyTrajectoryStep => ({
  index, kind, status, createdAt: at(index + 1), completedAt: status === "pending" ? null : at(index + 1), hasResponse: kind === "planner",
  responseText: kind === "planner" ? "Done here now." : null, stopReason: kind === "planner" ? "explicit-stop" : null, hasError: false, ...over });
const snapshot = (steps: AgyTrajectoryStep[], over: Partial<AgyConversationSnapshot> = {}): AgyConversationSnapshot => ({
  conversationId: rootID, parentId: null, origin: "origin", startedAt: at(0), updatedAt: at(steps.length), summaryState: "idle",
  summaryRunning: false, childActive: false, notFullyIdle: false, killedColumn: false, killedNative: false, interrupted: false,
  steps, workspaceRoot: null, ...over });
const turn = (over: Partial<AgyTrajectoryStep> = {}) => [step(0, "user", "done"), step(1, "planner", "done", over)];
const outcome = (s: AgyConversationSnapshot) => [agyRun(s).outcome, agyRun(s).terminalCause];

it("completes a done, explicitly stopped, non-empty response in an idle conversation", () => {
  assert.deepEqual(outcome(snapshot(turn())), ["complete", undefined]);
});
it("a new user turn clears an earlier in-progress step", () => {
  assert.deepEqual(outcome(snapshot([step(0, "user", "done"), step(1, "result", "pending"), step(2, "user", "done"), step(3, "planner", "done")])), ["complete", undefined]);
});
it("an in-progress step in the current turn blocks the end", () => {
  assert.deepEqual(outcome(snapshot([step(0, "user", "done"), step(1, "result", "pending"), step(2, "planner", "done")])), ["unknown", undefined]);
});
it("only an idle summary allows success", () => {
  assert.deepEqual(outcome(snapshot(turn(), { summaryState: "other" })), ["unknown", undefined]);
});
it("a killed flag in either the summary column or the native summary forbids success", () => {
  assert.deepEqual(outcome(snapshot(turn(), { killedNative: true })), ["unknown", undefined]);
  assert.deepEqual(outcome(snapshot(turn(), { killedColumn: true })), ["unknown", undefined]);
});
it("an end older than the latest native update is no end", () => {
  assert.deepEqual(outcome(snapshot(turn(), { updatedAt: at(5) })), ["unknown", undefined]);
});
it("an interrupted conversation ends cancelled, and an error record ends in error", () => {
  assert.deepEqual(outcome(snapshot(turn(), { interrupted: true })), ["failed", "cancelled"]);
  assert.deepEqual(outcome(snapshot(turn({ hasError: true }))), ["failed", "error"]);
});
it("a response that is not done, or is blank, is no success", () => {
  assert.deepEqual(outcome(snapshot(turn({ status: "other" }))), ["unknown", undefined]);
  assert.deepEqual(outcome(snapshot(turn({ responseText: "   " }))), ["unknown", undefined]);
});
it("publishes a message only for a step that carries a typed response", () => {
  assert.equal(agyRun(snapshot(turn({ hasResponse: false, responseText: null }))).activitySteps!.length, 0);
});
it("carries a store refusal and its bytes, with no runs", async () => {
  const refused: AgyStoreRead = { conversations: [], bytesRead: 7, files: ["f"], reason: "scan_limit" };
  const reads: AgyNativeReads = { ...agyNativeReads, readStore: async () => refused };
  const scan = await scanAGYIssue(reads, "/store", () => true, 20, 1000, Date.now());
  assert.deepEqual([scan.reason, scan.bytesRead, scan.runs.length, scan.files], ["scan_limit", 7, 0, ["f"]]);
});

const unread = unreadToolCalls;
it("returns the run itself when nothing is named and lifecycle is off", () => {
  const conversation = snapshot(turn()), run = agyRun(conversation);
  assert.equal(agyActivity({ run, storeRoot: "/store", conversation }, unread("tool-names-source-missing"), false), run);
});
it("never watches a log that was missing or not read for budget", async () => {
  for (const gap of ["tool-names-source-missing", "tool-names-budget-exhausted"] as const) {
    const conversation = snapshot(turn()), watchFiles = new Set<string>();
    const reads: AgyNativeReads = { ...agyNativeReads, readToolCalls: async () => unread(gap) };
    await attachAgyDescriptors([{ run: agyRun(conversation), storeRoot: "/store", conversation }], reads,
      { lifecycle: false, remainingBytes: 1 << 30, reserveBytes: 0, watchFiles });
    assert.equal(watchFiles.size, 0, gap);
  }
});
