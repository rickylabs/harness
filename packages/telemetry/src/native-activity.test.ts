import assert from "node:assert/strict";
import { it } from "node:test";
import { claudeActivity, codexActivity, recentActivity } from "./native-activity.js";

const at = "2026-01-01T00:00:00.000Z";
it("publishes only bounded safe assistant activity from a Codex rollout", () => {
  const origin = "PRIVATE-ORIGIN-CANARY";
  const command = { timestamp: at, type: "response_item", payload: { type: "function_call", name: "exec_command",
    arguments: JSON.stringify({ cmd: "git status --short SECRET-ARG-CANARY", path: "/private/host/path" }) } };
  const step = codexActivity(command, origin, 3)[0]!;
  assert.equal(step.commandHead, "git status");
  assert.equal(step.filePath, null);
  assert.equal(step.summary, "Ran git status");
  assert.equal(codexActivity(command, origin, 3)[0]?.id, step.id);
  const text = { timestamp: at, type: "response_item", payload: { type: "message", role: "assistant",
    content: [{ type: "output_text", text: "PRIVATE-PROMPT-CANARY https://private.invalid secret" }] } };
  assert.equal(codexActivity(text, origin, 4)[0]?.summary, "Agent message");
  assert.equal(codexActivity({ ...text, payload: { ...text.payload, role: "user" } }, origin, 4).length, 0);
  assert.equal(codexActivity({ ...text, payload: { ...text.payload, content: [{ type: "reasoning", text: "PRIVATE" }] } }, origin, 4).length, 0);
  assert.ok(!JSON.stringify([step, ...codexActivity(text, origin, 4)]).includes("PRIVATE"));
  assert.equal(recentActivity(Array.from({ length: 30 }, (_, i) => codexActivity(text, origin, i)[0]!)).length, 20);
});

it("reads Claude assistant tool use while excluding user text and unknown tool names", () => {
  const row = { type: "assistant", timestamp: at, message: { content: [
    { type: "tool_use", name: "Read", input: { file_path: "src/main.ts" } },
    { type: "tool_use", name: "PRIVATE-TOOL-CANARY", input: { command: "private-exe secret" } },
    { type: "text", text: "SECRET-CANARY" },
  ] } };
  const steps = claudeActivity(row, "PRIVATE-ORIGIN-CANARY", 1);
  assert.equal(steps.length, 3);
  assert.equal(steps[0]?.filePath, "src/main.ts");
  assert.equal(steps[1]?.toolName, null);
  assert.equal(steps[1]?.commandHead, null);
  assert.equal(steps[2]?.summary, "Agent message");
  assert.equal(claudeActivity({ ...row, type: "user" }, "o", 1).length, 0);
  assert.ok(!JSON.stringify(steps).includes("CANARY"));
});
