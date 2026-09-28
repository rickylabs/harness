import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readActionReceipt, readActionReceipts } from "./action-receipt-cli.js";
import { ORCHID_DISPATCH_ROOT } from "./orchid-dispatch.js";

const operationId = "123e4567-e89b-42d3-a456-426614174000";
const digest = "a".repeat(64), conflictDigest = "b".repeat(64);
const agentId = `agent_${"c".repeat(64)}`, dispatchId = `assignment_${"d".repeat(64)}`;
const at = "2026-09-28T10:00:00Z";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "action-receipt-fixture-"));
  const actions = join(root, "actions"), operation = join(actions, operationId);
  await mkdir(actions, { mode: 0o700 }); await mkdir(operation, { mode: 0o700 });
  await writeFile(join(operation, "intent.json"), JSON.stringify({ requestDigest: digest }), { mode: 0o600 });
  return { root, operation };
}
const accepted = () => ({ schemaVersion: 1, operationId, requestDigest: digest, repository: "fixture/project", issueNumber: 7,
  agentId, dispatchId, action: "steer", outcome: "accepted", reason: "prompt_delivered", observedAt: at,
  nativeRunId: "PRIVATE-RUN-CANARY", nativeSessionId: "PRIVATE-SESSION-CANARY", host: "PRIVATE-HOST-CANARY",
  paneId: "PRIVATE-PANE-CANARY", workspaceId: "PRIVATE-WORKSPACE-CANARY", idempotencyKey: "PRIVATE-KEY-CANARY" });

it("projects only bounded public delivery fields from one private operation", async () => {
  const { root, operation } = await fixture();
  await writeFile(join(operation, "result.json"), JSON.stringify(accepted()), { mode: 0o600 });
  const result = await readActionReceipt(root, operationId, digest);
  assert.equal(result.outcome, "accepted"); assert.equal(result.reason, "prompt_delivered");
  assert.equal(result.repository, "fixture/project"); assert.equal(result.issueNumber, 7);
  assert.equal(result.agentId, agentId); assert.equal(result.dispatchId, dispatchId);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-"));
  const cli = spawnSync(process.execPath, [join(import.meta.dirname, "cli.js"), "action-receipt", "--json", "--operation", operationId, "--digest", digest],
    { env: { ...process.env, [ORCHID_DISPATCH_ROOT]: root }, encoding: "utf8" });
  assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).outcome, "accepted");
  assert.ok(!cli.stdout.includes("PRIVATE-")); assert.ok(!cli.stdout.includes(root));
});

it("returns the conflicting digest rejection without replacing the primary result", async () => {
  const { root, operation } = await fixture();
  await writeFile(join(operation, "result.json"), JSON.stringify(accepted()), { mode: 0o600 });
  await writeFile(join(operation, `conflict-${conflictDigest}.json`), JSON.stringify({ schemaVersion: 1,
    operationId, requestDigest: conflictDigest, outcome: "rejected", reason: "digest_conflict", observedAt: at,
    nativeSessionId: "PRIVATE-SESSION-CANARY" }), { mode: 0o600 });
  assert.equal((await readActionReceipt(root, operationId, conflictDigest)).reason, "digest_conflict");
  assert.equal((await readActionReceipt(root, operationId, digest)).reason, "prompt_delivered");
});

it("withholds missing, malformed and symlinked evidence as unknown without leaking a path", async () => {
  const { root, operation } = await fixture();
  assert.equal((await readActionReceipt(root, operationId)).reason, "receipt_missing");
  await writeFile(join(operation, "result.json"), "{PRIVATE-BAD-JSON-CANARY", { mode: 0o600 });
  assert.equal((await readActionReceipt(root, operationId)).reason, "receipt_invalid");
  const other = join(root, "other.json");
  await writeFile(other, JSON.stringify(accepted()), { mode: 0o600 });
  const linked = await mkdtemp(join(tmpdir(), "action-symlink-fixture-"));
  await mkdir(join(linked, "actions"), { mode: 0o700 });
  await symlink(operation, join(linked, "actions", operationId));
  const result = await readActionReceipt(linked, operationId);
  assert.equal(result.outcome, "unknown"); assert.ok(!JSON.stringify(result).includes(root));
  const cli = spawnSync(process.execPath, [join(import.meta.dirname, "cli.js"), "action-receipt", "--json", "--operation", operationId],
    { env: { ...process.env, [ORCHID_DISPATCH_ROOT]: root }, encoding: "utf8" });
  assert.equal(cli.status, 3); assert.equal(JSON.parse(cli.stdout).reason, "receipt_invalid");
  assert.ok(!cli.stdout.includes("PRIVATE-") && !cli.stderr.includes(root));
  assert.ok((await readFile(other, "utf8")).includes("PRIVATE-"));
});

it("requires a scoped UUID and optional digest on the CLI", () => {
  const cli = spawnSync(process.execPath, [join(import.meta.dirname, "cli.js"), "action-receipt", "--json", "--operation", "../bad"],
    { encoding: "utf8" });
  assert.equal(cli.status, 2); assert.equal(cli.stdout, "");
  assert.equal(cli.stderr, "action-receipt: invalid command line\n");
});
it("enumerates only a complete bounded private receipt spool", async () => {
  const { root, operation } = await fixture();
  await writeFile(join(operation, "result.json"), JSON.stringify(accepted()), { mode: 0o600 });
  const complete = await readActionReceipts(root);
  assert.equal(complete.complete, true);
  assert.equal(complete.receipts.length, 1);
  assert.equal(complete.receipts[0]?.outcome, "accepted");
  assert.ok(!JSON.stringify(complete).includes("PRIVATE-"));
  const pending = join(root, "actions", "323e4567-e89b-42d3-a456-426614174000");
  await mkdir(pending, { mode: 0o700 });
  const partial = await readActionReceipts(root);
  assert.equal(partial.complete, false);
  assert.equal(partial.receipts.length, 1); // One in-progress operation cannot blank older proof.
  const linked = join(root, "actions", "223e4567-e89b-42d3-a456-426614174000");
  await symlink(operation, linked);
  const unsafe = await readActionReceipts(root);
  assert.equal(unsafe.complete, false);
  assert.deepEqual(unsafe.receipts, []);
});
