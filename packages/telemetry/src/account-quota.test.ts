import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { codexAccountQuota, opaqueUsageRef, pollCodexAccountQuota } from "./account-quota.js";
const key = Buffer.alloc(32, 7), at = "2026-01-02T12:00:00.000Z";
test("opaque refs are stable, domain-separated and reveal no native identity", () => {
  const id = "PRIVATE_CANARY";
  const first = opaqueUsageRef("sref", "codex", id, key);
  assert.match(first, /^sref:v1:codex:[A-Za-z0-9_-]{43}$/);
  assert.equal(first, opaqueUsageRef("sref", "codex", id, key));
  assert.notEqual(first, opaqueUsageRef("sref", "claude", id, key));
  assert.notEqual(first.split(":").pop(), opaqueUsageRef("aref", "codex", id, key).split(":").pop());
  assert.notEqual(first, opaqueUsageRef("sref", "codex", id, Buffer.alloc(32, 8)));
  assert.ok(!first.includes(id));
  assert.throws(() => opaqueUsageRef("sref", "codex", id, Buffer.alloc(31)));
});
test("maps both exact quota windows without blending distinct meters or inventing unknowns", () => {
  const bucket = (limitId: string, usedPercent: unknown) => ({ limitId,
    primary: { usedPercent, windowDurationMins: 300, resetsAt: 1767441600 },
    secondary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 1767441600 } });
  const rows = codexAccountQuota({ accountId: "fake-account", rateLimitsByLimitId: { a: bucket("meter-a", 12), b: bucket("meter-b", 27) } }, at, key);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => [r.limitId, r.window, r.usedPercent]), [["meter-a", "5h", 12], ["meter-a", "weekly", 9], ["meter-b", "5h", 27], ["meter-b", "weekly", 9]]);
  assert.ok(rows.every(r => r.accountRef?.startsWith("aref:v1:codex:")));
  const unknown = codexAccountQuota({ rateLimits: bucket("meter-a", 101) }, at, key)[0]!;
  assert.equal(unknown.usedPercent, null); assert.equal(unknown.accountRef, null); assert.equal(unknown.availability, "partial");
  assert.ok(codexAccountQuota({}, at, key).every(r => r.usedPercent === null && r.availability === "unavailable"));
});
function child(onRequest: (r: Record<string, unknown>, stdout: PassThrough) => void): ChildProcessWithoutNullStreams {
  const c = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  Object.assign(c, { stdin, stdout, stderr, kill: () => { queueMicrotask(() => c.emit("close", 0)); return true; } });
  stdin.on("data", data => { for (const line of String(data).trim().split("\n")) onRequest(JSON.parse(line) as Record<string, unknown>, stdout); });
  return c;
}
test("native transport permits only initialization and account reads; ignores notifications", async () => {
  const methods: unknown[] = [];
  let args: readonly string[] = [];
  const result = await pollCodexAccountQuota({ bin: "fake-bin", spawn: (_bin, argv) => {
    args = argv;
    return child((r, stdout) => {
      methods.push(r["method"]);
      if (r["method"] === "initialized") return;
      queueMicrotask(() => { stdout.write(`${JSON.stringify({ method: "notice", params: {} })}\n`);
        stdout.write(`${JSON.stringify({ id: r["id"], result: r["id"] === 3 ? { rateLimits: {} } : {} })}\n`); });
      if (r["method"] === "account/rateLimits/read") assert.deepEqual(r["params"], { excludeResetCreditDetails: true });
      if (r["method"] === "account/read") assert.deepEqual(r["params"], { refreshToken: false });
    });
  } });
  assert.deepEqual(args, ["app-server", "--listen", "stdio://"]);
  assert.deepEqual(methods, ["initialize", "initialized", "account/read", "account/rateLimits/read"]);
  assert.equal(result.ok, true);
});
test("timeout, byte cap, invalid JSON and remote errors return content-free failure codes", async () => {
  for (const [mode, reason] of [["timeout", "timeout"], ["oversize", "oversize"], ["invalid", "shape-mismatch"], ["remote", "request-failed"]]) {
    const result = await pollCodexAccountQuota({ bin: "fake-bin", timeoutMs: 10, maxBytes: 256, spawn: () => child((r, stdout) => {
      queueMicrotask(() => {
        if (mode === "oversize") stdout.write("PRIVATE_CANARY".repeat(100));
        if (mode === "invalid") stdout.write("PRIVATE_CANARY\n");
        if (mode === "remote") stdout.write(`${JSON.stringify({ id: r["id"], error: { message: "PRIVATE_CANARY" } })}\n`);
      });
    }) });
    assert.deepEqual(result, { ok: false, reason });
  }
});
