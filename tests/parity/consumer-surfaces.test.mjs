// Consumer parity: the surfaces atelier-cockpit and orchid read from this repository at a pinned
// revision (docs/STRUCTURE.md#consumer-surfaces). Every assertion names the consumer that breaks.
// Run against the built workspace (`pnpm run build`, or inside `pnpm test` after test:packages).
// Exports, file existence, exit codes and parsed JSON only; never rendered or help text (rule 6).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { validateProfileCollection } from "../../scripts/profile-frontmatter.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const load = path => import(pathToFileURL(join(root, path)).href);
const COCKPIT = "cockpit";
const ORCHID = "orchid";
const BOTH = "orchid+cockpit";

/** Assert every named export exists with the kind the consumer relies on. */
function assertExports(consumer, surface, module, expected) {
  for (const [name, kind] of Object.entries(expected)) {
    assert.equal(typeof module[name], kind, `${consumer}: ${surface} no longer exports ${name} (${kind})`);
  }
}
const kinds = (kind, names) => Object.fromEntries(names.split(/\s+/).filter(Boolean).map(name => [name, kind]));

before(() => {
  for (const built of ["packages/contracts/dist/index.js", "packages/subagents/dist/dispatch.js", "packages/routing/dist/discovery.js"]) {
    assert.ok(existsSync(join(root, built)), `parity needs the built workspace: ${built} is missing; run pnpm run build first`);
  }
});

// Group 1: @rickylabs/harness-contracts, as atelier-cockpit installs it from npm (deno.json).
test("cockpit: @rickylabs/harness-contracts entry points, manifest and runtime values", async () => {
  const pkg = "@rickylabs/harness-contracts";
  const manifest = (await import(`${pkg}/package.json`, { with: { type: "json" } })).default;
  assert.equal(manifest.name, pkg, `${COCKPIT}: ${pkg}/package.json changed its name`);
  assert.equal(manifest.license, "MIT", `${COCKPIT}: ${pkg}/package.json changed its license`);
  assert.equal(manifest.dsh?.protocol, 1, `${COCKPIT}: ${pkg}/package.json dsh.protocol is no longer 1`);
  for (const subpath of [".", "./server", "./route", "./package.json"]) {
    assert.ok(Object.hasOwn(manifest.exports ?? {}, subpath), `${COCKPIT}: ${pkg} no longer exports the subpath ${subpath}`);
  }
  const main = await import(pkg);
  assertExports(COCKPIT, pkg, main, {
    ...kinds("object", `PROVIDER_METER_UNITS PROVIDER_USAGE_REASONS AGENT_UNAVAILABLE_REASONS
      AGENT_ACTION_REJECTED_REASONS RUN_OBSERVATION_INCOMPLETE_REASONS RUN_OBSERVATION_UNAVAILABLE_REASONS
      OPENCODE_OBSERVED_SOURCES ISSUE_LAUNCH_REFUSAL_REASONS AGENT_ACTIVITY_STATES AGENT_ACTIVITY_GAPS`),
    ...kinds("number", "MAX_ISSUE_AGENT_TREE_BYTES PROTOCOL_VERSION"),
    ...kinds("function", `compareRouteIdentity emptyFold foldValue snapshotOf publicActivityTarget
      publicActivityText publicOpenCodeModel readAccountUsageDocument readAccountUsageEnvelope
      readAgentActivity readGovernanceSnapshot readIssueAgentTreeSnapshot readProviderBudgetDecisions readProviderLimitSnapshot readProviderUsageSnapshot
      readRepositoryRunObservation encodeWorkflowRevisionBundle readAgentObservations readRoutineRevision
      readRoutineWake readWorkflowRevision readWorkflowRevisionBundle unavailableAgentCost`),
  });
  assert.equal(main.PROTOCOL_VERSION, 1, `${COCKPIT}: ${pkg} PROTOCOL_VERSION is no longer 1`);
  assertExports(COCKPIT, `${pkg}/server`, await import(`${pkg}/server`), kinds("function", "openHub publish subscribe"));
  assertExports(COCKPIT, `${pkg}/route`, await import(`${pkg}/route`), kinds("function", "compareRouteIdentity"));
});

// Group 2: the routing matrix files orchid's divybot bridges import from a pinned checkout
// (cmd/divybot/matrix-bridge.ts, evaluator-preflight-bridge.ts); cockpit's pinned-matrix probes
// read the same files.
const MATRIX = "packages/routing/matrix";
const MATRIX_SURFACES = [
  [`${MATRIX}/delegation-matrix.ts`, [
    [ORCHID, kinds("object", "MATRIX_AUTHORITY MODEL_TRANSPORTS")],
    [ORCHID, kinds("function", "assertOwnerMatrixOverride assertPrivilegedTierAuthorization ownerMatrixOverrideWorklogEntry")],
    [BOTH, kinds("object", "MODEL_CATALOG DELEGATION_ROLES WORKLOAD_TIERS COORDINATOR_TIERS")],
    [BOTH, kinds("function", "isTransportAllowedForRole")],
    [COCKPIT, kinds("object", "COORDINATOR_MATRIX DELEGATION_MATRIX LOGICAL_MODEL_LABELS MODEL_TRANSPORT_PRIORITY")],
  ]],
  [`${MATRIX}/routing-policy.ts`, [[BOTH, kinds("function", "resolveCoordinatorRoute resolveWorkloadRoute")]]],
  [`${MATRIX}/contract.ts`, [[ORCHID, kinds("object", "EFFORTS PROVIDER_KINDS")]]],
  [`${MATRIX}/opencode-preflight.ts`, [[ORCHID, kinds("function", "preflightWorkloadRoute")]]],
  [`${MATRIX}/launchability.ts`, [[ORCHID, kinds("function", "RouteLaunchError")]]],
];
for (const [path, groups] of MATRIX_SURFACES) {
  const consumers = [...new Set(groups.flatMap(([consumer]) => consumer.split("+")))].join("+");
  test(`${consumers}: ${path} exports what the consumers import`, async () => {
    assert.ok(existsSync(join(root, path)), `${consumers}: ${path} is missing`);
    const module = await load(path);
    for (const [consumer, expected] of groups) assertExports(consumer, path, module, expected);
  });
}

// orchid's matrix-bridge.ts spawns this exact argv from the checkout root, under Deno, with no
// config file, and reads at most 1 MiB of stdout. The CLI calls Deno.args, so Node cannot run it.
const TABLE_CLI = `${MATRIX}/cli/delegation-matrix-table.ts`;
function runTable(args) {
  const run = spawnSync("deno", ["run", "--no-config", "--no-lock", TABLE_CLI, ...args, "--json"], {
    cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.notEqual(run.error?.code, "ENOENT", `${ORCHID}: deno is not on PATH — the ${TABLE_CLI} surface is unproven`);
  assert.ifError(run.error);
  assert.equal(run.status, 0, `${ORCHID}: ${TABLE_CLI} ${args.join(" ")} --json exited ${run.status}`);
  assert.ok(Buffer.byteLength(run.stdout) <= 1024 * 1024, `${ORCHID}: ${TABLE_CLI} output exceeds the bridge's 1 MiB bound`);
  const table = JSON.parse(run.stdout);
  assert.equal(table.schemaVersion, 1, `${ORCHID}: ${TABLE_CLI} schemaVersion is no longer 1`);
  return table;
}
test("orchid: the delegation-matrix-table CLI runs under Deno with the bridge's argv and exits 0", async () => {
  const matrix = await load(`${MATRIX}/delegation-matrix.ts`);
  const [tier] = matrix.WORKLOAD_TIERS;
  const [role] = matrix.DELEGATION_ROLES;
  const [scope] = matrix.COORDINATOR_TIERS;
  const workload = runTable(["--tier", tier, "--role", role]);
  assert.ok(Array.isArray(workload.tiers?.find(row => row.tier === tier)?.routes),
    `${ORCHID}: ${TABLE_CLI} --tier --role no longer yields tiers[].routes`);
  const full = runTable([]);
  assert.ok(Array.isArray(full.coordinators?.[scope]), `${ORCHID}: ${TABLE_CLI} no longer yields coordinators[tier]`);
});

// Group 3: the source files atelier-cockpit imports by raw GitHub URL (deno.json import map).
// Exports are read from the one-to-one tsc output: the sources import siblings as `./x.js`, which
// cockpit's import map rewrites and Node cannot. The source import lists are pinned exactly,
// because a raw-URL consumer resolves only the imports its map already covers.
const RAW_SOURCES = {
  "packages/subagents/src/dispatch.ts": ["./go-grammar.js"],
  "packages/subagents/src/route.ts": ["@rickylabs/harness-contracts/route"],
  "packages/subagents/src/go-grammar.ts": [],
  "packages/routing/src/discovery.ts": ["node:child_process", "node:crypto", "node:path", "node:process",
    "../config/discovery.native.v1.json"],
  "packages/contracts/src/governance-read.ts": null,
};
test("cockpit: raw-URL source files exist and import only what cockpit's import map resolves", () => {
  for (const [path, imports] of Object.entries(RAW_SOURCES)) {
    assert.ok(existsSync(join(root, path)), `${COCKPIT}: ${path} is missing (imported by raw URL)`);
    if (imports === null) continue;
    const found = ts.preProcessFile(readFileSync(join(root, path), "utf8"), true, true).importedFiles.map(file => file.fileName);
    assert.deepEqual(found, imports, `${COCKPIT}: ${path} changed its imports; cockpit's raw-URL import map resolves only ${JSON.stringify(imports)}`);
  }
});
test("cockpit: raw-URL dispatch, route and discovery modules export what cockpit imports", async () => {
  assertExports(COCKPIT, "packages/subagents/src/dispatch.ts", await load("packages/subagents/dist/dispatch.js"), {
    ...kinds("object", "HARNESSES"),
    ...kinds("function", "validateDispatch DispatchEncodingError parseSwarm renderSwarm timeoutMs toDispatchRequest"),
  });
  assertExports(COCKPIT, "packages/subagents/src/route.ts", await load("packages/subagents/dist/route.js"),
    kinds("function", "compareRouteIdentity"));
  assertExports(COCKPIT, "packages/routing/src/discovery.ts", await load("packages/routing/dist/discovery.js"),
    kinds("function", "discoverCliCapabilities validateCliDiscoverySnapshot"));
});

// cockpit reads these files through the GitHub contents API: routing.v1.json from harness main
// (unpinned, issue-dispatch.ts dispatchCatalog), matrix.test.mjs in its routing-proposal writer.
test("cockpit: routing files read through the GitHub contents API exist", () => {
  const config = "packages/routing/config/routing.v1.json";
  assert.ok(existsSync(join(root, config)), `${COCKPIT}: dispatchCatalog reads ${config} from harness main; it is missing`);
  const parsed = JSON.parse(readFileSync(join(root, config), "utf8"));
  assert.ok(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), `${COCKPIT}: ${config} is no longer a JSON object`);
  const proposal = `${MATRIX}/matrix.test.mjs`;
  assert.ok(existsSync(join(root, proposal)), `${COCKPIT}: the routing-proposal writer reads ${proposal}; it is missing`);
});

// Group 4: orchid reads profiles/<name>.md (profilePath, default "leaf") at a pinned revision and
// parses its routing row against the matrix vocabulary. Validation is the repository's own parser.
test("orchid: every profile the routing matrix can select has valid frontmatter", () => {
  const files = readdirSync(join(root, "profiles")).filter(name => name.endsWith(".md") && name !== "README.md");
  const documents = files.map(path => ({ path, markdown: readFileSync(join(root, "profiles", path), "utf8") }));
  const problems = validateProfileCollection(documents);
  assert.deepEqual(problems, [], problems.map(p => `${ORCHID}: profilePath() profiles/${p.path} ${p.field} ${p.code}`).join("\n"));
});

// Group 5: the canonical CLIs resolve from a package bin and exit 0 on --help. Output unread.
const manifests = readdirSync(join(root, "packages"))
  .filter(dir => existsSync(join(root, "packages", dir, "package.json")))
  .map(dir => ({ dir, manifest: JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8")) }));
for (const name of ["harness-board", "harness-coordinator", "harness-forge", "harness-telemetry"]) {
  test(`orchid: ${name} resolves from a package bin and exits 0 on --help`, () => {
    const owners = manifests.filter(({ manifest }) => typeof manifest.bin?.[name] === "string");
    assert.equal(owners.length, 1, `${ORCHID}: expected exactly one packages/*/package.json to declare bin ${name}, found ${owners.length}`);
    const [{ dir, manifest }] = owners;
    const bin = join(root, "packages", dir, manifest.bin[name]);
    const run = spawnSync(process.execPath, [bin, "--help"], { stdio: "ignore", timeout: 15_000 });
    assert.ifError(run.error);
    assert.equal(run.status, 0, `${ORCHID}: ${name} --help exited ${run.status}`);
  });
}

// Group 6: cockpit runs `harness-telemetry issue-agents` and decodes its frames with the published
// reader. The lifecycle flag is opt-in; parsed structure and exit codes only, never rendered text.
test("cockpit: harness-telemetry issue-agents accepts --activity-lifecycle and publishes agy activity the reader decodes", async () => {
  const { readIssueAgentTreeSnapshot } = await import("@rickylabs/harness-contracts");
  const { agyParityStore } = await import("./fixtures/agy-store.mjs");
  const bin = join(root, "packages/telemetry", JSON.parse(readFileSync(join(root, "packages/telemetry/package.json"), "utf8")).bin["harness-telemetry"]);
  const cli = (args, env = {}) => spawnSync(process.execPath, [bin, "issue-agents", "--json", ...args],
    { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH, ...env } });
  const unbound = cli(["--activity-lifecycle"]);
  assert.equal(unbound.status, 3, `${COCKPIT}: issue-agents --activity-lifecycle without a binding exited ${unbound.status}`);
  const empty = readIssueAgentTreeSnapshot(JSON.parse(unbound.stdout));
  assert.ok(empty.ok && empty.snapshot.reason === "source_not_bound", `${COCKPIT}: the unbound frame no longer decodes as source_not_bound`);
  assert.equal(cli(["--no-such-flag"]).status, 2, `${COCKPIT}: issue-agents accepted an unknown flag`);
  const store = await agyParityStore();
  try {
    const env = { HARNESS_TELEMETRY_DISPATCH_ROOT: store.receipts };
    const read = flag => {
      const run = cli(["--home", store.base, "--issue", store.issue, ...(flag ? ["--activity-lifecycle"] : [])], env);
      assert.equal(run.status, 0, `${COCKPIT}: the bound agy issue-agents run exited ${run.status}`);
      assert.ok(!run.stdout.includes("PRIVATE-"), `${COCKPIT}: a private canary reached the frame`);
      const decoded = readIssueAgentTreeSnapshot(JSON.parse(run.stdout));
      assert.ok(decoded.ok, `${COCKPIT}: the published reader rejected the frame`);
      return decoded.snapshot.issues[0].dispatches[0].agents[0].activity;
    };
    const lifecycle = read(true);
    assert.deepEqual(lifecycle.steps.filter(s => s.kind === "command").map(s => [s.commandHead, s.state]), [["git status", "unknown"]],
      `${COCKPIT}: the named agy call is no longer a command with unknown state`);
    assert.deepEqual(lifecycle.steps.filter(s => s.kind === "tool" && s.toolName === null).map(s => s.state), ["completed"],
      `${COCKPIT}: the unnamed agy result no longer carries its native state`);
    assert.deepEqual(lifecycle.coverage, { gaps: ["call-lifecycle-unproven"] }, `${COCKPIT}: agy coverage changed`);
    const plain = read(false);
    assert.equal(Object.hasOwn(plain, "coverage"), false, `${COCKPIT}: coverage leaked into an unflagged frame`);
    assert.ok(plain.steps.every(s => !Object.hasOwn(s, "state") && !(s.kind === "tool" && s.toolName === null)),
      `${COCKPIT}: lifecycle fields leaked into an unflagged frame`);
  } finally { await rm(store.base, { recursive: true, force: true }); }
});
