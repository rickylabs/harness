import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { childEventKey, readClaudeChildStarts } from "./claude-child-events.js";

const now = "2026-01-01T00:01:00.000Z";
const rootSession = "fixture-root";
const child = "agent-fixture";
const hookChild = "fixture";
const row = (event: "SubagentStart" | "SubagentStop", at: string, extra: Record<string, unknown> = {}) =>
  ({ event, sessionId: rootSession, agentId: hookChild, observedAt: at, ...extra });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "claude-child-events-"));
  await chmod(root, 0o700);
  const file = join(root, `${createHash("sha256").update(rootSession).digest("hex")}.jsonl`);
  const put = async (...rows: readonly unknown[]) => { await writeFile(file, rows.map(value => JSON.stringify(value)).join("\n") + "\n", { mode: 0o600 }); await chmod(file, 0o600); };
  const read = () => readClaudeChildStarts(root, rootSession, [child], now);
  return { root, file, put, read };
}

it("accepts only a fresh exact-session, exact-child Start; Stop clears running but never ends", async () => {
  const s = await fixture();
  const start = "2026-01-01T00:00:30.000Z";
  await s.put(row("SubagentStart", start));
  assert.deepEqual([...await s.read()], [[childEventKey(rootSession, child), start]]);
  await s.put(row("SubagentStart", start), row("SubagentStop", "2026-01-01T00:00:45.000Z"));
  assert.equal((await s.read()).size, 0);
  await s.put(row("SubagentStart", start), row("SubagentStop", "2026-01-01T00:00:45.000Z"),
    row("SubagentStart", "2026-01-01T00:00:50.000Z"));
  assert.equal((await s.read()).size, 1); // Resume is a new observation.
});

it("rejects stale, future, wrong-session and malformed evidence; ignores an unrelated internal child", async () => {
  const s = await fixture();
  for (const bad of [row("SubagentStart", "2025-12-31T23:58:00.000Z"),
    row("SubagentStart", "2026-01-01T00:02:00.000Z"),
    row("SubagentStart", "2026-01-01T00:00:30.000Z", { sessionId: "wrong-root" }),
    row("SubagentStart", "2026-01-01T00:00:30.000Z", { extraText: "PRIVATE" })]) {
    await s.put(bad);
    assert.equal((await s.read()).size, 0);
  }
  await s.put(row("SubagentStart", "2026-01-01T00:00:30.000Z", { agentId: "internal-child" }));
  assert.equal((await s.read()).size, 0);
  await s.put(row("SubagentStart", "2026-01-01T00:00:30.000Z", { agentId: child }));
  assert.equal((await s.read()).size, 0); // Never match a double-prefixed hook ID.
  assert.equal((await readClaudeChildStarts(s.root, "wrong-root", [child], now)).size, 0);
});

it("fails closed for absent, symlinked, public, or oversized private evidence", async () => {
  const s = await fixture();
  assert.equal((await s.read()).size, 0);
  await s.put(row("SubagentStart", "2026-01-01T00:00:30.000Z"));
  await chmod(s.root, 0o755);
  assert.equal((await s.read()).size, 0);
  await chmod(s.root, 0o700);
  await chmod(s.file, 0o644);
  assert.equal((await s.read()).size, 0);
  await s.put(row("SubagentStart", "2026-01-01T00:00:30.000Z"));
  await writeFile(s.file, "x".repeat(1_048_577));
  assert.equal((await s.read()).size, 0);
  const target = join(s.root, "target.jsonl");
  await writeFile(target, JSON.stringify(row("SubagentStart", "2026-01-01T00:00:30.000Z")) + "\n", { mode: 0o600 });
  await rm(s.file);
  await symlink(target, s.file);
  assert.equal((await s.read()).size, 0);
  const link = join(await mkdtemp(join(tmpdir(), "child-link-")), "link");
  await symlink(s.root, link);
  assert.equal((await readClaudeChildStarts(link, rootSession, [child], now)).size, 0);
  assert.ok((await readdir(s.root)).length > 0);
});
