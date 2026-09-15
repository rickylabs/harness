/** Opt-in read-only live probe plus an explicitly isolated assignment control.
 * The real stores are never modified. The temporary control is 0700/0600, outside Git,
 * removed in finally, and never emitted. Only this probe's closed summaries leave memory.
 */
import { readdir, open, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { defaultRoots } from "../packages/telemetry/dist/backfill/index.js";
import { parseCodexRollout } from "../packages/telemetry/dist/backfill/codex.js";
import { readOrchidDispatches } from "../packages/telemetry/dist/orchid-dispatch.js";
import { buildAgentObservations } from "../packages/telemetry/dist/agent-observations.js";
import { readAgentObservations } from "../packages/contracts/dist/index.js";
const emit = value => console.log(JSON.stringify(value));
const sha = value => createHash("sha256").update(value).digest("hex");
let scratch;
try {
  if (!process.argv.includes("--live")) throw new Error("live_opt_in_required");
  const root = defaultRoots(process.env.DSH_TELEMETRY_NATIVE_HOME ?? homedir()).codexSessions;
  const candidates = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (candidates.length === 512) return;
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) candidates.push(join(dir, entry.name));
    }
  }
  await walk(root);
  const runs = new Map(); let headers = 0, pair;
  for (const file of candidates) {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const bytes = Buffer.alloc(65_536);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const text = bytes.subarray(0, bytesRead).toString("utf8");
      const newline = text.indexOf("\n");
      if (newline < 0) continue;
      const first = text.slice(0, newline);
      if (JSON.parse(first).type !== "session_meta") continue;
      const run = parseCodexRollout(first + "\n", file).run;
      if (!run) continue;
      headers++; runs.set(run.id, run);
      const child = [...runs.values()].find(r => r.parentId !== null && runs.get(r.parentId)?.parentId === null);
      if (child) { pair = [runs.get(child.parentId), child]; break; }
    } catch { /* Header failures do not license absence claims. */ }
    finally { await handle?.close(); }
  }
  if (!pair) { emit({ verdict: "INCONCLUSIVE", reason: "native_pair_not_in_bounded_sample", headers, limit: 512 }); process.exitCode = 2; }
  else {
    // This proves reader -> native parent mapping -> exported decoder on a REAL pair.
    // It does NOT claim the pair belongs to any live issue: the assignment below is synthetic.
    scratch = await mkdtemp(join(tmpdir(), "orchid-pair-control-"));
    const binding = { IssueID: "fixture-issue", Repo: "example/target", BriefDigest: "b".repeat(64),
      Route: { transport: "codex", provider: "fixture-router", model: "fixture-model", effort: "high" },
      NativeSessionID: pair[0].id };
    const key = sha(binding.IssueID + "\0" + binding.Repo + "\0" + binding.BriefDigest);
    const record = join(scratch, key, "record");
    await mkdir(record, { recursive: true, mode: 0o700 });
    const dispatch = { schemaVersion: 1, runId: "orchid-" + key, issue: { repo: "example/inbox", number: 42 },
      parentRunId: null, source: "codex", provider: "fixture-router", model: "fixture-model", effort: "high",
      profile: "leaf", state: "dispatched", location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } };
    await writeFile(join(record, "dispatch.json"), JSON.stringify(dispatch), { mode: 0o600 });
    const bindingFile = join(record, "binding.json");
    await writeFile(bindingFile, JSON.stringify(binding), { mode: 0o600 });
    const project = async () => {
      const read = await readOrchidDispatches(scratch);
      return buildAgentObservations({ dispatches: read.dispatches, runs: pair, observedAt: new Date().toISOString(),
        sourceBound: true, dispatchComplete: !read.degraded, nativeComplete: true });
    };
    const positive = await project();
    const decoded = readAgentObservations(positive);
    const parent = positive.agents.find(row => row.parentAgentId.state === "confirmed-root");
    const child = positive.agents.find(row => row.parentAgentId.state === "known-parent");
    if (!decoded.ok || !positive.complete || positive.agents.length !== 2 || !parent || !child || child.parentAgentId.value !== parent.agentId)
      throw new Error("pair_control_failed");
    if (pair.some(run => JSON.stringify(positive).includes(run.id))) throw new Error("public_identity_leak");
    const controls = [];
    for (const kind of ["absent", "mismatched"]) {
      if (kind === "absent") await rm(bindingFile);
      else await writeFile(bindingFile, JSON.stringify({ ...binding, NativeSessionID: "fixture-unmatched" }), { mode: 0o600 });
      const result = await project();
      if (!readAgentObservations(result).ok || result.complete || result.agents.length !== 1 || result.reason !== "ancestry_unavailable")
        throw new Error("negative_control_failed");
      controls.push({ kind, rows: 1, complete: false, reason: result.reason });
    }
    emit({ verdict: "PASS", scope: "real-native-pair-with-isolated-synthetic-assignment", headers, limit: 512,
      liveIssueAssignmentProven: false, dataset: "selected-pair-only", decoded: true, complete: true, rows: 2, depth: 1, controls });
    const live = await readOrchidDispatches(process.env.DSH_TELEMETRY_DISPATCH_ROOT);
    const observations = buildAgentObservations({ dispatches: live.dispatches, runs: pair, observedAt: new Date().toISOString(),
      sourceBound: live.root !== undefined, dispatchComplete: !live.degraded, nativeComplete: false });
    emit({ verdict: "INCONCLUSIVE", scope: "live-issue-ancestry", reason: observations.reason,
      receiptScanComplete: !live.degraded, dispatches: live.dispatches.length, rows: observations.agents.length,
      complete: observations.complete, decoded: readAgentObservations(observations).ok });
  }
} catch {
  emit({ verdict: "INCONCLUSIVE", reason: "probe_failed" }); process.exitCode = 2;
} finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
