import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = () => JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// Independent of core-packages.mjs on purpose: `packages/<name>`, or `packages/<group>/<name>` when the
// group has no manifest of its own (`packages/hosts/`).
const expected = () => readdirSync(join(root, "packages")).filter(name => name !== "dsh-app").flatMap(name => {
  if (existsSync(join(root, "packages", name, "package.json"))) return [`packages/${name}`];
  if (!statSync(join(root, "packages", name)).isDirectory()) return [];
  return readdirSync(join(root, "packages", name))
    .filter(child => existsSync(join(root, "packages", name, child, "package.json")))
    .map(child => `packages/${name}/${child}`);
}).sort();

// Ask pnpm itself about the selector used by each configured execution stage. The old recursive
// stages are deliberately understood: broadening a stage back to them must go RED, not bypass
// the check. The root workspace is omitted by recursive run under its normal pnpm policy.
function selection(script) {
  let executable, args;
  if (/^node scripts\/core-packages\.mjs (build|typecheck|test|clean)$/.test(script)) {
    executable = process.execPath;
    args = [join(root, "scripts/core-packages.mjs"), "list"];
  } else {
    const words = /^pnpm (.+) run (build|typecheck|test|clean)$/.exec(script);
    assert.ok(words, `unrecognized execution selection: ${script}`);
    executable = "pnpm";
    args = [...words[1].split(/\s+/), "list", "--depth=-1", "--json"];
  }
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", timeout: 30_000,
    shell: process.platform === "win32" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  assert.ok(Array.isArray(rows) && rows.length > 0, "an empty selector is not coverage");
  return rows.map(row => row.dir ?? relative(root, row.path).replaceAll("\\", "/"))
    .filter(dir => dir !== "").sort();
}
for (const [script, action] of [["build:packages", "build"], ["typecheck:packages", "typecheck"], ["test:packages", "test"], ["clean", "clean"]]) {
  test(`default ${action} selects exactly the fifteen core packages`, () => {
    const core = expected();
    assert.equal(core.length, 15, "the core package count changed");
    assert.deepEqual(selection(manifest().scripts[script]), core);
  });
}

test("the root TS graph contains every core project and no experimental router", () => {
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
  assert.equal(expected().length, 15);
  assert.deepEqual(config.references.map(row => row.path).sort(), expected());
});

test("the optional router is private, declared separately, with two names for one CLI", () => {
  assert.equal(existsSync(join(root, "packages/dsh-app/package.json")), false);
  const path = join(root, "experiments/routers/dsh/package.json");
  assert.ok(existsSync(path), "optional experiment is missing");
  const router = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(router.name, "@rickylabs/harness-router-dsh");
  assert.equal(router.private, true);
  assert.equal(router.bin["harness-dsh-profile"], "./dist/cli.js");
  assert.equal(router.bin["dsh-profile"], router.bin["harness-dsh-profile"]);
  assert.match(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"), /experiments\/routers\/\*/);
});

test("the default tutorial executes no experimental profile or dump command", () => {
  const page = readFileSync(join(root, "docs/tutorials/01-from-clone-to-board.md"), "utf8");
  for (const block of page.matchAll(/```bash\n([\s\S]*?)\n```/g)) {
    assert.doesNotMatch(block[1], /(?:dsh-profile|dsh-app|experiments\/routers\/dsh|--dump-config)/);
  }
});


function isolatedCore(t) {
  const directory = mkdtempSync(join(tmpdir(), "core-inventory-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  copyFileSync(join(root, "scripts/core-packages.mjs"), join(directory, "scripts/core-packages.mjs"));
  for (const dir of expected()) {
    mkdirSync(join(directory, dir), { recursive: true });
    copyFileSync(join(root, dir, "package.json"), join(directory, dir, "package.json"));
  }
  return directory;
}
function intercepted(directory, result) {
  const interception = join(directory, "inventory.mjs");
  writeFileSync(interception, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
cp.spawnSync = (_command, args) => {
  if (!args.includes('list')) throw Error('a lifecycle effect reached the interceptor');
  return ${JSON.stringify(result)};
}; syncBuiltinESMExports();\n`);
  return spawnSync(process.execPath, ["--import", interception, join(directory, "scripts/core-packages.mjs"), "build"], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
  });
}
for (const [label, result, reason] of [
  ["empty native inventory", {status: 0, stdout: "[]"}, /inventory is empty/],
  ["unreadable native inventory", {status: 1, stdout: ""}, /inventory unavailable/],
  ["malformed inventory row", {status: 0, stdout: '[{"name":null,"path":null}]'}, /invalid pnpm core inventory/],
  ["mismatched native inventory", {status: 0, stdout: '[{"name":"foreign","path":"/synthetic/experiment"}]'}, /selector must include every core package/],
]) test(`${label} refuses before executing any package lifecycle`, t => {
  const run = intercepted(isolatedCore(t), result);
  assert.ifError(run.error);
  assert.equal(run.status, 1);
  assert.match(run.stderr, reason);
  assert.equal(run.stdout, "");
  assert.doesNotMatch(run.stderr, /lifecycle effect reached/);
});
test("a core workspace dependency on the experiment refuses before invoking pnpm", t => {
  const directory = isolatedCore(t);
  const path = join(directory, expected()[0], "package.json");
  const packageManifest = JSON.parse(readFileSync(path, "utf8"));
  packageManifest.dependencies = { ...packageManifest.dependencies, "@rickylabs/harness-router-dsh": "workspace:*" };
  writeFileSync(path, JSON.stringify(packageManifest));
  const run = intercepted(directory, {status: 1, stdout: ""});
  assert.ifError(run.error);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /default core dependency reaches an optional host/);
  assert.equal(run.stdout, "");
});

for (const [label, edit, reason] of [
  ["missing core package", (directory) => rmSync(join(directory, expected()[0]), {recursive: true}), /expected fifteen core packages/],
  ["duplicate core identity", (directory) => {
    const first = JSON.parse(readFileSync(join(directory, expected()[0], "package.json"), "utf8"));
    const path = join(directory, expected()[1], "package.json");
    const second = JSON.parse(readFileSync(path, "utf8"));
    second.name = first.name; writeFileSync(path, JSON.stringify(second));
  }, /duplicate core package identity/],
  ["upstream host in core", (directory) => {
    const path = join(directory, expected()[0], "package.json");
    const content = JSON.parse(readFileSync(path, "utf8"));
    content.dependencies = {...content.dependencies, "@deepseek-ai/dsh": "*"};
    writeFileSync(path, JSON.stringify(content));
  }, /default core dependency reaches an optional host/],
]) test(`${label} refuses before invoking pnpm`, t => {
  const directory = isolatedCore(t); edit(directory);
  const run = intercepted(directory, {status: 1, stdout: ""});
  assert.ifError(run.error); assert.equal(run.status, 1);
  assert.match(run.stderr, reason); assert.equal(run.stdout, "");
});


test("the actual default lifecycle writes outputs for every core package and none for the experiment", t => {
  const directory = isolatedCore(t);
  const touch = "node -e \"require('node:fs').writeFileSync('lifecycle-output', 'ran')\"";
  for (const dir of expected()) {
    const path = join(directory, dir, "package.json");
    const content = JSON.parse(readFileSync(path, "utf8"));
    content.scripts = {build: touch}; writeFileSync(path, JSON.stringify(content));
  }
  const experiment = "experiments/routers/dsh";
  mkdirSync(join(directory, experiment), {recursive: true});
  const optional = JSON.parse(readFileSync(join(root, experiment, "package.json"), "utf8"));
  optional.scripts = {build: touch};
  writeFileSync(join(directory, experiment, "package.json"), JSON.stringify(optional));
  copyFileSync(join(root, "pnpm-workspace.yaml"), join(directory, "pnpm-workspace.yaml"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({name: "core-selection-control", private: true}));
  const run = spawnSync(process.execPath, [join(directory, "scripts/core-packages.mjs"), "build"], {
    cwd: directory, encoding: "utf8", timeout: 30_000,
  });
  assert.ifError(run.error); assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const dir of expected()) assert.equal(readFileSync(join(directory, dir, "lifecycle-output"), "utf8"), "ran");
  assert.equal(existsSync(join(directory, experiment, "lifecycle-output")), false, "an optional router lifecycle executed");
});


function isolatedGraph(t) {
  const directory = isolatedCore(t);
  copyFileSync(join(root, "scripts/check-project-graph.mjs"), join(directory, "scripts/check-project-graph.mjs"));
  copyFileSync(join(root, "scripts/package-boundary.mjs"), join(directory, "scripts/package-boundary.mjs"));
  copyFileSync(join(root, "tsconfig.json"), join(directory, "tsconfig.json"));
  copyFileSync(join(root, "pnpm-workspace.yaml"), join(directory, "pnpm-workspace.yaml"));
  for (const dir of expected()) copyFileSync(join(root, dir, "tsconfig.json"), join(directory, dir, "tsconfig.json"));
  const experiment = "experiments/routers/dsh";
  mkdirSync(join(directory, experiment), {recursive: true});
  for (const file of ["package.json", "tsconfig.json"]) copyFileSync(join(root, experiment, file), join(directory, experiment, file));
  return directory;
}
const graphCheck = directory => spawnSync(process.execPath, [join(directory, "scripts/check-project-graph.mjs")], {
  cwd: directory, encoding: "utf8", timeout: 10_000,
});
test("the project guard accepts the whole workspace while rejecting experimental root selection", t => {
  const directory = isolatedGraph(t);
  const before = graphCheck(directory);
  assert.ifError(before.error); assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /16 packages/);
  const path = join(directory, "tsconfig.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.references.push({path: "experiments/routers/dsh"});
  writeFileSync(path, JSON.stringify(config));
  const refused = graphCheck(directory);
  assert.ifError(refused.error); assert.equal(refused.status, 1);
  assert.match(refused.stderr, /root references must contain every core project exactly once and no experiment/);
});
test("an omitted experiment project reference fails even with the core-only root intact", t => {
  const directory = isolatedGraph(t);
  const path = join(directory, "experiments/routers/dsh/tsconfig.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.references = config.references.filter(row => row.path !== "../../../packages/board");
  writeFileSync(path, JSON.stringify(config));
  const refused = graphCheck(directory);
  assert.ifError(refused.error); assert.equal(refused.status, 1);
  assert.match(refused.stderr, /depends on packages\/board but does not reference it/);
});
test("a host adapter's telemetry dependency fails even when its project reference matches", t => {
  const directory = isolatedGraph(t);
  const host = join(directory, "packages/hosts/orchid");
  const manifestPath = join(host, "package.json"), configPath = join(host, "tsconfig.json");
  const hostManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  hostManifest.dependencies = { ...hostManifest.dependencies, "@rickylabs/telemetry": "workspace:*" };
  writeFileSync(manifestPath, JSON.stringify(hostManifest));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.references.push({path: "../../telemetry"});
  writeFileSync(configPath, JSON.stringify(config));
  const refused = graphCheck(directory);
  assert.ifError(refused.error); assert.equal(refused.status, 1);
  assert.match(refused.stderr, /packages\/hosts\/orchid: dependencies: @rickylabs\/telemetry is not an allowed workspace dependency/);
  assert.doesNotMatch(refused.stderr, /does not reference it|does not depend on it/);
});
