import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = "packages/contracts/test-fixtures/governance-read";
const runFixture = "packages/contracts/test-fixtures/repository-run-observation/read.json";
const names = ["admissions-only", "complete-without-admissions", "conflicting-admissions",
  "degraded-log", "mixed-timeout", "stale", "transport-availability", "unavailable-not-configured"];
const limitDirectory = "packages/contracts/test-fixtures/provider-limits-produced";
const limitNames = readdirSync(join(root, limitDirectory)).filter(name => name.endsWith(".json"));
/** Runs the guard on a scratch copy and returns its exit status with its parsed `--json` result. */
function probe(change) {
  const scratch = mkdtempSync(join(tmpdir(), "snapshot-guard-"));
  // Exclude ambient Git index/worktree settings. Every git mutation is scratch-owned.
  const env = { PATH: process.env.PATH, HOME: scratch, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  try {
    mkdirSync(join(scratch, "scripts"));
    mkdirSync(join(scratch, directory), { recursive: true });
    copyFileSync(join(root, "scripts/check-snapshots.mjs"), join(scratch, "scripts/check-snapshots.mjs"));
    for (const name of names) copyFileSync(join(root, directory, `${name}.json`), join(scratch, directory, `${name}.json`));
    mkdirSync(join(scratch, limitDirectory), { recursive: true });
    for (const name of limitNames) copyFileSync(join(root, limitDirectory, name), join(scratch, limitDirectory, name));
    mkdirSync(dirname(join(scratch, runFixture)), { recursive: true });
    copyFileSync(join(root, runFixture), join(scratch, runFixture));
    execFileSync("git", ["init", "--quiet"], { cwd: scratch, env });
    execFileSync("git", ["add", "--", "."], { cwd: scratch, env });
    change(scratch);
    const run = (...flags) => spawnSync(process.execPath, [join(scratch, "scripts/check-snapshots.mjs"), ...flags], {
      cwd: scratch, env, encoding: "utf8", timeout: 10_000,
    });
    const result = run("--json"), text = run();
    assert.deepEqual([result.error, text.error], [undefined, undefined]);
    // The gate runs the text report: it must exit exactly as the structured one does.
    assert.equal(text.status, result.status);
    // A leak check on the raw bytes: no fixture or operator value is ever echoed.
    for (const out of [result, text]) assert.doesNotMatch(out.stdout + out.stderr, /synthetic-private-value/);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, result.status === 0 ? "PASS" : "FAIL");
    return { status: result.status, verified: report.verifiedFixtures, found: report.problems.map(p => [p.path, p.rule, p.line ?? null, p.key ?? null]) };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
function track(scratch, file, body) {
  writeFileSync(join(scratch, file), body);
  execFileSync("git", ["add", "--", file], { cwd: scratch, env: {
    PATH: process.env.PATH, HOME: scratch, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  } });
}
const inventoried = names.length + limitNames.length + 1;
const mixed = `${directory}/mixed-timeout.json`;
const produced = `${limitDirectory}/thresholds-hard-then-rate.json`;
test("every inventoried fixture, produced provider-limit snapshots included, passes", () => {
  assert.deepEqual(probe(() => {}), { status: 0, verified: inventoried, found: [] });
});
test("a changed produced provider-limit fixture fails the exact inventory", () => {
  const { status, found } = probe(scratch => {
    writeFileSync(join(scratch, produced), readFileSync(join(scratch, produced), "utf8").replace('"usedPercent":90,', '"usedPercent":91,'));
  });
  // Unapproved bytes are then scanned like any data file; the inventory refusal must still be its own record.
  assert.deepEqual([status, found], [1, [[produced, "inventory", null, null], [produced, "key", 1, "observedAt"]]]);
});
test("changed bytes fail even with identical JSON meaning", () => {
  const { status, found } = probe(scratch => writeFileSync(join(scratch, mixed), readFileSync(join(scratch, mixed), "utf8") + "\n"));
  assert.deepEqual([status, found], [1, [[mixed, "inventory", null, null], [mixed, "key", 16, "observedAt"]]]);
});
test("changed fixture fails even after removing all snapshot keys", () => {
  const { status, found } = probe(scratch => writeFileSync(join(scratch, mixed), "{}\n"));
  assert.deepEqual([status, found], [1, [[mixed, "inventory", null, null]]]);
});
test("missing inventoried fixture fails loudly", () => {
  const { status, found } = probe(scratch => unlinkSync(join(scratch, mixed)));
  assert.deepEqual([status, found], [1, [[mixed, "inventory", null, null]]]);
});
test("new file in fixture directory gets ordinary detection", () => {
  const { status, found } = probe(scratch => track(scratch, `${directory}/new.json`, readFileSync(join(scratch, mixed), "utf8")));
  assert.deepEqual([status, found], [1, [[`${directory}/new.json`, "key", 16, "observedAt"]]]);
});
test("identical fixture bytes at another path get ordinary detection", () => {
  const { status, found } = probe(scratch => track(scratch, "copied.json", readFileSync(join(scratch, mixed), "utf8")));
  assert.deepEqual([status, found], [1, [["copied.json", "key", 16, "observedAt"]]]);
});
test("operator snapshot outside fixture inventory still fails", () => {
  const { status, found } = probe(scratch => track(scratch, "operator.json", '{"balance_usd":"synthetic-private-value"}\n'));
  assert.deepEqual([status, found], [1, [["operator.json", "key", 1, "balance_usd"]]]);
});
test("a data file named for a quota fails on its name alone", () => {
  const { status, found } = probe(scratch => track(scratch, "quota.json", "{}\n"));
  assert.deepEqual([status, found], [1, [["quota.json", "name", null, null]]]);
});

test("missing repository-run fixture fails loudly", () => {
  const { status, found } = probe(scratch => unlinkSync(join(scratch, runFixture)));
  assert.deepEqual([status, found], [1, [[runFixture, "inventory", null, null]]]);
});
test("changed repository-run fixture fails even without snapshot keys", () => {
  const { status, found } = probe(scratch => writeFileSync(join(scratch, runFixture), "{}\n"));
  assert.deepEqual([status, found], [1, [[runFixture, "inventory", null, null]]]);
});
