/** Mutate compiled behavior, require a red test, restore bytes, require green. No live data. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const cost = "packages/telemetry/dist/agent-cost.js", agents = "packages/telemetry/dist/agent-observations.js";
const cases = [
  ["finite numeric measurements", cost, "Number.isFinite(value) && value >= 0", "value >= 0"],
  ["nonnegative measurements", cost, "Number.isFinite(value) && value >= 0", "Number.isFinite(value)"],
  ["canonical timestamp", cost, "new Date(value).toISOString() === value", "true"],
  ["finite timestamp", cost, "Number.isFinite(Date.parse(value))", "true"],
  ["usage timestamp valid", cost, "!Number.isFinite(time(run.updatedAt))", "false"],
  ["usage timestamp not future", cost, "time(run.updatedAt) > time(capturedAt)", "false"],
  ["capture clock valid", cost, "if (!Number.isFinite(time(capturedAt)))", "if (false)"],
  ["absent token component", cost, "if (value === undefined)", "if (false)"],
  ["token integer bound", cost, "!Number.isSafeInteger(value)", "false"],
  ["invalid token row isolation", cost, "const runTokens = invalidTokens", "const runTokens = false"],
  ["empty token measurement", cost, "Object.keys(measurement).length === 0", "false"],
  ["absent currency", cost, "amount === undefined", "false"],
  ["invalid currency", cost, "!nonnegative(amount)", "false"],
  ["empty quota source", cost, "if (run.quota.length === 0)", "if (false)"],
  ["quota timestamp valid", cost, "!Number.isFinite(time(q.observedAt))", "false"],
  ["quota timestamp not future", cost, "time(q.observedAt) > time(capturedAt)", "false"],
  ["latest quota batch", cost, "run.quota.filter(q => q.observedAt === observedAt)", "run.quota"],
  ["same quota source", cost, "if (q.source !== run.source)", "if (false)"],
  ["quota missing percent", cost, "q.usedPercent === null || ", ""],
  ["quota missing duration", cost, "q.windowMinutes === null || ", ""],
  ["quota missing reset", cost, " || q.resetsAt === null", ""],
  ["quota percent valid", cost, "!nonnegative(q.usedPercent)", "false"],
  ["quota percent ceiling", cost, "q.usedPercent > 100", "false"],
  ["quota duration integer", cost, "!Number.isSafeInteger(q.windowMinutes)", "false"],
  ["quota duration positive", cost, "q.windowMinutes <= 0", "false"],
  ["quota reset valid", cost, "!Number.isFinite(time(q.resetsAt))", "false"],
  ["quota reset after observation", cost, "time(q.resetsAt) <= time(observedAt)", "false"],
  ["quota conflict", cost, "if (prior && JSON.stringify(prior) !== JSON.stringify(value))", "if (false)"],
  ["most constrained window", cost, "a.remainingPercent - b.remainingPercent", "b.remainingPercent - a.remainingPercent"],
  ["earliest batch expiry", cost, "[...windows.values()].map(w => w.resetsAt).sort()[0]", "selected.resetsAt"],
  ["quota validity revision", cost, "revision({ observedAt, validUntil, measurement: selected })", "revision({ observedAt, measurement: selected })"],
  ["quota expiry", cost, "if (latest.some(q => time(q.resetsAt) <= time(capturedAt)))", "if (false)"],
  ["root cost bind", agents, "projectAgentCost(native.get(key), input.observedAt)", "unavailableAgentCost()"],
  ["child cost bind", agents, "projectAgentCost(run, input.observedAt)", "unavailableAgentCost()"],
  ["root cost revision", agents, "{ prior: root.revision, cost }", "{ prior: root.revision }"],
  ["child cost revision", agents, "{ parent: parent.agentId, observedAt, outcome: run.outcome, cost }", "{ parent: parent.agentId, observedAt, outcome: run.outcome }"],
];
const testArgs = ["--test", "packages/telemetry/dist/agent-cost.test.js"];
const test = () => spawnSync(process.execPath, testArgs, { cwd: root, encoding: "utf8" });
assert.equal(test().status, 0, "positive baseline must pass before any mutation");
for (const [name, file, before, after] of cases) {
  const location = new URL("../" + file, import.meta.url), original = readFileSync(location, "utf8");
  assert.equal(original.split(before).length - 1, 1, "mutation anchor must be unique: " + name);
  let broken;
  try {
    writeFileSync(location, original.replace(before, after));
    broken = test();
  } finally { writeFileSync(location, original); }
  const restored = test();
  const output = broken.stdout + broken.stderr;
  assert.equal(broken.status, 1, "mutation survived: " + name);
  assert.match(output, /(?:not ok|✖|fail [1-9])/u, "mutation must fail tests, not just execution");
  assert.doesNotMatch(output, /SyntaxError|ERR_MODULE_NOT_FOUND/, "invalid mutation is not evidence");
  assert.equal(restored.status, 0, "restored controls must pass: " + name);
  const failure = output.split("\n").filter(line => /^(?:not ok|✖|ℹ (?:tests|pass|fail)|# (?:tests|pass|fail))/.test(line));
  console.log(JSON.stringify({ mutation: name, command: "node " + testArgs.join(" "), mutatedExit: broken.status,
    output: failure, restoredExit: restored.status }));
}
console.log(JSON.stringify({ verdict: "PASS", mutationsKilled: cases.length, restoredControls: cases.length }));
