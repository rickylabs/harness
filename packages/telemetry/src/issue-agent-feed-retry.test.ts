import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "./operator-environment.js";
import { readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";

it("keeps a verified running retry visible without certifying an earlier unresolved attempt", async () => {
  const home = await mkdtemp(join(tmpdir(), "issue-retry-home-"));
  const receipts = await mkdtemp(join(tmpdir(), "issue-retry-receipts-"));
  const repo = "example/project", brief = "b".repeat(64);
  const rootId = "01997e0c-2f4a-7c31-9d61-6b0a1f2b3c4d";
  const at = "2026-09-27T21:25:00.000Z", now = "2026-09-27T21:25:10.000Z";
  const options = { home, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, limit: 20, now };
  const attempt = async (issueId: string, bound: boolean) => {
    const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
    const record = join(receipts, key, "record");
    await mkdir(record, { recursive: true, mode: 0o700 });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1,
      runId: `orchid-${key}`, issue: { repo, number: 42 }, parentRunId: null, source: "codex",
      provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf",
      state: bound ? "dispatched" : "uncertain", observedAt: at,
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    if (bound) await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo,
      BriefDigest: brief, Route: { transport: "codex", provider: "fixture-router", model: "fixture-model", effort: "high" },
      NativeSessionID: rootId }), { mode: 0o600 });
    return join(receipts, key);
  };
  try {
    await mkdir(join(receipts, "actions"), { mode: 0o700 });
    await attempt("fixture-uncertain", false);
    await attempt("fixture-started", true);
    const sessions = join(home, ".codex", "sessions", "2026", "09", "27");
    await mkdir(sessions, { recursive: true });
    const rollout = join(sessions, `rollout-2026-09-27T21-25-00-${rootId}.jsonl`);
    await writeFile(rollout, [
      { timestamp: at, type: "session_meta", payload: { session_id: rootId, timestamp: at,
        cwd: "/fixture", model_provider: "fixture" } },
      { timestamp: at, type: "event_msg", payload: { type: "task_started" } },
    ].map(row => JSON.stringify(row)).join("\n") + "\n");
    const conservative = await collectIssueAgentTree(options);
    assert.equal(conservative.complete, false);
    assert.equal(conservative.issues[0]?.dispatches.length, 0);
    const partial = await collectIssueAgentTree({ ...options, partialTrees: true });
    assert.ok(readIssueAgentTreeSnapshot(partial).ok);
    assert.equal(partial.complete, false);
    assert.equal(partial.issues[0]?.complete, false);
    assert.equal(partial.issues[0]?.reason, "scan_limit");
    const groups = partial.issues[0]?.dispatches ?? [];
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.agents.length, 1);
    assert.equal(groups[0]?.agents[0]?.liveness.state, "running");
    assert.equal(groups[0]?.agents[0]?.observation.parentAgentId.state, "confirmed-root");
    assert.ok(!JSON.stringify(partial).includes(rootId));
    const duplicate = await attempt("fixture-duplicate", true);
    assert.equal((await collectIssueAgentTree({ ...options, partialTrees: true })).issues[0]?.dispatches.length, 0);
    await rm(duplicate, { recursive: true, force: true });
    await rm(rollout);
    assert.equal((await collectIssueAgentTree({ ...options, partialTrees: true })).issues[0]?.dispatches.length, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(receipts, { recursive: true, force: true });
  }
});
