import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readOrchidTeardownObservation } from "../../src/adapters/teardown-observation.js";

const issueId = "fixture-issue", repo = "example/inbox", briefDigest = "a".repeat(64);
const key = createHash("sha256").update(issueId + "\0" + repo + "\0" + briefDigest).digest("hex");
const runId = "orchid-" + key;
const expected = { runId, repository: repo, issueNumber: 42,
  host: "fixture-node", paneId: "fixture-pane", workspaceId: "fixture-workspace" };
const startedAt = "2026-01-01T00:00:01.000000001Z";
const seatAt = "2026-01-01T00:00:02.123456789Z", processAt = "2026-01-01T00:00:03.000000001Z";
const intent = { schemaVersion: 1, issue: 42, dispatchKey: key, nativeRunId: runId,
  nativeSessionId: "PRIVATE-NATIVE-SESSION", host: expected.host, paneId: expected.paneId,
  workspaceId: expected.workspaceId, cause: "operator-timeout", startedAt };
const anchor = { schemaVersion: 1, operationId: "", requestDigest: "", groupId: 301, rootPid: 301,
  members: [{ pid: 301, start: 9 }] };
const observation = (kind: string, observedAt: string) => ({ schemaVersion: 1, nativeRunId: runId, kind, observedAt });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orchid-teardown-fixture-"));
  const record = join(root, "record");
  await mkdir(record, { mode: 0o700 });
  const write = (name: string, value: unknown) => writeFile(join(record, name), JSON.stringify(value), { mode: 0o600 });
  await write("binding.json", { NativeSessionID: intent.nativeSessionId, Repo: repo, Host: expected.host,
    IssueID: issueId, BriefDigest: briefDigest });
  await write("teardown-intent.json", intent);
  await write("teardown-anchor.json", anchor);
  return { root, record, write };
}

it("reads bound private teardown observations without projecting a private native id", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await readOrchidTeardownObservation(f.record, expected),
      { cause: "timeout", seatObservedAt: null, processObservedAt: null });
    await f.write("teardown-seat-observed.json", observation("seat_absent", seatAt));
    assert.deepEqual(await readOrchidTeardownObservation(f.record, expected),
      { cause: "timeout", seatObservedAt: "2026-01-01T00:00:02.123Z", processObservedAt: null });
    await f.write("teardown-process-observed.json", observation("process_absent", processAt));
    const both = await readOrchidTeardownObservation(f.record, expected);
    assert.deepEqual(both, { cause: "timeout", seatObservedAt: "2026-01-01T00:00:02.123Z",
      processObservedAt: "2026-01-01T00:00:03.000Z" });
    assert.ok(!JSON.stringify(both).includes("PRIVATE-"));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

it("harness#613: reads the teardown of an inbox run whose binding names its work repository", async () => {
  // An inbox issue (example/inbox) launched from a source elsewhere: Orchid resolves the target from
  // the body's authoritative repo: key, so its binding names the work repository, keyed with it.
  const work = "example/work";
  const workKey = createHash("sha256").update(issueId + "\0" + work + "\0" + briefDigest).digest("hex");
  const workRun = "orchid-" + workKey;
  const f = await fixture();
  try {
    await f.write("binding.json", { NativeSessionID: intent.nativeSessionId, Repo: work, Host: expected.host,
      IssueID: issueId, BriefDigest: briefDigest });
    await f.write("teardown-intent.json", { ...intent, dispatchKey: workKey, nativeRunId: workRun, cause: "teardown" });
    await f.write("teardown-seat-observed.json", { ...observation("seat_absent", seatAt), nativeRunId: workRun });
    await f.write("teardown-process-observed.json", { ...observation("process_absent", processAt), nativeRunId: workRun });
    const read = await readOrchidTeardownObservation(f.record, { ...expected, runId: workRun });
    assert.deepEqual(read, { cause: "teardown", seatObservedAt: "2026-01-01T00:00:02.123Z",
      processObservedAt: "2026-01-01T00:00:03.000Z" });
    // The dispatch key still binds the repository: a binding naming another one is withheld.
    await f.write("binding.json", { NativeSessionID: intent.nativeSessionId, Repo: "example/other", Host: expected.host,
      IssueID: issueId, BriefDigest: briefDigest });
    assert.equal(await readOrchidTeardownObservation(f.record, { ...expected, runId: workRun }), undefined);
    // A repository that is not an owner/name is withheld even when it hashes to the key.
    const odd = "not a repository";
    const oddKey = createHash("sha256").update(issueId + "\0" + odd + "\0" + briefDigest).digest("hex");
    await f.write("binding.json", { NativeSessionID: intent.nativeSessionId, Repo: odd, Host: expected.host,
      IssueID: issueId, BriefDigest: briefDigest });
    await f.write("teardown-intent.json", { ...intent, dispatchKey: oddKey, nativeRunId: "orchid-" + oddKey });
    assert.equal(await readOrchidTeardownObservation(f.record, { ...expected, runId: "orchid-" + oddKey }), undefined);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

it("withholds an unbound intent, an absent anchor, and malformed process proof", async () => {
  const f = await fixture();
  try {
    assert.equal(await readOrchidTeardownObservation(f.record, { ...expected, paneId: "other-pane" }), undefined);
    await f.write("teardown-process-observed.json", { ...observation("process_absent", processAt), nativeRunId: "orchid-" + "b".repeat(64) });
    assert.deepEqual(await readOrchidTeardownObservation(f.record, expected),
      { cause: "timeout", seatObservedAt: null, processObservedAt: null });
    await chmod(join(f.record, "teardown-anchor.json"), 0o644);
    assert.equal(await readOrchidTeardownObservation(f.record, expected), undefined);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
