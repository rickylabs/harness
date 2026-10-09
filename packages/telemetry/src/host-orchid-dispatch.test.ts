/** Telemetry read models over Orchid receipts read by @rickylabs/host-orchid. All values are synthetic. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readAgentObservations } from "@rickylabs/harness-contracts";
import { readOrchidDispatches, bindOrchidDispatchEvidence, orchidHost } from "@rickylabs/host-orchid";
import { buildAgentObservations } from "./agent-observations.js";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
const key = "a".repeat(64);
const fixture = { schemaVersion: 1, runId: "orchid-" + key,
  issue: { repo: "example/inbox", number: 42 }, parentRunId: null, source: "codex",
  provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf", state: "dispatched",
  location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } };
async function setup(reservation = key) {
  const root = await mkdtemp(join(tmpdir(), "orchid-read-"));
  const dir = join(root, reservation, "record");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "dispatch.json");
  return { root, file, record: dir, write: (value: unknown) => writeFile(file, JSON.stringify(value), { mode: 0o600 }) };
}

it("binds a fresh Claude working status to the exact native root and never to a child", async () => {
  const issueID = "fixture-issue", repo = "example/inbox", briefDigest = "b".repeat(64);
  const reservation = createHash("sha256").update(issueID + "\0" + repo + "\0" + briefDigest).digest("hex");
  const s = await setup(reservation);
  const id = "fixture-native-session";
  const binding = { IssueID: issueID, Repo: repo, BriefDigest: briefDigest, Host: "fixture-node",
    NativeSessionID: id, Route: { transport: "claude", provider: "fixture-router", model: "fixture-model", effort: "high" } };
  const status = (at: string, session = id) => ({ schemaVersion: 1, runId: "orchid-" + reservation,
    nativeSessionId: session, host: "fixture-node", paneId: "fixture-pane", workspaceId: "fixture-workspace",
    status: "working", observedAt: at });
  const source = (idValue: string, parentId: string | null) => ({ id: idValue, parentId, source: "claude" as const,
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), branch: null,
    identity: { model: null, effort: null, provider: null, profile: null }, usage: {}, outcome: "unknown" as const,
    linkedIssues: [], origin: "PRIVATE-PATH-CANARY", quota: [] });
  try {
    await s.write({ ...fixture, runId: "orchid-" + reservation, source: "claude", host: "fixture-node" });
    await writeFile(join(s.record, "binding.json"), JSON.stringify(binding), { mode: 0o600 });
    const statusFile = join(s.record, "claude-status.json");
    await writeFile(statusFile, JSON.stringify(status(new Date().toISOString())), { mode: 0o600 });
    const first = (await readOrchidDispatches(s.root)).dispatches[0]!;
    assert.ok(first.claudeStatus);
    const runs = [source(id, null), source("fixture-child", id)];
    const observations = buildAgentObservations({ dispatches: [first], runs, observedAt: new Date().toISOString(),
      sourceBound: true, dispatchComplete: true, nativeComplete: true, host: orchidHost });
    assert.equal(observations.agents.find(agent => agent.parentAgentId.state === "confirmed-root")?.running.value, true);
    assert.equal(observations.agents.find(agent => agent.parentAgentId.state === "known-parent")?.running.value, null);
    for (const bad of [status(new Date().toISOString(), "other-session"),
      { ...status(new Date().toISOString()), status: "blocked" }, { ...status(new Date().toISOString()), paneId: "other-pane" }]) {
      await writeFile(statusFile, JSON.stringify(bad));
      assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.claudeStatus, undefined);
    }
    // herdr's idle and done both mean stopped at the prompt: observed not running, not unknown.
    for (const stopped of ["idle", "done"]) {
      await writeFile(statusFile, JSON.stringify({ ...status(new Date().toISOString()), status: stopped }));
      const idle = (await readOrchidDispatches(s.root)).dispatches[0]!;
      assert.equal(idle.claudeStatus?.state, "idle", stopped);
      const idleRoot = buildAgentObservations({ dispatches: [idle], runs, observedAt: new Date().toISOString(),
        sourceBound: true, dispatchComplete: true, nativeComplete: true, host: orchidHost }).agents.find(agent => agent.parentAgentId.state === "confirmed-root");
      assert.equal(idleRoot?.running.value, false, stopped);
    }
    await writeFile(statusFile, JSON.stringify(status(new Date(Date.now() - 120_000).toISOString())));
    const stale = (await readOrchidDispatches(s.root)).dispatches[0]!;
    const staleObservations = buildAgentObservations({ dispatches: [stale], runs, observedAt: new Date().toISOString(),
      sourceBound: true, dispatchComplete: true, nativeComplete: true, host: orchidHost });
    assert.equal(staleObservations.agents.find(agent => agent.parentAgentId.state === "confirmed-root")?.running.value, null);
    await writeFile(statusFile, JSON.stringify(status(new Date().toISOString())));
    await chmod(statusFile, 0o644);
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.claudeStatus, undefined);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("carries validated Orchid observed reasons and withholds corrupt receipt text", async () => {
  const s = await setup();
  const reason = "No independent runtime observation is available.";
  const receipt = { schemaVersion: 1, resolution: { sourceRevision: "a".repeat(40), digest: "b".repeat(64),
    resolvedAt: "2026-01-01T00:00:00.000Z", selected: { logicalModel: "fixture-logical-model", physicalModel: "fixture-model" } },
    requested: { transport: "codex", model: "fixture-model", effort: "medium", tier: "fixture", role: "fixture" },
    observed: Object.fromEntries(["transport", "model", "effort", "tier", "role"].map(field => [field,
      { status: "unknown", reasonCode: "observer-unavailable", reason }])) };
  try {
    await s.write(fixture);
    const path = join(s.record, "receipt.json");
    await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
    const first = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.equal(first?.routeObservedReasons?.model.reason, reason);
    assert.deepEqual(first?.routePolicy, { value: "netscript-matrix", digest: "b".repeat(64), source: "dispatch", reason: null });
    assert.equal(first?.routeObservedReasons?.transport.reasonCode, "observer-unavailable");
    const harnessReceipt = { ...receipt, resolution: { ...receipt.resolution, sourceRepository: "rickylabs/harness" } };
    const harnessDispatch = { ...fixture, matrixSource: "rickylabs/harness", matrixRevision: "a".repeat(40) };
    await s.write(harnessDispatch);
    await writeFile(path, JSON.stringify(harnessReceipt));
    let sourced = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.deepEqual(sourced?.routePolicy, { value: "harness-matrix", digest: "b".repeat(64), source: "dispatch", reason: null });
    assert.equal(sourced?.matrixRevision?.value, "a".repeat(40));
    await s.write({ ...fixture, matrixRevision: "a".repeat(40) });
    sourced = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.equal(sourced?.routePolicy?.value, null); // receipt only
    assert.equal(sourced?.matrixRevision?.value, null);
    await s.write(harnessDispatch);
    await writeFile(path, JSON.stringify(receipt));
    sourced = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.equal(sourced?.routePolicy?.value, null); // dispatch only
    await s.write({ ...harnessDispatch, matrixSource: "example/unknown" });
    await writeFile(path, JSON.stringify({ ...harnessReceipt, resolution: { ...receipt.resolution, sourceRepository: "example/unknown" } }));
    sourced = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.equal(sourced?.routePolicy?.value, null); // unsupported source cannot become trusted policy
    await s.write({ ...harnessDispatch, matrixSource: "example/other" });
    await writeFile(path, JSON.stringify(harnessReceipt));
    sourced = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.equal(sourced?.routePolicy?.value, null); // conflicting sources
    await s.write(fixture);
    await writeFile(path, JSON.stringify(receipt));
    // Orchid's requested effort can differ from the effective dispatch effort.
    assert.equal(receipt.requested.effort, "medium");
    assert.equal(fixture.effort, "high");
    const publicTree = buildAgentObservations({ dispatches: [first!], runs: [], observedAt: new Date().toISOString(),
      sourceBound: true, dispatchComplete: true, nativeComplete: true, host: orchidHost });
    assert.equal(publicTree.agents[0]?.routeObservedReasons?.model.reason, reason);
    assert.equal(readAgentObservations(publicTree).ok, true);
    await writeFile(path, JSON.stringify({ ...receipt, requested: { ...receipt.requested, model: "wrong-model" } }));
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.routeObservedReasons?.model.status, "unavailable");
    await writeFile(path, JSON.stringify({ ...receipt, resolution: { ...receipt.resolution,
      selected: { ...receipt.resolution.selected, physicalModel: "wrong-model" } } }));
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.routeObservedReasons?.model.status, "unavailable");
    await writeFile(path, JSON.stringify({ ...receipt, observed: { ...receipt.observed,
      model: { status: "unknown", reasonCode: "observer-unavailable", reason: "PRIVATE-CANARY" } } }));
    const invalid = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.equal(invalid?.routeObservedReasons?.model.status, "unavailable");
    assert.equal(invalid?.routePolicy?.value, null);
    assert.ok(!JSON.stringify(invalid).includes("PRIVATE-CANARY"));
    await writeFile(path, JSON.stringify({ ...receipt, resolution: { ...receipt.resolution, digest: "PRIVATE-CANARY" } }));
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.routePolicy?.value, null);
    await writeFile(path, JSON.stringify(receipt));
    await chmod(path, 0o644);
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.routeObservedReasons?.model.status, "unavailable");
    await chmod(path, 0o600);
    await rm(path);
    const target = join(s.record, "receipt-target.json");
    await writeFile(target, JSON.stringify(receipt), { mode: 0o600 });
    await symlink(target, path);
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.routeObservedReasons?.model.status, "unavailable");
    await rm(path);
    const oversized = JSON.stringify({ ...receipt, padding: "x".repeat(16_385 - JSON.stringify({ ...receipt, padding: "" }).length) });
    assert.equal(Buffer.byteLength(oversized), 16_385);
    await writeFile(path, oversized, { mode: 0o600 });
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.routeObservedReasons?.model.status, "unavailable");
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("retains verified failed registration without a location and leaves neighbouring receipts readable", async () => {
  const s = await setup();
  try {
    const neighbour = join(s.root, "b".repeat(64), "record");
    await mkdir(neighbour, { recursive: true, mode: 0o700 });
    await writeFile(join(neighbour, "dispatch.json"), JSON.stringify({ ...fixture,
      runId: "orchid-" + "b".repeat(64), issue: { ...fixture.issue, number: 43 } }), { mode: 0o600 });
    for (const source of ["agy", "codex", "claude"]) {
      await s.write({ ...fixture, source, state: "uncertain", location: null });
      const before = await readFile(s.file);
      const read = await readOrchidDispatches(s.root);
      assert.equal(read.degraded, false);
      assert.deepEqual(read.notes, []);
      assert.equal(read.dispatches.length, 2);
      const failed = read.dispatches.find(d => d.issue?.number === 42)!;
      assert.equal(failed.dispatchState, "uncertain");
      assert.equal(failed.location, null);
      assert.equal(failed.external, null);
      assert.equal(failed.harness, source);
      assert.equal(failed.stop, undefined);
      assert.equal(failed.teardown, undefined);
      assert.equal(failed.claudeStatus, undefined);
      const tree = buildAgentObservations({ dispatches: [failed], runs: [], observedAt: new Date().toISOString(),
        sourceBound: true, dispatchComplete: true, nativeComplete: true, host: orchidHost });
      assert.equal(readAgentObservations(tree).ok, true);
      assert.equal(tree.agents.length, 1);
      assert.equal(tree.agents[0]?.pane.value, null);
      assert.equal(tree.agents[0]?.workspace.value, null);
      assert.equal(tree.agents[0]?.running.value, null);
      assert.equal(tree.agents[0]?.parentAgentId.state, "unavailable");
      assert.deepEqual(read.dispatches.find(d => d.issue?.number === 43)?.location, fixture.location);
      assert.deepEqual(await readFile(s.file), before, "reader must never rewrite the failed receipt or its fence");
      const forged = { ...failed, source: "codex" as const, external: "PRIVATE-NATIVE-CANARY" };
      assert.equal(bindOrchidDispatchEvidence([failed], [forged]).dispatches[0]?.external, null);
    }
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("serves the failed AGY issue as unknown without masking an unrelated known refusal", async () => {
  const s = await setup();
  const at = "2026-10-01T00:00:00.000Z";
  try {
    await s.write({ ...fixture, source: "agy", observedAt: at, state: "uncertain", location: null });
    const refusal = { schemaVersion: 1, issue: { repo: "example/inbox", number: 43 },
      dispatchId: "assignment_" + "c".repeat(64), state: "refused", reasonCode: "routing-invalid", observedAt: at };
    await writeFile(join(s.root, "launch-" + "d".repeat(64) + ".json"), JSON.stringify(refusal), { mode: 0o600 });
    const snapshot = await collectIssueAgentTree({ home: s.root, limit: 10,
      env: { DSH_TELEMETRY_DISPATCH_ROOT: s.root }, now: at });
    const failed = snapshot.issues.find(i => i.issueNumber === 42);
    const neighbour = snapshot.issues.find(i => i.issueNumber === 43);
    assert.equal(failed?.complete, false);
    assert.equal(failed?.reason, "binding_unavailable");
    assert.deepEqual(failed?.dispatches, []);
    assert.equal(neighbour?.complete, true);
    assert.equal(neighbour?.launchRefusal?.reason, "routing-invalid");
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
