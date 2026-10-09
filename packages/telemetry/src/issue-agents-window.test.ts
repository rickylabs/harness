/**
 * The issue feed reads a dispatch until its run can no longer change: while it has no end, up to
 * a running cap after dispatch; once Orchid saw it end, for a fixed window after the end. So a run
 * that ends a day or more after its dispatch still has its final tree read, complete, once.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

import { collectIssueAgentTree, dispatchEndMs, dispatchReadWindow, ENDED_RUN_WINDOW_MS,
  RUNNING_DISPATCH_CAP_MS } from "./issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "./operator-environment.js";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";

const HOUR = 3_600_000;
// Fixture clocks sit in the past: Orchid observations stamped after the real clock are refused.
const DISPATCHED = Date.parse("2026-09-20T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const ROOT = "11111111-1111-4111-8111-000000000001";

const at = (ms: number) => iso(ms);
const dispatch = (extra: Partial<DispatchEvidence> = {}) => ({ observedAt: iso(DISPATCHED), ...extra }) as DispatchEvidence;
const pair = (seatMs: number, processMs: number) => ({ seatObservedAt: at(seatMs), processObservedAt: at(processMs) });

it("an end is a paired seat and process absence, the later of the two, the earliest pair winning", () => {
  const now = DISPATCHED + 40 * HOUR;
  assert.equal(dispatchEndMs(dispatch(), now), null);
  // A lone observation is not an end: the tree keeps such a root running or unknown too.
  assert.equal(dispatchEndMs(dispatch({ teardown: { cause: "teardown", seatObservedAt: null, processObservedAt: at(DISPATCHED + HOUR) } }), now), null);
  assert.equal(dispatchEndMs(dispatch({ stop: { seatObservedAt: at(DISPATCHED + HOUR), processObservedAt: null } }), now), null);
  assert.equal(dispatchEndMs(dispatch({ teardown: { cause: "teardown", ...pair(DISPATCHED + 2 * HOUR, DISPATCHED + 3 * HOUR) } }), now),
    DISPATCHED + 3 * HOUR);
  assert.equal(dispatchEndMs(dispatch({ stop: pair(DISPATCHED + 5 * HOUR, DISPATCHED + 4 * HOUR),
    teardown: { cause: "timeout", ...pair(DISPATCHED + 9 * HOUR, DISPATCHED + 9 * HOUR) } }), now), DISPATCHED + 5 * HOUR);
  // Stamped after the read: not yet an end.
  assert.equal(dispatchEndMs(dispatch({ stop: pair(now + 1, now + 1) }), now), null);
});

it("reads a running dispatch up to the running cap, and an ended one for the window after its end", () => {
  const running = dispatch();
  assert.equal(dispatchReadWindow(running, DISPATCHED + 30 * HOUR).readable, true, "a day is not the bound any more");
  assert.equal(dispatchReadWindow(running, DISPATCHED + RUNNING_DISPATCH_CAP_MS).readable, true);
  assert.equal(dispatchReadWindow(running, DISPATCHED + RUNNING_DISPATCH_CAP_MS + 1).readable, false);
  const end = DISPATCHED + 30 * HOUR;
  const ended = dispatch({ teardown: { cause: "teardown", ...pair(end - 1_000, end) } });
  assert.equal(dispatchReadWindow(ended, end + ENDED_RUN_WINDOW_MS).readable, true);
  assert.equal(dispatchReadWindow(ended, end + ENDED_RUN_WINDOW_MS + 1).readable, false);
  // Ended, but only after the running cap: the run was past every bound before it ended.
  const late = DISPATCHED + RUNNING_DISPATCH_CAP_MS + HOUR;
  assert.equal(dispatchReadWindow(dispatch({ stop: pair(late, late) }), late + HOUR).readable, false);
  // The native window: ten minutes before dispatch to ten minutes after the end, never past now.
  assert.deepEqual(dispatchReadWindow(ended, end + 5 * HOUR), { readable: true, startMs: DISPATCHED - 600_000, endMs: end + 600_000 });
  assert.equal(dispatchReadWindow(ended, end + 60_000).endMs, end + 60_000);
  assert.equal(dispatchReadWindow(running, DISPATCHED + 3 * HOUR).endMs, DISPATCHED + 3 * HOUR);
  assert.equal(dispatchReadWindow({} as DispatchEvidence, DISPATCHED).readable, false);
});

/** A bound Codex dispatch with real receipts and its root rollout, optionally torn down. */
async function feedAt(nowMs: number, options: { teardownAt?: number; withRollout?: boolean; workRepo?: string } = {}) {
  const home = await mkdtemp(join(tmpdir(), "issue-agents-window-"));
  try {
    const receipts = join(home, "receipts"), issueId = "fixture-13", brief = "a".repeat(64), repo = "example/project";
    // Orchid keys the run with its binding's WORK repository: for an inbox launch from a source
    // elsewhere (the body's repo: key) that is not the inbox issue's repository (harness#613).
    const work = options.workRepo ?? repo;
    const key = createHash("sha256").update(`${issueId}\0${work}\0${brief}`).digest("hex");
    const record = join(receipts, key, "record"), runId = `orchid-${key}`, host = "fixture-node";
    await mkdir(record, { recursive: true, mode: 0o700 });
    const write = (name: string, value: unknown) => writeFile(join(record, name), JSON.stringify(value), { mode: 0o600 });
    await write("dispatch.json", { schemaVersion: 1, runId, issue: { repo, number: 13 }, parentRunId: null, source: "codex",
      provider: "fixture", model: "fixture-model", effort: "high", state: "dispatched", observedAt: iso(DISPATCHED), host,
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } });
    await write("binding.json", { IssueID: issueId, Repo: work, BriefDigest: brief, Host: host,
      Route: { transport: "codex", provider: "fixture", model: "fixture-model", effort: "high" }, NativeSessionID: ROOT });
    if (options.teardownAt !== undefined) {
      const end = options.teardownAt;
      await write("teardown-intent.json", { schemaVersion: 1, issue: 13, dispatchKey: key, nativeRunId: runId,
        nativeSessionId: ROOT, host, paneId: "fixture-pane", workspaceId: "fixture-workspace", cause: "teardown",
        startedAt: iso(end - 2_000) });
      await write("teardown-anchor.json", { schemaVersion: 1, operationId: "", requestDigest: "", groupId: 301, rootPid: 301,
        members: [{ pid: 301, start: 9 }] });
      await write("teardown-seat-observed.json", { schemaVersion: 1, nativeRunId: runId, kind: "seat_absent", observedAt: iso(end - 1_000) });
      await write("teardown-process-observed.json", { schemaVersion: 1, nativeRunId: runId, kind: "process_absent", observedAt: iso(end) });
    }
    if (options.withRollout !== false) {
      const stamp = iso(DISPATCHED + 60_000);
      const day = join(home, ".codex", "sessions", stamp.slice(0, 4), stamp.slice(5, 7), stamp.slice(8, 10));
      await mkdir(day, { recursive: true });
      const line = (ms: number, type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp: iso(ms), type, payload }) + "\n";
      await writeFile(join(day, `rollout-${stamp.slice(0, 19).replaceAll(":", "-")}-${ROOT}.jsonl`),
        line(DISPATCHED + 60_000, "session_meta", { id: ROOT, cwd: "/fixture", model_provider: "fixture" }) +
        line(DISPATCHED + 61_000, "event_msg", { type: "task_started" }));
    }
    return await collectIssueAgentTree({ home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20, now: iso(nowMs) });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
const root = (frame: Awaited<ReturnType<typeof feedAt>>) =>
  frame.issues[0]?.dispatches[0]?.agents.find(agent => agent.observation.parentAgentId.state === "confirmed-root");

it("serves a run with no end a day and a half after its dispatch", async () => {
  const frame = await feedAt(DISPATCHED + 36 * HOUR);
  assert.equal(frame.issues[0]?.complete, true, `reason ${frame.issues[0]?.reason}`);
  // Its root is served; with no recent activity its liveness is honestly unknown, never ended.
  assert.ok(root(frame));
  assert.notEqual(root(frame)?.liveness.state, "ended");
  assert.equal(root(frame)?.endedAt, null);
});

it("serves the final tree of a run that ended a day after its dispatch, complete and ended", async () => {
  const end = DISPATCHED + 30 * HOUR;
  const frame = await feedAt(end + 10 * HOUR, { teardownAt: end });
  assert.equal(frame.issues[0]?.complete, true, `reason ${frame.issues[0]?.reason}`);
  assert.deepEqual(root(frame)?.liveness, { state: "ended", evidence: "teardown-observation", observedAt: iso(end), reason: null });
  assert.equal(root(frame)?.endedBy, "teardown");
  assert.equal(root(frame)?.endedAt, iso(end));
});

it("harness#613: an inbox run whose binding names its work repository ends at its teardown", async () => {
  const end = DISPATCHED + 3 * HOUR;
  const frame = await feedAt(end + HOUR, { teardownAt: end, workRepo: "example/work" });
  assert.equal(frame.issues[0]?.issueNumber, 13);
  assert.deepEqual(root(frame)?.liveness, { state: "ended", evidence: "teardown-observation", observedAt: iso(end), reason: null });
  assert.equal(root(frame)?.endedBy, "teardown");
  assert.equal(root(frame)?.endedAt, iso(end));
  assert.equal(root(frame)?.timeline?.events.find(event => event.kind === "ended")?.reason, "teardown");
});

it("stops reading a run a day after its end, and a run with no end after the running cap", async () => {
  const end = DISPATCHED + 30 * HOUR;
  const after = await feedAt(end + ENDED_RUN_WINDOW_MS + HOUR, { teardownAt: end });
  assert.equal(after.issues[0]?.complete, false);
  assert.equal(after.issues[0]?.reason, "scan_limit");
  const stale = await feedAt(DISPATCHED + RUNNING_DISPATCH_CAP_MS + HOUR);
  assert.equal(stale.issues[0]?.complete, false);
  assert.equal(stale.issues[0]?.reason, "scan_limit");
});

it("reads a run that ended six and a half days after its dispatch through one native window", async () => {
  const end = DISPATCHED + 156 * HOUR;
  const frame = await feedAt(end + HOUR, { teardownAt: end });
  assert.equal(frame.issues[0]?.complete, true, `reason ${frame.issues[0]?.reason}`);
  assert.equal(root(frame)?.liveness.state, "ended");
});

it("still refuses a native window longer than the cap", async () => {
  const { backfillFromDisk, CODEX_WINDOW_MAX_MS } = await import("./backfill/index.js");
  const home = await mkdtemp(join(tmpdir(), "issue-agents-window-cap-"));
  try {
    await mkdir(join(home, "sessions"), { recursive: true });
    const scan = (length: number) => backfillFromDisk({ codexSessions: join(home, "sessions") }, { limit: 20,
      codexWindows: [{ startMs: DISPATCHED, endMs: DISPATCHED + length }], codexRootMatches: () => false,
      maxTranscriptBytes: 8_388_608, maxTotalBytes: 33_554_432 });
    assert.equal((await scan(CODEX_WINDOW_MAX_MS)).degraded, false);
    const over = await scan(CODEX_WINDOW_MAX_MS + 1);
    assert.equal(over.degraded, true);
    assert.match(over.notes.join("\n"), /invalid receipt window/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("ends the native window at the run's end, so a late read of a long run stays inside the cap", async () => {
  // Ended just inside the running cap and read 20 h later: a window running to now would be longer
  // than the cap and refused; one ending ten minutes after the end is not.
  const end = DISPATCHED + 165 * HOUR;
  const frame = await feedAt(end + 20 * HOUR, { teardownAt: end });
  assert.equal(frame.issues[0]?.complete, true, `reason ${frame.issues[0]?.reason}`);
  assert.equal(root(frame)?.liveness.state, "ended");
});
