#!/usr/bin/env node
// Observation-only Claude hook. It never writes hook decisions or private hook payloads.
import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, openSync, readSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";

const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function input() {
  const chunks = [];
  let size = 0;
  for (;;) {
    const buffer = Buffer.allocUnsafe(8192);
    const count = readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    size += count;
    if (size > 65536) return null;
    chunks.push(buffer.subarray(0, count));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function record() {
  const event = process.argv[2];
  if (event !== "SubagentStart" && event !== "SubagentStop") return;
  const root = process.env.HARNESS_CLAUDE_CHILD_EVENT_ROOT;
  if (!root) return; // Shared interactive homes may have no dispatch reporter configured.
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() ||
      (directory.mode & 0o777) !== 0o700) return;
  const payload = input();
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.hook_event_name !== event || !id(payload.session_id) || !id(payload.agent_id)) return;
  const name = `${createHash("sha256").update(payload.session_id).digest("hex")}.jsonl`;
  const fd = openSync(join(root, name), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.getuid() || file.nlink !== 1 ||
        (file.mode & 0o777) !== 0o600 || file.size > 1048576) return;
    const line = JSON.stringify({ event, sessionId: payload.session_id, agentId: payload.agent_id,
      observedAt: new Date().toISOString() }) + "\n";
    if (file.size + Buffer.byteLength(line) > 1048576) return;
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

try { record(); } catch { /* Hooks must not interrupt a Claude turn or reveal payloads in logs. */ }
