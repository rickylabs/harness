/** Native-source regressions: no transcript, process ancestry or history scan can supply these facts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { MAX_AGENT_OBSERVATIONS } from "@rickylabs/harness-contracts";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "./operator-environment.js";

const dispatched = "2026-10-05T12:00:00.000Z", now = "2026-10-05T13:01:00.000Z";
const repo = "example/project", brief = "a".repeat(64);
async function fixture(run: (f: {
  receipt(number: number, id: string): Promise<string>;
  collect(issueKey?: string): ReturnType<typeof collectIssueAgentTree>;
  status(state: string): void;
  mismatch(): void;
  duplicate(): void;
  restore(): void;
  complete(): void;
  readonly requests: string[][];
  readonly nativeId: string;
}) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "nr-"));
  const receipts = join(home, "receipts"), socket = join(home, "run.sock");
  const id = randomUUID(); let seatId = id, status = "working", duplicated = false; let key = "", workspace = "original-workspace", pane = "original-pane", phase = "active";
  const requests: string[][] = [];
  const server = createServer(conn => {
    conn.setEncoding("utf8"); let bytes = "";
    conn.on("data", chunk => {
      bytes += chunk;
      if (!bytes.includes("\n")) return;
      const rpc = JSON.parse(bytes);
      requests.push(rpc.params.keys.map((q: { key: string }) => q.key));
      conn.end(JSON.stringify({ id: rpc.id, result: { type: "run_lookup", schemaVersion: 1,
        generation: "fixture-generation", revision: 1, complete: true, missing: [], records: [{
          key: "701", issue: { repo, number: 776 }, dispatchKey: key, nativeSessionId: id,
          agent: "codex", label: "codex-701", phase, observedAt: now,
        }] } }) + "\n");
    });
  });
  try {
    await mkdir(receipts, { mode: 0o700 });
    await new Promise<void>(resolve => server.listen(socket, resolve));
    const receipt = async (number: number, nativeId: string) => {
      const issueId = `fixture-${number}`;
      const dispatchKey = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
      const record = join(receipts, dispatchKey, "record"), host = "fixture-node";
      await mkdir(record, { recursive: true, mode: 0o700 });
      const write = (name: string, value: unknown) => writeFile(join(record, name), JSON.stringify(value), { mode: 0o600 });
      await write("dispatch.json", { schemaVersion: 1, runId: `orchid-${dispatchKey}`, issue: { repo, number },
        parentRunId: null, source: "codex", provider: "fixture", model: "fixture-model", effort: "high", host,
        state: "dispatched", observedAt: dispatched, location: { paneId: "original-pane", workspaceId: "original-workspace" } });
      await write("binding.json", { IssueID: issueId, Repo: repo, BriefDigest: brief, Host: host,
        Route: { transport: "codex", provider: "fixture", model: "fixture-model", effort: "high" }, NativeSessionID: nativeId });
      return dispatchKey;
    };
    key = await receipt(776, id);
    await run({ receipt, requests, nativeId: id, restore() { workspace = "restored-workspace"; pane = "restored-pane"; },
      complete() { phase = "completed"; }, status(value) { status = value; },
      mismatch() { seatId = randomUUID(); }, duplicate() { duplicated = true; }, collect(issueKey) {
        // A variable remains assignable to the original collector, which must fail these controls.
        const agent = { workspace_id: workspace, pane_id: pane, terminal_id: "fixture-terminal", agent: "codex",
          agent_status: status, revision: 3, state_change_seq: 4,
          agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: seatId } };
        const options = { home, limit: 20, now, partialTrees: true, ...(issueKey ? { issueKey } : {}),
          env: { [OPERATOR_ENV.dispatchRoot]: receipts, HARNESS_TELEMETRY_ORCHID_RUN_SOCKET: socket },
          nativeSnapshot: { workspaces: [{ workspace_id: workspace, label: "codex-701" }],
            agents: duplicated ? [agent, { ...agent, pane_id: "duplicate-pane", terminal_id: "duplicate-terminal" }] : [agent] } };
        return collectIssueAgentTree(options);
      } });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(home, { recursive: true, force: true }); }
}

it("links a restored workspace to the same native receipt and issue, then observes native assignment completion", () => fixture(async f => {
  const before = await f.collect();
  const original = before.issues[0]?.dispatches[0]?.agents[0];
  assert.equal(original?.liveness.state, "running");
  f.restore();
  const restored = await f.collect();
  const root = restored.issues[0]?.dispatches[0]?.agents[0];
  assert.equal(restored.issues[0]?.issueNumber, 776);
  assert.equal(root?.observation.assignment.id, original?.observation.assignment.id);
  assert.equal(root?.observation.parentAgentId.state, "confirmed-root");
  assert.equal(root?.liveness.state, "running");
  assert.equal(root?.endedAt, null);
  f.complete();
  const ended = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
  assert.equal(ended?.observation.assignment.id, root?.observation.assignment.id);
  assert.equal(ended?.liveness.state, "ended");
  assert.ok(!JSON.stringify(restored).includes(f.nativeId), "native identity stays private");
}));

it("selects the oldest active receipt by its native key even when retained history exceeds the observation limit", () => fixture(async f => {
  for (let n = 1; n <= MAX_AGENT_OBSERVATIONS + 2; n++) await f.receipt(n, randomUUID());
  f.restore();
  const snapshot = await f.collect();
  assert.equal(snapshot.issues.length, 1, "only current native workspaces select receipts");
  assert.equal(snapshot.issues[0]?.issueNumber, 776);
  assert.equal(snapshot.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  assert.deepEqual(f.requests, [["701"]], "history never competes for a current run lookup");
}));

it("native idle, done and blocked are stopped turns, never final assignment outcomes", () => fixture(async f => {
  for (const state of ["idle", "done", "blocked"]) {
    f.status(state);
    const root = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
    assert.equal(root?.liveness.state, "idle");
    assert.equal(root?.terminalOutcome.value, null);
    assert.equal(root?.endedAt, null);
  }
  f.status("unknown");
  assert.equal((await f.collect()).issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "unknown");
}));
it("a restored label cannot bind a different native session", () => fixture(async f => {
  f.restore(); f.mismatch();
  const result = await f.collect();
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, []);
}));
it("duplicate native seats stay unresolved instead of selecting one", () => fixture(async f => {
  f.duplicate();
  const result = await f.collect();
  assert.equal(result.complete, false);
  assert.deepEqual(result.issues, []);
}));
it("native source scoping selects the canonical issue without consulting other receipts", () => fixture(async f => {
  assert.equal((await f.collect("example/project#776")).issues[0]?.issueNumber, 776);
  assert.deepEqual((await f.collect("example/project#777")).issues, []);
}));
