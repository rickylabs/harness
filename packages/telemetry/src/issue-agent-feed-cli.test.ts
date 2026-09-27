import assert from "node:assert/strict";
import { it } from "node:test";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectIssueAgentTree, issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import { ORCHID_DISPATCH_ROOT } from "./orchid-dispatch.js";
import type { IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";

const at = "2026-01-01T00:00:00.000Z";
const snapshot = (complete: boolean): IssueAgentTreeSnapshot => ({ schema: 1, protocol: 1, observedAt: at,
  validUntil: "2026-01-01T00:00:15.000Z",
  revision: createHash("sha256").update(String(complete)).digest("hex"), complete,
  reason: complete ? null : "source_unavailable", issues: [] });
class Capture extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString("utf8")); callback();
  }
}

it("emits sequenced full snapshots, heartbeat, and degradation after success", async () => {
  const output = new Capture(); let calls = 0, waits = 0;
  const code = await issueAgentFeedCommand(["--watch", "--interval-ms", "100"], {
    output, now: () => at, generation: () => "generation-a", env: {},
    collect: async () => { calls++; if (calls === 3) throw Error("PRIVATE-PATH-CANARY"); return snapshot(true); },
    wait: async () => { if (++waits === 3) output.emit("close"); },
  });
  assert.equal(code, 0);
  const frames = output.lines.map(line => JSON.parse(line));
  assert.deepEqual(frames.map(f => f.sequence), [0, 1, 2]);
  assert.deepEqual(frames.map(f => f.generation), ["generation-a", "generation-a", "generation-a"]);
  assert.deepEqual(frames.map(f => f.snapshot.complete), [true, true, false]);
  assert.equal(frames[2].snapshot.reason, "source_unavailable");
  assert.ok(!output.lines.join("").includes("PRIVATE-"));
});
it("a new process generation starts with seq zero and one-shot reports incompleteness", async () => {
  const output = new Capture();
  assert.equal(await issueAgentFeedCommand(["--json"], { output, now: () => at, collect: async () => snapshot(false) }), 3);
  assert.equal(JSON.parse(output.lines[0]!).complete, false);
  const next = new Capture();
  assert.equal(await issueAgentFeedCommand(["--watch"], { output: next, now: () => at, generation: () => "generation-b",
    collect: async () => snapshot(true), wait: async () => { next.emit("close"); } }), 0);
  assert.equal(JSON.parse(next.lines[0]!).sequence, 0);
  assert.equal(JSON.parse(next.lines[0]!).generation, "generation-b");
});
it("awaits the write callback before collecting a second snapshot", async () => {
  let release: (() => void) | undefined, collected = 0;
  const output = new Writable({ write(_chunk, _encoding, callback) { release = () => callback(); } });
  const task = issueAgentFeedCommand(["--watch"], { output, now: () => at, collect: async () => { collected++; return snapshot(true); },
    wait: async () => { output.emit("close"); } });
  for (let i = 0; i < 20 && !release; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(collected, 1);
  assert.ok(release);
  release();
  assert.equal(await task, 0);
  assert.equal(collected, 1);
});
it("closes an in-flight write when its consumer disconnects", async () => {
  let started = false;
  const output = new Writable({ write(_chunk, _encoding, _callback) { started = true; } });
  const task = issueAgentFeedCommand(["--watch"], { output, now: () => at, collect: async () => snapshot(true) });
  for (let i = 0; i < 20 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  output.emit("close");
  assert.equal(await task, 3);
});
it("normalizes oversized or invalid collector output to an incomplete bounded frame", async () => {
  const output = new Capture();
  const huge = { ...snapshot(true), unexpected: "PRIVATE-PATH-CANARY".repeat(200_000) } as IssueAgentTreeSnapshot;
  assert.equal(await issueAgentFeedCommand(["--json"], { output, now: () => at, collect: async () => huge }), 3);
  assert.equal(JSON.parse(output.lines[0]!).complete, false);
  assert.ok(output.lines[0]!.length < 1024);
  assert.ok(!output.lines[0]!.includes("PRIVATE-"));
});
it("fails a broken output without silently continuing the watch", async () => {
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(Error("broken")); } });
  const code = await issueAgentFeedCommand(["--watch"], { output, now: () => at, collect: async () => snapshot(true) });
  assert.equal(code, 3);
});
it("withholds a snapshot that expired during collection and bounds the watch interval", async () => {
  const output = new Capture(); let ticks = 0;
  const code = await issueAgentFeedCommand(["--json"], { output,
    now: () => ++ticks === 1 ? at : "2026-01-01T00:00:16.000Z",
    collect: async () => snapshot(true) });
  assert.equal(code, 3);
  const emitted = JSON.parse(output.lines[0]!);
  assert.equal(emitted.complete, false);
  assert.equal(emitted.reason, "source_unavailable");
  assert.equal(emitted.observedAt, "2026-01-01T00:00:16.000Z");
  assert.equal(await issueAgentFeedCommand(["--json", "--interval-ms", "15000"], {
    output: new Capture(), now: () => at, collect: async () => snapshot(true) }), 2);
});
it("emits a bound issue tree despite a stale issue and scans only receipt-day rollouts", async () => {
  const home = await mkdtemp(join(tmpdir(), "issue-feed-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-receipts-"));
  const issue = async (number: number, observedAt: string, rootId?: string) => {
    const issueId = `fixture-${number}`, repo = "example/project", brief = "b".repeat(64);
    const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
    const record = join(receipts, key, "record");
    await mkdir(record, { recursive: true, mode: 0o700 });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1,
      runId: `orchid-${key}`, issue: { repo, number }, parentRunId: null, source: "codex",
      provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf",
      state: "dispatched", observedAt, location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    if (rootId) await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo,
      BriefDigest: brief, Route: { transport: "codex", provider: "fixture-router", model: "fixture-model", effort: "high" },
      NativeSessionID: rootId }), { mode: 0o600 });
  };
  try {
    const rootId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d";
    const childId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4e";
    await issue(387, "2026-09-27T21:24:00.000Z", rootId);
    await issue(378, "2026-09-15T21:24:00.000Z");
    const sessions = join(home, ".codex", "sessions", "2026", "09", "27");
    await mkdir(sessions, { recursive: true });
    const rollout = (id: string, parentId: string | null) => JSON.stringify({ timestamp: "2026-09-27T21:25:00.000Z",
      type: "session_meta", payload: { session_id: id, timestamp: "2026-09-27T21:25:00.000Z", cwd: "/fixture",
        model_provider: "fixture", ...(parentId ? { parent_thread_id: parentId } : {}) } }) + "\n";
    await writeFile(join(sessions, `rollout-2026-09-27T21-25-00-${rootId}.jsonl`), rollout(rootId, null));
    await writeFile(join(sessions, `rollout-2026-09-27T21-26-00-${childId}.jsonl`), rollout(childId, rootId));
    const older = join(home, ".codex", "sessions", "2025", "01", "01");
    await mkdir(older, { recursive: true });
    await writeFile(join(older, `rollout-2025-01-01T00-00-00-${rootId}.jsonl`), "{malformed\n");
    const frame = await collectIssueAgentTree({ home, env: { [ORCHID_DISPATCH_ROOT]: receipts }, limit: 20,
      now: "2026-09-27T22:00:00.000Z" });
    assert.equal(frame.complete, false);
    assert.equal(frame.issues.length, 2);
    assert.equal(frame.issues[0]?.issueNumber, 378);
    assert.deepEqual([frame.issues[0]?.complete, frame.issues[0]?.reason, frame.issues[0]?.dispatches.length],
      [false, "scan_limit", 0]);
    assert.equal(frame.issues[1]?.issueNumber, 387);
    assert.equal(frame.issues[1]?.complete, true);
    assert.equal(frame.issues[1]?.dispatches[0]?.agents.length, 2);
    assert.ok(!JSON.stringify(frame).includes(rootId));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});
