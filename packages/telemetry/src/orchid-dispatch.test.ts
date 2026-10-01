/** All dispatch, pane and source values in these fixtures are synthetic. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readOrchidDispatches, bindOrchidDispatchEvidence } from "./orchid-dispatch.js";
import { buildAgentObservations } from "./agent-observations.js";
import { readAgentObservations } from "@rickylabs/harness-contracts";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
const key = "a".repeat(64);
const fixture = { schemaVersion: 1, runId: "orchid-" + key,
  issue: { repo: "example/inbox", number: 42 }, parentRunId: null, source: "codex",
  provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf", state: "dispatched",
  location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } };

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
      sourceBound: true, dispatchComplete: true, nativeComplete: true });
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
        sourceBound: true, dispatchComplete: true, nativeComplete: true }).agents.find(agent => agent.parentAgentId.state === "confirmed-root");
      assert.equal(idleRoot?.running.value, false, stopped);
    }
    await writeFile(statusFile, JSON.stringify(status(new Date(Date.now() - 120_000).toISOString())));
    const stale = (await readOrchidDispatches(s.root)).dispatches[0]!;
    const staleObservations = buildAgentObservations({ dispatches: [stale], runs, observedAt: new Date().toISOString(),
      sourceBound: true, dispatchComplete: true, nativeComplete: true });
    assert.equal(staleObservations.agents.find(agent => agent.parentAgentId.state === "confirmed-root")?.running.value, null);
    await writeFile(statusFile, JSON.stringify(status(new Date().toISOString())));
    await chmod(statusFile, 0o644);
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.claudeStatus, undefined);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
async function setup(reservation = key) {
  const root = await mkdtemp(join(tmpdir(), "orchid-read-"));
  const dir = join(root, reservation, "record");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "dispatch.json");
  return { root, file, record: dir, write: (value: unknown) => writeFile(file, JSON.stringify(value), { mode: 0o600 }) };
}
it("certifies only the configured short host matching the private reservation", async () => {
  const issueID = "fixture-issue", repo = "example/target", briefDigest = "b".repeat(64);
  const reservation = createHash("sha256").update(issueID + "\0" + repo + "\0" + briefDigest).digest("hex");
  const s = await setup(reservation);
  const binding = { IssueID: issueID, Repo: repo, BriefDigest: briefDigest, Host: "fixture-node" };
  try {
    await s.write({ ...fixture, runId: "orchid-" + reservation, host: "fixture-node" });
    await writeFile(join(s.record, "binding.json"), JSON.stringify(binding), { mode: 0o600 });
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.host, "fixture-node");
    await writeFile(join(s.record, "binding.json"), JSON.stringify({ ...binding, Host: "other-fixture" }));
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.host, null);
    await writeFile(join(s.record, "binding.json"), JSON.stringify(binding));
    await s.write({ ...fixture, runId: "orchid-" + reservation, host: "fixture.invalid" });
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.host, null);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("binds launch revisions to the private profile and matrix receipts with typed fallback", async () => {
  const issueID = "fixture-issue", repo = "example/target", briefDigest = "b".repeat(64);
  const reservation = createHash("sha256").update(issueID + "\0" + repo + "\0" + briefDigest).digest("hex");
  const profileRevision = "c".repeat(40), matrixRevision = "d".repeat(40);
  const s = await setup(reservation);
  const binding = { IssueID: issueID, Repo: repo, BriefDigest: briefDigest, Host: "fixture-node", ProfileRevision: profileRevision };
  const receipt = { schemaVersion: 1, resolution: { sourceRevision: matrixRevision, digest: "b".repeat(64),
    resolvedAt: "2026-01-01T00:00:00.000Z", selected: { logicalModel: "fixture-logical", physicalModel: "fixture-model" } },
    requested: { transport: "codex", model: "fixture-model", effort: "high", tier: "feature", role: "implementation" },
    observed: Object.fromEntries(["transport", "model", "effort", "tier", "role"].map(field => [field,
      { status: "unknown", reasonCode: "observer-unavailable", reason: "No independent runtime observation is available." }])) };
  const pin = (value: string) => ({ value, scope: "root-dispatch", source: "dispatch", reason: null });
  const missing = (reason: string) => ({ value: null, scope: "root-dispatch", source: "unavailable", reason });
  try {
    await s.write({ ...fixture, runId: "orchid-" + reservation, host: "fixture-node", profileRevision, matrixRevision });
    await writeFile(join(s.record, "binding.json"), JSON.stringify(binding), { mode: 0o600 });
    await writeFile(join(s.record, "receipt.json"), JSON.stringify(receipt), { mode: 0o600 });
    let row = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.deepEqual(row?.profileRevision, pin(profileRevision));
    assert.deepEqual(row?.matrixRevision, pin(matrixRevision));
    await writeFile(join(s.record, "binding.json"), JSON.stringify({ ...binding, ProfileRevision: "e".repeat(40) }));
    row = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.deepEqual(row?.profileRevision, missing("binding_invalid"));
    assert.deepEqual(row?.matrixRevision, pin(matrixRevision));
    await writeFile(join(s.record, "binding.json"), JSON.stringify(binding));
    await writeFile(join(s.record, "receipt.json"), JSON.stringify({ ...receipt, resolution: {
      ...receipt.resolution, sourceRevision: "e".repeat(40) } }));
    assert.deepEqual((await readOrchidDispatches(s.root)).dispatches[0]?.matrixRevision, missing("binding_invalid"));
    await s.write({ ...fixture, runId: "orchid-" + reservation, host: "fixture-node" });
    row = (await readOrchidDispatches(s.root)).dispatches[0];
    assert.deepEqual(row?.profileRevision, missing("source_not_bound"));
    assert.deepEqual(row?.matrixRevision, missing("source_not_bound"));
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
      sourceBound: true, dispatchComplete: true, nativeComplete: true });
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
it("joins exact inbox issue and pane to the dispatch without inventing router or native identity", async () => {
  const s = await setup();
  try {
    await s.write({ ...fixture, ignoredSecret: "PRIVATE-CANARY", Repo: "example/target" });
    const result = await readOrchidDispatches(s.root);
    assert.equal(result.degraded, false);
    const row = result.dispatches[0];
    assert.deepEqual(row?.issue, fixture.issue);
    assert.deepEqual(row?.location, fixture.location);
    assert.equal(row?.external, null);
    assert.equal(row?.parentRunId, null);
    assert.equal(row?.route.requested.model.value, "fixture-model");
    assert.equal(row?.route.requested.effort.value, "high");
    assert.equal(row?.route.requested.provider.value, "fixture-router");
    assert.equal(row?.route.observed.model.value, null);
    assert.equal(row?.dispatchState, "dispatched");
    assert.deepEqual(row?.router, { value: "direct", source: "dispatch", reason: null });
    assert.ok(!JSON.stringify(result).includes("PRIVATE-CANARY"));
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("projects a bound nonnegative budget with the writer's exact source vocabulary", async () => {
  const s = await setup();
  try {
    for (const [source, publicSource] of [["issue", "issue-override"], ["route", "route-default"]] as const) {
      await s.write({ ...fixture, tokenBudget: 1000, budgetSource: source, ignoredDefault: 2000 });
      const read = await readOrchidDispatches(s.root);
      assert.equal(read.degraded, false);
      assert.deepEqual(read.dispatches[0]?.budget, { tokenLimit: 1000, source: publicSource, reason: null });
    }
    await s.write({ ...fixture, tokenBudget: null, budgetSource: "unset" });
    assert.deepEqual((await readOrchidDispatches(s.root)).dispatches[0]?.budget, { tokenLimit: null, source: "unavailable", reason: "source_not_bound" });
    for (const source of ["issue", "route"] as const) {
      await s.write({ ...fixture, tokenBudget: 0, budgetSource: source });
      assert.deepEqual((await readOrchidDispatches(s.root)).dispatches[0]?.budget,
        { tokenLimit: 0, source: source === "issue" ? "issue-override" : "route-default", reason: null });
    }
    for (const bad of [
      { tokenBudget: -1, budgetSource: "route" }, { tokenBudget: 1000, budgetSource: "PRIVATE-CANARY" },
      { tokenBudget: "/PRIVATE-PATH-CANARY", budgetSource: "issue" }, { tokenBudget: 1000 },
    ]) {
      await s.write({ ...fixture, ...bad });
      const read = await readOrchidDispatches(s.root);
      assert.equal(read.degraded, false);
      assert.deepEqual(read.dispatches[0]?.budget, { tokenLimit: null, source: "unavailable", reason: "source_not_bound" });
      assert.ok(!JSON.stringify(read.dispatches).includes("PRIVATE-"));
    }
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("does not claim direct for an agy dispatch", async () => {
  const s = await setup();
  try {
    await s.write({ ...fixture, source: "agy" });
    assert.deepEqual((await readOrchidDispatches(s.root)).dispatches[0]?.router,
      { value: null, source: "unavailable", reason: "source_not_bound" });
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("hides reserved attempts and retains an ambiguous execution as uncertain", async () => {
  const s = await setup();
  try {
    await s.write({ ...fixture, state: "reserved", location: null });
    assert.deepEqual((await readOrchidDispatches(s.root)).dispatches, []);
    await s.write({ ...fixture, state: "uncertain" });
    assert.equal((await readOrchidDispatches(s.root)).dispatches[0]?.dispatchState, "uncertain");
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
        sourceBound: true, dispatchComplete: true, nativeComplete: true });
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
it("still rejects null locations for running receipts and malformed uncertain locations", async () => {
  const s = await setup();
  try {
    for (const value of [
      { ...fixture, state: "launching", location: null },
      { ...fixture, state: "dispatched", location: null },
      { ...fixture, state: "uncertain", location: undefined },
      { ...fixture, state: "uncertain", location: {} },
      { ...fixture, state: "uncertain", location: null, source: "PRIVATE-CANARY" },
      { ...fixture, state: "uncertain", location: null, issue: { ...fixture.issue, number: 0 } },
    ]) {
      await s.write(value);
      const read = await readOrchidDispatches(s.root);
      assert.equal(read.degraded, true);
      assert.deepEqual(read.dispatches, []);
      assert.deepEqual(read.notes, ["orchid-dispatch: binding_unavailable"]);
      assert.ok(!JSON.stringify(read).includes("PRIVATE-CANARY"));
    }
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
it("withholds corrupt or relocated records, paths and symlinks with fixed diagnostics", async () => {
  const s = await setup();
  try {
    for (const value of [
      { ...fixture, runId: "fixture-wrong" }, { ...fixture, issue: { repo: "example/inbox", number: 0 } },
      { ...fixture, parentRunId: "fixture-parent" }, { ...fixture, location: { ...fixture.location, paneId: "/PRIVATE-CANARY" } },
    ]) {
      await s.write(value);
      const result = await readOrchidDispatches(s.root);
      assert.equal(result.degraded, true);
      assert.deepEqual(result.dispatches, []);
      assert.deepEqual(result.notes, ["orchid-dispatch: binding_unavailable"]);
    }
    await rm(s.file);
    await symlink(join(s.root, "PRIVATE-CANARY"), s.file);
    assert.equal((await readOrchidDispatches(s.root)).degraded, true);
    await chmod(s.root, 0o755);
    assert.deepEqual((await readOrchidDispatches(s.root)).notes, ["orchid-dispatch: source_unavailable"]);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

it("reports the configured receipt root and each root refusal without changing degradation", async t => {
  const assertRefusal = async (root: string, reason: string) => {
    const result = await readOrchidDispatches(root);
    assert.equal(result.root, root);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.dispatches, []);
    assert.deepEqual(result.notes, ["orchid-dispatch: source_unavailable"]);
    assert.equal(result.degraded, true);
  };

  await t.test("healthy readable root has no reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchid-empty-"));
    try {
      const result = await readOrchidDispatches(root);
      assert.equal(result.root, root);
      assert.equal(result.reason, null);
      assert.deepEqual(result.dispatches, []);
      assert.deepEqual(result.notes, []);
      assert.equal(result.degraded, false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  await t.test("missing", async () => {
    const parent = await mkdtemp(join(tmpdir(), "orchid-missing-"));
    try { await assertRefusal(join(parent, "receipts"), "missing"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  await t.test("not_directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "orchid-file-"));
    const root = join(parent, "receipts");
    try {
      await writeFile(root, "fixture", { mode: 0o600 });
      await assertRefusal(root, "not_directory");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  await t.test("wrong_mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchid-mode-"));
    try {
      await chmod(root, 0o755);
      await assertRefusal(root, "wrong_mode");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  await t.test("relative_path", async () => {
    await assertRefusal("relative-receipts", "relative_path");
  });

  await t.test("symlink", async () => {
    const parent = await mkdtemp(join(tmpdir(), "orchid-symlink-"));
    const target = join(parent, "target");
    const root = join(parent, "receipts");
    try {
      await mkdir(target, { mode: 0o700 });
      await symlink(target, root);
      await assertRefusal(root, "symlink");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  await t.test("git_ancestor", async () => {
    const parent = await mkdtemp(join(tmpdir(), "orchid-git-"));
    const root = join(parent, "receipts");
    try {
      await mkdir(join(parent, ".git"), { mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      await assertRefusal(root, "git_ancestor");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});

it("binds only an explicit same-dispatch same-source native reference and refuses ambiguity", async () => {
  const s = await setup();
  try {
    await s.write(fixture);
    // Legacy non-Orchid evidence remains supported; private reader rows have their own boundary.
    const rows = (await readOrchidDispatches(s.root)).dispatches.map(row => ({ ...row }));
    const d = rows[0]!;
    const result = { ...d, external: "PRIVATE-NATIVE-FIXTURE" };
    const bound = bindOrchidDispatchEvidence(rows, [result]);
    assert.equal(bound.degraded, false);
    assert.equal(bound.dispatches[0]?.external, "PRIVATE-NATIVE-FIXTURE");
    for (const ambiguous of [[result, result], [{ ...result, source: "claude" as const }]]) {
      assert.equal(bindOrchidDispatchEvidence(rows, ambiguous).degraded, true);
    }
    assert.equal(bindOrchidDispatchEvidence(rows, [{ ...result, runId: "different-fixture" }]).dispatches[0]?.external, null);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

it("requires exactly 0700 on the root and still accepts a restored 0700 root", async () => {
  const s = await setup();
  try {
    await s.write(fixture);
    await chmod(s.root, 0o700);
    assert.equal((await readOrchidDispatches(s.root)).dispatches.length, 1);
    for (const mode of [0o500, 0o1700]) {
      await chmod(s.root, mode);
      const refused = await readOrchidDispatches(s.root);
      assert.equal(refused.degraded, true);
      assert.deepEqual(refused.dispatches, []);
      assert.deepEqual(refused.notes, ["orchid-dispatch: source_unavailable"]);
    }
    await chmod(s.root, 0o700);
    const accepted = await readOrchidDispatches(s.root);
    assert.equal(accepted.degraded, false);
    assert.equal(accepted.dispatches.length, 1);
  } finally { await chmod(s.root, 0o700); await rm(s.root, { recursive: true, force: true }); }
});
it("reads a closed issue launch refusal without a dispatch and withholds malformed records", async () => {
  const s = await setup();
  const path = join(s.root, "launch-" + "d".repeat(64) + ".json");
  const refusal = { schemaVersion: 1, issue: { repo: "example/inbox", number: 42 },
    dispatchId: "assignment_" + "e".repeat(64), state: "refused", reasonCode: "routing-invalid",
    observedAt: "2026-01-01T00:00:00.000Z" };
  try {
    await writeFile(path, JSON.stringify(refusal), { mode: 0o600 });
    const good = await readOrchidDispatches(s.root);
    assert.deepEqual(good.dispatches, []);
    assert.equal(good.launchStates[0]?.reasonCode, "routing-invalid");
    assert.ok(!JSON.stringify(good).includes("PRIVATE"));
    for (const reasonCode of ["budget-reached", "budget-unavailable"]) {
      await writeFile(path, JSON.stringify({ ...refusal, reasonCode }));
      assert.equal((await readOrchidDispatches(s.root)).launchStates[0]?.reasonCode, reasonCode);
    }
    for (const state of [
      { ...refusal, reasonCode: "PRIVATE-refusal" },
      { ...refusal, reasonCode: "goal-prompt-unconfirmed" },
      { ...refusal, dispatchId: "PRIVATE-native-id" },
      { ...refusal, issue: { repo: "example/inbox", number: 0 } },
    ]) {
      await writeFile(path, JSON.stringify(state));
      const bad = await readOrchidDispatches(s.root);
      assert.deepEqual(bad.launchStates, []);
      assert.equal(bad.degraded, true);
    }
    await writeFile(path, JSON.stringify({ ...refusal, state: "launching", reasonCode: null }));
    assert.equal((await readOrchidDispatches(s.root)).launchStates[0]?.state, "launching");
    await chmod(path, 0o644);
    assert.deepEqual((await readOrchidDispatches(s.root)).launchStates, []);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

it("reads only schema2 closed post-launch blocks and preserves schema1 states", async () => {
  const s = await setup();
  const path = join(s.root, "launch-" + "d".repeat(64) + ".json");
  const block = { schemaVersion: 2, issue: { repo: "example/inbox", number: 42 },
    dispatchId: "assignment_" + "e".repeat(64), state: "blocked", reasonCode: "goal-prompt-unconfirmed",
    observedAt: "2026-01-01T00:00:00.000Z" };
  try {
    await writeFile(path, JSON.stringify(block), { mode: 0o600 });
    const good = await readOrchidDispatches(s.root);
    assert.equal(good.degraded, false);
    assert.deepEqual(good.launchStates, [{ issue: block.issue, dispatchId: block.dispatchId,
      state: block.state, reasonCode: block.reasonCode, observedAt: block.observedAt }]);
    for (const value of [
      { ...block, schemaVersion: 1 }, { ...block, schemaVersion: 3 },
      { ...block, state: "refused", reasonCode: "routing-invalid" },
      { ...block, state: "launching", reasonCode: null }, { ...block, state: "launched", reasonCode: null },
      { ...block, reasonCode: null }, { ...block, reasonCode: "routing-invalid" },
      { ...block, reasonCode: "PRIVATE-ERROR-CANARY" }, { ...block, dispatchId: "PRIVATE-NATIVE-ID" },
      { ...block, observedAt: "2026-02-30T00:00:00.000Z" }, { ...block, prompt: "PRIVATE-PROMPT-CANARY" },
      { ...block, issue: { ...block.issue, cwd: "/PRIVATE-PATH-CANARY" } },
    ]) {
      await writeFile(path, JSON.stringify(value));
      const bad = await readOrchidDispatches(s.root);
      assert.equal(bad.degraded, true, JSON.stringify(value));
      assert.deepEqual(bad.launchStates, []);
      assert.ok(!JSON.stringify(bad).includes("PRIVATE-"));
    }
    for (const state of ["launching", "launched"] as const) {
      await writeFile(path, JSON.stringify({ ...block, schemaVersion: 1, state, reasonCode: null }));
      assert.equal((await readOrchidDispatches(s.root)).launchStates[0]?.state, state);
    }
    await writeFile(path, JSON.stringify(block));
    await chmod(path, 0o644);
    assert.deepEqual((await readOrchidDispatches(s.root)).launchStates, []);
    await chmod(path, 0o600);
    const duplicate = join(s.root, "launch-" + "f".repeat(64) + ".json");
    await writeFile(duplicate, JSON.stringify(block), { mode: 0o600 });
    const ambiguous = await readOrchidDispatches(s.root);
    assert.equal(ambiguous.degraded, true);
    assert.deepEqual(ambiguous.launchStates, []);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
