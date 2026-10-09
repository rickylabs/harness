/** agy descriptors through real stores and the issue feed: shared budget, ordering, bounds and watch. */
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { agyNativeReads } from "@rickylabs/provider-agy";
import { readIssueAgentTreeSnapshot, type IssueAgentTreeAgent } from "@rickylabs/harness-contracts";
import type { AgyNativeReads } from "../agy-reads.js";
import { collectIssueAgentTree } from "../issue-agent-feed-cli.js";
import { openIssueFeedChanges } from "../issue-agent-feed-changes.js";
import { OPERATOR_ENV } from "../operator-environment.js";
import { scanAGYIssue } from "./agy.js";
import { attachAgyDescriptors } from "./agy-activity.js";
import { agyReservation, bindAgyIssue, captured, childID, rootID, seconds, sqliteFixture, transcript as t,
  type ConversationSpec } from "../fixtures/agy-store.js";

const MiB = 1_048_576, BIG = 1 << 30, WS = "/workspace/project";
const B_ID = "00000000-0000-4000-8000-0000000000b0", DECOY = "00000000-0000-4000-8000-0000000000d0";
const run = { name: "run_command", args: { CommandLine: "git status PRIVATE-ARG-CANARY" } };
const pad = (idx: number, size: number) => JSON.stringify({ step_index: idx, type: "GENERIC", content: "x".repeat(size) });
const spec = (message: string, pads: [number, number], extra: Partial<ConversationSpec> = {}): ConversationSpec => ({ ...extra,
  steps: [{ kind: "user" }, { kind: "planner", pad: pads[0] }, { kind: "result", pad: pads[1] }, { kind: "planner", message }] });
const log = (padLines: number, size: number) => t.lines(t.planner(1, [run]), ...Array.from({ length: padLines }, () => pad(2, size)), t.planner(3));
const now = new Date(captured).toISOString();
const recording = () => {
  const reads: { allowance: number; bytesRead: number }[] = [];
  const reads$: AgyNativeReads = { transcriptPath: agyNativeReads.transcriptPath,
    async readToolCalls(root, id, max, count) { const r = await agyNativeReads.readToolCalls(root, id, max, count); reads.push({ allowance: max, bytesRead: r.bytesRead }); return r; } };
  return { reads, port: reads$ };
};
const agents = (snapshot: Awaited<ReturnType<typeof collectIssueAgentTree>>) => snapshot.issues.flatMap(i => i.dispatches.flatMap(d => d.agents));
const byMessage = (all: IssueAgentTreeAgent[], text: string) => all.find(a => a.activity?.steps.some(s => s.summary === text))!;
const hasNames = (a: IssueAgentTreeAgent) => a.activity!.steps.some(s => s.commandHead !== null || (s.toolName ?? null) !== null);
const gapsOf = (a: IssueAgentTreeAgent) => a.activity?.availability === "available" ? a.activity.coverage?.gaps ?? [] : [];

/** Dispatch A (root + child, newer) and B (older), each in its own bound store, sized for a 1 MiB frame. */
async function twoDispatches(sameIssue: boolean) {
  const receipts = await mkdtemp(join(tmpdir(), "agy-receipts-"));
  const a = await sqliteFixture(agyReservation(42, "example/project", "b".repeat(64)), { workspaceColumn: true });
  const bNumber = sameIssue ? 42 : 43;
  const b = await sqliteFixture(agyReservation(bNumber, "example/project", "c".repeat(64)), { workspaceColumn: true });
  a.replaceRoot(spec("Root done here.", [45_000, 45_000]));
  a.addConversation(spec("Child done here.", [10_000, 0], { id: childID, parent: rootID }));
  b.addConversation(spec("Other done here.", [50_000, 50_000], { id: B_ID }));
  await a.writeTranscript(rootID, log(3, 66_000)); await a.writeTranscript(childID, log(1, 85_000));
  await b.writeTranscript(B_ID, log(1, 60_000));
  await bindAgyIssue(receipts, { number: 42, root: a.root, observedAt: new Date((seconds + 5) * 1000).toISOString() });
  await bindAgyIssue(receipts, { number: bNumber, root: b.root, brief: "c".repeat(64), nativeID: B_ID, observedAt: new Date(seconds * 1000).toISOString() });
  const authority = async (root: string, id: string) => (await scanAGYIssue(root, match => match === id, 20, BIG, captured)).bytesRead;
  return { receipts, a, b, aBytes: await authority(a.root, rootID), bBytes: await authority(b.root, B_ID),
    close: async () => { await a.close(); await b.close(); await rm(receipts, { recursive: true, force: true }); } };
}

it("SQLite and transcript bytes share one budget; descriptors follow authority, newest first (S23, G32, G39)", async () => {
  const f = await twoDispatches(true), rec = recording();
  try {
    const snapshot = await collectIssueAgentTree({ home: f.a.base, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: f.receipts },
      activityLifecycle: true, maxFrameBytes: MiB, agy: rec.port });
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    const first = MiB - MiB / 2 - f.aBytes - f.bBytes;
    assert.ok(first >= 65_536 && first < MiB, `fixture precondition: first allowance ${first}`);
    assert.equal(rec.reads[0]?.allowance, first, "every authority read of the group was deducted before the first descriptor read");
    assert.equal(rec.reads.length, 2, "A root and A child were read; B was skipped");
    assert.equal(rec.reads[1]?.allowance, first - rec.reads[0]!.bytesRead);
    const all = agents(snapshot);
    const [aRoot, aChild, b] = [byMessage(all, "Root done here."), byMessage(all, "Child done here."), byMessage(all, "Other done here.")];
    assert.ok(hasNames(aRoot) && hasNames(aChild), "A's descriptors were read");
    assert.deepEqual(gapsOf(aRoot), ["call-lifecycle-unproven"]);
    assert.equal(hasNames(b), false, "B's descriptor read did not fit above the reserve");
    assert.deepEqual(gapsOf(b), ["tool-names-budget-exhausted"]);
    assert.ok(b.activity!.steps.some(s => s.state === "completed"), "B's authority read still published its result");
  } finally { await f.close(); }
});

it("the composition root deducts one group's transcript bytes before the next group (S23b, G32b)", async () => {
  const f = await twoDispatches(false), rec = recording();
  try {
    const snapshot = await collectIssueAgentTree({ home: f.a.base, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: f.receipts },
      activityLifecycle: true, maxFrameBytes: MiB, agy: rec.port });
    const spent = rec.reads.reduce((sum, r) => sum + r.bytesRead, 0);
    assert.equal(rec.reads.length, 2);
    assert.ok(MiB - f.aBytes - spent - f.bBytes - MiB / 2 < 65_536, "fixture precondition: the later group cannot read");
    const b = byMessage(agents(snapshot), "Other done here.");
    assert.equal(hasNames(b), false);
    assert.deepEqual(gapsOf(b), ["tool-names-budget-exhausted"]);
  } finally { await f.close(); }
});

it("a budget under the reserve plus the minimum skips names without starving authority (S15, G33)", async () => {
  const f = await sqliteFixture(agyReservation(42)), receipts = join(f.base, "receipts");
  try {
    await bindAgyIssue(receipts, { number: 42, root: f.root });
    const snapshot = await collectIssueAgentTree({ home: f.base, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: receipts },
      activityLifecycle: true, maxFrameBytes: 120_000 });
    assert.equal(snapshot.issues[0]?.complete, true);
    assert.equal(agents(snapshot)[0]?.activity?.steps[0]?.summary, "The work is complete.");
    assert.deepEqual(gapsOf(agents(snapshot)[0]!), ["tool-names-budget-exhausted"]);
  } finally { await f.close(); }
});

it("an oversized workspace value is never materialized, and its bytes are counted when read (S24, S28, G40, G41)", async () => {
  const valid = JSON.stringify([`file://${WS}`]), padded = JSON.stringify([`file://${WS}`], null, 4000).padEnd(5000, " ");
  assert.ok(Buffer.byteLength(padded) > 4096 && JSON.parse(padded)[0] === `file://${WS}`, "fixture: a valid single root over the cap");
  const viewed = t.lines(t.planner(1, [{ name: "view_file", args: { AbsolutePath: `${WS}/src/app.ts` } }]), t.planner(3));
  const paths = async (workspace: string) => {
    const f = await sqliteFixture("e".repeat(64), { workspaceColumn: true });
    try {
      f.replaceRoot(spec("Viewed it now.", [0, 0]), workspace); await f.writeTranscript(rootID, viewed);
      const scan = await scanAGYIssue(f.root, id => id === rootID, 20, BIG, captured);
      const phase = await attachAgyDescriptors(scan.conversations, agyNativeReads, { lifecycle: true, remainingBytes: BIG, reserveBytes: 0 });
      return { bytes: scan.bytesRead, files: [...phase.runs.values()][0]!.activitySteps!.map(s => s.filePath).filter(p => p !== null) };
    } finally { await f.close(); }
  };
  const small = await paths(valid), large = await paths(padded), longer = await paths(JSON.stringify([`file://${WS}/nested/deeper`]));
  assert.deepEqual(small.files, ["src/app.ts"]);
  assert.deepEqual(large.files, [], "an over-cap value relativizes nothing");
  assert.equal(longer.bytes - small.bytes, Buffer.byteLength(JSON.stringify([`file://${WS}/nested/deeper`])) - Buffer.byteLength(valid));
});

it("a delegation result never ends the delegated child (S7, G9)", async () => {
  const f = await sqliteFixture(agyReservation(42)), receipts = join(f.base, "receipts");
  try {
    f.replaceRoot({ steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result", status: 3 }, { kind: "planner", message: "Delegated it now." }] });
    f.addConversation({ id: childID, parent: rootID, notIdle: true, running: true, summaryState: 2,
      steps: [{ kind: "user" }, { kind: "planner", status: 2 }] });
    await f.writeTranscript(rootID, t.lines(t.planner(1, [{ name: "invoke_subagent", args: { Prompt: "PRIVATE-PROMPT-CANARY" } }]), t.planner(3)));
    await bindAgyIssue(receipts, { number: 42, root: f.root });
    const snapshot = await collectIssueAgentTree({ home: f.base, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: receipts }, activityLifecycle: true });
    assert.equal(readIssueAgentTreeSnapshot(snapshot).ok, true);
    const all = agents(snapshot), parent = byMessage(all, "Delegated it now."), child = all.find(a => a !== parent)!;
    assert.ok(parent.activity!.steps.some(s => s.state === "completed" && s.toolName === null));
    assert.ok(parent.activity!.steps.some(s => s.toolName === "invoke_subagent" && s.state === "unknown"));
    assert.notEqual(child.liveness.state, "ended");
    assert.equal(child.terminalOutcome.value, null);
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE-"));
  } finally { await f.close(); }
});

it("a refused transcript and a decoy conversation's transcript name nothing (S12, S14, G31)", async () => {
  const f = await sqliteFixture("f".repeat(64));
  try {
    f.replaceRoot(spec("Root done here.", [0, 0]));
    f.addConversation(spec("Decoy done here.", [0, 0], { id: DECOY }));
    await f.writeTranscript(DECOY, log(0, 0));
    const decoyOnly = await scanAGYIssue(f.root, id => id === rootID, 20, BIG, captured);
    const read = await attachAgyDescriptors(decoyOnly.conversations, agyNativeReads, { lifecycle: true, remainingBytes: BIG, reserveBytes: 0 });
    const root = [...read.runs.values()][0]!;
    assert.equal(root.activitySteps!.some(s => s.toolName !== null || s.commandHead !== null), false);
    assert.deepEqual(root.activityCoverage?.gaps, ["tool-names-source-missing"]);
    const logs = join(f.root, "brain", rootID, ".system_generated", "logs");
    await mkdir(logs, { recursive: true }); await writeFile(join(f.base, "elsewhere.jsonl"), log(0, 0));
    await symlink(join(f.base, "elsewhere.jsonl"), join(logs, "transcript.jsonl"));
    const linked = await attachAgyDescriptors(decoyOnly.conversations, agyNativeReads, { lifecycle: true, remainingBytes: BIG, reserveBytes: 0 });
    assert.deepEqual([...linked.runs.values()][0]!.activityCoverage?.gaps, ["tool-names-source-missing"]);
  } finally { await f.close(); }
});

it("a transcript append wakes the feed through the existing watch (G35)", async () => {
  const f = await sqliteFixture(), changes = openIssueFeedChanges(undefined, join(f.base, "unbound"));
  try {
    f.replaceRoot(spec("Root done here.", [0, 0]));
    const path = await f.writeTranscript(rootID, log(0, 0));
    const scan = await scanAGYIssue(f.root, id => id === rootID, 20, BIG, captured);
    const watchFiles = new Set(scan.files);
    await attachAgyDescriptors(scan.conversations, agyNativeReads, { lifecycle: false, remainingBytes: BIG, reserveBytes: 0, watchFiles });
    assert.ok(watchFiles.has(path));
    changes.setFiles(watchFiles, new Set([f.root]));
    await new Promise(resolve => setTimeout(resolve, 30)); changes.consume();
    await appendFile(path, t.planner(3) + "\n");
    let changed = false;
    for (let i = 0; i < 30 && !changed; i++) { await new Promise(resolve => setTimeout(resolve, 20)); changed = changes.consume(); }
    assert.equal(changed, true);
  } finally { changes.close(); await f.close(); }
});
