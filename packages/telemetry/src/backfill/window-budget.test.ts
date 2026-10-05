/**
 * Head and tail windows against the real file reads. Every `FileHandle.read` on a rollout is
 * counted before the modules load, so the claims below rest on actual IO, never on a returned
 * counter: every byte read is charged to the frame budget, and a tail that starts on a record
 * boundary or ends without a newline keeps its complete records.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { appendFileSync } from "node:fs";
import { basename, join } from "node:path";
import { it } from "node:test";

type FilePromises = typeof import("node:fs/promises");
const fsp = createRequire(import.meta.url)("node:fs/promises") as FilePromises;
let reads = 0;
/** Runs before each rollout read with its requested length; a test can append to the file here. */
let beforeRead: ((length: number) => void) | null = null;
const open = fsp.open;
(fsp as { open: FilePromises["open"] }).open = (async (...args: Parameters<FilePromises["open"]>) => {
  const handle = await open(...args);
  if (basename(String(args[0])).endsWith(".jsonl")) {
    const read = handle.read.bind(handle) as (...a: unknown[]) => Promise<{ bytesRead: number }>;
    (handle as { read: unknown }).read = async (...a: unknown[]) => {
      beforeRead?.(Number(a[2]));
      const result = await read(...a);
      reads += result.bytesRead;
      return result;
    };
  }
  return handle;
}) as FilePromises["open"];
syncBuiltinESMExports();
const { backfillFromDisk } = await import("./index.js");
const { collectIssueAgentTree } = await import("../issue-agent-feed-cli.js");
const { ORCHID_DISPATCH_ROOT } = await import("../orchid-dispatch.js");

const TAIL = 2_097_152, MAX = 8_388_608, FRAME = 33_554_432;
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.parse("2026-10-05T12:00:00.000Z") + n * 1000).toISOString();
const line = (n: number, type: string, payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: at(n), type, payload }) + "\n";
const event = (n: number, type: string, extra: Record<string, unknown> = {}) => line(n, "event_msg", { type, ...extra });
const tokens = (n: number) => event(n, "token_count", { info: { total_token_usage: { input_tokens: 1_234, output_tokens: 56 } } });
const filler = (n: number, bytes: number) => line(n, "response_item", { type: "fixture", text: "x".repeat(bytes) });
const meta = (session: string, parent: string | null = null) => line(0, "session_meta", { id: session, cwd: "/fixture",
  model_provider: "fixture", ...(parent ? { source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } } } : {}) });

async function fixture(fn: (f: {
  put: (session: string, text: string) => Promise<string>;
  scan: () => ReturnType<typeof backfillFromDisk>;
  feed: () => ReturnType<typeof collectIssueAgentTree>;
}) => Promise<void>) {
  const home = await fsp.mkdtemp(join(tmpdir(), "window-budget-"));
  const store = join(home, ".codex", "sessions"), day = join(store, "2026", "10", "05"), receipts = join(home, "receipts");
  await fsp.mkdir(day, { recursive: true });
  const issueId = "fixture-605", brief = "a".repeat(64), repo = "example/project";
  const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
  const record = join(receipts, key, "record");
  await fsp.mkdir(record, { recursive: true, mode: 0o700 });
  await fsp.writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: `orchid-${key}`,
    issue: { repo, number: 605 }, parentRunId: null, source: "codex", provider: "fixture", model: "fixture-model", effort: "high",
    state: "dispatched", observedAt: at(-60), location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
  await fsp.writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo, BriefDigest: brief,
    Route: { transport: "codex", provider: "fixture", model: "fixture-model", effort: "high" }, NativeSessionID: id(1) }), { mode: 0o600 });
  try {
    await fn({
      put: async (session, text) => {
        const path = join(day, `rollout-2026-10-05T12-00-00-${session}.jsonl`);
        await fsp.writeFile(path, text);
        return path;
      },
      scan: () => {
        reads = 0;
        return backfillFromDisk({ codexSessions: store }, { limit: 20,
          codexWindows: [{ startMs: Date.parse(at(-600)), endMs: Date.parse(at(120)) }],
          maxTranscriptBytes: MAX, maxTotalBytes: FRAME, notAfterMs: Date.parse(at(120)),
          codexRootMatches: candidate => candidate === id(1) });
      },
      feed: () => {
        reads = 0;
        return collectIssueAgentTree({ home, env: { [ORCHID_DISPATCH_ROOT]: receipts }, limit: 20, now: at(120) });
      },
    });
  } finally {
    beforeRead = null;
    await fsp.rm(home, { recursive: true, force: true });
  }
}

it("charges every byte a refused window read to the frame budget, and reads no more than it", () => fixture(async ({ put, scan }) => {
  // A valid final record without a newline, longer than the tail window: no window is usable.
  for (let i = 1; i <= 20; i++) {
    await put(id(i), meta(id(i), i === 1 ? null : id(1)) + filler(5, 6_500_000) + filler(105, 3_000_000).trimEnd());
  }
  const result = await scan();
  assert.ok(reads <= FRAME, `actual reads ${reads} exceeded the frame budget ${FRAME}`);
  assert.equal(result.bytesRead, reads, "every byte read is charged");
}));

it("keeps a complete first tail record when the tail starts exactly on a record boundary", () => fixture(async ({ put, scan, feed }) => {
  const token = tokens(104), padding = filler(105, 1);
  const tail = token + filler(105, TAIL - Buffer.byteLength(token) - Buffer.byteLength(padding) + 1);
  assert.equal(Buffer.byteLength(tail), TAIL);
  const text = meta(id(1)) + filler(5, 9_000_000) + tail;
  assert.equal(Buffer.from(text)[Buffer.byteLength(text) - TAIL - 1], 10, "the byte before the tail is a newline");
  await put(id(1), text);
  const result = await scan();
  assert.equal(result.degraded, false);
  assert.deepEqual(result.runs[0]?.usage, { inputTokens: 1_234, outputTokens: 56 });
  const frame = await feed();
  assert.equal(frame.issues[0]?.dispatches[0]?.agents[0]?.tokenUsage?.usedTokens, 1_290);
}));

it("keeps a complete final record without a trailing newline that exactly fills the tail", () => fixture(async ({ put, scan, feed }) => {
  const ending = event(105, "task_complete", { padding: "" }).trimEnd();
  const final = event(105, "task_complete", { padding: "x".repeat(TAIL - Buffer.byteLength(ending)) }).trimEnd();
  assert.equal(Buffer.byteLength(final), TAIL);
  await put(id(1), meta(id(1)) + filler(5, 9_000_000) + final);
  const result = await scan();
  assert.equal(result.degraded, false);
  assert.equal(result.runs[0]?.outcome, "complete");
  const frame = await feed();
  assert.equal(frame.issues[0]?.dispatches[0]?.agents[0]?.terminalOutcome.value, "succeeded");
}));

it("a transcript that grows while it is read never spends more than its per-transcript bound", () => fixture(async ({ put, scan }) => {
  const prefix = meta(id(1)) + event(2, "task_complete");
  const text = prefix + filler(5, MAX - Buffer.byteLength(prefix) - Buffer.byteLength(filler(5, 0)) - 100);
  assert.equal(Buffer.byteLength(text), MAX - 100);
  const path = await put(id(1), text);
  let grew = false;
  const identityProbe = 512;
  beforeRead = length => {
    // A live writer appends after the reader measured the file, on its first full read.
    if (!grew && length > identityProbe) {
      grew = true;
      appendFileSync(path, tokens(104) + event(105, "agent_message", { message: "late fixture activity" }));
    }
  };
  const result = await scan();
  assert.equal(grew, true, "the file grew during the read");
  assert.ok(reads - identityProbe <= MAX + 1, `one transcript spent ${reads - identityProbe} bytes`);
  assert.equal(result.bytesRead, reads);
  // The read keeps the records the file held when it was opened.
  assert.equal(result.runs[0]?.outcome, "complete");
}));
