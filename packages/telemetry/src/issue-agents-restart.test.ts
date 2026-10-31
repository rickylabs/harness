/** Native-source regressions: no transcript, process ancestry or history scan can supply these facts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import { MAX_AGENT_OBSERVATIONS, readIssueAgentTreeSnapshot, type DispatchEvidence } from "@rickylabs/harness-contracts";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "./operator-environment.js";

const dispatched = "2026-10-05T12:00:00.000Z", now = "2026-10-05T13:01:00.000Z";
const repo = "example/project", brief = "a".repeat(64);
/** Test-only control: run real producer frames through the tagged older decoder. */
async function compatibilityRead(snapshot: unknown) {
  const control = process.env.HARNESS_ISSUE_TREE_READER_CONTROL;
  const reader = control === undefined ? readIssueAgentTreeSnapshot :
    (await import(pathToFileURL(control).href) as { readIssueAgentTreeSnapshot: typeof readIssueAgentTreeSnapshot }).readIssueAgentTreeSnapshot;
  return reader(snapshot);
}
async function fixture(run: (f: {
  receipt(number: number, id: string): Promise<string>;
  facets(state?: "refused" | "blocked"): Promise<void>;
  legacy(): ReturnType<typeof collectIssueAgentTree>;
  failedNative(): ReturnType<typeof collectIssueAgentTree>;
  collect(issueKey?: string, partialTrees?: boolean): ReturnType<typeof collectIssueAgentTree>;
  status(state: string): void;
  mismatch(): void;
  duplicate(): void;
  disappear(): void;
  clutter(): void;
  staleStop(): Promise<void>;
  restore(): void;
  complete(): void;
  metadata(read: (receipt: DispatchEvidence, binding: { readonly paneId: string }) => Promise<void>): void;
  readonly requests: string[][];
  readonly nativeId: string;
}) => Promise<void>, source: "codex" | "claude" | "agy" | "opencode" = "codex") {
  const home = await mkdtemp(join(tmpdir(), "nr-"));
  const receipts = join(home, "receipts"), socket = join(home, "run.sock");
  const id = source === "opencode" ? "ses_" + randomUUID() : randomUUID(); let seatId = id, status = "working", duplicated = false; let key = "", workspace = "original-workspace", pane = "original-pane", phase = "active";
  let disappeared = false;
  let clutter: { workspace_id: string; label: string }[] = [];
  const knownRuns: { key: string; label: string }[] = [];
  const requests: string[][] = [];
  let metadata: ((receipt: DispatchEvidence, binding: { readonly paneId: string }) => Promise<void>) | undefined;
  const server = createServer(conn => {
    conn.setEncoding("utf8"); let bytes = "";
    conn.on("data", chunk => {
      bytes += chunk;
      if (!bytes.includes("\n")) return;
      const rpc = JSON.parse(bytes);
      requests.push(rpc.params.keys.map((q: { key: string }) => q.key));
      conn.end(JSON.stringify({ id: rpc.id, result: { type: "run_lookup", schemaVersion: 1,
        generation: "fixture-generation", revision: 1, complete: true,
        missing: rpc.params.keys.filter((q: { key: string }) => q.key !== "701").map((q: { key: string }) => ({ key: q.key, reason: "run_not_found" })),
        records: rpc.params.keys.some((q: { key: string }) => q.key === "701") ? [{
          key: "701", issue: { repo, number: 776 }, dispatchKey: key, nativeSessionId: id,
          agent: source, label: `${source}-701`, phase, observedAt: now,
        }] : [] } }) + "\n");
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
        parentRunId: null, source, provider: "fixture", model: "fixture-model", effort: "high", host,
        state: "dispatched", observedAt: dispatched, location: { paneId: "original-pane", workspaceId: "original-workspace" } });
      await write("binding.json", { IssueID: issueId, Repo: repo, BriefDigest: brief, Host: host,
        ...(source === "agy" ? { NativeStore: { source: "agy", directory: join(home, ".divybot-native", dispatchKey, "agy") } } : {}),
        Route: { transport: source, provider: "fixture", model: "fixture-model", effort: "high" }, NativeSessionID: nativeId });
      return dispatchKey;
    };
    key = await receipt(776, id);
    const staleStop = async () => {
      const operationId = randomUUID(), requestDigest = "d".repeat(64), runId = "orchid-" + key;
      const dir = join(receipts, "actions", operationId);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const write = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
      await write(join(receipts, key, "record", "stop-action.json"), { schemaVersion: 1, operationId, requestDigest });
      await write(join(dir, "intent.json"), { requestDigest });
      const opaque = (kind: string) => kind + "_" + createHash("sha256").update(kind + "\0" + runId).digest("hex");
      await write(join(dir, "result.json"), { schemaVersion: 1, operationId, requestDigest, action: "stop", outcome: "accepted",
        reason: "workspace_close_delivered", repository: repo, issueNumber: 776, agentId: opaque("agent"), dispatchId: opaque("assignment"),
        nativeRunId: runId, host: "fixture-node", paneId: "original-pane", workspaceId: "original-workspace", observedAt: dispatched });
      for (const [file, kind] of [["seat-observed.json", "seat_absent"], ["process-observed.json", "process_absent"]]) {
        await write(join(dir, file!), { schemaVersion: 1, operationId, requestDigest, kind, observedAt: dispatched });
      }
    };
    const facets = async (state: "refused" | "blocked" = "refused") => {
      const sessions = join(home, ".codex", "sessions", "2026", "10", "05");
      await mkdir(sessions, { recursive: true });
      const child = randomUUID();
      for (const [native, parent] of [[id, null], [child, id]]) {
        const events = [
          { timestamp: dispatched, type: "session_meta", payload: { session_id: native, timestamp: dispatched,
            cwd: "/fixture", model_provider: "fixture", ...(parent ? { parent_thread_id: parent } : {}) } },
          { timestamp: now, type: "event_msg", payload: { type: "task_started" } },
          { timestamp: now, type: "event_msg", payload: { type: "token_count", info: {
            total_token_usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 0, total_tokens: 7 } } } },
          ...(!parent ? [{ timestamp: now, type: "event_msg", payload: { type: "task_complete" } }] : []),
        ];
        await writeFile(join(sessions, `rollout-2026-10-05T12-00-00-${native}.jsonl`), events.map(row => JSON.stringify(row)).join("\n") + "\n");
      }
      await staleStop();
      await writeFile(join(receipts, "launch-" + "f".repeat(64) + ".json"), JSON.stringify({ schemaVersion: state === "refused" ? 1 : 2,
        state, reasonCode: state === "refused" ? "routing-invalid" : "goal-prompt-unconfirmed", observedAt: now, issue: { repo, number: 776 },
        dispatchId: "assignment_" + "a".repeat(64) }), { mode: 0o600 });
    };
    const legacy = () => collectIssueAgentTree({ home, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: receipts } });
    const failedNative = () => collectIssueAgentTree({ home, limit: 20, now,
      env: { [OPERATOR_ENV.dispatchRoot]: receipts, HARNESS_TELEMETRY_ORCHID_RUN_SOCKET: join(home, "unavailable.sock") },
      nativeSnapshot: { workspaces: [], agents: [] } });
    await run({ receipt, staleStop, facets, legacy, failedNative, requests, nativeId: id, metadata(read) { metadata = read; }, restore() { workspace = "restored-workspace"; pane = "restored-pane"; },
      complete() { phase = "completed"; }, status(value) { status = value; },
      mismatch() { seatId = randomUUID(); }, duplicate() { duplicated = true; }, disappear() { disappeared = true; },
      clutter() { clutter = Array.from({ length: MAX_AGENT_OBSERVATIONS + 40 }, (_, n) => ({ workspace_id: `old-workspace-${n}`, label: `${source}-${1000 + n}` })); }, collect(issueKey, partialTrees = true) {
        // A variable remains assignable to the original collector, which must fail these controls.
        const agent = { workspace_id: workspace, pane_id: pane, terminal_id: "fixture-terminal", agent: source,
          agent_status: status, revision: 3, state_change_seq: 4,
          agent_session: { source: source === "agy" ? "herdr:antigravity_cli" : `herdr:${source}`, agent: source, kind: "id", value: seatId } };
        const options = { home, limit: 20, now, partialTrees, ...(issueKey ? { issueKey } : {}),
          knownRuns: [...knownRuns], onBinding: async (receipt: DispatchEvidence, binding: { readonly paneId: string }) => {
            if (!knownRuns.length) knownRuns.push({ key: "701", label: `${source}-701` });
            await metadata?.(receipt, binding);
          },
          env: { [OPERATOR_ENV.dispatchRoot]: receipts, [OPERATOR_ENV.placementHost]: "fixture-node", HARNESS_TELEMETRY_ORCHID_RUN_SOCKET: socket },
          nativeSnapshot: { workspaces: disappeared ? [] : [...clutter, { workspace_id: workspace, label: `${source}-701` }],
            agents: disappeared ? [] : duplicated ? [agent, { ...agent, pane_id: "duplicate-pane", terminal_id: "duplicate-terminal" }] : [agent] } };
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

it("private attachment metadata sees only a certified receipt, and its failure cannot change execution", () => fixture(async f => {
  const observed: string[] = [];
  f.restore();
  f.metadata(async (receipt, binding) => {
    assert.equal(receipt.location?.paneId, "original-pane", "the receipt is unchanged, for independent scope validation");
    assert.equal(binding.paneId, "restored-pane");
    observed.push(receipt.runId);
    throw Error("PRIVATE-ATTACHMENT-CANARY");
  });
  const result = await f.collect();
  assert.equal(observed.length, 1);
  assert.equal(result.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
  f.mismatch(); await f.collect();
  assert.equal(observed.length, 1, "unverified receipts never reach the metadata reader");
}));

it("a remembered native coordinate resolves final assignment end after its workspace disappears", () => fixture(async f => {
  const before = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
  assert.equal(before?.liveness.state, "running");
  f.disappear(); f.complete();
  const after = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
  assert.equal(after?.observation.assignment.id, before?.observation.assignment.id);
  assert.equal(after?.liveness.state, "ended");
  assert.equal(after?.terminalOutcome.value, null, "a final fence does not invent success");
  assert.equal(after?.endedAt, null, "read time is not the exact native end time");
}));
it("a remembered active run without a native seat is unknown, never running or ended", () => fixture(async f => {
  assert.equal((await f.collect()).issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  f.disappear();
  const after = await f.collect();
  assert.equal(after.complete, false);
  assert.equal(after.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "unknown");
}));

for (const source of ["codex", "claude", "agy", "opencode"] as const) {
  it(`${source}: native identity and execution need no vendor transcript or native history store`, () => fixture(async f => {
    f.restore();
    const root = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
    assert.equal(root?.harness.value, source);
    assert.equal(root?.liveness.state, "running");
    f.disappear(); f.complete();
    assert.equal((await f.collect()).issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "ended");
  }, source));
}
it("reported native work wins capacity over unoccupied restored workspace labels", () => fixture(async f => {
  f.clutter();
  const result = await f.collect();
  assert.equal(result.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  assert.equal(result.reason, "scan_limit");
  assert.equal(f.requests[0]?.[0], "701");
  assert(f.requests.every(keys => keys.length <= 128));
  assert.equal(f.requests.flat().length, MAX_AGENT_OBSERVATIONS);
}));

it("a paired historical stop cannot end a resumed native working assignment", () => fixture(async f => {
  await f.staleStop(); f.restore();
  let certified = false;
  f.metadata(async receipt => { assert.equal(receipt.stop?.seatObservedAt, dispatched); assert.equal(receipt.stop?.processObservedAt, dispatched); certified = true; });
  const root = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
  assert(certified, "the stale paired stop was actually read and validated");
  assert.equal(root?.liveness.state, "running");
  assert.equal(root?.observation.running.value, true);
  assert.equal(root?.terminalOutcome.value, null);
}));

it("an unbounded native snapshot is complete and the default needs no partial-tree capability", () => fixture(async f => {
  const snapshot = await f.collect(undefined, false);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.reason, null);
  assert.equal(snapshot.issues[0]?.complete, true);
  assert.equal(snapshot.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  assert((await compatibilityRead(snapshot)).ok);
}));
it("real native overflow is scan_limit and default readers get no bounded forest", () => fixture(async f => {
  f.clutter();
  const snapshot = await f.collect(undefined, false);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.reason, "scan_limit");
  assert.equal(snapshot.issues[0]?.reason, "scan_limit");
  assert.deepEqual(snapshot.issues[0]?.dispatches, []);
  assert((await compatibilityRead(snapshot)).ok);
  const opted = await f.collect(undefined, true);
  assert.equal(opted.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  assert(readIssueAgentTreeSnapshot(opted).ok);
  if (process.env.HARNESS_ISSUE_TREE_READER_CONTROL !== undefined) assert.equal((await compatibilityRead(opted)).ok, false);
}));
it("native execution retains admission, actions, capacity, token costs and native children", () => fixture(async f => {
  await f.facets(); f.restore();
  const snapshot = await f.collect(undefined, false);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.issues[0]?.launchRefusal?.reason, "routing-invalid");
  const agents = snapshot.issues[0]?.dispatches[0]?.agents ?? [];
  assert.equal(agents.length, 2);
  const root = agents.find(agent => agent.parentAgentId === null)!;
  const child = agents.find(agent => agent.parentAgentId !== null)!;
  assert.equal(root.liveness.state, "running", "an earlier native turn completion cannot end resumed work");
  assert.equal(root.terminalOutcome.value, null);
  assert.equal(root.endedAt, null);
  assert.equal(root.observation.cost.runTokens.availability, "available");
  assert.equal(root.tokenUsage?.usedTokens, 7);
  assert.notEqual(root.observation.cost.localCapacity.reason, "source_not_bound");
  assert(root.timeline?.events.some(event => event.kind === "action-accepted" && event.action === "stop"));
  assert.equal(child.parentAgentId, root.observation.agentId);
  assert.equal(child.observation.cost.runTokens.availability, "available");
  assert((await compatibilityRead(snapshot)).ok);
}));

it("an absent optional socket preserves previous feed data; a configured failed socket stays unavailable", () => fixture(async f => {
  await f.facets();
  const legacy = await f.legacy();
  assert.equal(legacy.complete, true);
  assert.equal(legacy.issues[0]?.launchRefusal?.reason, "routing-invalid");
  assert.equal(legacy.issues[0]?.dispatches[0]?.agents.length, 2);
  const failed = await f.failedNative();
  assert.equal(failed.reason, "source_unavailable");
  assert.deepEqual(failed.issues[0]?.dispatches, [], "no execution falls back to historical state");
  assert.equal(failed.issues[0]?.launchRefusal?.reason, "routing-invalid", "independent admission stays available");
}));
it("native launch blocks coexist with an already running assignment", () => fixture(async f => {
  await f.facets("blocked");
  const snapshot = await f.collect();
  assert.equal(snapshot.issues[0]?.launchBlock?.reason, "goal-prompt-unconfirmed");
  assert.equal(snapshot.issues[0]?.dispatches[0]?.agents.find(a => a.parentAgentId === null)?.liveness.state, "running");
  assert(readIssueAgentTreeSnapshot(snapshot).ok);
}));
