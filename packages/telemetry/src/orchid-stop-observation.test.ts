import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readOrchidStopObservation } from "./orchid-stop-observation.js";

const key = "a".repeat(64), runId = "orchid-" + key;
const operationId = "123e4567-e89b-42d3-a456-426614174000", requestDigest = "b".repeat(64);
const at = "2026-01-01T00:00:01.000Z", seatAt = "2026-01-01T00:00:02.123456789Z", processAt = "2026-01-01T00:00:03.000000001Z";
const opaque = (kind: string) => `${kind}_${createHash("sha256").update(kind + "\0" + runId).digest("hex")}`;
const expected = { runId, repository: "example/inbox", issueNumber: 42,
  host: "fixture-node", paneId: "fixture-pane", workspaceId: "fixture-workspace" };
const result = { schemaVersion: 1, operationId, requestDigest, repository: expected.repository,
  issueNumber: expected.issueNumber, agentId: opaque("agent"), dispatchId: opaque("assignment"),
  nativeRunId: runId, nativeSessionId: "PRIVATE-NATIVE-SESSION", host: expected.host,
  paneId: expected.paneId, workspaceId: expected.workspaceId, action: "stop", outcome: "accepted",
  reason: "workspace_close_delivered", observedAt: at, promptText: "PRIVATE-PROMPT" };
const observed = (kind: string, observedAt: string) => ({ schemaVersion: 1, operationId, requestDigest, kind, observedAt });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orchid-stop-fixture-"));
  const record = join(root, key, "record"), dir = join(root, "actions", operationId);
  await mkdir(record, { recursive: true, mode: 0o700 });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const write = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await write(join(record, "stop-action.json"), { schemaVersion: 1, operationId, requestDigest });
  await write(join(dir, "intent.json"), { requestDigest });
  await write(join(dir, "result.json"), result);
  return { root, record, dir, write };
}
it("projects only bound immutable stop observations, requiring both for terminal proof", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await readOrchidStopObservation(f.root, f.record, expected), { seatObservedAt: null, processObservedAt: null });
    await f.write(join(f.dir, "seat-observed.json"), observed("seat_absent", seatAt));
    assert.deepEqual(await readOrchidStopObservation(f.root, f.record, expected),
      { seatObservedAt: "2026-01-01T00:00:02.123Z", processObservedAt: null });
    await f.write(join(f.dir, "process-observed.json"), observed("process_absent", processAt));
    const both = await readOrchidStopObservation(f.root, f.record, expected);
    assert.deepEqual(both, { seatObservedAt: "2026-01-01T00:00:02.123Z", processObservedAt: "2026-01-01T00:00:03.000Z" });
    assert.ok(!JSON.stringify(both).includes("PRIVATE-"));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it("withholds an unbound result, an invalid observation and unsafe file modes", async () => {
  const f = await fixture();
  try {
    assert.equal(await readOrchidStopObservation(f.root, f.record, { ...expected, paneId: "other-pane" }), undefined);
    await f.write(join(f.dir, "seat-observed.json"), observed("seat_absent", seatAt));
    await f.write(join(f.dir, "process-observed.json"), { ...observed("process_absent", processAt), requestDigest: "c".repeat(64) });
    assert.deepEqual(await readOrchidStopObservation(f.root, f.record, expected),
      { seatObservedAt: "2026-01-01T00:00:02.123Z", processObservedAt: null });
    await chmod(join(f.dir, "seat-observed.json"), 0o644);
    assert.deepEqual(await readOrchidStopObservation(f.root, f.record, expected), { seatObservedAt: null, processObservedAt: null });
    await rm(join(f.dir, "seat-observed.json"));
    await symlink(join(f.dir, "result.json"), join(f.dir, "seat-observed.json"));
    assert.deepEqual(await readOrchidStopObservation(f.root, f.record, expected), { seatObservedAt: null, processObservedAt: null });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
