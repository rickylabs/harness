import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectIssueAgentTree, issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "./operator-environment.js";
import type { IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { at, Capture } from "./fixtures/issue-agent-feed-cli.js";

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
