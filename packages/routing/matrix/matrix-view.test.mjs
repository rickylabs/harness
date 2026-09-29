import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LOGICAL_MODEL_IDS } from "./delegation-matrix.ts";
import { matrixTable } from "./cli/delegation-matrix-table.ts";
import { fallbackMatches, runMatrixView } from "./cli/matrix-view.ts";

// Recorded once from NetScript's viewer at the recorded SHA (it read this matrix pinned at
// harnessMatrixRevision). CI replays frozen data and never installs, imports or reads NetScript.
const reference = JSON.parse(readFileSync(new URL("../test-fixtures/matrix-view.e75161c.json", import.meta.url), "utf8"));
const isHelp = args => args.includes("--help") || args.includes("-h");

test("the frozen NetScript viewer reference is intact and covers every mode", () => {
  assert.equal(reference.sourceRevision, "e75161c32e8189b4cb6716b92e1bf16702648886");
  assert.equal(createHash("sha256").update(JSON.stringify(reference.cases)).digest("hex"), reference.casesSha256);
  const flags = new Set(reference.cases.flatMap(c => c.args.filter(arg => arg.startsWith("-"))));
  for (const flag of ["--tier", "--role", "--plan-evaluator", "--impl-evaluator", "--fallback-of", "--fallback", "--json", "--help", "-h", "--"]) {
    assert.ok(flags.has(flag), flag);
  }
  assert.ok(reference.cases.some(c => c.args.length === 0));
  assert.ok(reference.cases.filter(c => c.status === 2).length >= 9);
});

test("every recorded query renders byte-identically, including refusals", () => {
  for (const expected of reference.cases) {
    const actual = runMatrixView(expected.args);
    const label = JSON.stringify(expected.args);
    assert.equal(actual.status, expected.status, label);
    assert.equal(actual.stderr, expected.stderr, label);
    if (!isHelp(expected.args)) {
      assert.equal(actual.stdout, expected.stdout, label);
      continue;
    }
    // Only the usage line names the command; it points at Harness instead of the NetScript task.
    const [actualUsage, ...actualRest] = actual.stdout.split("\n");
    const [expectedUsage, ...expectedRest] = expected.stdout.split("\n");
    assert.equal(expectedUsage, "Usage: deno task agentic:matrix -- [options]", label);
    assert.equal(actualUsage, "Usage: deno run --no-config --no-lock matrix/cli/matrix-view.ts [options]", label);
    assert.deepEqual(actualRest, expectedRest, label);
  }
});

test("viewer JSON for full, tier and role modes is the stable table the bridge reads", () => {
  const json = args => JSON.parse(runMatrixView([...args, "--json"]).stdout);
  assert.deepEqual(json([]), matrixTable());
  assert.deepEqual(json(["--tier", "complex"]), matrixTable({ tier: "complex" }));
  assert.deepEqual(json(["--role", "impl-eval"]), matrixTable({ role: "implementation_evaluation" }));
  assert.deepEqual(json(["--tier", "feature", "--plan-evaluator"]), matrixTable({ tier: "feature", role: "plan_evaluation" }));
});

test("fallback lookup lists every primary context, workload and coordinator", () => {
  for (const model of LOGICAL_MODEL_IDS) {
    const workload = fallbackMatches(model, { role: "implementation" });
    assert.ok(workload.every(match => match.scope === "workload" && match.primary.model === model && match.fallbacks.length > 0), model);
  }
  const sol = fallbackMatches("sol");
  assert.ok(sol.some(match => match.scope === "coordinator" && match.tier === "milestone"));
  assert.ok(sol.some(match => match.scope === "workload" && match.tier === "feature" && match.role === "implementation"));
  assert.deepEqual(fallbackMatches("sol", { tier: "feature" }).map(match => `${match.scope}/${match.role}`), ["workload/implementation"]);
});
