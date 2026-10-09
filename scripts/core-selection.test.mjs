import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = () => JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expected = () => readdirSync(join(root, "packages")).filter(name =>
  existsSync(join(root, "packages", name, "package.json"))).map(name => `packages/${name}`).sort();

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
  test(`default ${action} selects exactly the twelve core packages`, () => {
    const core = expected();
    assert.equal(core.length, 12, "the core package count changed");
    assert.deepEqual(selection(manifest().scripts[script]), core);
  });
}

test("the root TS graph contains every core project", () => {
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
  assert.equal(expected().length, 12);
  assert.deepEqual(config.references.map(row => row.path).sort(), expected());
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
  ["mismatched native inventory", {status: 0, stdout: '[{"name":"foreign","path":"/synthetic/foreign"}]'}, /selector must include every core package/],
]) test(`${label} refuses before executing any package lifecycle`, t => {
  const run = intercepted(isolatedCore(t), result);
  assert.ifError(run.error);
  assert.equal(run.status, 1);
  assert.match(run.stderr, reason);
  assert.equal(run.stdout, "");
  assert.doesNotMatch(run.stderr, /lifecycle effect reached/);
});

for (const [label, edit, reason] of [
  ["missing core package", (directory) => rmSync(join(directory, expected()[0]), {recursive: true}), /expected twelve core packages/],
  ["duplicate core identity", (directory) => {
    const first = JSON.parse(readFileSync(join(directory, expected()[0], "package.json"), "utf8"));
    const path = join(directory, expected()[1], "package.json");
    const second = JSON.parse(readFileSync(path, "utf8"));
    second.name = first.name; writeFileSync(path, JSON.stringify(second));
  }, /duplicate core package identity/],
]) test(`${label} refuses before invoking pnpm`, t => {
  const directory = isolatedCore(t); edit(directory);
  const run = intercepted(directory, {status: 1, stdout: ""});
  assert.ifError(run.error); assert.equal(run.status, 1);
  assert.match(run.stderr, reason); assert.equal(run.stdout, "");
});


test("the actual default lifecycle writes outputs for every core package", t => {
  const directory = isolatedCore(t);
  const touch = "node -e \"require('node:fs').writeFileSync('lifecycle-output', 'ran')\"";
  for (const dir of expected()) {
    const path = join(directory, dir, "package.json");
    const content = JSON.parse(readFileSync(path, "utf8"));
    content.scripts = {build: touch}; writeFileSync(path, JSON.stringify(content));
  }
  copyFileSync(join(root, "pnpm-workspace.yaml"), join(directory, "pnpm-workspace.yaml"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({name: "core-selection-control", private: true}));
  const run = spawnSync(process.execPath, [join(directory, "scripts/core-packages.mjs"), "build"], {
    cwd: directory, encoding: "utf8", timeout: 30_000,
  });
  assert.ifError(run.error); assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const dir of expected()) assert.equal(readFileSync(join(directory, dir, "lifecycle-output"), "utf8"), "ran");
});


function isolatedGraph(t) {
  const directory = isolatedCore(t);
  copyFileSync(join(root, "scripts/check-project-graph.mjs"), join(directory, "scripts/check-project-graph.mjs"));
  copyFileSync(join(root, "tsconfig.json"), join(directory, "tsconfig.json"));
  copyFileSync(join(root, "pnpm-workspace.yaml"), join(directory, "pnpm-workspace.yaml"));
  for (const dir of expected()) copyFileSync(join(root, dir, "tsconfig.json"), join(directory, dir, "tsconfig.json"));
  return directory;
}
const graphCheck = directory => spawnSync(process.execPath, [join(directory, "scripts/check-project-graph.mjs")], {
  cwd: directory, encoding: "utf8", timeout: 10_000,
});
test("the project guard accepts the whole workspace while rejecting a duplicate root reference", t => {
  const directory = isolatedGraph(t);
  const before = graphCheck(directory);
  assert.ifError(before.error); assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /12 packages/);
  const path = join(directory, "tsconfig.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.references.push({path: expected()[0]});
  writeFileSync(path, JSON.stringify(config));
  const refused = graphCheck(directory);
  assert.ifError(refused.error); assert.equal(refused.status, 1);
  assert.match(refused.stderr, /tsconfig\.json: root references must contain every core project exactly once/);
});
test("an omitted project reference fails even with the root intact", t => {
  const directory = isolatedGraph(t);
  const path = join(directory, "packages/coordinator/tsconfig.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.references = config.references.filter(row => row.path !== "../contracts");
  writeFileSync(path, JSON.stringify(config));
  const refused = graphCheck(directory);
  assert.ifError(refused.error); assert.equal(refused.status, 1);
  assert.match(refused.stderr, /depends on packages\/contracts but does not reference it/);
});
