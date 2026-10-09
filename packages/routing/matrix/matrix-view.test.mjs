import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { DELEGATION_ROLES, LOGICAL_MODEL_IDS, WORKLOAD_TIERS } from "./delegation-matrix.ts";
import { matrixTable } from "./cli/delegation-matrix-table.ts";
import { fallbackMatches, runMatrixView } from "./cli/matrix-view.ts";
import {
  OWNER_ROUTING_2026_10_08, ownerCoordinatorRoutes, ownerWorkloadHead, ownerWorkloadRoutes,
} from "../test-fixtures/owner-routing.2026-10-08.mjs";

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
  if (value.model === "grok_4_6" && Object.hasOwn(value, "effort")) return { ...value, model: "grok_4_7" };
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
    .replace(/SOL (high|medium)/g, "SOL xhigh").replaceAll("Grok 4.6", "Grok 4.7")
    .replace(/Opus 5(?!\.)/g, "Opus 5.5 (legacy logical alias)");
}
// The 2026-10-08 decision prepends a route to some cells; apply it to the recorded views.
function ownerRouting(view) {
  if (!view || typeof view !== "object" || !Array.isArray(view.tiers)) return view;
  const tiers = view.tiers.map(row => view.mode === "role"
    ? { ...row, routes: ownerWorkloadRoutes(row.tier, view.role, row.routes) }
    : Object.fromEntries(Object.entries(row).map(([key, routes]) =>
      [key, DELEGATION_ROLES.includes(key) ? ownerWorkloadRoutes(row.tier, key, routes) : routes])));
  const coordinators = view.coordinators && Object.fromEntries(Object.entries(view.coordinators)
    .map(([scope, routes]) => [scope, ownerCoordinatorRoutes(scope, routes)]));
  return { ...view, tiers, ...(coordinators ? { coordinators } : {}) };
}
const ownerLabel = route => `${route.model === "sol" ? "SOL" : "Opus 5.5"} ${route.effort}`;
const fullColumns = { "Implementer (default)": "implementation", "Plan eval (default)": "plan_evaluation", "Impl eval (default)": "implementation_evaluation" };
const roleTitles = { "# Implementation routes": "implementation", "# PLAN-EVAL routes": "plan_evaluation", "# IMPL-EVAL routes": "implementation_evaluation" };
function shiftCell(cells, index, head) {
  if (!head || cells[index] === "—") return;
  cells.splice(index, 2, ownerLabel(head), [cells[index], ...(cells[index + 1] === "—" ? [] : [cells[index + 1]])].join(" → "));
}
function ownerMarkdown(content) {
  const lines = content.split("\n");
  const role = roleTitles[lines[0]];
  let header = [];
  return lines.map(line => {
    if (!line.startsWith("|")) { header = []; return line; }
    const cells = line.split("|");
    if (!header.length) { header = cells; return line; }
    const name = cells[1].split("<br>")[0];
    if (header[1] === "Scope") shiftCell(cells, 2, OWNER_ROUTING_2026_10_08.coordinators[name]);
    else if (header[1] === "Tier / complexity") {
      for (const [column, cellRole] of Object.entries(fullColumns)) shiftCell(cells, header.indexOf(column), ownerWorkloadHead(name, cellRole));
    } else if (header[1] === "Tier" && role) shiftCell(cells, 2, ownerWorkloadHead(name, role));
    return cells.join("|");
  }).join("\n");
}

// Every fallback view is derived from the recorded full table under the current owner policy.
const currentTable = ownerRouting(ownerPolicy(JSON.parse(reference.cases.find(recorded => recorded.args.join(" ") === "--json").stdout)));
function currentFallbacks(model, tier, role) {
  const matches = [];
  for (const row of currentTable.tiers) for (const cellRole of DELEGATION_ROLES) {
    if ((tier && row.tier !== tier) || (role && cellRole !== role)) continue;
    const [primary, ...fallbacks] = row[cellRole];
    if (primary?.model === model && fallbacks.length) matches.push({ scope: "workload", tier: row.tier, role: cellRole, primary, fallbacks });
  }
  if (!tier && !role) for (const [scope, [primary, ...fallbacks]] of Object.entries(currentTable.coordinators)) {
    if (primary?.model === model && fallbacks.length) matches.push({ scope: "coordinator", tier: scope, role: "coordinator", primary, fallbacks });
  }
  return matches;
}

function assertFallback(args, actual, recorded) {
  const flag = Math.max(args.lastIndexOf("--fallback"), args.lastIndexOf("--fallback-of"));
  if (flag < 0) return false;
  const tier = args.includes("--tier") ? args[args.indexOf("--tier") + 1] : undefined;
  const role = args.includes("--role") ? args[args.indexOf("--role") + 1] : undefined;
  const view = JSON.parse(runMatrixView([...args, "--json"]).stdout);
  if (args.includes("--json")) assert.equal(view.model, JSON.parse(recorded.stdout).model, JSON.stringify(args));
  const matches = currentFallbacks(view.model, tier, role);
  assert.deepEqual(view, { schemaVersion: 1, mode: "fallback", model: view.model, matches }, JSON.stringify(args));
  const recordedJson = reference.cases.find(other => other.args.join(" ") === [...args, "--json"].join(" "));
  if (!args.includes("--json") && recordedJson && isDeepStrictEqual(ownerPolicy(JSON.parse(recordedJson.stdout).matches), matches)) {
    assert.equal(markdownContent(actual.stdout), markdownContent(currentMarkdown(recorded.stdout)), JSON.stringify(args));
  } else if (!args.includes("--json")) {
    const title = recorded.stdout.split("\n")[0];
    assert.ok([title, currentMarkdown(title)].includes(actual.stdout.split("\n")[0]), JSON.stringify(args));
    if (!matches.length) {
      assert.ok(actual.stdout.trimEnd().endsWith("\n\nNo selected context declares this model as its primary with a fallback."));
    } else {
      const rows = markdownContent(actual.stdout).split("\n").filter(line => line.startsWith("|")).slice(1);
      assert.equal(rows.length, matches.length);
      for (const [index, match] of matches.entries()) {
        const cells = rows[index].split("|");
        assert.deepEqual(cells.slice(1, 3), [match.scope, match.tier]);
        if (view.model === "sol") assert.equal(cells[4], `SOL ${match.primary.effort}`);
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
    assert.equal(actual.stderr, expected.stderr.startsWith("Unknown logical model ") ? expected.stderr.replace(/(; expected )[^\n]+/, `$1${LOGICAL_MODEL_IDS.join(", ")}`) : expected.stderr, label);
    if (!isHelp(expected)) {
      if (expected.status !== 0) {
        assert.equal(actual.stdout, expected.stdout, label);
      } else if (!assertFallback(expected.args, actual, expected)) {
        if (expected.args.includes("--json")) {
          assert.deepEqual(JSON.parse(actual.stdout), ownerRouting(ownerPolicy(JSON.parse(expected.stdout))), label);
        } else {
          assert.equal(markdownContent(actual.stdout), ownerMarkdown(markdownContent(currentMarkdown(expected.stdout))), label);
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
  assert.ok(sol.some(match => match.scope === "coordinator" && match.tier === "project"));
  assert.ok(sol.some(match => match.scope === "workload" && match.tier === "feature" && match.role === "implementation_evaluation"));
  assert.deepEqual(fallbackMatches("sol", { tier: "feature" }).map(match => `${match.scope}/${match.role}`),
    ["workload/plan_evaluation", "workload/implementation_evaluation"]);
  const opus = fallbackMatches("opus_5_5");
  assert.ok(opus.some(match => match.scope === "coordinator" && match.tier === "milestone"));
  assert.ok(opus.some(match => match.scope === "workload" && match.tier === "feature" && match.role === "implementation"));
});
