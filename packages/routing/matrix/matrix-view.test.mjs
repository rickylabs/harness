import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DELEGATION_ROLES, LOGICAL_MODEL_IDS, WORKLOAD_TIERS } from "./delegation-matrix.ts";
import { matrixTable } from "./cli/delegation-matrix-table.ts";
import { fallbackMatches, runMatrixView } from "./cli/matrix-view.ts";

// Recorded once from NetScript's viewer at the recorded SHA (it read this matrix pinned at
// harnessMatrixRevision). CI replays frozen data and never installs, imports or reads NetScript.
const reference = JSON.parse(readFileSync(new URL("../test-fixtures/matrix-view.e75161c.json", import.meta.url), "utf8"));
const isHelp = recorded => recorded.stdout.startsWith("Usage: ");

test("the frozen NetScript viewer reference is intact and covers every mode", () => {
  assert.equal(reference.sourceRevision, "e75161c32e8189b4cb6716b92e1bf16702648886");
  assert.equal(createHash("sha256").update(JSON.stringify(reference.cases)).digest("hex"), reference.casesSha256);
  const flags = new Set(reference.cases.flatMap(c => c.args.filter(arg => arg.startsWith("-"))));
  for (const flag of ["--tier", "--role", "--plan-evaluator", "--impl-evaluator", "--fallback-of", "--fallback", "--json", "--help", "-h", "--"]) {
    assert.ok(flags.has(flag), flag);
  }
  assert.ok(reference.cases.some(c => c.args.length === 0));
  assert.ok(reference.cases.filter(c => c.status === 2).length >= 22);
  // A `--` after an earlier bad argument must still be the reported refusal, as in NetScript.
  assert.ok(reference.cases.some(c => c.args.join(" ") === "--tier huge --" && c.stderr === "Unknown argument: --\n"));
});

// Preserve the source recording. Compare changed routes against the owner policy,
// ignoring only Markdown column padding that changes with the longer effort label.
function ownerPolicy(value) {
  if (Array.isArray(value)) return value.map(ownerPolicy);
  if (!value || typeof value !== "object") return value;
  if (["luna", "sol"].includes(value.model) && Object.hasOwn(value, "effort")) {
    return { ...value, model: "sol", effort: value.model === "luna" ? "low" : "xhigh" };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ownerPolicy(child)]));
}
function markdownContent(output) {
  return output.split("\n")
    .filter(line => !/^\|[ |:-]+\|$/.test(line))
    .map(line => line.startsWith("|") ? line.split("|").map(cell => cell.trim()).join("|") : line)
    .join("\n");
}
function currentMarkdown(output) {
  return output.replaceAll("Luna max", "SOL low")
    .replace(/SOL (high|medium)/g, "SOL xhigh");
}
const recordedFallbacks = model => JSON.parse(reference.cases.find(recorded =>
  recorded.args.join(" ") === `--fallback ${model} --json`).stdout).matches;
const currentSolFallbacks = ownerPolicy([...recordedFallbacks("luna"), ...recordedFallbacks("sol")]);

function assertChangedFallback(args, actual) {
  const flag = Math.max(args.lastIndexOf("--fallback"), args.lastIndexOf("--fallback-of"));
  const model = args[flag + 1];
  if (!["sol", "luna"].includes(model)) return false;
  const tier = args.includes("--tier") ? args[args.indexOf("--tier") + 1] : undefined;
  const role = args.includes("--role") ? args[args.indexOf("--role") + 1] : undefined;
  const matches = model === "luna" ? [] : currentSolFallbacks.filter(match =>
    (!tier || match.tier === tier) && (!role || match.role === role) &&
    (!(tier || role) || match.scope === "workload"));
  assert.deepEqual(JSON.parse(runMatrixView([...args, "--json"]).stdout),
    { schemaVersion: 1, mode: "fallback", model, matches }, JSON.stringify(args));
  if (!args.includes("--json")) {
    assert.ok(actual.stdout.startsWith(`# Declared fallbacks for ${model === "sol" ? "SOL" : "Luna"}\n`));
    if (!matches.length) {
      assert.equal(actual.stdout.trimEnd(), `# Declared fallbacks for Luna\n\nNo selected context declares this model as its primary with a fallback.`);
    } else {
      const rows = markdownContent(actual.stdout).split("\n").filter(line => line.startsWith("|")).slice(1);
      assert.equal(rows.length, matches.length);
      for (const [index, match] of matches.entries()) {
        const cells = rows[index].split("|");
        assert.deepEqual(cells.slice(1, 3), [match.scope, match.tier]);
        assert.equal(cells[4], `SOL ${match.primary.effort}`);
      }
    }
  }
  return true;
}

test("every recorded query preserves refusals and unrelated routes under the owner decision", () => {
  for (const expected of reference.cases) {
    const actual = runMatrixView(expected.args);
    const label = JSON.stringify(expected.args);
    assert.equal(actual.status, expected.status, label);
    assert.equal(actual.stderr, expected.stderr, label);
    if (!isHelp(expected)) {
      if (expected.status !== 0) {
        assert.equal(actual.stdout, expected.stdout, label);
      } else if (!assertChangedFallback(expected.args, actual)) {
        if (expected.args.includes("--json")) {
          assert.deepEqual(JSON.parse(actual.stdout), ownerPolicy(JSON.parse(expected.stdout)), label);
        } else {
          assert.equal(markdownContent(actual.stdout), markdownContent(currentMarkdown(expected.stdout)), label);
        }
      }
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
  // Serialized, so a role without a loop policy (`policy: undefined`) is compared as emitted.
  let views = 0;
  for (const tier of [undefined, ...WORKLOAD_TIERS]) {
    for (const role of [undefined, ...DELEGATION_ROLES]) {
      const args = [...(tier ? ["--tier", tier] : []), ...(role ? ["--role", role] : []), "--json"];
      assert.equal(runMatrixView(args).stdout, `${JSON.stringify(matrixTable({ tier, role }), null, 2)}\n`, args.join(" "));
      views++;
    }
  }
  assert.equal(views, 54);
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
