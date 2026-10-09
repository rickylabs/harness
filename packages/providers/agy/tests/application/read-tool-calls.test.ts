import assert from "node:assert/strict";
import { it } from "node:test";
import { agyTranscriptPath, readAgyToolCalls } from "../../src/application/read-tool-calls.js";
import type { TranscriptTail, TranscriptTailRead } from "../../src/ports/transcript-tail.js";
import { jsonl, planner, result, runCommand, user, viewFile } from "../fixtures/transcript.js";

const ID = "0f0e0d0c-0b0a-4090-8070-605040302010";
const tail = (text: string, fromStart = true): TranscriptTail & { asked: number[] } => {
  const asked: number[] = [];
  return { asked, async read(_root, _path, maxBytes): Promise<TranscriptTailRead> {
    asked.push(maxBytes); return { bytes: new TextEncoder().encode(text), fromStart };
  } };
};

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
