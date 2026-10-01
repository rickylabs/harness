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
  assert.deepEqual(step.target, { kind: "command", value: "git status" });
  assert.equal(codexActivity(command, origin, 3)[0]?.id, step.id);
  const wrapped = codexActivity({ ...command, payload: { ...command.payload,
    name: "functions.exec", arguments: JSON.stringify({ code: "return 1" }) } }, origin, 6)[0]!;
  assert.equal(wrapped.summary, "Used functions.exec");
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
  assert.deepEqual(steps[0]?.target, { kind: "file", value: "main.ts" });
  assert.equal(steps[1]?.toolName, null);
  assert.equal(steps[1]?.commandHead, null);
  assert.equal(steps[1]?.target, null);
  assert.equal(steps[2]?.summary, "Agent message");
  assert.equal(claudeActivity({ ...row, type: "user" }, "o", 1).length, 0);
  assert.ok(!JSON.stringify(steps).includes("CANARY"));
});
it("screens short search targets and file basenames without echoing raw paths or queries", () => {
  const call = (name: string, input: unknown) => claudeActivity({ type: "assistant", timestamp: at,
    message: { content: [{ type: "tool_use", name, input }] } }, "PRIVATE-ORIGIN-CANARY", 7)[0]!;
  assert.deepEqual(call("Grep", { pattern: "route status" }).target, { kind: "search", value: "route status" });
  assert.equal(call("Grep", { pattern: "PRIVATE-URL-CANARY https://private.invalid" }).target, null);
  assert.equal(call("Grep", { pattern: "Use recovery code 482916" }).target, null);
  assert.deepEqual(call("Read", { file_path: "src/agent-detail.ts" }).target, { kind: "file", value: "agent-detail.ts" });
  assert.equal(call("Read", { file_path: "/private/host/path" }).target, null);
  assert.equal(call("Read", { file_path: "src/secret-token.txt" }).target, null);
  assert.equal(call("Read", { file_path: "src/secret-token.txt" }).filePath, null);
  assert.equal(call("Read", { file_path: "src/PRIVATE-PATH-CANARY.txt" }).filePath, null);
  assert.ok(!JSON.stringify([call("Grep", { pattern: "PRIVATE-URL-CANARY https://private.invalid" }),
    call("Read", { file_path: "/private/host/path" }),
    call("Read", { file_path: "src/PRIVATE-PATH-CANARY.txt" })]).includes("PRIVATE-"));
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
  assert.equal(call([{ step: "Use recovery code 482916", status: "in_progress" }]).summary, "Used update_plan");
  assert.equal(call([{ step: "Check backup code ABCD-EFGH", status: "in_progress" }]).summary, "Used update_plan");
  assert.equal(call([{ step: "Check recovery phrase", status: "in_progress" }]).summary, "Used update_plan");
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
  assert.equal(call([{ content: "Use verification code 482916", status: "in_progress" }]).summary,
    "Used TodoWrite");
  assert.equal(call([{ content: "Use ABCD-EFGH", status: "in_progress" }]).summary, "Used TodoWrite");
  assert.equal(call([{ content: "Review the parser ".repeat(8), status: "in_progress" }]).summary, "Used TodoWrite");
  assert.equal(call([{ content: "Pending only", status: "pending" }]).summary, "Used TodoWrite");
});

it("uses the first safe assistant sentence, and never truncates or echoes private prose", () => {
  const text = (value: string) => codexActivity({ timestamp: at, type: "response_item", payload: {
    type: "message", role: "assistant", content: [{ type: "output_text", text: value }],
  } }, "fixture-origin", 3)[0]!.summary;
  assert.equal(text("Review the parser. Then run tests."), "Review the parser.");
  assert.equal(text("Review the parser ".repeat(8) + ". Then run tests."), "Then run tests.");
  for (const unsafe of ["Read /private/host/path.", "Read /fixture/path.", "Visit example.invalid.",
    "Check credential material.", "Use recovery code 482916.", "Enter OTP 482916.", "Enter 482916."]) {
    assert.equal(text(unsafe + " Then continue."), "Then continue.");
    assert.equal(text(unsafe), "Agent message");
  }
  assert.equal(text("Review code coverage. Then continue."), "Review code coverage.");
  const claude = claudeActivity({ timestamp: at, type: "assistant", message: { content: [
    { type: "text", text: "Run focused tests. Then review." },
  ] } }, "fixture-origin", 4)[0]!;
  assert.equal(claude.summary, "Run focused tests.");
});

it("serves screened native commentary and final answers after presentation normalization", () => {
  const text = (value: string, phase: unknown = "commentary") => codexActivity({ timestamp: at, type: "response_item", payload: {
    type: "message", role: "assistant", phase, content: [{ type: "output_text", text: value }],
  } }, "fixture-origin", 3);
  assert.equal(text("I’m reviewing the parser.")[0]?.summary, "I'm reviewing the parser.");
  assert.equal(text("The `launchBlock` field is present.")[0]?.summary, "The launchBlock field is present.");
  assert.equal(text("- **Completed** the assigned read-only scope.", "final_answer")[0]?.summary,
    "Completed the assigned read-only scope.");
  assert.equal(text("Read `/fixture/a.ts.`. Tests pass.")[0]?.summary, "Tests pass.");
  assert.equal(text("Visit https://private.invalid. Tests pass.")[0]?.summary, "Tests pass.");
  assert.equal(text("Use sk-abc. def.")[0]?.summary, "Agent message");
  assert.equal(text("Read `/fixture/path` and use credential material.")[0]?.summary, "Agent message");
  assert.equal(text("Read `/fixture/path. Embedded code words`.")[0]?.summary, "Agent message");
  assert.equal(text("Read **/fixture/path. Embedded code words**.")[0]?.summary, "Agent message");
  assert.equal(text("Review the parser ".repeat(8) + " private-suffix")[0]?.summary, "Agent message");
  assert.equal(text("Read the parser.", "analysis").length, 0);
  assert.equal(text("Read the parser.", "unknown").length, 0);
  assert.equal(text("Read the parser.", null).length, 0);
  assert.equal(text("Read the parser. " + "x".repeat(16_384))[0]?.summary, "Agent message");
  assert.equal(text("`/unsafe/path`.\n".repeat(64) + "Read the parser.")[0]?.summary, "Agent message");
  assert.equal(claudeActivity({ timestamp: at, type: "assistant", message: { content: [
    { type: "text", text: "I’m reviewing the parser." },
  ] } }, "fixture-origin", 4)[0]?.summary, "I'm reviewing the parser.");
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

const codeMode = (input: unknown, line = 11) => codexActivity({ timestamp: at, type: "response_item",
  payload: { type: "custom_tool_call", name: "exec", input } }, "PRIVATE-ORIGIN-CANARY", line);

it("extracts named commands and patch files from multiple static code-mode calls", () => {
  const patch = "*** Begin Patch\n*** Update File: src/main.ts\n@@\n-private\n+PRIVATE-PATCH-CANARY\n*** End Patch\n";
  const input = `const results = await Promise.all([
    tools.exec_command({cmd: "git status --short PRIVATE-ARG-CANARY", yield_time_ms: 1000}),
    tools.exec_command({cmd: ['bash', '-lc', 'go test ./... PRIVATE-ARG-CANARY']}),
    tools.apply_patch(${JSON.stringify(patch)})
  ]); text(results);`;
  const steps = codeMode(input);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map(step => step.toolName), ["exec_command", "exec_command", "apply_patch"]);
  assert.deepEqual(steps.map(step => step.commandHead), ["git status", "go test", null]);
  assert.equal(steps[2]?.filePath, "src/main.ts");
  assert.equal(steps[2]?.summary, "Patched a repository file");
  assert.equal(steps[2]?.target, null); // Existing contract file-target allowlist does not include patches.
  assert.equal(new Set(steps.map(step => step.id)).size, 3);
  assert.deepEqual(codeMode(input), steps);
  assert.ok(!JSON.stringify(steps).includes("PRIVATE-"));
  assert.equal(recentActivity(Array.from({ length: 12 }, (_, i) => codeMode(input, i)).flat()).length, 20);
  assert.equal(codeMode('await tools.exec_command({cmd:"g\\u0069t status --short"})')[0]?.commandHead, "git status");
  assert.equal(codeMode('await tools.exec_command({cmd:`pnpm test PRIVATE-ARG-CANARY`})')[0]?.commandHead, "pnpm test");
});

it("parses code-mode syntax without executing JavaScript or treating quoted text as calls", () => {
  const globals = globalThis as typeof globalThis & { parserExecutionCanary?: boolean };
  assert.equal(globals.parserExecutionCanary, undefined);
  const input = `globalThis.parserExecutionCanary = true;
    const quoted = "tools.exec_command({cmd:'git status'})";
    const template = \`tools.exec_command({cmd:'git diff'})\`;
    const regex = /tools.exec_command\\(\\{cmd:'git log'\\}\\)/;
    // tools.exec_command({cmd: 'git fetch'})
    /* tools.apply_patch('PRIVATE-PATCH-CANARY') */
    function unused() { tools.exec_command({cmd: 'git push'}); }
    const deferred = () => tools.exec_command({cmd: 'git pull'});
    if (false) tools.exec_command({cmd: 'git checkout'});
    false && tools.exec_command({cmd: 'git merge'});
    await tools.exec_command({cmd: 'go vet ./... PRIVATE-ARG-CANARY'});`;
  const steps = codeMode(input);
  assert.equal(globals.parserExecutionCanary, undefined);
  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.commandHead, "go vet");
  assert.ok(!JSON.stringify(steps).includes("PRIVATE-"));
});

it("keeps dynamic, spread, duplicate, optional, deferred and shadowed code-mode shapes generic", () => {
  for (const input of [
    'await tools.exec_command({cmd: getCommand()})',
    'await tools.exec_command({cmd: `git ${subcommand}`})',
    'await tools.exec_command({cmd: "git status", ...options})',
    'await tools.exec_command({...options, cmd: "git status"})',
    'await tools.exec_command({cmd: "git status", cmd: "go test"})',
    'await tools.exec_command({["cmd"]: "git status"})',
    'await tools.exec_command({get cmd() {return "git status"}})',
    'await tools["exec_command"]({cmd: "git status"})',
    'await tools?.exec_command({cmd: "git status"})',
    'const tools = {exec_command: () => 1}; await tools.exec_command({cmd: "git status"})',
    'tools.exec_command = () => 1; await tools.exec_command({cmd: "git status"})',
    'function tools() {}; await tools.exec_command({cmd: "git status"})',
    'const {tools} = replacement; await tools.exec_command({cmd: "git status"})',
    'const alias = tools; alias.exec_command = () => 1; await tools.exec_command({cmd: "git status"})',
    'Object.assign(tools, {exec_command: () => 1}); await tools.exec_command({cmd: "git status"})',
    'const holder = {api: tools}; holder.api.exec_command = () => 1; await tools.exec_command({cmd: "git status"})',
    'delete tools.exec_command; await tools.exec_command({cmd: "git status"})',
    'const call = () => tools.exec_command({cmd: "git status"});',
    'if (flag) tools.exec_command({cmd: "git status"});',
    'flag ? tools.exec_command({cmd: "git status"}) : null',
    'for (const item of items) tools.exec_command({cmd: "git status"});',
  ]) {
    const steps = codeMode(input);
    assert.equal(steps.length, 1, input);
    assert.equal(steps[0]?.commandHead, null, input);
    assert.equal(steps[0]?.filePath, null, input);
    assert.equal(steps[0]?.kind, "tool", input);
  }
});

it("withholds unsafe patch paths and command arguments from code-mode activity", () => {
  const patch = "*** Begin Patch\n*** Update File: /PRIVATE-PATH-CANARY\n*** Update File: src/secret-token.ts\n*** Update File: ../outside.ts\n*** End Patch";
  const steps = codeMode(`await tools.exec_command({cmd: "git status PRIVATE-ARG-CANARY"});
    await tools.apply_patch(${JSON.stringify(patch)});`);
  assert.equal(steps[0]?.commandHead, "git status");
  assert.ok(steps.slice(1).every(step => step.filePath === null && step.target === null));
  assert.ok(!JSON.stringify(steps).includes("PRIVATE-"));
  assert.ok(!JSON.stringify(steps).includes("secret-token"));
  assert.ok(!JSON.stringify(steps).includes("outside"));
});

it("keeps malformed and exceeded code-mode bounds generic without a partial command prefix", () => {
  const valid = 'await tools.exec_command({cmd: "git status"});';
  for (const input of [null, { code: valid }, {cmd: 'git status'}, '{"cmd":"git status"}', '', 'await tools.exec_command({cmd: "git status});',
    '/*' + 'x'.repeat(65_536) + '*/' + valid,
    '/*' + '🙂'.repeat(20_000) + '*/' + valid,
    valid + '0;'.repeat(5000),
    '('.repeat(65) + '1' + ')'.repeat(65) + ';' + valid,
    valid.repeat(21),
    Array.from({ length: 20 }, () => 'await tools.apply_patch("*** Begin Patch\\n*** Update File: src/a.ts\\n*** Update File: src/b.ts\\n*** End Patch");').join(''),
  ]) {
    const steps = codeMode(input);
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.toolName, null);
    assert.equal(steps[0]?.summary, "Used a tool");
    assert.equal(steps[0]?.commandHead, null);
    assert.equal(steps[0]?.filePath, null);
  }
});
