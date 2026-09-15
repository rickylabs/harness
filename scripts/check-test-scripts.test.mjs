// Every arm of the gate is driven in both directions, because a guard that has only ever been
// observed passing is a guard nobody has seen work. Each case below turns the gate red on purpose;
// deleting the corresponding clause in check-test-scripts.mjs turns one of these tests red.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { auditTestScripts, readPackages, DECLARED_UNCOVERED } from "./check-test-scripts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const withTest = { name: "covered", hasTestScript: true };
const withoutTest = { name: "bare", hasTestScript: false };

test("a package with no test script and no declaration is reported by name", () => {
  const result = auditTestScripts([withTest, withoutTest], []);
  assert.deepEqual(result.undeclared, ["bare"]);
});

test("a package with no test script that is declared uncovered is accepted", () => {
  const result = auditTestScripts([withTest, withoutTest], [{ name: "bare", reason: "why" }]);
  assert.deepEqual(result.undeclared, []);
  assert.deepEqual(result.stale, []);
});

test("a declaration that outlived its reason is reported, so the list cannot rot", () => {
  const result = auditTestScripts([withTest], [{ name: "covered", reason: "why" }]);
  assert.deepEqual(result.stale, ["covered"]);
});

test("a declaration naming a package that no longer exists is reported", () => {
  const result = auditTestScripts([withTest], [{ name: "deleted-package", reason: "why" }]);
  assert.deepEqual(result.absent, ["deleted-package"]);
});

test("a declaration with no reason is an omission with extra steps and is reported", () => {
  const result = auditTestScripts([withoutTest], [{ name: "bare", reason: "   " }]);
  assert.deepEqual(result.unreasoned, ["bare"]);
});

test("the real repository passes, and every declared package actually exists", () => {
  const packages = readPackages(root);
  assert.ok(packages.length > 0, "the probe found no packages, so it proves nothing");
  // The shipped list, not a copy of it, so the assertion covers the value that runs.
  const result = auditTestScripts(packages, DECLARED_UNCOVERED);
  assert.deepEqual(result.undeclared, []);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.absent, []);
  assert.deepEqual(result.unreasoned, []);
});

test("the executable gate exits non-zero on a package it was not told about", () => {
  const scratch = mkdtempSync(join(tmpdir(), "test-scripts-guard-"));
  try {
    mkdirSync(join(scratch, "scripts"));
    mkdirSync(join(scratch, "packages/surprise"), { recursive: true });
    copyFileSync(join(root, "scripts/check-test-scripts.mjs"), join(scratch, "scripts/check-test-scripts.mjs"));
    copyFileSync(join(root, "scripts/inconclusive.mjs"), join(scratch, "scripts/inconclusive.mjs"));
    writeFileSync(join(scratch, "packages/surprise/package.json"), JSON.stringify({ name: "surprise", scripts: {} }));
    const run = spawnSync(process.execPath, ["scripts/check-test-scripts.mjs"], { cwd: scratch, encoding: "utf8" });
    assert.equal(run.status, 1, "an undeclared uncovered package must fail the gate");
    assert.match(run.stderr, /surprise/, "the failure must name the package");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
