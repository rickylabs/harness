import assert from "node:assert/strict";
import { it } from "node:test";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectIssueAgentTree, issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "./operator-environment.js";
import { CLAUDE_CHILD_EVENT_ROOT } from "./claude-child-events.js";
import { chmod } from "node:fs/promises";
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
  const childEvents = join(root, "child-events");
  const day = join(sessions, "2026", "09", "28");
  const claudeProject = join(claude, "fixture-project");
  const record = join(receipts, "fixture", "record");
  await mkdir(day, { recursive: true }); await mkdir(record, { recursive: true });
  await mkdir(claudeProject, { recursive: true }); await mkdir(childEvents, { recursive: true });
  const selected = join(day, "selected.jsonl"), unrelated = join(day, "unrelated.jsonl");
  const claudeSelected = join(claudeProject, "selected.jsonl");
  await writeFile(selected, "a"); await writeFile(unrelated, "a"); await writeFile(claudeSelected, "a");
  const changes = openIssueFeedChanges(receipts, sessions, claude, childEvents);
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
    const childFile = join(childEvents, "fixture.jsonl");
    await writeFile(childFile, "a");
    assert.equal(await eventually(), true);
    changes.setFiles(new Set([selected, claudeSelected, childFile]));
    changes.consume();
    await appendFile(childFile, "b");
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
it("passes --partial-trees to the scan only when asked, and refuses it twice", async () => {
  const seen: (boolean | undefined)[] = [];
  const collect = async (options: { partialTrees?: boolean }) => { seen.push(options.partialTrees); return snapshot(true); };
  assert.equal(await issueAgentFeedCommand(["--json"], { output: new Capture(), now: () => at, collect }), 0);
  assert.equal(await issueAgentFeedCommand(["--json", "--partial-trees"], { output: new Capture(), now: () => at, collect }), 0);
  assert.deepEqual(seen, [undefined, true]);
  assert.equal(await issueAgentFeedCommand(["--json", "--partial-trees", "--partial-trees"], { output: new Capture(), now: () => at, collect }), 2);
  assert.equal(seen.length, 2);
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
    // The child appends after the capture (22:00:00): that record is not in this frame (RUN-6).
    await writeFile(join(sessions, `rollout-2026-09-27T23-26-00-${childId}.jsonl`), rollout(childId, rootId) +
      JSON.stringify({ timestamp: "2026-09-27T22:00:01.266Z", type: "event_msg", payload: { type: "agent_message", message: "later" } }) + "\n");
    for (const [minute, id] of [[27, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4f"],
      [28, "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c50"]] as const) {
      const unrelated = await open(join(sessions, `rollout-2026-09-27T23-${minute}-00-${id}.jsonl`), "w");
      try { await unrelated.writeFile(rollout(id, null)); await unrelated.truncate(20 * 1_048_576); }
      finally { await unrelated.close(); }
    }
    const older = join(home, ".codex", "sessions", "2025", "01", "01");
    await mkdir(older, { recursive: true });
    await writeFile(join(older, `rollout-2025-01-01T00-00-00-${rootId}.jsonl`), "{malformed\n");
    const frame = await collectIssueAgentTree({ home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20,
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
    const canonical = await collectIssueAgentTree({ home, env: { [OPERATOR_ENV.dispatchRoot]: receipts,
      HARNESS_TELEMETRY_WIRE_FAMILY: "harness" }, limit: 20, now: "2026-09-27T22:00:00.000Z" });
    assert.equal(canonical.issues[1]?.complete, true);
    const names = { subscriptionHeadroom: "governance.usage", meteredSpend: "runs", runTokens: "runs", localCapacity: "host-capacity" };
    for (const agent of canonical.issues[1]!.dispatches[0]!.agents) {
      const previous: IssueAgentTreeSnapshot["issues"][number]["dispatches"][number]["agents"][number] = frame.issues[1]!.dispatches[0]!.agents.find(row => row.observation.agentId === agent.observation.agentId)!;
      for (const key of Object.keys(names) as (keyof typeof names)[]) {
        assert.equal(agent.observation.cost[key].source, `harness-telemetry.${names[key]}`);
        assert.deepEqual({ ...agent.observation.cost[key], source: previous.observation.cost[key].source }, previous.observation.cost[key]);
      }
    }
    const scoped = new Capture();
    const command = ["--json", "--issue", "example/project#387", "--home", home, "--limit", "20"];
    assert.equal(await issueAgentFeedCommand(command, { output: scoped, now: () => "2026-09-27T22:00:00.000Z",
      env: { [OPERATOR_ENV.dispatchRoot]: receipts } }), 0);
    const scopedFrame = JSON.parse(scoped.lines[0]!);
    assert.equal(scopedFrame.complete, true);
    assert.deepEqual(scopedFrame.issues.map((row: { issueNumber: number }) => row.issueNumber), [387]);
    const canonicalCLI = new Capture();
    assert.equal(await issueAgentFeedCommand(command, { output: canonicalCLI, now: () => "2026-09-27T22:00:00.000Z",
      env: { [OPERATOR_ENV.dispatchRoot]: receipts, HARNESS_TELEMETRY_WIRE_FAMILY: "harness" } }), 0);
    const canonicalFrame = JSON.parse(canonicalCLI.lines[0]!);
    assert.equal(canonicalFrame.issues[0].dispatches[0].agents[0].observation.cost.runTokens.source, "harness-telemetry.runs");
    const missing = new Capture();
    assert.equal(await issueAgentFeedCommand(["--json", "--issue", "example/project#999", "--home", home],
      { output: missing, now: () => "2026-09-27T22:00:00.000Z", env: { [OPERATOR_ENV.dispatchRoot]: receipts } }), 3);
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
    const frame = await collectIssueAgentTree({ home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20,
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
it("RUN-6: records appended after the capture stay out of the frame instead of failing the issue tree", async () => {
  // RUN-6 (2026-09-30), synthetic ids and the real times: the frame was stamped 11:21:09.952, and by the
  // time the files were read, the sub-agent had appended a record stamped 11:21:11.218. Its observation
  // then claimed a time after the frame, the strict reader refused it, and the whole #516 tree came back
  // ancestry_unavailable for one poll (root and sub gone). A hook line after the capture must not
  // refuse the child-event file either.
  const home = await mkdtemp(join(tmpdir(), "issue-claude-home-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-claude-receipts-"));
  const events = await mkdtemp(join(tmpdir(), "issue-claude-events-"));
  const issueId = "fixture-claude", repo = "example/project", brief = "b".repeat(64);
  const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
  const record = join(receipts, key, "record"), sessionId = "3f6c1e2a-7b9d-4c5e-8a1f-0d2b4e6c8a91";
  const project = join(home, ".claude", "projects", "fixture-project");
  const now = "2026-09-30T11:21:09.952Z";
  const row = (sidechain: boolean, timestamp: string, uuid: string) => JSON.stringify({ type: "assistant", timestamp, sessionId, uuid,
    isSidechain: sidechain, message: { role: "assistant", model: "fixture-model", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "Working." }] } }) + "\n";
  const hook = (event: string, observedAt: string) =>
    JSON.stringify({ event, sessionId, agentId: "fixture-child", observedAt }) + "\n";
  try {
    await mkdir(record, { recursive: true, mode: 0o700 });
    await mkdir(join(receipts, "actions"), { mode: 0o700 });
    await mkdir(join(project, sessionId, "subagents"), { recursive: true });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1,
      runId: `orchid-${key}`, issue: { repo, number: 516 }, parentRunId: null, source: "claude",
      provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf",
      tokenBudget: 1000, budgetSource: "route", state: "dispatched", observedAt: "2026-09-30T11:20:41.000Z",
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo,
      BriefDigest: brief, Route: { transport: "claude", provider: "fixture-router", model: "fixture-model", effort: "high" },
      NativeSessionID: sessionId }), { mode: 0o600 });
    await writeFile(join(project, sessionId + ".jsonl"), row(false, "2026-09-30T11:20:45.132Z", "r1") +
      row(false, "2026-09-30T11:21:09.530Z", "r2") + row(false, "2026-09-30T11:21:12.074Z", "r3"));
    await writeFile(join(project, sessionId, "subagents", "agent-fixture-child.jsonl"), row(true, "2026-09-30T11:21:00.696Z", "c1") +
      row(true, "2026-09-30T11:21:08.100Z", "c2") + row(true, "2026-09-30T11:21:11.218Z", "c3") + row(true, "2026-09-30T11:21:11.608Z", "c4"));
    await chmod(events, 0o700);
    const eventFile = join(events, `${createHash("sha256").update(sessionId).digest("hex")}.jsonl`);
    await writeFile(eventFile, hook("SubagentStart", "2026-09-30T11:21:00.681Z") + hook("SubagentStop", "2026-09-30T11:21:11.700Z"), { mode: 0o600 });
    await chmod(eventFile, 0o600);
    const frame = await collectIssueAgentTree({ home, env: { [OPERATOR_ENV.dispatchRoot]: receipts, [CLAUDE_CHILD_EVENT_ROOT]: events },
      limit: 20, now, issueKey: "example/project#516" });
    assert.equal(frame.complete, true, String(frame.reason));
    const agents = frame.issues[0]?.dispatches[0]?.agents ?? [];
    assert.equal(agents.length, 2);
    const child = agents.find(agent => agent.parentAgentId !== null)!;
    // Its last record as of the capture, and its Start (the Stop came after the capture).
    assert.equal(child.observation.observedAt, "2026-09-30T11:21:08.100Z");
    assert.equal(child.liveness.state, "running");
    assert.ok(!JSON.stringify(frame).includes(sessionId));
  } finally {
    for (const dir of [home, receipts, events]) await rm(dir, { recursive: true, force: true });
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
    const options = { home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20, now,
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

it("keeps a scoped post-launch block before any native thread and clears only on receipt replacement", async () => {
  const home = await mkdtemp(join(tmpdir(), "issue-block-home-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-block-root-"));
  const path = join(receipts, "launch-" + "d".repeat(64) + ".json");
  const block = { schemaVersion: 2, issue: { repo: "example/inbox", number: 42 },
    dispatchId: "assignment_" + "e".repeat(64), state: "blocked", reasonCode: "goal-prompt-unconfirmed", observedAt: at };
  const now = "2026-01-01T00:00:01.000Z";
  const options = { home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20, now, issueKey: "example/inbox#42" };
  const expected = { state: "blocked", reason: "goal-prompt-unconfirmed", at,
    dispatchId: block.dispatchId, source: "orchid" };
  try {
    await writeFile(path, JSON.stringify(block), { mode: 0o600 });
    await writeFile(join(receipts, "launch-" + "f".repeat(64) + ".json"),
      JSON.stringify({ ...block, issue: { repo: "example/inbox", number: 43 } }), { mode: 0o600 });
    const frame = await collectIssueAgentTree(options);
    assert.equal(frame.complete, false);
    assert.equal(frame.issues.length, 1);
    assert.deepEqual(frame.issues[0], { repo: { owner: "example", name: "inbox" }, issueNumber: 42,
      complete: false, reason: "binding_unavailable", dispatches: [], launchBlock: expected });
    const output = new Capture();
    assert.equal(await issueAgentFeedCommand(["--json", "--issue", "example/inbox#42", "--home", home],
      { output, now: () => now, env: options.env }), 3);
    assert.deepEqual(JSON.parse(output.lines[0]!).issues[0].launchBlock, expected);
    for (const state of ["launching", "launched"] as const) {
      await writeFile(path, JSON.stringify({ ...block, schemaVersion: 1, state, reasonCode: null }));
      assert.deepEqual((await collectIssueAgentTree(options)).issues, []);
    }
    await writeFile(path, JSON.stringify({ ...block, observedAt: "2026-01-01T00:00:02.000Z" }));
    assert.deepEqual((await collectIssueAgentTree(options)).issues, []);
    await writeFile(path, JSON.stringify({ ...block, reasonCode: "PRIVATE-ERROR-CANARY" }));
    const invalid = await collectIssueAgentTree(options);
    assert.equal(invalid.complete, false);
    assert.deepEqual(invalid.issues, []);
    assert.ok(!JSON.stringify(invalid).includes("PRIVATE-"));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});

it("keeps a block through missing native identity, verified root activity, scan bounds and native failures", async () => {
  const home = await mkdtemp(join(tmpdir(), "issue-block-native-home-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-block-native-root-"));
  const issueId = "fixture-block-42", repo = "example/project", brief = "b".repeat(64);
  const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
  const record = join(receipts, key, "record");
  const blockFile = join(receipts, "launch-" + "d".repeat(64) + ".json");
  const dispatchedAt = "2026-09-27T21:24:00.000Z", blockedAt = "2026-09-27T21:25:00.000Z";
  const now = "2026-09-27T22:00:00.000Z";
  const rootId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d";
  const options = { home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20, now, issueKey: "example/project#42" };
  const block = { schemaVersion: 2, issue: { repo, number: 42 }, dispatchId: "assignment_" + key,
    state: "blocked", reasonCode: "goal-prompt-unconfirmed", observedAt: blockedAt };
  const expected = { state: "blocked", reason: "goal-prompt-unconfirmed", at: blockedAt,
    dispatchId: block.dispatchId, source: "orchid" };
  const dispatch = { schemaVersion: 1, runId: "orchid-" + key, issue: block.issue, parentRunId: null,
    source: "codex", provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf",
    state: "dispatched", observedAt: dispatchedAt, location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } };
  try {
    await mkdir(record, { recursive: true, mode: 0o700 });
    await writeFile(join(record, "dispatch.json"), JSON.stringify(dispatch), { mode: 0o600 });
    await writeFile(blockFile, JSON.stringify(block), { mode: 0o600 });
    const assertPartial = (frame: IssueAgentTreeSnapshot, reason?: string) => {
      assert.equal(frame.complete, false);
      assert.equal(frame.issues.length, 1);
      assert.equal(frame.issues[0]?.complete, false);
      if (reason !== undefined) assert.equal(frame.issues[0]?.reason, reason);
      assert.deepEqual(frame.issues[0]?.dispatches, []);
      assert.deepEqual(frame.issues[0]?.launchBlock, expected);
    };
    assertPartial(await collectIssueAgentTree(options));
    await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo, BriefDigest: brief,
      Route: { transport: "codex", provider: "fixture-router", model: "fixture-model", effort: "high" },
      NativeSessionID: rootId }), { mode: 0o600 });
    const sessions = join(home, ".codex", "sessions", "2026", "09", "27");
    await mkdir(sessions, { recursive: true });
    const rollout = join(sessions, `rollout-2026-09-27T21-24-30-${rootId}.jsonl`);
    const meta = JSON.stringify({ timestamp: "2026-09-27T21:24:30.000Z", type: "session_meta",
      payload: { session_id: rootId, timestamp: "2026-09-27T21:24:30.000Z", cwd: "/PRIVATE-PATH-CANARY" } }) + "\n";
    await writeFile(rollout, meta);
    for (const text of [meta, meta + JSON.stringify({ timestamp: "2026-09-27T21:30:00.000Z", type: "event_msg",
      payload: { type: "agent_message", message: "PRIVATE-PROMPT-CANARY" } }) + "\n"]) {
      await writeFile(rollout, text);
      const full = await collectIssueAgentTree(options);
      assert.equal(full.complete, true, String(full.reason));
      assert.equal(full.issues[0]?.dispatches[0]?.agents.length, 1);
      assert.deepEqual(full.issues[0]?.launchBlock, expected);
      assert.ok(!JSON.stringify(full).includes(rootId));
      assert.ok(!JSON.stringify(full).includes("PRIVATE-"));
    }
    // Past the running cap with no end: the scan bound still keeps the block.
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ ...dispatch, observedAt: "2026-09-19T21:24:00.000Z" }));
    assertPartial(await collectIssueAgentTree(options), "scan_limit");
    await writeFile(join(record, "dispatch.json"), JSON.stringify(dispatch));
    const big = await open(rollout, "w");
    try { await big.writeFile(meta); await big.truncate(9 * 1_048_576); } finally { await big.close(); }
    assertPartial(await collectIssueAgentTree(options), "scan_limit");
    await writeFile(rollout, "{malformed\n");
    assertPartial(await collectIssueAgentTree(options));
    await writeFile(rollout, meta);
    await writeFile(blockFile, JSON.stringify({ ...block, schemaVersion: 1, state: "launched", reasonCode: null }));
    const cleared = await collectIssueAgentTree(options);
    assert.equal(cleared.complete, true);
    assert.equal(cleared.issues[0]?.launchBlock, undefined);
    assert.equal(cleared.issues[0]?.dispatches[0]?.agents.length, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});

it("keeps a dispatched Codex root and its child whose rollouts outgrew the transcript read bound, read by head and tail", async () => {
  const home = await mkdtemp(join(tmpdir(), "issue-feed-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-receipts-"));
  try {
    const rootId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c60";
    const childId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c61";
    const issueId = "fixture-601", repo = "example/project", brief = "b".repeat(64);
    const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
    const record = join(receipts, key, "record");
    await mkdir(record, { recursive: true, mode: 0o700 });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1,
      runId: `orchid-${key}`, issue: { repo, number: 601 }, parentRunId: null, source: "codex",
      provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf",
      state: "dispatched", observedAt: "2026-09-27T21:24:00.000Z",
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo,
      BriefDigest: brief, Route: { transport: "codex", provider: "fixture-router", model: "fixture-model", effort: "high" },
      NativeSessionID: rootId }), { mode: 0o600 });
    const sessions = join(home, ".codex", "sessions", "2026", "09", "27");
    await mkdir(sessions, { recursive: true });
    const stamp = (seconds: number) => new Date(Date.parse("2026-09-27T21:25:00.000Z") + seconds * 1000).toISOString();
    const line = (seconds: number, type: string, payload: Record<string, unknown>) =>
      JSON.stringify({ timestamp: stamp(seconds), type, payload }) + "\n";
    // Generated here, never committed: a head that finished turn one, a middle (past the read bound)
    // that starts turn two, and a tail with only activity and the latest cumulative token count.
    const rollout = (id: string, parentId: string | null) => {
      const head = line(0, "session_meta", { session_id: id, cwd: "/fixture", model_provider: "fixture",
          ...(parentId ? { parent_thread_id: parentId } : {}) }) +
        line(1, "turn_context", { model: "fixture-model", cwd: "/fixture",
          collaboration_mode: { settings: { reasoning_effort: "high" } } }) +
        line(2, "event_msg", { type: "user_message", message: "fixture task" }) +
        line(3, "event_msg", { type: "task_started" }) +
        line(4, "event_msg", { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } } }) +
        line(5, "event_msg", { type: "task_complete" });
      // Turn two starts just past the head window, in the middle the read never reaches.
      const filler = line(6, "event_msg", { type: "agent_message", message: "m".repeat(300_000) }) +
        line(7, "event_msg", { type: "task_started" }) + Array.from({ length: 9_300 }, (_, i) =>
        line(10 + i * 0.2, "event_msg", { type: "agent_message", message: "m".repeat(1_000) })).join("");
      const tail = line(1_950, "event_msg", { type: "token_count",
        info: { total_token_usage: { input_tokens: 5_000, output_tokens: 700 } } }) +
        line(1_960, "event_msg", { type: "agent_message", message: "latest" });
      return head + filler + tail;
    };
    for (const [minute, id, parent] of [["25", rootId, null], ["26", childId, rootId]] as const) {
      const text = rollout(id, parent);
      assert.ok(Buffer.byteLength(text) > 9 * 1_048_576);
      await writeFile(join(sessions, `rollout-2026-09-27T23-${minute}-00-${id}.jsonl`), text);
    }
    const frame = await collectIssueAgentTree({ home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20,
      now: "2026-09-27T22:00:00.000Z" });
    const issue = frame.issues.find(row => row.issueNumber === 601)!;
    assert.deepEqual([issue.complete, issue.reason], [true, null]);
    const agents = issue.dispatches[0]!.agents;
    assert.equal(agents.length, 2, "the root and its child are present, never silently absent");
    for (const agent of agents) {
      // The latest cumulative count comes from the tail; the unread history between is served as incomplete.
      assert.equal(agent.tokenUsage?.usedTokens, 5_700);
      assert.deepEqual(agent.observation.cost.runTokens.measurement, { inputTokens: 5_000, outputTokens: 700 });
      assert.deepEqual(agent.resourceHistory?.tokens, { points: [], truncated: false, source: "unavailable",
        reason: "source_incomplete" });
      // Turn one completed in the head, but turn two started in the unread middle: no outcome is claimed.
      assert.equal(agent.terminalOutcome.value, null);
    }
    assert.ok(!JSON.stringify(frame).includes(rootId));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});
