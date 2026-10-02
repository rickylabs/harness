/** Sanitized structural regressions for the #552/#559/#561 startup failures.
 * Identifiers, hosts, routes, budget and revisions are synthetic. Native stores are never read.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import { readAgentObservations, readIssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { buildAgentObservations } from "./agent-observations.js";
import { collectIssueAgentTree } from "./issue-agent-feed-cli.js";
import { readOrchidDispatches } from "./orchid-dispatch.js";

// All 17 header fields match the measured receipt-isolation field inventory.
const shapes = [
  { number: 552, source: "agy", state: "uncertain", location: null },
  { number: 559, source: "opencode", state: "dispatched", location: { paneId: "fixture-pane-a", workspaceId: "fixture-workspace-a" } },
  { number: 561, source: "opencode", state: "dispatched", location: { paneId: "fixture-pane-b", workspaceId: "fixture-workspace-b" } },
] as const;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "receipt-compat-"));
  const files: string[] = [];
  const values: Record<string, unknown>[] = [];
  for (const shape of shapes) {
    const key = createHash("sha256").update("fixture-" + shape.number).digest("hex");
    const dir = join(root, key, "record"); await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "dispatch.json"); files.push(file);
    const value = { schemaVersion: 1, runId: "orchid-" + key, issue: { repo: "example/inbox", number: shape.number },
      parentRunId: null, source: shape.source, state: shape.state, location: shape.location,
      provider: "fixture-provider", model: shape.source === "opencode" ? "fixture-provider/fixture-model" : "fixture-model",
      effort: "provider_default", host: "fixture-host", profile: "leaf", profileRevision: "c".repeat(40), matrixRevision: "d".repeat(40),
      matrixSource: "rickylabs/harness", tokenBudget: 1000, budgetSource: "route" };
    assert.equal(Object.keys(value).length, 17); values.push(value);
    await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  }
  const now = new Date().toISOString();
  await writeFile(join(root, "launch-" + "d".repeat(64) + ".json"), JSON.stringify({ schemaVersion: 1,
    issue: { repo: "example/inbox", number: 545 }, dispatchId: "assignment_" + "c".repeat(64),
    state: "refused", reasonCode: "routing-invalid", observedAt: now }), { mode: 0o600 });
  return { root, files, values, now, close: () => rm(root, { recursive: true, force: true }) };
}
// An explicit test-only control permits replay against the exact installed old reader.
async function selectedReader(): Promise<typeof readOrchidDispatches> {
  const control = process.env.HARNESS_RECEIPT_READER_CONTROL;
  return control === undefined ? readOrchidDispatches :
    (await import(pathToFileURL(control).href) as { readOrchidDispatches: typeof readOrchidDispatches }).readOrchidDispatches;
}
it("P0 sanitized #552/#559/#561 receipts remain readable, honest and strictly decodable without native evidence", async () => {
  const f = await fixture();
  try {
    const before = await Promise.all(f.files.map(path => readFile(path)));
    const result = await (await selectedReader())(f.root);
    assert.equal(result.degraded, false); assert.equal(result.reason, null); assert.deepEqual(result.notes, []);
    assert.equal(result.dispatches.length, 3); assert.equal(result.launchStates.length, 1);
    for (const shape of shapes) {
      const d = result.dispatches.find(row => row.issue?.number === shape.number)!;
      assert.ok(d); assert.equal(d.source, shape.source); assert.equal(d.dispatchState, shape.state);
      assert.deepEqual(d.location, shape.location); assert.equal(d.external, null);
      const observations = buildAgentObservations({ dispatches: [d], runs: [], observedAt: f.now,
        sourceBound: true, dispatchComplete: true, nativeComplete: true });
      assert.equal(readAgentObservations(observations).ok, true);
      assert.equal(observations.agents[0]?.running.value, null);
      assert.equal(observations.agents[0]?.parentAgentId.state, "unavailable");
      if (shape.location === null) {
        assert.equal(observations.agents[0]?.pane.value, null);
        assert.equal(observations.agents[0]?.workspace.value, null);
      }
    }
    const snapshot = await collectIssueAgentTree({ home: f.root, limit: 20, now: f.now,
      env: { DSH_TELEMETRY_DISPATCH_ROOT: f.root } });
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    for (const shape of shapes) {
      const issue = snapshot.issues.find(row => row.issueNumber === shape.number)!;
      assert.ok(issue); assert.equal(issue.complete, false); assert.equal(issue.reason, "binding_unavailable");
      assert.deepEqual(issue.dispatches, []); // No native acceptance, running or Done is invented.
    }
    const neighbour = snapshot.issues.find(row => row.issueNumber === 545)!;
    assert.equal(neighbour.complete, true); assert.equal(neighbour.launchRefusal?.reason, "routing-invalid");
    const after = await Promise.all(f.files.map(path => readFile(path)));
    assert.deepEqual(after, before, "read must never modify the receipts or their durable fences");
  } finally { await f.close(); }
});
it("P0 compatibility keeps malformed and unlocated running receipts rejected", async () => {
  const f = await fixture();
  try {
    for (const bad of [
      { ...f.values[0], state: "dispatched" },
      { ...f.values[1], location: null },
      { ...f.values[1], source: "unrecognized" },
      { ...f.values[1], model: "foreign-provider/model" },
      { ...f.values[0], issue: { repo: "example/inbox", number: 0 } },
    ]) {
      await writeFile(f.files[0]!, JSON.stringify({ ...bad, runId: f.values[0]!.runId }));
      const result = await readOrchidDispatches(f.root);
      assert.equal(result.degraded, true); assert.deepEqual(result.notes, ["orchid-dispatch: binding_unavailable"]);
      assert.equal(result.dispatches.length, 2); // Valid neighbours survive strict validation.
    }
  } finally { await f.close(); }
});
