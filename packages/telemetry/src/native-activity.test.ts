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

it("publishes only the single in-progress Codex plan step after the full privacy screen", () => {
  const call = (plan: unknown) => codexActivity({ timestamp: at, type: "response_item", payload: {
    type: "function_call", name: "update_plan", arguments: JSON.stringify({ plan }) } }, "fixture-origin", 1)[0]!;
  const active = call([{ step: "Draft release notes", status: "pending" },
    { step: "Review the parser", status: "in_progress" }]);
  assert.equal(active.kind, "message");
  assert.equal(active.toolName, "update_plan");
  assert.equal(active.summary, "Review the parser");
  assert.equal(call([{ step: "Review the parser", status: "pending" }]).summary, "Used update_plan");
  assert.equal(call([{ step: "Secret credential", status: "in_progress" }]).summary, "Used update_plan");
  assert.equal(call([{ step: "Review the parser ".repeat(8), status: "in_progress" }]).summary, "Used update_plan");
  assert.equal(call([{ step: "One", status: "in_progress" }, { step: "Two", status: "in_progress" }]).summary, "Used update_plan");
});

it("uses the Claude TodoWrite in-progress content without publishing unsafe text", () => {
  const call = (todos: unknown) => claudeActivity({ timestamp: at, type: "assistant", message: { content: [
    { type: "tool_use", name: "TodoWrite", input: { todos } },
  ] } }, "fixture-origin", 2)[0]!;
  assert.equal(call([{ content: "Read the contract", status: "in_progress", activeForm: "Reading the contract" }]).summary,
    "Read the contract");
  assert.equal(call([{ content: "PRIVATE-URL-CANARY https://private.invalid", status: "in_progress" }]).summary,
    "Used TodoWrite");
  assert.equal(call([{ content: "Review the parser ".repeat(8), status: "in_progress" }]).summary, "Used TodoWrite");
  assert.equal(call([{ content: "Pending only", status: "pending" }]).summary, "Used TodoWrite");
});

it("uses the first safe assistant sentence, and never truncates or echoes private prose", () => {
  const text = (value: string) => codexActivity({ timestamp: at, type: "response_item", payload: {
    type: "message", role: "assistant", content: [{ type: "output_text", text: value }],
  } }, "fixture-origin", 3)[0]!.summary;
  assert.equal(text("Review the parser. Then run tests."), "Review the parser.");
  assert.equal(text("Review the parser ".repeat(8) + ". Then run tests."), "Agent message");
  assert.equal(text("Read /private/host/path. Then continue."), "Agent message");
  assert.equal(text("Read /fixture/path. Then continue."), "Agent message");
  assert.equal(text("Visit example.invalid. Then continue."), "Agent message");
  assert.equal(text("Check credential material. Then continue."), "Agent message");
  const claude = claudeActivity({ timestamp: at, type: "assistant", message: { content: [
    { type: "text", text: "Run focused tests. Then review." },
  ] } }, "fixture-origin", 4)[0]!;
  assert.equal(claude.summary, "Run focused tests.");
});

it("extracts only a safe command head from an exact bash -lc array", () => {
  const command = (cmd: unknown) => codexActivity({ timestamp: at, type: "response_item", payload: {
    type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd }),
  } }, "fixture-origin", 5)[0]!;
  assert.equal(command(["bash", "-lc", "git status --short PRIVATE-ARG-CANARY"]).commandHead, "git status");
  assert.equal(command(["bash", "-lc", "git status --short PRIVATE-ARG-CANARY"]).summary, "Ran git status");
  assert.equal(command(["env", "-lc", "git status"]).commandHead, null);
  assert.equal(command(["bash", "-c", "git status"]).commandHead, null);
  assert.equal(command(["bash", "-lc", "git status", "extra"]).commandHead, null);
  assert.ok(!JSON.stringify(command(["bash", "-lc", "git status --short PRIVATE-ARG-CANARY"]))
    .includes("PRIVATE-"));
});
