import assert from "node:assert/strict";
import { it } from "node:test";
import { agyTranscriptPath, readAgyToolCalls } from "../../src/application/read-tool-calls.js";
import { memoryTail, transcript as t } from "../../test-fixtures/agy-store.js";

const { planner, runCommand, viewFile, lines: jsonl } = t;
const result = (stepIndex: number) => t.step(stepIndex, "GENERIC");
const user = (stepIndex: number) => t.step(stepIndex, "USER_INPUT");

const ID = "0f0e0d0c-0b0a-4090-8070-605040302010";
const tail = memoryTail;

it("keeps the last line per step, ignores steps at or past stepCount, and orders by step (T2, T3, T4)", async () => {
  const read = await readAgyToolCalls(tail(jsonl(planner(5, [viewFile("/w/a")]), user(0), planner(1, [runCommand()]),
    planner(5, [runCommand()]), planner(9, [runCommand()]))), "/store", ID, 4096, 9);
  assert.equal(read.gap, null);
  assert.deepEqual(read.calls.map(c => [c.stepIndex, c.kind]), [[1, "command"], [5, "command"]]);
  assert.deepEqual(read.decodedPlannerSteps, [1, 5]);
  assert.equal(read.fromStepIndex, 0);
});

it("makes a malformed line invalidate the whole read (T12)", async () => {
  const read = await readAgyToolCalls(tail(jsonl(planner(1, [runCommand()]), "{not json", planner(2))), "/store", ID, 4096, 9);
  assert.equal(read.gap, "tool-names-source-invalid");
  assert.deepEqual(read.calls, []);
});

it("drops the partial first line of a tail and a partial last line (T5)", async () => {
  const text = planner(1, [runCommand()]).slice(20) + "\n" + jsonl(planner(3, [runCommand()]), result(4)) + planner(6).slice(0, 15);
  const read = await readAgyToolCalls(tail(text, false), "/store", ID, 4096, 9);
  assert.equal(read.gap, null);
  assert.deepEqual(read.decodedPlannerSteps, [3]);
  assert.equal(read.fromStart, false);
  assert.equal(read.fromStepIndex, 3);
});

it("lists vendor-truncated planner steps and drops their calls", async () => {
  const read = await readAgyToolCalls(tail(jsonl(planner(1, [runCommand()], { truncated_fields: ["tool_calls"] }),
    planner(2, [runCommand()], { truncated_fields: ["content"] }))), "/store", ID, 4096, 9);
  assert.deepEqual(read.vendorTruncatedSteps, [1]);
  assert.deepEqual(read.decodedPlannerSteps, [1, 2]);
  assert.deepEqual(read.calls.map(c => c.stepIndex), [2]);
});

it("refuses an unverified conversation id without reading, and bounds every read", async () => {
  const fake = tail(jsonl(planner(1, [runCommand()])));
  assert.equal(agyTranscriptPath("/store", "../other"), null);
  assert.equal((await readAgyToolCalls(fake, "/store", "../other", 4096, 9)).gap, "tool-names-source-missing");
  assert.equal((await readAgyToolCalls(fake, "/store", ID, 0, 9)).gap, "tool-names-budget-exhausted");
  assert.deepEqual(fake.asked, []);
  await readAgyToolCalls(fake, "/store", ID, 8 * 1_048_576, 9);
  assert.deepEqual(fake.asked, [1_048_576]);
});

it("reports a missing or refused log as a missing source", async () => {
  for (const reason of ["missing", "refused"] as const) {
    const read = await readAgyToolCalls({ async read() { return { bytes: null, reason }; } }, "/store", ID, 4096, 9);
    assert.equal(read.gap, "tool-names-source-missing");
  }
});

it("refuses an invalid step count before reading", async () => {
  for (const stepCount of [-1, 1.5, Number.NaN]) {
    const fake = tail(jsonl(planner(1, [runCommand()])));
    assert.equal((await readAgyToolCalls(fake, "/store", ID, 4096, stepCount)).gap, "tool-names-source-missing", String(stepCount));
    assert.deepEqual(fake.asked, []);
  }
});

it("invalidates the read on invalid UTF-8, even inside an otherwise valid JSON line", async () => {
  const line = new TextEncoder().encode(planner(1, [runCommand()]) + "\n");
  // Inside the CommandLine string value, so only the strict decoder (not JSON) can refuse it.
  const at = Buffer.from(line).indexOf("git status") + 3;
  const broken = new Uint8Array([...line.subarray(0, at), 0xff, ...line.subarray(at)]);
  assert.equal(JSON.parse(new TextDecoder().decode(broken)).step_index, 1, "fixture: valid JSON when decoded leniently");
  const read = await readAgyToolCalls({ async read() { return { bytes: broken, fromStart: true }; } }, "/store", ID, 4096, 9);
  assert.equal(read.gap, "tool-names-source-invalid");
});

it("reports a non-finite or unsafe byte budget as exhausted, before any read", async () => {
  for (const maxBytes of [Infinity, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 2 ** 60]) {
    const fake = tail(jsonl(planner(1, [runCommand()])));
    assert.equal((await readAgyToolCalls(fake, "/store", ID, maxBytes, 9)).gap, "tool-names-budget-exhausted", String(maxBytes));
    assert.deepEqual(fake.asked, []);
  }
});

it("turns a non-object row or a non-object tool call into invalid evidence, never a throw", async () => {
  for (const bad of ["null", "[1]", "5", JSON.stringify("PLANNER_RESPONSE"),
    planner(1, [], { tool_calls: [null] }), planner(1, [], { tool_calls: [7] }), planner(1, [], { tool_calls: ["run_command"] }),
    planner(1, [], { tool_calls: [[]] })]) {
    const read = await readAgyToolCalls(tail(jsonl(planner(0, [runCommand()]), bad)), "/store", ID, 4096, 9);
    assert.equal(read.gap, "tool-names-source-invalid", bad);
    assert.deepEqual(read.calls, []);
  }
});
