import assert from "node:assert/strict";
import { it } from "node:test";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectIssueAgentTree, issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import { ORCHID_DISPATCH_ROOT } from "./orchid-dispatch.js";
import type { IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { openIssueFeedChanges, type IssueFeedChanges } from "./issue-agent-feed-changes.js";

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
  let dirty = false;
  const changes: IssueFeedChanges = { consume() { const value = dirty; dirty = false; return value; }, setFiles() {}, close() {} };
  const code = await issueAgentFeedCommand(["--watch", "--interval-ms", "100"], {
    output, now: () => at, generation: () => "generation-a", env: {}, changes,
    collect: async () => { calls++; if (calls === 3) throw Error("PRIVATE-PATH-CANARY"); return snapshot(true); },
    wait: async () => { if (++waits < 3) dirty = true; else output.emit("close"); },
  });
  assert.equal(code, 0);
  const frames = output.lines.map(line => JSON.parse(line));
  assert.deepEqual(frames.map(f => f.sequence), [0, 1, 2]);
  assert.deepEqual(frames.map(f => f.generation), ["generation-a", "generation-a", "generation-a"]);
  assert.deepEqual(frames.map(f => f.snapshot.complete), [true, true, false]);
  assert.equal(frames[2].snapshot.reason, "source_unavailable");
  assert.ok(!output.lines.join("").includes("PRIVATE-"));
});
it("heartbeats retain the last observation and a missed event recovers by the safety deadline", async () => {
  const output = new Capture(); let elapsed = 0, scans = 0;
  const times: number[] = [];
  const changes: IssueFeedChanges = { consume: () => false, setFiles() {}, close() {} };
  const code = await issueAgentFeedCommand(["--watch", "--interval-ms", "5000"], {
    output, changes, generation: () => "generation-safety", elapsed: () => elapsed,
    now: () => new Date(Date.parse(at) + elapsed).toISOString(),
    collect: async options => {
      scans++; times.push(elapsed);
      return { ...snapshot(true), observedAt: options.now,
        validUntil: new Date(Date.parse(options.now) + 15_000).toISOString() };
    },
    wait: async ms => { elapsed += ms; if (elapsed >= 25_000) output.emit("close"); },
  });
  assert.equal(code, 0);
  assert.deepEqual(times, [0, 12_000, 24_000]);
  assert.equal(scans, 3);
  const frames = output.lines.map(line => JSON.parse(line));
  assert.deepEqual(frames.map(f => f.snapshot.observedAt), [at, at, at,
    new Date(Date.parse(at) + 12_000).toISOString(), new Date(Date.parse(at) + 12_000).toISOString(),
    new Date(Date.parse(at) + 12_000).toISOString(), new Date(Date.parse(at) + 24_000).toISOString()]);
  assert.ok(frames.every(f => f.snapshot.complete));
});
it("a source change collects at the next heartbeat without waiting for the safety scan", async () => {
  const output = new Capture(); let elapsed = 0, dirty = false, scans = 0;
  const changes: IssueFeedChanges = { consume() { const changed = dirty; dirty = false; return changed; }, setFiles() {}, close() {} };
  const code = await issueAgentFeedCommand(["--watch"], {
    output, changes, elapsed: () => elapsed, now: () => new Date(Date.parse(at) + elapsed).toISOString(),
    collect: async options => { scans++; return { ...snapshot(true), observedAt: options.now,
      validUntil: new Date(Date.parse(options.now) + 15_000).toISOString() }; },
    wait: async ms => { elapsed += ms; if (elapsed === 5000) dirty = true; else output.emit("close"); },
  });
  assert.equal(code, 0);
  assert.equal(scans, 2);
  assert.deepEqual(output.lines.map(line => JSON.parse(line).snapshot.observedAt),
    [at, new Date(Date.parse(at) + 5000).toISOString()]);
});
it("filesystem hints ignore unrelated appends but notice bound files, new files and receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "issue-watch-"));
  const receipts = join(root, "receipts"), sessions = join(root, "sessions"), claude = join(root, "claude");
  const day = join(sessions, "2026", "09", "28");
  const claudeProject = join(claude, "fixture-project");
  const record = join(receipts, "fixture", "record");
  await mkdir(day, { recursive: true }); await mkdir(record, { recursive: true });
  await mkdir(claudeProject, { recursive: true });
  const selected = join(day, "selected.jsonl"), unrelated = join(day, "unrelated.jsonl");
  const claudeSelected = join(claudeProject, "selected.jsonl");
  await writeFile(selected, "a"); await writeFile(unrelated, "a"); await writeFile(claudeSelected, "a");
  const changes = openIssueFeedChanges(receipts, sessions, claude);
  const eventually = async () => {
    for (let i = 0; i < 30; i++) {
      if (changes.consume()) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return false;
  };
  try {
    changes.setFiles(new Set([selected, claudeSelected]));
    await new Promise(resolve => setTimeout(resolve, 50));
    changes.consume();
    await appendFile(unrelated, "b");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(changes.consume(), false);
    await appendFile(selected, "b");
    assert.equal(await eventually(), true);
    await appendFile(claudeSelected, "b");
    assert.equal(await eventually(), true);
    await writeFile(join(day, "new.jsonl"), "a");
    assert.equal(await eventually(), true);
    await writeFile(join(claudeProject, "new.jsonl"), "a");
    assert.equal(await eventually(), true);
    await writeFile(join(record, "binding.json"), "{}");
    assert.equal(await eventually(), true);
  } finally { changes.close(); await rm(root, { recursive: true, force: true }); }
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
        model_provider: "fixture", base_instructions: "fixture".repeat(3_600),
        ...(parentId ? { parent_thread_id: parentId } : {}) } }) + "\n";
    assert.ok(Buffer.byteLength(rollout(rootId, null).split("\n")[0]!) >= 24_000);
    // Native filenames use a local UTC+2 wall clock while receipts and JSONL timestamps use UTC.
    await writeFile(join(sessions, `rollout-2026-09-27T23-25-00-${rootId}.jsonl`), rollout(rootId, null));
    await writeFile(join(sessions, `rollout-2026-09-27T23-26-00-${childId}.jsonl`), rollout(childId, rootId));
    for (const [minute, id] of [[27, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4f"],
      [28, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c50"]] as const) {
      const unrelated = await open(join(sessions, `rollout-2026-09-27T23-${minute}-00-${id}.jsonl`), "w");
      try { await unrelated.writeFile(rollout(id, null)); await unrelated.truncate(20 * 1_048_576); }
      finally { await unrelated.close(); }
    }
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
    const scoped = new Capture();
    const command = ["--json", "--issue", "example/project#387", "--home", home, "--limit", "20"];
    assert.equal(await issueAgentFeedCommand(command, { output: scoped, now: () => "2026-09-27T22:00:00.000Z",
      env: { [ORCHID_DISPATCH_ROOT]: receipts } }), 0);
    const scopedFrame = JSON.parse(scoped.lines[0]!);
    assert.equal(scopedFrame.complete, true);
    assert.deepEqual(scopedFrame.issues.map((row: { issueNumber: number }) => row.issueNumber), [387]);
    const missing = new Capture();
    assert.equal(await issueAgentFeedCommand(["--json", "--issue", "example/project#999", "--home", home],
      { output: missing, now: () => "2026-09-27T22:00:00.000Z", env: { [ORCHID_DISPATCH_ROOT]: receipts } }), 3);
    assert.equal(JSON.parse(missing.lines[0]!).reason, "source_not_bound");
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});
it("binds one Claude root and native child into live steps, tokens and separate resource histories", async () => {
  const home = await mkdtemp(join(tmpdir(), "issue-claude-home-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-claude-receipts-"));
  const issueId = "fixture-claude", repo = "example/project", brief = "b".repeat(64);
  const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
  const record = join(receipts, key, "record"), sessionId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d";
  const project = join(home, ".claude", "projects", "fixture-project");
  const childFile = join(project, sessionId, "subagents", "agent-child.jsonl");
  const when = "2026-09-29T00:00:01.000Z";
  const transcript = (sidechain: boolean, input: number, output: number) => [
    { type: "user", timestamp: "2026-09-29T00:00:00.000Z", sessionId,
      uuid: "u1", isSidechain: sidechain, message: { role: "user", content: "PRIVATE-PROMPT-CANARY" } },
    { type: "assistant", timestamp: when, sessionId,
      uuid: "a1", isSidechain: sidechain, message: { role: "assistant", model: "fixture-model",
        usage: { input_tokens: input, output_tokens: output },
        content: [{ type: "text", text: "Review fixtures." }] } },
  ].map(row => JSON.stringify(row)).join("\n") + "\n";
  try {
    await mkdir(record, { recursive: true, mode: 0o700 });
    await mkdir(join(receipts, "actions"), { mode: 0o700 });
    await mkdir(join(project, sessionId, "subagents"), { recursive: true });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1,
      runId: `orchid-${key}`, issue: { repo, number: 451 }, parentRunId: null, source: "claude",
      provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf",
      tokenBudget: 1000, budgetSource: "route", state: "dispatched",
      observedAt: "2026-09-29T00:00:00.000Z",
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo,
      BriefDigest: brief, Route: { transport: "claude", provider: "fixture-router", model: "fixture-model", effort: "high" },
      NativeSessionID: sessionId }), { mode: 0o600 });
    await writeFile(join(project, sessionId + ".jsonl"), transcript(false, 5, 2));
    await writeFile(childFile, transcript(true, 3, 1));
    const frame = await collectIssueAgentTree({ home, env: { [ORCHID_DISPATCH_ROOT]: receipts }, limit: 20,
      now: "2026-09-29T00:00:10.000Z", issueKey: "example/project#451" });
    assert.equal(frame.complete, true);
    const agents = frame.issues[0]?.dispatches[0]?.agents ?? [];
    assert.equal(agents.length, 2);
    const root = agents.find(agent => agent.parentAgentId === null)!;
    const child = agents.find(agent => agent.parentAgentId !== null)!;
    assert.equal(root.activity?.steps.length, 1);
    assert.equal(root.tokenUsage?.usedTokens, 7);
    assert.equal(root.resourceHistory?.tokens.points.at(-1)?.usedTokens, 7);
    assert.equal(root.resourceHistory?.budgets.points[0]?.tokenLimit, 1000);
    assert.equal(child.tokenUsage?.usedTokens, 4);
    assert.equal(child.resourceHistory?.tokens.points.at(-1)?.usedTokens, 4);
    assert.equal(child.resourceHistory?.budgets.reason, "source_not_bound");
    assert.equal(root.liveness.state, "unknown"); // Claude transcript has no task-start marker.
    assert.ok(!JSON.stringify(frame).includes(sessionId));
    assert.ok(!JSON.stringify(frame).includes("PRIVATE-"));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});
it("rejects malformed scoped issue selectors before collecting", async () => {
  for (const issue of ["387", "example/project#0", "example/project#99999999999999999999", "example/../project#387"]) {
    assert.equal(await issueAgentFeedCommand(["--json", "--issue", issue], { collect: async () => { throw Error("must not collect"); } }), 2);
  }
});
it("keeps an issue-scoped Orchid refusal when no agent ever launched", async () => {
  const home = await mkdtemp(join(tmpdir(), "issue-refusal-home-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-refusal-root-"));
  const path = join(receipts, "launch-" + "d".repeat(64) + ".json");
  const refusal = { schemaVersion: 1, issue: { repo: "example/inbox", number: 42 },
    dispatchId: "assignment_" + "e".repeat(64), state: "refused", reasonCode: "routing-invalid",
    observedAt: "2026-01-01T00:00:00.000Z" };
  try {
    await writeFile(path, JSON.stringify(refusal), { mode: 0o600 });
    const now = "2026-01-01T00:00:01.000Z";
    const options = { home, env: { [ORCHID_DISPATCH_ROOT]: receipts }, limit: 20, now,
      issueKey: "example/inbox#42" };
    const frame = await collectIssueAgentTree(options);
    assert.equal(frame.issues.length, 1);
    assert.equal(frame.issues[0]?.complete, true);
    assert.deepEqual(frame.issues[0]?.dispatches, []);
    assert.deepEqual(frame.issues[0]?.launchRefusal, { state: "refused", reason: "routing-invalid",
      at: refusal.observedAt, dispatchId: refusal.dispatchId, source: "orchid" });
    const output = new Capture();
    assert.equal(await issueAgentFeedCommand(["--json", "--issue", "example/inbox#42", "--home", home],
      { output, now: () => now, env: options.env }), 0);
    assert.equal(JSON.parse(output.lines[0]!).issues[0].launchRefusal.reason, "routing-invalid");
    await writeFile(path, JSON.stringify({ ...refusal, state: "launching", reasonCode: null }));
    const cleared = await collectIssueAgentTree(options);
    assert.deepEqual(cleared.issues, []);
    assert.ok(!JSON.stringify(frame).includes("PRIVATE"));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});
