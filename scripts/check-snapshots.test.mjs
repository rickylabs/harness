import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = "packages/contracts/test-fixtures/governance-read";
const names = ["admissions-only", "complete-without-admissions", "conflicting-admissions",
  "degraded-log", "mixed-timeout", "stale", "unavailable-not-configured"];
function probe(change, expected, diagnostic) {
  const scratch = mkdtempSync(join(tmpdir(), "snapshot-guard-"));
  // Exclude ambient Git index/worktree settings. Every git mutation is scratch-owned.
  const env = { PATH: process.env.PATH, HOME: scratch, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  try {
    mkdirSync(join(scratch, "scripts"));
    mkdirSync(join(scratch, directory), { recursive: true });
    copyFileSync(join(root, "scripts/check-snapshots.mjs"), join(scratch, "scripts/check-snapshots.mjs"));
    for (const name of names) copyFileSync(join(root, directory, `${name}.json`), join(scratch, directory, `${name}.json`));
    execFileSync("git", ["init", "--quiet"], { cwd: scratch, env });
    execFileSync("git", ["add", "--", "."], { cwd: scratch, env });
    change(scratch);
    const result = spawnSync(process.execPath, [join(scratch, "scripts/check-snapshots.mjs")], {
      cwd: scratch, env, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected, "isolated snapshot guard exit");
    assert.match(result.stdout + result.stderr, diagnostic);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-value/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const target = scratch => join(scratch, directory, "mixed-timeout.json");
function track(scratch, file, body) {
  writeFileSync(join(scratch, file), body);
  execFileSync("git", ["add", "--", file], { cwd: scratch, env: {
    PATH: process.env.PATH, HOME: scratch, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  } });
}
test("exact seven tracked fixtures pass", () => probe(() => {}, 0, /7 exact synthetic fixtures verified/));
test("changed bytes fail even with identical JSON meaning", () => probe(scratch => {
  writeFileSync(target(scratch), readFileSync(target(scratch), "utf8") + "\n");
}, 1, /exact SHA-256 match required/));
test("changed fixture fails even after removing all snapshot keys", () => probe(scratch => {
  writeFileSync(target(scratch), '{}\n');
}, 1, /exact SHA-256 match required/));
test("missing inventoried fixture fails loudly", () => probe(scratch => unlinkSync(target(scratch)), 1, /exact SHA-256 match required/));
test("new file in fixture directory gets ordinary detection", () => probe(scratch => {
  track(scratch, `${directory}/new.json`, readFileSync(target(scratch), "utf8"));
}, 1, /new.json:.*carries `observedAt`/));
test("identical fixture bytes at another path get ordinary detection", () => probe(scratch => {
  track(scratch, "copied.json", readFileSync(target(scratch), "utf8"));
}, 1, /copied.json:.*carries `observedAt`/));
test("operator snapshot outside fixture inventory still fails", () => probe(scratch => {
  track(scratch, "operator.json", '{"balance_usd":"synthetic-private-value"}\n');
}, 1, /operator.json:.*carries `balance_usd`/));
