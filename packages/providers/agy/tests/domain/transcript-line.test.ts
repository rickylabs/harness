import assert from "node:assert/strict";
import { it } from "node:test";
import { describeCall } from "../../src/domain/tool-vocabulary.js";
import { decodeTranscriptLine, MAX_ARGUMENT_CHARS, MAX_LINE_BYTES } from "../../src/domain/transcript-line.js";
import { CANARY, mcpTool, planner, result, runCommand, viewFile } from "../fixtures/transcript.js";

it("decodes a planner line and keeps only the vocabulary's argument per kind (T1)", () => {
  const line = decodeTranscriptLine(planner(4, [runCommand(), viewFile("/w/src/a.ts"), mcpTool]));
  assert.ok(line?.planner);
  const described = line.calls.map((call, i) => describeCall(4, i, call));
  assert.deepEqual(described.map(d => [d.kind, d.toolName]), [["command", "run_command"], ["file", "view_file"], ["tool", null]]);
  assert.equal(described[0]!.path, null);
  assert.equal(described[1]!.commandLine, null);
  assert.equal(JSON.stringify(described[2]).includes(CANARY), false);
});

it("counts a planner line with zero calls as decoded, and a non-planner line as not a planner (T13)", () => {
  assert.deepEqual(decodeTranscriptLine(planner(2)), { stepIndex: 2, planner: true, calls: [], vendorTruncated: false });
  assert.deepEqual(decodeTranscriptLine(result(3)), { stepIndex: 3, planner: false });
});

it("rejects an oversized line (T11)", () => {
  assert.equal(decodeTranscriptLine(planner(1, [], { content: "x".repeat(MAX_LINE_BYTES) })), null);
});

it("rejects invalid step indexes (T6)", () => {
  for (const stepIndex of [-1, 1.5, "3", 4097, null]) {
    assert.equal(decodeTranscriptLine(JSON.stringify({ step_index: stepIndex, type: "PLANNER_RESPONSE", tool_calls: [] })), null, String(stepIndex));
  }
  assert.equal(decodeTranscriptLine(JSON.stringify({ step_index: 1, type: 7 })), null);
});

it("rejects a non-array tool_calls and more than 64 calls (T7)", () => {
  assert.equal(decodeTranscriptLine(planner(1, [], { tool_calls: { name: "run_command" } })), null);
  assert.equal(decodeTranscriptLine(planner(1, Array.from({ length: 65 }, () => runCommand()))), null);
  assert.ok(decodeTranscriptLine(planner(1, Array.from({ length: 64 }, () => runCommand()))));
});

it("rejects a non-string or oversized name; an unknown well-formed name stays unnamed (T8)", () => {
  assert.equal(decodeTranscriptLine(planner(1, [{ name: 7 as unknown as string }])), null);
  assert.equal(decodeTranscriptLine(planner(1, [{ name: "a".repeat(129) }])), null);
  const odd = decodeTranscriptLine(planner(1, [{ name: "Run-Command" }, { name: "invoke_subagent" }]));
  assert.ok(odd?.planner);
  assert.deepEqual(odd.calls.map((c, i) => describeCall(1, i, c).toolName), [null, "invoke_subagent"]);
});

it("turns an oversized argument into null and rejects non-object args (T9, T10)", () => {
  const long = decodeTranscriptLine(planner(1, [runCommand("git " + "x".repeat(MAX_ARGUMENT_CHARS))]));
  assert.ok(long?.planner);
  assert.equal(long.calls[0]!.commandLine, null);
  assert.equal(decodeTranscriptLine(planner(1, [{ name: "run_command", args: "git status" }])), null);
});

it("classifies vendor truncation: prose fields never, tool_calls and unknown fields always (T14)", () => {
  const truncated = (fields: string[]) => (decodeTranscriptLine(planner(1, [runCommand()], { truncated_fields: fields })) as { vendorTruncated: boolean }).vendorTruncated;
  assert.equal(truncated(["content"]), false);
  assert.equal(truncated(["thinking", "content"]), false);
  assert.equal(truncated(["tool_calls"]), true);
  assert.equal(truncated(["something_new"]), true);
});

it("rejects malformed truncated_fields (T15)", () => {
  for (const fields of ["tool_calls", Array.from({ length: 17 }, () => "content"), [7], ["x".repeat(65)]]) {
    assert.equal(decodeTranscriptLine(planner(1, [], { truncated_fields: fields })), null, JSON.stringify(fields).slice(0, 40));
  }
});
