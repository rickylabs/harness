/** Synthetic observation tests only. Never reads a telemetry store or dispatch receipt. */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Unexpected tooling errors must not turn a checkout path into a public diagnostic.
process.setUncaughtExceptionCaptureCallback(() => {
  console.error("INCONCLUSIVE: mutation runner did not finish");
  process.exitCode = 2;
});
const root = fileURLToPath(new URL("../", import.meta.url));
const contracts = "packages/contracts/src/agent-observations.ts";
const telemetry = "packages/telemetry/src/agent-observations.ts";
const originals = new Map([contracts, telemetry].map(path => [path, readFileSync(new URL(path, new URL("../", import.meta.url)), "utf8")]));
const tests = ["--test", "--test-reporter=dot", "packages/contracts/dist/agent-observations.test.js", "packages/telemetry/dist/agent-observations.test.js"];
function command(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 120_000 });
  if (result.error || result.signal) throw Error("INCONCLUSIVE: command did not complete");
  return result;
}
function build() {
  const result = command(["node_modules/typescript/bin/tsc", "-b", "packages/telemetry"]);
  if (result.status !== 0) throw Error("INCONCLUSIVE: mutation must compile before its assertion can count");
}
function check(label, expectPass) {
  const result = command(tests);
  // Dot reporter prints only assertion outcomes. Never publish a stack or private path on failure.
  const dots = result.stdout.split("\n").filter(line => /^[.X]+$/.test(line)).join("\n");
  if (!dots) throw Error("INCONCLUSIVE: expected test assertion output");
  console.log(`${label}: node ${tests.join(" ")}`);
  console.log(`exit ${result.status} (dot outcome lines)\n${dots}`);
  if (expectPass ? result.status !== 0 : result.status !== 1 || !dots.includes("X")) {
    throw Error(expectPass ? "restored control failed" : "mutation survived");
  }
}
const mutations = [
  ["complete reason consistency", contracts, 'if (r.complete && r.reason !== null) return bad();', ''],
  ["incomplete reason allowlist", contracts, 'reason !== "ancestry_unavailable"', 'false'],
  ["nonempty dispatch collection", contracts, 'raw.length === 0', 'false'],
  ["dispatch-only eligibility", contracts, '!agents.every(dispatchOnly)', 'false'],
  ["unavailable native parent", contracts, 'a.parentAgentId.state === "unavailable" && a.parentAgentId.reason === "identity_unavailable"', 'true'],
  ["parent unavailable reason", contracts, 'a.parentAgentId.reason === "identity_unavailable"', 'true'],
  ...["provider", "model", "effort"].map(field => [
    `null observed ${field}`, contracts,
    'ROUTE_FIELDS.every(field => a.route.observed[field].value === null)',
    `ROUTE_FIELDS.filter(field => field !== "${field}").every(field => a.route.observed[field].value === null)`,
  ]),
  // cwd is already forbidden by the canonical public route reader, before dispatch eligibility.
  ["existing public cwd guard", contracts, '(field === "cwd" && leaf.value !== null)', 'false'],
  ["unknown execution evidence", contracts, 'a.running.value === null && a.running.reason === "observer-unavailable" &&\n    a.running.observedAt === null && a.running.revision === null', 'true'],
  ["unknown execution reason", contracts, 'a.running.reason === "observer-unavailable"', 'true'],
  ["execution timestamp unavailable", contracts, 'a.running.observedAt === null', 'true'],
  ["execution revision unavailable", contracts, 'a.running.revision === null', 'true'],
  ["runtime tab unavailable", contracts, 'a.tab.value === null', 'true'],
  ["runtime terminal unavailable", contracts, 'a.terminal.value === null', 'true'],
  ["separate unavailable costs", contracts, 'Object.values(a.cost).every(row => row.availability === "unavailable")', 'true'],
  ["complete trees require proven parentage", contracts, 'r.complete && a.parentAgentId.state === "unavailable"', 'false'],
  ["unique dispatch assignment", contracts, '!r.complete || a.parentAgentId.state === "confirmed-root"', 'a.parentAgentId.state === "confirmed-root"'],
  ["preserved incompleteness", contracts, 'complete: r.complete, reason, agents', 'complete: true, reason: null, agents'],
  ["producer validates dispatch-only rows", telemetry, 'reason !== null && reason !== "ancestry_unavailable"', 'reason !== null'],
  ["producer distinguishes native bindings", telemetry, 'parentAgentId: d.external === null', 'parentAgentId: false'],
  ["native runtime completeness remains required", telemetry, 'roots.size > 0 && !input.nativeComplete', 'false'],
];
function writeSource(path, source) {
  const base = new URL("../", import.meta.url);
  writeFileSync(new URL(path, base), source);
  // Re-emit only the changed module; baseline/final builds perform full project typechecking.
  const result = ts.transpileModule(source, { fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } });
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error("INCONCLUSIVE: mutation did not compile");
  writeFileSync(new URL(path.replace("/src/", "/dist/").replace(/\.ts$/, ".js"), base), result.outputText);
}
function restore() {
  for (const [path, source] of originals) writeSource(path, source);
}
try {
  build();
  check("baseline", true);
  for (const [name, path, from, to] of mutations) {
    const source = originals.get(path);
    if (source.split(from).length !== 2) throw Error("mutation site must be unique");
    writeSource(path, source.replace(from, to));
    try { check(`mutated: ${name}`, false); }
    finally { restore(); }
    check(`restored: ${name}`, true);
  }
  console.log(`PASS: ${mutations.length} mutations failed assertions; ${mutations.length} restored controls passed`);
} finally {
  restore();
  build();
}
