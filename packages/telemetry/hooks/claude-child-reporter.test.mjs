import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const reporter = join(here, "claude-child-reporter.mjs");
const wrapper = join(here, "claude-child-reporter.sh");
const session = "5dc200b1-b629-4b56-b487-6990b69ef498";
const filename = `${createHash("sha256").update(session).digest("hex")}.jsonl`;
const payload = (event = "SubagentStart", extra = {}) => ({
  hook_event_name: event, session_id: session, agent_id: "agent-abc123",
  prompt: "PRIVATE PROMPT", last_assistant_message: "PRIVATE RESPONSE",
  agent_transcript_path: "/private/transcript", ...extra,
});

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "child-hook-"));
  chmodSync(root, 0o700);
  try {
    const result = fn(root);
    if (result && typeof result.then === "function")
      return result.finally(() => rmSync(root, { recursive: true, force: true }));
    rmSync(root, { recursive: true, force: true });
    return result;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function run(root, event = "SubagentStart", body = payload(event)) {
  return spawnSync("node", [reporter, event], {
    input: typeof body === "string" ? body : JSON.stringify(body),
    env: { ...process.env, HARNESS_CLAUDE_CHILD_EVENT_ROOT: root }, timeout: 2200,
  });
}

test("writes only IDs, event, and timestamp in owner-only files; Stop has no decision output", () => withRoot((root) => {
  for (const event of ["SubagentStart", "SubagentStop"]) {
    const result = run(root, event);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
  }
  assert.deepEqual(readdirSync(root), [filename]);
  assert.equal(lstatSync(join(root, filename)).mode & 0o777, 0o600);
  const text = readFileSync(join(root, filename), "utf8");
  assert.doesNotMatch(text, /PRIVATE|transcript|prompt|response|\/private/);
  const rows = text.trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map(({ event }) => event), ["SubagentStart", "SubagentStop"]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ["event", "sessionId", "agentId", "observedAt"]);
    assert.equal(row.sessionId, session);
    assert.equal(row.agentId, "agent-abc123");
    assert.ok(Number.isFinite(Date.parse(row.observedAt)));
  }
}));

test("invalid, pathlike, mismatched and oversized payloads write nothing", () => withRoot((root) => {
  const cases = ["{", "x".repeat(65537), payload("SubagentStop"),
    payload("SubagentStart", { session_id: "../escape" }),
    payload("SubagentStart", { agent_id: "agent/path" }),
    payload("SubagentStart", { agent_id: "x".repeat(129) })];
  for (const body of cases) {
    assert.equal(run(root, "SubagentStart", body).status, 0);
  }
  assert.deepEqual(readdirSync(root), []);
}));

test("absent or unsafe storage fails closed, including symlink and wrong-mode file", () => withRoot((root) => {
  const noRoot = run("", "SubagentStart");
  assert.equal(noRoot.status, 0);
  assert.deepEqual(readdirSync(root), []);
  const link = `${root}-link`;
  symlinkSync(root, link);
  try { assert.equal(run(link).status, 0); } finally { rmSync(link); }
  chmodSync(root, 0o755);
  assert.equal(run(root).status, 0);
  assert.deepEqual(readdirSync(root), []);
  chmodSync(root, 0o700);
  writeFileSync(join(root, filename), "", { mode: 0o644 });
  chmodSync(join(root, filename), 0o644);
  assert.equal(run(root).status, 0);
  assert.equal(readFileSync(join(root, filename), "utf8"), "");
  rmSync(join(root, filename));
  symlinkSync(join(root, "target"), join(root, filename));
  assert.equal(run(root).status, 0);
  assert.equal(readdirSync(root).includes("target"), false);
}));

test("unrelated interactive sessions stay in separate files and repeated Start is observation only", () => withRoot((root) => {
  assert.equal(run(root).status, 0);
  assert.equal(run(root).status, 0);
  assert.equal(run(root, "SubagentStart", payload("SubagentStart", { session_id: "other-session" })).status, 0);
  assert.equal(readdirSync(root).length, 2);
  assert.equal(readFileSync(join(root, filename), "utf8").trim().split("\n").length, 2);
}));

test("wrapper exits zero without output before a hanging stdin can block Stop", async () => withRoot(async (root) => {
  const start = Date.now();
  const child = spawn("sh", [wrapper, "SubagentStop"], {
    env: { ...process.env, HARNESS_CLAUDE_CHILD_EVENT_ROOT: root }, stdio: ["pipe", "pipe", "pipe"],
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  const exit = await new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  child.stdin.end();
  assert.equal(exit, 0);
  assert.equal(Buffer.concat(chunks).length, 0);
  assert.ok(Date.now() - start < 2000, "hook wrapper must exit within two seconds");
  assert.deepEqual(readdirSync(root), []);
}));
