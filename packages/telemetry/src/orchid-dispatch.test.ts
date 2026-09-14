/** All dispatch, pane and source values in these fixtures are synthetic. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readOrchidDispatches, bindOrchidDispatchEvidence } from "./orchid-dispatch.js";
const key = "a".repeat(64);
const fixture = { schemaVersion: 1, runId: "orchid-" + key,
  issue: { repo: "example/inbox", number: 42 }, parentRunId: null, source: "codex",
  provider: "fixture-router", model: "fixture-model", effort: "high", profile: "leaf", state: "dispatched",
  location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "orchid-read-"));
  const dir = join(root, key, "record");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "dispatch.json");
  return { root, file, write: (value: unknown) => writeFile(file, JSON.stringify(value), { mode: 0o600 }) };
}
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
    assert.ok(!JSON.stringify(result).includes("PRIVATE-CANARY"));
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

it("binds only an explicit same-dispatch same-source native reference and refuses ambiguity", async () => {
  const s = await setup();
  try {
    await s.write(fixture);
    const rows = (await readOrchidDispatches(s.root)).dispatches;
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
