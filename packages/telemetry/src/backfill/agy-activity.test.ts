/** The agy descriptor join and its coverage, on synthetic trajectories and transcripts (no native data). */
import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeAgyConversation, readAgyToolCalls, type TranscriptTail } from "@rickylabs/provider-agy";
import type { AgentActivityStep, NativeToolCallRead } from "@rickylabs/harness-contracts";
import { agyRun } from "./agy.js";
import { agyActivity } from "./agy-activity.js";
import { captured, conversation, rootID, transcript as t, type ConversationSpec } from "@rickylabs/provider-agy/test-fixtures";
import { nativeMessageActivity } from "../native-activity.js";
import type { RunRecord } from "../model.js";

const WS = "/workspace/project";
const memory = (text: string, fromStart = true): TranscriptTail => ({
  async read() { return { bytes: new TextEncoder().encode(text), fromStart }; } });
const missing: NativeToolCallRead = { calls: [], decodedPlannerSteps: [], vendorTruncatedSteps: [], fromStart: false,
  fromStepIndex: null, bytesRead: 0, gap: "tool-names-source-missing" };
const runCommand = { name: "run_command", args: { CommandLine: "git status PRIVATE-ARG-CANARY", Cwd: "PRIVATE-CWD-CANARY" } };
const viewFile = (path = `${WS}/src/app.ts`) => ({ name: "view_file", args: { AbsolutePath: path } });

async function join(spec: ConversationSpec, log: string | null | { text: string; fromStart: boolean }, lifecycle = true,
  workspaceRoot: string | null = WS) {
  const c = conversation(spec), decoded = decodeAgyConversation(c.summary, c.rows, "private-origin", captured, workspaceRoot);
  assert.ok(decoded, "the synthetic trajectory is accepted by the provider's decoder");
  const read = log === null ? missing : await readAgyToolCalls(typeof log === "string" ? memory(log) : memory(log.text, log.fromStart),
    "/store", rootID, 1_048_576, c.rows.length);
  return agyActivity({ run: agyRun(decoded), storeRoot: "/store", conversation: decoded }, read, lifecycle);
}
const named = (run: RunRecord) => (run.activitySteps ?? []).filter(s => s.toolName !== null || s.commandHead !== null || s.filePath !== null);
const results = (run: RunRecord) => (run.activitySteps ?? []).filter(s => s.provenance === "executed");
const gaps = (run: RunRecord) => run.activityCoverage?.gaps;
// S1: one planner step issuing two calls, their two results, and a closing response.
const S1: ConversationSpec = { steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result", status: 3 }, { kind: "result", status: 7 },
  { kind: "planner", message: "All done here." }] };
const S1_LOG = t.lines(t.step(0, "USER_INPUT"), t.planner(1, [runCommand, viewFile()]), t.step(2, "GENERIC", "RUNNING"),
  t.step(3, "GENERIC", "ERROR"), t.planner(4));

it("publishes named calls as unknown, results with their SQLite state, and the unproven correlation (S1)", async () => {
  const run = await join(S1, S1_LOG);
  const byKind = (kind: AgentActivityStep["kind"]) => run.activitySteps!.filter(s => s.kind === kind);
  assert.deepEqual(byKind("command").map(s => [s.commandHead, s.state]), [["git status", "unknown"]]);
  assert.deepEqual(byKind("file").map(s => [s.filePath, s.toolName, s.state]), [["src/app.ts", "view_file", "unknown"]]);
  assert.deepEqual(results(run).map(s => s.state).sort(), ["completed", "failed"]);
  assert.equal(byKind("message").length, 2, "both planner responses");
  assert.deepEqual(named(run).map(s => s.provenance), ["requested", "requested"]);
  assert.ok(results(run).every(s => s.kind === "tool" && s.toolName === null && s.commandHead === null && s.filePath === null));
  assert.deepEqual(gaps(run), ["call-lifecycle-unproven"]);
  assert.ok(!JSON.stringify(run.activitySteps).includes("PRIVATE-"));
});

it("keeps today's keys without the lifecycle flag: no state, no coverage, no unnamed results (G3)", async () => {
  const run = await join(S1, S1_LOG, false);
  assert.equal(Object.hasOwn(run, "activityCoverage"), false);
  assert.equal(results(run).length, 0);
  for (const step of run.activitySteps!) {
    assert.deepEqual(Object.keys(step).sort(), ["at", "commandHead", "filePath", "id", "kind", "source", "summary", "target", "toolName"]);
  }
  assert.equal(named(run).length, 2);
});

it("never gives a named call a result's state, whatever the result order or count (S2-S5)", async () => {
  const cases: [string, ConversationSpec, string][] = [
    ["reversed", { steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result", status: 7 }, { kind: "result", status: 3 }, { kind: "planner", message: "Done now." }] },
      t.lines(t.planner(1, [runCommand, viewFile()]), t.planner(4))],
    ["missing first", { steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result", status: 6 }, { kind: "planner", message: "Done now." }] },
      t.lines(t.planner(1, [runCommand, viewFile()]), t.planner(3))],
    ["intervening", { steps: [{ kind: "user" }, { kind: "planner" }, { kind: "system" }, { kind: "checkpoint" }, { kind: "result", status: 3 },
      { kind: "result", status: 7 }, { kind: "planner", message: "Done now." }] }, t.lines(t.planner(1, [runCommand, viewFile()]), t.planner(6))],
    ["excess", { steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result", status: 3 }, { kind: "result", status: 7 }, { kind: "result", status: 12 },
      { kind: "planner", message: "Done now." }] }, t.lines(t.planner(1, [runCommand, viewFile()]), t.planner(5))],
  ];
  for (const [name, spec, log] of cases) {
    const run = await join(spec, log);
    assert.equal(named(run).length, 2, name);
    assert.deepEqual(named(run).map(s => s.state), ["unknown", "unknown"], name);
    assert.ok(gaps(run)?.includes("call-lifecycle-unproven"), name);
  }
});

it("maps only the authority's terminal codes, and ignores the transcript's status (G6)", async () => {
  const states = async (status: number) => results(await join({ steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result", status },
    { kind: "planner", message: "Done now." }] }, t.lines(t.planner(1, [runCommand]), t.step(2, "GENERIC", "RUNNING"), t.planner(3))))[0]?.state;
  assert.equal(await states(3), "completed");
  assert.equal(await states(7), "failed");
  assert.equal(await states(6), "cancelled");
  assert.equal(await states(12), "cancelled");
  assert.equal(await states(4), "unknown");
});

it("keeps in-progress results unknown, with the explicit gap, regardless of turn or activity (S6, G7)", async () => {
  const earlier: ConversationSpec = { notIdle: true, summaryState: 2, running: true, steps: [{ kind: "user" }, { kind: "planner" },
    { kind: "result", status: 2 }, { kind: "user" }, { kind: "planner" }, { kind: "result", status: 2 }] };
  const run = await join(earlier, t.lines(t.planner(1, [runCommand]), t.planner(4, [runCommand])));
  assert.equal(run.outcome, "running");
  assert.deepEqual(results(run).map(s => s.state), ["unknown", "unknown"]);
  assert.ok(gaps(run)?.includes("in-progress-unattributed"));
  const idle = await join({ steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result", status: 9 }] }, t.lines(t.planner(1, [runCommand])));
  assert.deepEqual(results(idle).map(s => s.state), ["unknown"]);
  assert.ok(gaps(idle)?.includes("in-progress-unattributed"));
});

it("a summary-only resume keeps the old result unknown while the run is running (S18, G8)", async () => {
  const steps: ConversationSpec["steps"] = [{ kind: "user" }, { kind: "planner" }, { kind: "result", status: 2 }];
  const log = t.lines(t.planner(1, [runCommand]));
  const before = await join({ steps }, log);
  assert.notEqual(before.outcome, "running");
  const resumed = await join({ steps, summaryState: 2, running: true, notIdle: true }, log);
  assert.equal(resumed.outcome, "running");
  assert.deepEqual(results(resumed).map(s => s.state), ["unknown"]);
  assert.deepEqual(results(before).map(s => s.state), ["unknown"]);
});

it("drops every name from an incoherent transcript and keeps results and messages (S13, G11)", async () => {
  const run = await join(S1, t.lines(t.planner(1, [runCommand]), t.planner(2, [viewFile()]), t.planner(4)));
  assert.equal(named(run).length, 0);
  assert.equal(results(run).length, 2);
  assert.equal(run.activitySteps!.some(s => s.kind === "message"), true);
  assert.deepEqual(gaps(run), ["tool-names-source-invalid"]);
});

it("reports a missing transcript as reduced coverage and keeps results and messages (S11, G12)", async () => {
  const run = await join(S1, null);
  assert.equal(named(run).length, 0);
  assert.equal(results(run).length, 2);
  assert.deepEqual(gaps(run), ["tool-names-source-missing"]);
});

const THREE: ConversationSpec = { steps: [{ kind: "user" }, { kind: "planner" }, { kind: "result" }, { kind: "planner" }, { kind: "result" },
  { kind: "planner" }, { kind: "result" }, { kind: "planner", message: "Done now." }] };
it("classifies a missing prefix, a missing middle and a missing newest planner line (S16, S19, S20)", async () => {
  const prefix = await join(THREE, { text: "partial-line\n" + t.lines(t.planner(5, [runCommand]), t.planner(7)), fromStart: false });
  assert.deepEqual(gaps(prefix), ["tool-names-truncated", "call-lifecycle-unproven"]);
  const middle = await join(THREE, t.lines(t.planner(1, [runCommand]), t.planner(5, [runCommand]), t.planner(7)));
  assert.deepEqual(gaps(middle), ["tool-names-lines-missing", "call-lifecycle-unproven"]);
  const newest = await join(THREE, t.lines(t.planner(1, [runCommand]), t.planner(3, [runCommand]), t.planner(5, [runCommand])));
  assert.deepEqual(gaps(newest), ["tool-names-lines-missing", "call-lifecycle-unproven"]);
  const full = await join(THREE, t.lines(t.planner(1, [runCommand]), t.planner(3, [runCommand]), t.planner(5, [runCommand]), t.planner(7)));
  assert.deepEqual(gaps(full), ["call-lifecycle-unproven"]);
});

it("drops a vendor-truncated planner line's calls and says so (S21, G16)", async () => {
  const run = await join(THREE, t.lines(t.planner(1, [runCommand]), t.planner(3, [runCommand]), t.planner(5, [viewFile()]),
    t.planner(7, [], { truncated_fields: ["tool_calls"] })));
  assert.deepEqual(gaps(run), ["tool-names-vendor-truncated", "call-lifecycle-unproven"]);
  const cut = await join(THREE, t.lines(t.planner(1, [runCommand]), t.planner(3, [runCommand]), t.planner(5, [viewFile()], { truncated_fields: ["tool_calls"] }), t.planner(7)));
  assert.equal(named(cut).some(s => s.filePath !== null || s.toolName === "view_file"), false);
  assert.equal(results(cut).length, 3);
});

it("gives messages, calls and results disjoint, stable ids, keeping the message id (S22, G17)", async () => {
  const spec: ConversationSpec = { steps: [{ kind: "user" }, { kind: "planner", message: "Checked the tree." }, { kind: "result" }, { kind: "result" }] };
  const log = t.lines(t.planner(1, [runCommand, viewFile(), { name: "search_web" }]));
  const first = await join(spec, log), second = await join(spec, log);
  const ids = first.activitySteps!.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 6);
  assert.deepEqual(second.activitySteps!.map(s => s.id), ids);
  const message = first.activitySteps!.find(s => s.kind === "message")!;
  assert.equal(message.id, nativeMessageActivity("agy-transcript", rootID, 1, message.at, "Checked the tree.")!.id);
});

it("screens names, commands and paths: no canary, no outside path, no MCP name (G34)", async () => {
  const run = await join(S1, t.lines(t.planner(1, [{ name: "run_command", args: { CommandLine: "curl PRIVATE-URL-CANARY" } },
    viewFile("/elsewhere/PRIVATE-PATH-CANARY.ts"), { name: "github_create_issue", args: { title: "PRIVATE-MCP-CANARY" } }]), t.planner(4)));
  assert.deepEqual(named(run).map(s => [s.kind, s.toolName, s.commandHead, s.filePath]).sort(),
    [["tool", "run_command", null, null], ["tool", "view_file", null, null]]);
  assert.ok(!JSON.stringify(run).includes("PRIVATE-"));
  assert.equal(run.activitySteps!.filter(s => s.provenance === "requested" && s.kind === "tool" && s.toolName === null).length, 1);
});

it("a planner-only call is a request: requested provenance, unknown state, no execution claimed", async () => {
  const run = await join({ notIdle: true, summaryState: 2, running: true, steps: [{ kind: "user" }, { kind: "planner" }] },
    t.lines(t.planner(1, [runCommand])));
  assert.equal(run.outcome, "running");
  assert.deepEqual(named(run).map(s => [s.kind, s.commandHead, s.provenance, s.state]), [["command", "git status", "requested", "unknown"]]);
  assert.equal(run.activitySteps!.some(s => s.provenance === "executed"), false);
  const unflagged = await join({ steps: [{ kind: "user" }, { kind: "planner" }] }, t.lines(t.planner(1, [runCommand])), false);
  assert.deepEqual(named(unflagged).map(s => [Object.hasOwn(s, "provenance"), Object.hasOwn(s, "state")]), [[false, false]]);
});

it("names only calls from the newest 20 planner steps, even when an older one is newest by time", async () => {
  // Planner 1 is the oldest by index but carries the newest native time; planners 2..21 fill the window.
  const steps: ConversationSpec["steps"] = [{ kind: "user" }, { kind: "planner", offset: 28 },
    ...Array.from({ length: 20 }, () => ({ kind: "planner" as const }))];
  const log = t.lines(...steps.flatMap((_, i) => i === 0 ? [] : [t.planner(i, [runCommand])]));
  const run = await join({ steps }, log);
  const oldestAt = new Date((1_767_225_600 + 28) * 1000).toISOString();
  assert.ok(run.activitySteps!.some(s => s.kind === "message" && s.at === oldestAt), "its time is within the published steps");
  assert.equal(named(run).some(s => s.at === oldestAt), false, "the call outside the planner window is not named");
});
