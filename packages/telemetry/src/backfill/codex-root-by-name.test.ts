/**
 * The dispatched Codex root is found by its rollout name on a busy host. Every `FileHandle.read`
 * on a rollout is counted before the modules load, so the bounds below rest on actual IO: the root
 * is read without reading its neighbours, descendants are read newest first up to a fixed number
 * of heads, and a bound reached on descendants makes the tree partial, never refused.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { it } from "node:test";

type FilePromises = typeof import("node:fs/promises");
const fsp = createRequire(import.meta.url)("node:fs/promises") as FilePromises;
let reads = 0;
const opened: string[] = [];
const open = fsp.open;
(fsp as { open: FilePromises["open"] }).open = (async (...args: Parameters<FilePromises["open"]>) => {
  const handle = await open(...args);
  if (basename(String(args[0])).endsWith(".jsonl")) {
    opened.push(basename(String(args[0])));
    const read = handle.read.bind(handle) as (...a: unknown[]) => Promise<{ bytesRead: number }>;
    (handle as { read: unknown }).read = async (...a: unknown[]) => {
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

const HEADS = 128, HEAD_BYTES = 65_536, MAX = 8_388_608, FRAME = 33_554_432;
const ROOT_AT = Date.parse("2026-10-05T12:00:00.000Z");
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const iso = (ms: number) => new Date(ms).toISOString();
const meta = (session: string, parent: string | null = null, depth = 1) => JSON.stringify({ timestamp: iso(ROOT_AT),
  type: "session_meta", payload: { id: session, cwd: "/fixture", model_provider: "fixture",
    ...(parent ? { source: { subagent: { thread_spawn: { parent_thread_id: parent, depth } } } } : {}) } }) + "\n";
const ROOT = id(1);

async function fixture(fn: (f: {
  /** A rollout named for `session`, created `offsetMs` after the root's name clock. */
  put: (session: string, offsetMs: number, text?: string) => Promise<string>;
  scan: (options?: { limit?: number; maxTotalBytes?: number }) => ReturnType<typeof backfillFromDisk>;
  feed: (partialTrees?: boolean) => ReturnType<typeof collectIssueAgentTree>;
}) => Promise<void>) {
  const home = await fsp.mkdtemp(join(tmpdir(), "codex-root-by-name-"));
  const store = join(home, ".codex", "sessions"), receipts = join(home, "receipts");
  const issueId = "fixture-600", brief = "a".repeat(64), repo = "example/project";
  const key = createHash("sha256").update(`${issueId}\0${repo}\0${brief}`).digest("hex");
  const record = join(receipts, key, "record");
  await fsp.mkdir(record, { recursive: true, mode: 0o700 });
  await fsp.writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: `orchid-${key}`,
    issue: { repo, number: 600 }, parentRunId: null, source: "codex", provider: "fixture", model: "fixture-model", effort: "high",
    state: "dispatched", observedAt: iso(ROOT_AT), location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
  await fsp.writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo, BriefDigest: brief,
    Route: { transport: "codex", provider: "fixture", model: "fixture-model", effort: "high" }, NativeSessionID: ROOT }), { mode: 0o600 });
  // The scan reads as of an hour after the root started.
  const now = ROOT_AT + 3_600_000;
  try {
    await fn({
      put: async (session, offsetMs, text = meta(session)) => {
        const stamp = iso(ROOT_AT + offsetMs);
        const day = join(store, stamp.slice(0, 4), stamp.slice(5, 7), stamp.slice(8, 10));
        await fsp.mkdir(day, { recursive: true });
        const path = join(day, `rollout-${stamp.slice(0, 19).replaceAll(":", "-")}-${session}.jsonl`);
        await fsp.writeFile(path, text);
        return path;
      },
      scan: (options = {}) => {
        reads = 0; opened.length = 0;
        return backfillFromDisk({ codexSessions: store }, { limit: options.limit ?? 20,
          codexWindows: [{ startMs: ROOT_AT - 600_000, endMs: now }],
          maxTranscriptBytes: MAX, maxTotalBytes: options.maxTotalBytes ?? FRAME, notAfterMs: now,
          codexRootMatches: candidate => candidate === ROOT });
      },
      feed: (partialTrees = false) => {
        reads = 0; opened.length = 0;
        return collectIssueAgentTree({ home, env: { [ORCHID_DISPATCH_ROOT]: receipts }, limit: 20, now: iso(now),
          ...(partialTrees ? { partialTrees } : {}) });
      },
    });
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
}

const agents = (frame: Awaited<ReturnType<typeof collectIssueAgentTree>>) =>
  frame.issues[0]?.dispatches.flatMap(dispatch => dispatch.agents) ?? [];

it("finds the root by its rollout name past more than 128 Codex sessions in the window", () => fixture(async ({ put, scan, feed }) => {
  // A busy host: 200 unrelated sessions in the window's day envelope, all created hours before
  // the root. The root is never looked for among them, and none of them can descend from it.
  for (let i = 0; i < 200; i++) await put(id(1_000 + i), -5 * 3_600_000 + i * 1_000);
  await put(ROOT, 0);
  await put(id(2), 60_000, meta(id(2), ROOT));
  const result = await scan();
  assert.equal(result.degraded, false, result.notes.join("\n"));
  assert.deepEqual(result.partial, []);
  assert.deepEqual(result.runs.map(run => run.id).sort(), [ROOT, id(2)]);
  // Only the root and its one candidate descendant were opened: no neighbour head was read.
  assert.deepEqual(opened.filter(name => !name.includes(ROOT) && !name.includes(id(2))), []);
  assert.equal(result.bytesRead, reads, "every byte read is charged");
  const frame = await feed();
  assert.equal(frame.complete, true);
  assert.equal(frame.issues[0]?.complete, true);
  assert.equal(agents(frame).filter(agent => agent.observation.parentAgentId.state === "confirmed-root").length, 1);
  assert.equal(agents(frame).length, 2);
}));

it("reads only the 128 newest descendant heads and reports a descendant beyond them as partial", () => fixture(async ({ put, scan, feed }) => {
  await put(ROOT, 0);
  // The descendant is older than 128 newer unrelated sessions created after the root.
  await put(id(2), 1_000, meta(id(2), ROOT));
  for (let i = 0; i < HEADS; i++) await put(id(1_000 + i), 10_000 + i * 1_000);
  const result = await scan();
  assert.equal(result.degraded, false, result.notes.join("\n"));
  assert.deepEqual(result.partial, ["descendant_heads_bound"]);
  assert.match(result.notes.join("\n"), /codex: tree partial \(descendant_heads_bound\)/);
  assert.deepEqual(result.runs.map(run => run.id), [ROOT], "the root is kept, the unread descendant is not invented");
  assert.equal(opened.some(name => name.includes(id(2))), false, "the descendant beyond the bound is not opened");
  // One root head plus 128 candidate heads, then the root's transcript: never more heads.
  assert.equal(opened.length, 1 + HEADS + 1);
  assert.ok(reads <= (1 + HEADS) * (HEAD_BYTES + 1) + MAX);
  assert.equal(result.bytesRead, reads, "every byte read is charged");
  // Published to a 0.37 reader: the issue is scan_limit and keeps its root.
  const partial = await feed(true);
  assert.equal(partial.complete, false);
  assert.equal(partial.reason, "scan_limit");
  assert.equal(partial.issues[0]?.complete, false);
  assert.equal(partial.issues[0]?.reason, "scan_limit");
  assert.deepEqual(agents(partial).map(agent => agent.observation.parentAgentId.state), ["confirmed-root"]);
  // Without the opt-in the wire stays readable by older readers: scan_limit and no agents.
  const legacy = await feed();
  assert.equal(legacy.issues[0]?.complete, false);
  assert.equal(legacy.issues[0]?.reason, "scan_limit");
  assert.deepEqual(legacy.issues[0]?.dispatches, []);
}));

it("never matches the root by a file named for another session", () => fixture(async ({ put, scan }) => {
  // Its head claims the root's id; the name says another session. It is not the root, and the
  // disagreement makes it unreadable as a candidate rather than a second root.
  await put(id(3), 5_000, meta(ROOT));
  const missing = await scan();
  assert.deepEqual(missing.runs, [], "no file is named for the root: nothing is the root");
  assert.equal(missing.degraded, false);
  assert.equal(opened.length, 0, "with no root by name, no head is read at all");
  await put(ROOT, 0);
  const result = await scan();
  assert.equal(result.degraded, false, result.notes.join("\n"));
  assert.deepEqual(result.runs.map(run => run.id), [ROOT]);
  assert.deepEqual(result.partial, ["descendant_head_unreadable"]);
  // A name and a head that disagree are never linked, whatever parent the head claims.
  await put(id(6), 6_000, meta(id(5), ROOT));
  const disagreeing = await scan();
  assert.deepEqual(disagreeing.runs.map(run => run.id), [ROOT]);
  assert.deepEqual(disagreeing.partial, ["descendant_head_unreadable"]);
}));

it("refuses a file named for the root whose head is another session", () => fixture(async ({ put, scan }) => {
  await put(ROOT, 0, meta(id(4)));
  const result = await scan();
  assert.equal(result.degraded, true);
  assert.deepEqual(result.runs, []);
  assert.match(result.notes.join("\n"), /candidate head could not be read/);
}));

it("bounds descendants by the root's name clock, with a named margin for a clock set back", () => fixture(async ({ put, scan }) => {
  await put(ROOT, 0);
  // 90 minutes earlier by name (a DST change on the writer's clock) is still a candidate.
  await put(id(2), -90 * 60_000, meta(id(2), ROOT));
  // Three hours earlier by name cannot be the root's child and is never read.
  await put(id(3), -3 * 3_600_000, meta(id(3), ROOT));
  const result = await scan();
  assert.equal(result.degraded, false, result.notes.join("\n"));
  assert.deepEqual(result.runs.map(run => run.id).sort(), [ROOT, id(2)]);
  assert.equal(opened.some(name => name.includes(id(3))), false);
}));

it("keeps parents before children when the tree holds more transcripts than the scan limit", () => fixture(async ({ put, scan }) => {
  await put(ROOT, 0);
  await put(id(2), 1_000, meta(id(2), ROOT));
  // The grandchildren are newer than every child but come after them: a kept node's parent is kept.
  for (let i = 0; i < 4; i++) await put(id(10 + i), 100_000 + i * 1_000, meta(id(10 + i), id(2), 2));
  for (let i = 0; i < 3; i++) await put(id(20 + i), 2_000 + i * 1_000, meta(id(20 + i), ROOT));
  const result = await scan({ limit: 5 });
  assert.equal(result.degraded, false, result.notes.join("\n"));
  assert.deepEqual(result.partial, ["selected_files_bound"]);
  const ids = new Set(result.runs.map(run => run.id));
  assert.equal(ids.size, 5);
  assert.ok(ids.has(ROOT));
  for (const run of result.runs) assert.ok(run.parentId === null || ids.has(run.parentId), "a closed tree");
  // Children first (newest first), so no grandchild fits.
  assert.deepEqual([...ids].sort(), [ROOT, id(2), id(20), id(21), id(22)].sort());
}));

it("stops reading descendant heads at the frame budget and says so", () => fixture(async ({ put, scan }) => {
  await put(ROOT, 0);
  for (let i = 0; i < 4; i++) await put(id(1_000 + i), 10_000 + i * 1_000);
  // A head is attempted only while a whole head still fits: room for the root's and one more.
  const size = (text: string) => Buffer.byteLength(text);
  const result = await scan({ maxTotalBytes: HEAD_BYTES + 1 + size(meta(ROOT)) + size(meta(id(1_000))) - 1 });
  assert.equal(result.partial.includes("descendant_heads_budget"), true, result.notes.join("\n"));
  assert.equal(opened.filter(name => !name.includes(ROOT)).length, 1);
  assert.equal(result.bytesRead, reads);
}));

it("treats two descendant files under one session id as unreadable, never as the tree", () => fixture(async ({ put, scan }) => {
  await put(ROOT, 0);
  await put(id(2), 1_000, meta(id(2), ROOT));
  await put(id(2), 2_000, meta(id(2), ROOT));
  const result = await scan();
  assert.equal(result.degraded, false, result.notes.join("\n"));
  assert.deepEqual(result.runs.map(run => run.id), [ROOT]);
  assert.deepEqual(result.partial, ["descendant_head_unreadable"]);
}));
