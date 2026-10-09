/** Synthetic producer controls; no native session, model, credentials or live sources. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRouteIdentity, readAgentObservations, readIssueAgentTreeSnapshot, readGovernanceSnapshot } from "@rickylabs/harness-contracts";
import { projectAgentCost } from "./agent-cost.js";
import { buildAgentObservations } from "./agent-observations.js";
import { buildIssueAgentTreeSnapshot } from "./issue-agent-feed.js";
import { readLocalHostCapacity } from "./host-capacity.js";
import { governanceRead } from "./governance/read.js";
import { validateWireFamily, resolveWireFamily, producerAgentCost, wireProducer } from "./producer-names.js";
import { main } from "./cli.js";
import type { SourceServices } from "./governance/collect.js";
import { collectIssueAgentTree, issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import { Writable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { composeGovernance } from "./governance/compose.js";
import type { RunRecord } from "./model.js";
import type { DispatchEvidence } from "@rickylabs/harness-contracts";
import type { GovernanceSource } from "./source.js";

const at = "2026-01-01T00:00:00.000Z", capturedAt = "2026-01-01T00:01:00.000Z";
const run: RunRecord = { id: "PRIVATE-ROOT-CANARY", source: "codex", parentId: null, startedAt: at, updatedAt: at,
  branch: null, identity: { provider: null, model: null, effort: null, profile: null },
  usage: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 80, costUsd: 0.25 }, outcome: "complete",
  linkedIssues: [], origin: "PRIVATE-ORIGIN-CANARY", quota: [{ source: "codex", observedAt: at,
    usedPercent: 25, windowMinutes: 60, resetsAt: "2026-01-01T01:00:00.000Z", limitId: "fixture-window", planType: null, creditBalance: null }] };
const dispatch: DispatchEvidence = { runId: "PRIVATE-DISPATCH-CANARY", external: run.id, source: "codex",
  linkageBasis: "dispatcher-confirmed", issue: { repo: "example/project", number: 42 }, parentRunId: null,
  location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" }, dispatchState: "dispatched",
  observedAt: at, revision: "a".repeat(64), route: projectRouteIdentity(null), host: "fixture-node" };
const sources = { subscriptionHeadroom: "governance.usage", meteredSpend: "runs", runTokens: "runs", localCapacity: "host-capacity" } as const;
function names(cost: ReturnType<typeof projectAgentCost>, family: "harness" | "legacy") {
  for (const key of Object.keys(sources) as (keyof typeof sources)[]) {
    assert.equal(cost[key].source, `${family === "harness" ? "harness" : "dsh"}-telemetry.${sources[key]}`);
  }
}
const project = projectAgentCost;
const observe = (native: readonly RunRecord[], wireFamily?: "harness" | "legacy", d = dispatch, nativeComplete = true) => buildAgentObservations({
  runs: native, dispatches: [d], observedAt: capturedAt, sourceBound: true, dispatchComplete: true, nativeComplete,
  ...(wireFamily === undefined ? {} : { wireFamily }) });
const source: GovernanceSource = { accountLabel: "fixture", usage: null, spend: null, capacity: null, admissions: null };
const legs = { usage: { ok: false, code: "timeout" }, spend: { ok: false, code: "timeout" }, capacity: { ok: false, code: "timeout" }, events: [], logDegraded: false } as const;
const governance = (wireFamily?: "harness" | "legacy") => composeGovernance(source, legs, capturedAt, capturedAt, wireFamily);
it("explicit canonical run producers preserve measurements and stamps while the default remains legacy", () => {
  for (const native of [run, { ...run, usage: {}, quota: [] }, { ...run, updatedAt: "invalid" },
    { ...run, usage: { inputTokens: -1, costUsd: -1 } }, { ...run, quota: [{ ...run.quota[0]!, usedPercent: 101 }] }]) {
    const legacy = project(native, capturedAt), canonical = project(native, capturedAt, "harness");
    names(legacy, "legacy"); names(project(native, capturedAt, "legacy"), "legacy"); names(canonical, "harness");
    for (const key of Object.keys(sources) as (keyof typeof sources)[]) assert.deepEqual(
      { ...canonical[key], source: legacy[key].source }, legacy[key], "only originated source vocabulary changes");
  }
  const measured = project(run, capturedAt, "harness");
  assert.deepEqual(measured.runTokens.measurement, { inputTokens: 100, outputTokens: 25, cacheReadTokens: 80 });
  assert.equal(measured.meteredSpend.measurement?.amount, 0.25);
  assert.equal(measured.subscriptionHeadroom.measurement?.remainingPercent, 75);
  assert.equal(measured.runTokens.observedAt, at); assert.equal(measured.meteredSpend.observedAt, at);
  names(project(run, "invalid", "harness"), "harness");
});
it("canonical native roots and children carry their own costs without changing attribution or old defaults", () => {
  const child = { ...run, id: "PRIVATE-CHILD-CANARY", parentId: run.id, usage: { inputTokens: 1 } };
  const old = observe([run, child]), current = observe([run, child], "harness");
  assert.ok(readAgentObservations(current).ok); assert.equal(current.agents.length, 2);
  for (const row of current.agents) {
    names(row.cost, "harness"); const previous = old.agents.find(p => p.agentId === row.agentId)!;
    assert.equal(row.assignment.id, previous.assignment.id); assert.deepEqual(row.parentAgentId, previous.parentAgentId);
    assert.deepEqual(row.running, previous.running); assert.deepEqual(row.route, previous.route);
    assert.notEqual(row.revision, previous.revision, "revision binds the produced cost vocabulary");
  }
  assert.doesNotMatch(JSON.stringify(current), /PRIVATE-/);
  for (const row of old.agents) names(row.cost, "legacy");
});
it("canonical dispatch-only and invalid-source rows keep absence reasons and ancestry refusal", () => {
  const partial = observe([], "harness", { ...dispatch, external: null }, false);
  assert.equal(partial.complete, false); assert.equal(partial.reason, "ancestry_unavailable");
  assert.equal(partial.agents.length, 1); names(partial.agents[0]!.cost, "harness");
  assert.ok(readAgentObservations(partial).ok);
  const prior = observe([], "legacy", { ...dispatch, external: null }, false);
  assert.notEqual(partial.agents[0]!.revision, prior.agents[0]!.revision, "revision binds originated dispatch-only cost names");
  const gap = buildAgentObservations({ runs: [], dispatches: [], observedAt: capturedAt,
    sourceBound: false, dispatchComplete: false, nativeComplete: false, wireFamily: "harness" });
  assert.equal(gap.complete, false); assert.equal(gap.reason, "source_not_bound"); assert.equal(gap.agents.length, 0);
});
it("canonical host measurements and unplaced tree fallbacks retain strict placement evidence", async () => {
  const home = await mkdtemp(join(tmpdir(), "producer-host-"));
  try {
    const driver = join(home, "amdgpu"), drm = join(home, "drm"), device = join(drm, "card0", "device"), meminfo = join(home, "meminfo");
    await mkdir(driver); await mkdir(device, { recursive: true }); await symlink(driver, join(device, "driver"));
    await writeFile(meminfo, "MemTotal: 100 kB\nMemAvailable: 25 kB\n");
    await writeFile(join(device, "mem_info_vram_used"), "40\n"); await writeFile(join(device, "mem_info_vram_total"), "100\n");
    const read = readLocalHostCapacity;
    const legacy = await read(capturedAt, "fixture-node", { meminfoPath: meminfo, drmRoot: drm });
    const canonical = await read(capturedAt, "fixture-node", { meminfoPath: meminfo, drmRoot: drm }, "harness");
    assert.equal(canonical.cost.source, "harness-telemetry.host-capacity");
    assert.deepEqual({ ...canonical.cost, source: legacy.cost.source }, legacy.cost);
    const missing = await read(capturedAt, undefined, {}, "harness");
    assert.equal(missing.cost.source, "harness-telemetry.host-capacity"); assert.equal(missing.cost.reason, "host_identity_unset");
    for (const capacity of [undefined, canonical, { ...canonical, host: "wrong-node" },
      { ...canonical, cost: { ...canonical.cost, validUntil: at } }]) {
      const tree = buildIssueAgentTreeSnapshot({ observations: observe([run], "harness"), dispatches: [dispatch], runs: [run],
        ...(capacity === undefined ? {} : { localCapacity: capacity }), wireFamily: "harness" });
      assert.ok(readIssueAgentTreeSnapshot(tree).ok);
      const row = tree.issues[0]!.dispatches[0]!.agents[0]!.observation.cost.localCapacity;
      assert.equal(row.source, "harness-telemetry.host-capacity");
      assert.equal(row.availability, capacity === canonical ? "available" : "unavailable");
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});
it("canonical governance producer keeps independent source provenance and legacy byte compatibility", () => {
  const old = governanceRead(governance()), current = governanceRead(governance("harness"));
  assert.equal(old.producer, "dsh-telemetry"); assert.equal(current.producer, "harness-telemetry");
  assert.deepEqual({ ...current, producer: old.producer }, old); assert.ok(readGovernanceSnapshot(current).ok);
});
it("family resolution retains absence and refuses invalid selections without reflecting private input", () => {
  assert.equal(resolveWireFamily({}), "legacy");
  for (const value of ["harness", "legacy"] as const) assert.equal(resolveWireFamily({ HARNESS_TELEMETRY_WIRE_FAMILY: value }), value);
  for (const value of ["", " harness", "harness ", "HARNESS", "PRIVATE-FAMILY-CANARY", null, 1]) {
    assert.throws(() => validateWireFamily(value), /^Error: invalid HARNESS_TELEMETRY_WIRE_FAMILY$/);
    for (const invoke of [
      () => Reflect.apply(resolveWireFamily, undefined, [{ HARNESS_TELEMETRY_WIRE_FAMILY: value }]),
      () => Reflect.apply(producerAgentCost, undefined, ["source_not_bound", value]),
      () => Reflect.apply(wireProducer, undefined, [value]),
      () => Reflect.apply(projectAgentCost, undefined, [run, "invalid", value]),
      () => Reflect.apply(composeGovernance, undefined, [source, legs, capturedAt, capturedAt, value]),
      () => buildAgentObservations({ runs: [], dispatches: [], observedAt: capturedAt,
        sourceBound: false, dispatchComplete: false, nativeComplete: false, ...({ wireFamily: value } as object) }),
      () => buildIssueAgentTreeSnapshot({ observations: observe([]), dispatches: [], runs: [], ...({ wireFamily: value } as object) }),
    ]) assert.throws(invoke, /^Error: invalid HARNESS_TELEMETRY_WIRE_FAMILY$/);
  }
});
it("invalid issue-feed family refuses before binding reads, collection or watcher effects", async () => {
  let touched = 0, collected = 0;
  const env = { HARNESS_TELEMETRY_WIRE_FAMILY: "PRIVATE-FAMILY-CANARY" };
  Object.defineProperty(env, "HARNESS_TELEMETRY_DISPATCH_ROOT", { get() { touched++; throw Error("PRIVATE-PATH-CANARY"); } });
  const frame = await collectIssueAgentTree({ home: "/fixture/unused", limit: 1, env, now: capturedAt });
  assert.equal(touched, 0); assert.equal(frame.complete, false); assert.equal(frame.reason, "source_unavailable");
  let out = "";
  const output = new Writable({ write(chunk, _encoding, done) { out += String(chunk); done(); } });
  const code = await issueAgentFeedCommand(["--json"], { env, now: () => capturedAt, output,
    collect: async () => { collected++; return frame; } });
  assert.equal(code, 3); assert.equal(touched, 0); assert.equal(collected, 0);
  assert.equal(JSON.parse(out).complete, false); assert.doesNotMatch(out, /PRIVATE-/);
  await assert.rejects(Reflect.apply(readLocalHostCapacity, undefined, [capturedAt, undefined, {}, "PRIVATE-FAMILY-CANARY"]),
    /^Error: invalid HARNESS_TELEMETRY_WIRE_FAMILY$/);
  let fileOptionRead = false;
  const source = Object.defineProperty({}, "meminfoPath", { get() { fileOptionRead = true; throw Error("PRIVATE-FILE-CANARY"); } });
  await assert.rejects(Reflect.apply(readLocalHostCapacity, undefined, [capturedAt, "fixture-node", source, "PRIVATE-FAMILY-CANARY"]),
    /^Error: invalid HARNESS_TELEMETRY_WIRE_FAMILY$/);
  assert.equal(fileOptionRead, false, "validate family before any host source option or file effect");
});
it("actual governance CLI selects canonical provenance and rejects invalid family before a missing descriptor", async () => {
  const home = await mkdtemp(join(tmpdir(), "producer-cli-"));
  const execute = promisify(execFile), cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:HARNESS|DSH)_TELEMETRY_/.test(key)));
  try {
    const descriptor = join(home, "source.json"); await writeFile(descriptor, JSON.stringify(source));
    for (const family of [undefined, "legacy", "harness"]) {
      const env = { ...cleanEnv, ...(family === undefined ? {} : { HARNESS_TELEMETRY_WIRE_FAMILY: family }) };
      const result = await execute(process.execPath, [cli, "governance", "--home", home, "--now", capturedAt,
        "--observations-from", descriptor], { cwd: home, env, timeout: 10_000 }).then(
          () => { assert.fail("not-configured must remain incomplete"); },
          error => { assert.equal(error.code, 3); return JSON.parse(error.stdout); });
      assert.equal(result.producer, family === "harness" ? "harness-telemetry" : "dsh-telemetry");
      assert.equal(result.complete, false); assert.ok(readGovernanceSnapshot(result).ok);
    }
    await execute(process.execPath, [cli, "runs", "--json", "--home", home, "--now", capturedAt], { cwd: home,
      env: { ...cleanEnv, HARNESS_TELEMETRY_WIRE_FAMILY: "PRIVATE-FAMILY-CANARY" }, timeout: 10_000 }).then(
        () => { assert.fail("invalid family must fail before descriptor or native reads"); },
        error => { assert.equal(error.code, 3); assert.equal(error.stdout, "");
          assert.equal(error.stderr, "harness-telemetry: invalid HARNESS_TELEMETRY_WIRE_FAMILY\n"); });
    for (const value of ["", "PRIVATE-FAMILY-CANARY"]) {
      await execute(process.execPath, [cli, "governance", "--home", home, "--now", capturedAt,
        "--observations-from", join(home, "missing")], { cwd: home,
          env: { ...cleanEnv, HARNESS_TELEMETRY_WIRE_FAMILY: value }, timeout: 10_000 }).then(
            () => { assert.fail("invalid family must fail"); },
            error => { assert.equal(error.code, 2); assert.equal(error.stdout, "");
              assert.equal(error.stderr, "governance: invalid HARNESS_TELEMETRY_WIRE_FAMILY\n"); });
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});
it("the tree reader preserves received mixed source provenance during canonical preparation", () => {
  const observations = observe([run], "harness");
  const costs = observations.agents[0]!.cost;
  const mixed = { ...observations, agents: [{ ...observations.agents[0]!, cost: {
    ...costs, meteredSpend: { ...costs.meteredSpend, source: "dsh-telemetry.runs" as const } } }] };
  const tree = buildIssueAgentTreeSnapshot({ observations: mixed, dispatches: [dispatch], runs: [run], wireFamily: "harness" });
  assert.ok(readIssueAgentTreeSnapshot(tree).ok);
  const read = tree.issues[0]!.dispatches[0]!.agents[0]!.observation.cost;
  assert.equal(read.meteredSpend.source, "dsh-telemetry.runs"); assert.equal(read.runTokens.source, "harness-telemetry.runs");
});

it("CLI producer preflight refuses invalid family before observable descriptor or native effects", async () => {
  const previousOut = process.stdout.write, previousErr = process.stderr.write;
  let out = "", err = "", reads = 0, probes = 0;
  process.stdout.write = chunk => { out += String(chunk); return true; };
  process.stderr.write = chunk => { err += String(chunk); return true; };
  try {
    const effect = async (): Promise<never> => { probes++; throw Error("PRIVATE-EFFECT-CANARY"); };
    const services: SourceServices = { env: { HARNESS_TELEMETRY_WIRE_FAMILY: "harness" }, clock: () => capturedAt,
      usage: effect, fetch: effect, readText: async () => { reads++; return JSON.stringify(source); } };
    const args = ["governance", "--observations-from", "/fixture/descriptor", "--now", capturedAt];
    assert.equal(await main(args, services), 3); assert.equal(reads, 1); assert.equal(probes, 0);
    assert.equal(JSON.parse(out).producer, "harness-telemetry");
    out = ""; err = ""; reads = 0;
    const invalid = { ...services, env: { HARNESS_TELEMETRY_WIRE_FAMILY: "PRIVATE-FAMILY-CANARY" } };
    assert.equal(await main(args, invalid), 2); assert.equal(reads, 0); assert.equal(probes, 0);
    assert.equal(out, ""); assert.equal(err, "governance: invalid HARNESS_TELEMETRY_WIRE_FAMILY\n");
  } finally { process.stdout.write = previousOut; process.stderr.write = previousErr; }
});
