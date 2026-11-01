/** Native-source regressions: no transcript, process ancestry or history scan can supply these facts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it } from "node:test";
import { MAX_AGENT_OBSERVATIONS, readIssueAgentTreeSnapshot, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
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
  failedHerdr(): Promise<{ snapshot: IssueAgentTreeSnapshot; exit: number | null }>;
  hiddenRun(): Promise<void>;
  sharedReceipt(): void;
  collect(issueKey?: string, partialTrees?: boolean): ReturnType<typeof collectIssueAgentTree>;
  status(state: string): void;
  mismatch(): void;
  duplicate(): void;
  disappear(): void;
  clutter(): void;
  staleStop(): Promise<void>;
  restore(): void;
  complete(): void;
  readonly requests: string[][];
  readonly nativeId: string;
}) => Promise<void>, source: "codex" | "claude" | "agy" | "opencode" = "codex", recordedAgent: string = source) {
  const home = await mkdtemp(join(tmpdir(), "nr-"));
  const receipts = join(home, "receipts"), socket = join(home, "run.sock");
  const id = source === "opencode" ? "ses_" + randomUUID() : randomUUID(); let seatId = id, status = "working", duplicated = false; let key = "", workspace = "original-workspace", pane = "original-pane", phase = "active";
  let disappeared = false;
  let clutter: { workspace_id: string; label: string }[] = [];
  let hiddenKey = "", hiddenId = "", shared = false;
  const requests: string[][] = [];
  const server = createServer(conn => {
    conn.setEncoding("utf8"); let bytes = "";
    conn.on("data", chunk => {
      bytes += chunk;
      if (!bytes.includes("\n")) return;
      const rpc = JSON.parse(bytes);
      requests.push(rpc.params.keys.map((q: { key: string }) => q.key));
      // Orchid still owns these active records when Herdr has lost their workspaces.
      const records = [{ key: "701", issue: { repo, number: 776 }, dispatchKey: key, nativeSessionId: id,
        agent: recordedAgent, label: `${recordedAgent}-701`, phase, observedAt: now },
        ...(hiddenKey ? [{ key: "702", issue: { repo, number: 776 }, dispatchKey: hiddenKey, nativeSessionId: hiddenId,
          agent: recordedAgent, label: `${recordedAgent}-702`, phase: "active", observedAt: now }] : [])];
      conn.end(JSON.stringify({ id: rpc.id, result: { type: "run_lookup", schemaVersion: 1,
        generation: "fixture-generation", revision: 1, complete: true,
        missing: rpc.params.keys.filter((q: { key: string }) => !records.some(r => r.key === q.key)).map((q: { key: string }) => ({ key: q.key, reason: "run_not_found" })),
        records: records.filter(r => rpc.params.keys.some((q: { key: string }) => q.key === r.key)) } }) + "\n");
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
    const failedHerdr = async () => {
      const bin = join(home, "bin");
      await mkdir(bin, { mode: 0o700 });
      await writeFile(join(bin, "herdr"), "#!/bin/sh\necho PRIVATE-HERDR-FAILURE >&2\nexit 1\n", { mode: 0o700 });
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)),
        "issue-agents", "--json", "--home", home], { encoding: "utf8", env: {
        PATH: bin + delimiter + process.env.PATH, HOME: home, [OPERATOR_ENV.dispatchRoot]: receipts,
        HARNESS_TELEMETRY_ORCHID_RUN_SOCKET: socket } });
      assert.ok(!result.stdout.includes("PRIVATE-HERDR-FAILURE"));
      return { snapshot: JSON.parse(result.stdout) as IssueAgentTreeSnapshot, exit: result.status };
    };
    await run({ receipt, staleStop, facets, legacy, failedNative, failedHerdr, requests, nativeId: id,
      async hiddenRun() { hiddenId = randomUUID(); hiddenKey = await receipt(777, hiddenId); },
      // A second labelled Orchid run that claims the same receipt as 701.
      sharedReceipt() { hiddenId = randomUUID(); hiddenKey = key; shared = true; },
      restore() { workspace = "restored-workspace"; pane = "restored-pane"; },
      complete() { phase = "completed"; }, status(value) { status = value; },
      mismatch() { seatId = randomUUID(); }, duplicate() { duplicated = true; }, disappear() { disappeared = true; },
      clutter() { clutter = Array.from({ length: MAX_AGENT_OBSERVATIONS + 40 }, (_, n) => ({ workspace_id: `old-workspace-${n}`, label: `${source}-${1000 + n}` })); }, collect(issueKey, partialTrees = true) {
        // A variable remains assignable to the original collector, which must fail these controls.
        const agent = { workspace_id: workspace, pane_id: pane, terminal_id: "fixture-terminal", agent: source,
          agent_status: status, revision: 3, state_change_seq: 4,
          agent_session: { source: source === "agy" ? "herdr:antigravity_cli" : `herdr:${source}`, agent: source, kind: "id", value: seatId } };
        const options = { home, limit: 20, now, partialTrees, ...(issueKey ? { issueKey } : {}),
          env: { [OPERATOR_ENV.dispatchRoot]: receipts, [OPERATOR_ENV.placementHost]: "fixture-node", HARNESS_TELEMETRY_ORCHID_RUN_SOCKET: socket },
          nativeSnapshot: { workspaces: disappeared ? [] : [...clutter, { workspace_id: workspace, label: `${recordedAgent}-701` },
            ...(shared ? [{ workspace_id: "shared-workspace", label: `${recordedAgent}-702` }] : [])],
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
/** Orchid's active run that this read cannot attach leaves its issue uncovered, never absent or complete. */
function assertUnattached(result: IssueAgentTreeSnapshot) {
  assert.equal(result.complete, false);
  assert.equal(result.reason, "binding_unavailable");
  assert.deepEqual(result.issues.map(issue => [issue.issueNumber, issue.complete, issue.reason, issue.dispatches.length]),
    [[776, false, "binding_unavailable", 0]]);
}
it("a restored label cannot bind a different native session", () => fixture(async f => {
  f.restore(); f.mismatch();
  assertUnattached(await f.collect());
}));
it("duplicate native seats stay unresolved instead of selecting one", () => fixture(async f => {
  f.duplicate();
  assertUnattached(await f.collect());
}));
it("two Orchid runs claiming one receipt leave their issue uncovered instead of dropping it", () => fixture(async f => {
  f.sharedReceipt();
  assertUnattached(await f.collect());
  assert.deepEqual(f.requests, [["701", "702"]]);
}));
it("native source scoping selects the canonical issue without consulting other receipts", () => fixture(async f => {
  assert.equal((await f.collect("example/project#776")).issues[0]?.issueNumber, 776);
  assert.deepEqual((await f.collect("example/project#777")).issues, []);
}));

it("an empty Herdr census cannot certify zero active Orchid runs", () => fixture(async f => {
  f.disappear(); // Orchid still has the active 701 record; its key is no longer discoverable here.
  const result = await f.collect(undefined, false);
  assert.deepEqual(f.requests, [[]], "a keyless health ping is not an active-run census");
  assert.equal(result.complete, false);
  assert.equal(result.reason, "binding_unavailable");
  assert.deepEqual(result.issues, []);
  assert((await compatibilityRead(result)).ok);
}));
it("a partial Herdr census keeps positive roots but never certifies an issue with a hidden active run", () => fixture(async f => {
  await f.hiddenRun(); // The active 702 record on #776 has no workspace; only 701 can be selected.
  const result = await f.collect(undefined, false);
  assert.deepEqual(f.requests, [["701"]]);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "binding_unavailable");
  assert.equal(result.issues[0]?.complete, false, "two runs are active on #776; one running row is not the whole issue");
  assert.equal(result.issues[0]?.reason, "binding_unavailable");
  assert.deepEqual(result.issues[0]?.dispatches, [], "default readers get no partial forest");
  assert((await compatibilityRead(result)).ok);
  const opted = await f.collect(undefined, true);
  assert.equal(opted.issues[0]?.complete, false);
  assert.equal(opted.issues[0]?.reason, "binding_unavailable");
  assert.equal(opted.issues[0]?.dispatches[0]?.agents.find(a => a.parentAgentId === null)?.liveness.state, "running",
    "opted-in readers keep the verified root, never as a complete count");
  assert(readIssueAgentTreeSnapshot(opted).ok);
}));

for (const source of ["codex", "claude", "agy", "opencode"] as const) {
  it(`${source}: native identity and execution need no vendor transcript or native history store`, () => fixture(async f => {
    f.restore();
    const root = (await f.collect()).issues[0]?.dispatches[0]?.agents[0];
    assert.equal(root?.harness.value, source);
    assert.equal(root?.liveness.state, "running");
    f.complete();
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
  await f.facets(); f.restore();
  // Agents are ordered by opaque id, so the native child can sort first: select the root by ancestry.
  const previous = await f.legacy();
  assert.equal(previous.issues[0]?.dispatches[0]?.agents.find(a => a.parentAgentId === null)?.liveness.state, "ended",
    "the previous producer validates the historical paired stop");
  const root = (await f.collect()).issues[0]?.dispatches[0]?.agents.find(a => a.parentAgentId === null);
  assert.equal(root?.liveness.state, "running");
  assert.equal(root?.observation.running.value, true);
  assert.equal(root?.terminalOutcome.value, null);
}));

it("an unbounded native snapshot certifies neither global nor per-issue coverage until Orchid covers the active set", () => fixture(async f => {
  const snapshot = await f.collect(undefined, false);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.reason, "binding_unavailable");
  assert.equal(snapshot.issues[0]?.complete, false);
  assert.equal(snapshot.issues[0]?.reason, "binding_unavailable");
  assert.deepEqual(snapshot.issues[0]?.dispatches, []);
  assert((await compatibilityRead(snapshot)).ok);
  const opted = await f.collect(undefined, true);
  assert.equal(opted.issues[0]?.dispatches[0]?.agents[0]?.liveness.state, "running");
  if (process.env.HARNESS_ISSUE_TREE_READER_CONTROL !== undefined) assert.equal((await compatibilityRead(opted)).ok, false);
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
  assert((await compatibilityRead(await f.collect(undefined, false))).ok);
  const snapshot = await f.collect(undefined, true);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.reason, "binding_unavailable");
  assert.equal(snapshot.issues[0]?.complete, false);
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
  assert(readIssueAgentTreeSnapshot(snapshot).ok);
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

for (const [source, recordedAgent] of [["codex", "codex-run"], ["opencode", "opencode-run"]] as const) {
  it(`${recordedAgent}: preserves the exact recorded label while matching the canonical native integration`, () => fixture(async f => {
    f.restore();
    const before = await f.collect(undefined, true);
    const root = before.issues[0]?.dispatches[0]?.agents[0];
    assert.equal(root?.harness.value, source);
    assert.equal(root?.liveness.state, "running");
    assert.deepEqual(f.requests, [["701"]]);
    f.complete();
    const ended = (await f.collect(undefined, true)).issues[0]?.dispatches[0]?.agents[0];
    assert.equal(ended?.liveness.state, "ended");
    assert.equal(ended?.observation.assignment.id, root?.observation.assignment.id);
    assert.ok(!JSON.stringify(before).includes(f.nativeId));
  }, source, recordedAgent));
}

for (const state of ["refused", "blocked"] as const) {
  it(`a failed Herdr snapshot preserves ${state} admission through the real CLI`, () => fixture(async f => {
    await f.facets(state);
    const { snapshot, exit } = await f.failedHerdr();
    assert.equal(exit, 3);
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.reason, "source_unavailable");
    assert.deepEqual(snapshot.issues[0]?.dispatches, []);
    assert.equal(state === "refused" ? snapshot.issues[0]?.launchRefusal?.reason : snapshot.issues[0]?.launchBlock?.reason,
      state === "refused" ? "routing-invalid" : "goal-prompt-unconfirmed");
    assert(readIssueAgentTreeSnapshot(snapshot).ok);
  }));
}
