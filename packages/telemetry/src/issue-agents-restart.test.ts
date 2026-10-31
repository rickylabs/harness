/** Synthetic receipts and native events model a restored session, without process ancestry. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { MAX_AGENT_OBSERVATIONS } from "@rickylabs/harness-contracts";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "./operator-environment.js";

const dispatched = "2026-10-05T12:00:00.000Z";
const resumed = "2026-10-05T13:00:00.000Z";
const now = "2026-10-05T13:01:00.000Z";
const repo = "example/project", brief = "a".repeat(64);
const event = (at: string, type: string, payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: at, type, payload }) + "\n";
const native = (at: string, type: string) => event(at, "event_msg", { type });
const output = (bytes: number) => event(resumed, "response_item",
  { type: "function_call_output", call_id: "fixture-call", output: "x".repeat(bytes) });

async function fixture(fn: (f: {
  home: string; receipts: string;
  receipt: (number: number, options?: { id?: string; at?: string; suffix?: string; ended?: boolean }) => Promise<void>;
  rollout: (id: string, text: string) => Promise<string>;
  collect: (partialTrees?: boolean) => ReturnType<typeof collectIssueAgentTree>;
}) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "issue-restart-"));
  const receipts = join(home, "receipts");
  try {
    await mkdir(receipts, { mode: 0o700 });
    await fn({ home, receipts,
      receipt: async (number, options = {}) => {
        const issueId = `fixture-${number}-${options.suffix ?? "root"}`;
        const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
        const record = join(receipts, key, "record"), runId = `orchid-${key}`, host = "fixture-node";
        await mkdir(record, { recursive: true, mode: 0o700 });
        const write = (name: string, value: unknown) => writeFile(join(record, name), JSON.stringify(value), { mode: 0o600 });
        await write("dispatch.json", { schemaVersion: 1, runId, issue: { repo, number }, parentRunId: null,
          source: "codex", provider: "fixture", model: "fixture-model", effort: "high", host,
          state: "dispatched", observedAt: options.at ?? dispatched,
          location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } });
        await write("binding.json", { IssueID: issueId, Repo: repo, BriefDigest: brief, Host: host,
          Route: { transport: "codex", provider: "fixture", model: "fixture-model", effort: "high" },
          NativeSessionID: options.id ?? randomUUID() });
        if (options.ended) {
          await write("teardown-intent.json", { schemaVersion: 1, issue: number, dispatchKey: key, nativeRunId: runId,
            nativeSessionId: options.id, host, paneId: "fixture-pane", workspaceId: "fixture-workspace",
            cause: "teardown", startedAt: resumed });
          await write("teardown-anchor.json", { schemaVersion: 1, operationId: "", requestDigest: "", groupId: 301,
            rootPid: 301, members: [{ pid: 301, start: 9 }] });
          for (const [kind, file] of [["seat_absent", "teardown-seat-observed.json"],
            ["process_absent", "teardown-process-observed.json"]]) {
            await write(file!, { schemaVersion: 1, nativeRunId: runId, kind, observedAt: resumed });
          }
        }
      },
      rollout: async (id, text) => {
        const day = join(home, ".codex", "sessions", "2026", "10", "05");
        await mkdir(day, { recursive: true });
        const path = join(day, `rollout-2026-10-05T12-00-00-${id}.jsonl`);
        await writeFile(path, event(dispatched, "session_meta", { id, cwd: "/fixture", model_provider: "fixture" }) + text);
        return path;
      },
      collect: (partialTrees = true) => collectIssueAgentTree({ home, env: { [OPERATOR_ENV.dispatchRoot]: receipts },
        limit: 20, now, partialTrees }),
    });
  } finally { await rm(home, { recursive: true, force: true }); }
}

it("resolves a resumed session to its original receipt and recovers running beyond the fixed tail", () => fixture(async f => {
  const id = randomUUID();
  await f.receipt(776, { id });
  const path = await f.rollout(id, native(dispatched, "task_complete") + output(300_000));
  // The host restarts: the native session appends to the same file; the receipt never changes.
  await appendFile(path, native(resumed, "task_started") + output(9_000_000) + native(now, "agent_message"));
  const before = await f.collect();
  const root = before.issues[0]?.dispatches[0]?.agents[0];
  assert.equal(before.issues[0]?.issueNumber, 776);
  assert.equal(root?.observation.parentAgentId.state, "confirmed-root");
  assert.equal(root?.liveness.state, "running");
  assert.equal(root?.endedAt, null, "the old completion in the head cannot end a resumed turn");
  const assignment = root?.observation.assignment.id;
  await f.receipt(776, { suffix: "missing-old-attempt" });
  const partial = await f.collect();
  assert.equal(partial.issues[0]?.reason, "scan_limit");
  assert.equal(partial.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  assert.equal((await f.collect(false)).issues[0]?.reason, "ancestry_unavailable");
  await appendFile(path, native(now, "task_complete"));
  const ended = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
  assert.equal(ended?.observation.assignment.id, assignment);
  assert.equal(ended?.liveness.state, "ended");
  assert.ok(!JSON.stringify(partial).includes(id), "native identity stays private");
}));

it("keeps the oldest active issue when the receipt set exceeds the issue observation limit", () => fixture(async f => {
  const id = randomUUID();
  await f.receipt(1, { id });
  await f.rollout(id, native(now, "task_started"));
  for (let n = 2; n <= MAX_AGENT_OBSERVATIONS + 2; n++) {
    await f.receipt(n, { id: randomUUID(), at: "2026-10-05T12:30:00.000Z", ended: true });
  }
  const frame = await f.collect();
  assert.equal(frame.complete, false);
  assert.equal(frame.reason, "scan_limit");
  assert.ok(frame.issues.length <= MAX_AGENT_OBSERVATIONS);
  const active = frame.issues.find(issue => issue.issueNumber === 1);
  assert.equal(active?.dispatches[0]?.agents[0]?.liveness.state, "running");
}));

it("keeps a verified resumed root when a historical retry no longer fits the remaining frame bytes", () => fixture(async f => {
  const historical = randomUUID(), active = randomUUID();
  await f.receipt(776, { id: historical, suffix: "history" });
  await f.rollout(historical, output(9_000_000) + native(dispatched, "task_complete"));
  await f.receipt(776, { id: active });
  await f.rollout(active, native(dispatched, "task_complete") + output(300_000) +
    native(resumed, "task_started") + output(31_000_000) + native(now, "agent_message"));
  const frame = await f.collect();
  assert.equal(frame.issues[0]?.complete, false);
  assert.equal(frame.issues[0]?.reason, "scan_limit");
  const roots = frame.issues[0]?.dispatches.flatMap(dispatch => dispatch.agents) ?? [];
  assert.equal(roots.length, 1, "an unread historical retry cannot erase a verified current root");
  assert.equal(roots[0]?.liveness.state, "running");
}));
