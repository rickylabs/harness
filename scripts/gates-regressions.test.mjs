import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Inconclusive, inconclusiveRecord, requireExecutableDirectory } from "./inconclusive.mjs";
import { DECLARED_UNCOVERED } from "./check-test-scripts.mjs";
import { classifyStageResult, summarise } from "./run-stages.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "gate-control-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function workspace(t) {
  const directory = fixture(t);
  mkdirSync(join(directory, "scripts"));
  for (const file of ["check-test-scripts.mjs", "run-stages.mjs", "inconclusive.mjs"]) {
    copyFileSync(join(scripts, file), join(directory, "scripts", file));
  }
  return directory;
}
function manifest(directory, name, content = { scripts: {} }) {
  mkdirSync(join(directory, "packages", name), { recursive: true });
  writeFileSync(join(directory, "packages", name, "package.json"), JSON.stringify(content));
}
function audit(directory) {
  return spawnSync(process.execPath, ["scripts/check-test-scripts.mjs"], { cwd: directory, encoding: "utf8" });
}
function stages(directory, names, env = process.env) {
  return spawnSync(process.execPath, [join(scripts, "run-stages.mjs"), "--label", "control", "--compile-stage", "compile", ...names],
    { cwd: directory, env, encoding: "utf8" });
}

test("installed entrypoint preserves preflight inconclusive status and location", t => {
  const directory = workspace(t);
  copyFileSync(join(scripts, "check-installed-contracts.mjs"), join(directory, "scripts/check-installed-contracts.mjs"));
  // Only prerequisite presence matters: refusal must happen before any fixture/consumer runs.
  for (const file of ["telemetry/dist/cli.js", "contracts/dist/index.js", "contracts/dist/index.d.ts", "contracts/dist/server.js", "contracts/dist/server.d.ts"]) {
    const target = join(directory, "packages", file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "");
  }
  const matrix = join(directory, "packages/telemetry/test-fixtures/run-observation/matrix.mjs");
  mkdirSync(dirname(matrix), { recursive: true });
  writeFileSync(matrix, "export function runObservationMatrix() { throw new Error('must not run'); }\n");
  writeFileSync(join(directory, "refuse.mjs"), `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
childProcess.spawnSync = () => ({ error: Object.assign(new Error('private-canary'), { code: 'EACCES' }), status: null });
syncBuiltinESMExports();\n`);
  const run = spawnSync(process.execPath, ["--import", "./refuse.mjs", "scripts/check-installed-contracts.mjs"],
    { cwd: directory, env: { ...process.env, TMPDIR: directory }, encoding: "utf8" });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  const record = JSON.parse(run.stdout);
  assert.equal(record.status, "INCONCLUSIVE");
  assert.equal(record.stage, "scratch executability preflight");
  assert.equal(dirname(record.location), directory);
  assert.equal(record.execution, "EACCES");
  assert.doesNotMatch(run.stdout + run.stderr, /private-canary/);
  assert.ok(!readdirSync(directory).some(name => name.startsWith("governance-installed-")), "entrypoint must clean its scratch directory");
});

test("preflight diagnostic names only owned location and closed execution reason", t => {
  const directory = fixture(t);
  const injected = "private-canary /unowned/credential";
  assert.throws(() => requireExecutableDirectory(directory, () => ({
    error: Object.assign(new Error(injected), { code: "EACCES", path: injected }), stdout: injected, stderr: injected,
  })), error => {
    const record = inconclusiveRecord("installed-contracts", "scratch", error);
    assert.equal(record.status, "INCONCLUSIVE");
    assert.equal(record.location, directory);
    assert.equal(record.execution, "EACCES");
    assert.doesNotMatch(record.remedy, /is on a noexec/);
    assert.ok(!JSON.stringify(record).includes(injected));
    return true;
  });
  assert.deepEqual(readdirSync(directory), []);
});

test("preflight refuses Windows before spawning or writing a shebang fixture", t => {
  const directory = fixture(t);
  let called = false;
  assert.throws(() => requireExecutableDirectory(directory, () => { called = true; return { status: 0 }; }, "win32"),
    error => error instanceof Inconclusive && error.reason === "posix-shebang-host-required");
  assert.equal(called, false);
  assert.deepEqual(readdirSync(directory), []);
});

test("preflight fixture uses the same Node interpreter as the installed fixture", t => {
  const directory = fixture(t);
  let observed;
  requireExecutableDirectory(directory, (probe, args, options) => {
    observed = { source: readFileSync(probe, "utf8"), args, options };
    return { status: 0 };
  }, "linux");
  assert.ok(observed.source.startsWith(`#!${process.execPath}\n`));
  assert.deepEqual(observed.args, []);
  assert.equal(observed.options.timeout, 5000);
});

test("preflight unknown execution codes cannot reflect arbitrary input", t => {
  const directory = fixture(t);
  assert.throws(() => requireExecutableDirectory(directory, () => ({ error: { code: "private-canary" } })), error => {
    const record = inconclusiveRecord("preflight", "scratch", error);
    assert.equal(record.execution, "probe-did-not-complete-successfully");
    assert.ok(!JSON.stringify(record).includes("private-canary"));
    return true;
  });
});

test("preflight setup and thrown spawn errors are inconclusive without raw errors", t => {
  const directory = fixture(t);
  for (const run of [
    () => requireExecutableDirectory(join(directory, "absent")),
    () => requireExecutableDirectory(directory, () => { throw new Error("private-canary"); }),
  ]) {
    assert.throws(run, error => {
      assert.ok(error instanceof Inconclusive);
      assert.ok(!JSON.stringify(inconclusiveRecord("preflight", "scratch", error)).includes("private-canary"));
      return true;
    });
  }
});

test("preflight cleanup failure is inconclusive", t => {
  const directory = fixture(t);
  assert.throws(() => requireExecutableDirectory(directory, probe => {
    rmSync(probe);
    mkdirSync(probe);
    return { status: 0 };
  }), Inconclusive);
});

test("bounded output capture is inconclusive after the runner started", () => {
  const run = spawnSync(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], { maxBuffer: 1024 });
  assert.ok(run.error);
  assert.ok(run.pid > 0);
  const result = classifyStageResult(run, { compile: true });
  assert.equal(result.code, 2);
  assert.equal(result.reason, "stage-result-unavailable");
  const summary = summarise({ label: "build", stages: ["compile"], compileStage: "compile", results: [{ stage: "compile", ...result }] });
  assert.equal(summary.compileRan, true);
});

test("workspace inventory missing or empty is inconclusive, not a verdict", t => {
  const directory = workspace(t);
  let run = audit(directory);
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).reason, "workspace-unreadable");
  mkdirSync(join(directory, "packages"));
  run = audit(directory);
  assert.equal(run.status, 2, run.stdout + run.stderr);
  const record = JSON.parse(run.stdout);
  assert.equal(record.reason, "workspace-empty");
  assert.equal(record.status, "INCONCLUSIVE");
  assert.match(record.remedy, /inventory/);
});

test("workspace unreadable manifest is inconclusive but invalid JSON fails", t => {
  const directory = workspace(t);
  const file = join(directory, "packages/broken/package.json");
  mkdirSync(file, { recursive: true }); // Reading a directory as a file fails on the CI Linux host.
  let run = audit(directory);
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).reason, "workspace-unreadable");
  rmSync(file, { recursive: true });
  writeFileSync(file, "invalid JSON");
  run = audit(directory);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).status, "FAIL");
  writeFileSync(file, "null");
  run = audit(directory);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).status, "FAIL");
});

test("workspace declarations pass, missing tests fail and the missing package is named", t => {
  const directory = workspace(t);
  for (const entry of DECLARED_UNCOVERED) manifest(directory, entry.name);
  manifest(directory, "covered", { scripts: { test: "node --test" } });
  mkdirSync(join(directory, "packages/not-a-package"));
  let run = audit(directory);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  manifest(directory, "surprise");
  run = audit(directory);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /surprise: declares no test script/);
});

test("an inaccessible package cannot disappear from an otherwise valid inventory", t => {
  const directory = workspace(t);
  for (const entry of DECLARED_UNCOVERED) manifest(directory, entry.name);
  manifest(directory, "hidden", { scripts: { test: "node --test" } });
  assert.equal(audit(directory).status, 0);
  // Deterministic EACCES even when tests run as root. existsSync would silently return false.
  writeFileSync(join(directory, "deny.mjs"), `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync, exists = fs.existsSync;
const hidden = path => String(path).endsWith('/packages/hidden/package.json');
fs.existsSync = path => hidden(path) ? false : exists(path);
fs.readFileSync = (path, ...args) => {
  if (hidden(path)) throw Object.assign(new Error('private-canary'), { code: 'EACCES', syscall: 'open' });
  return read(path, ...args);
};
syncBuiltinESMExports();\n`);
  const run = spawnSync(process.execPath, ["--import", "./deny.mjs", "scripts/check-test-scripts.mjs"], { cwd: directory, encoding: "utf8" });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).reason, "workspace-unreadable");
  assert.doesNotMatch(run.stdout + run.stderr, /private-canary/);
});

test("importing a workspace audit does not inspect or certify the workspace", t => {
  const directory = workspace(t);
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", "import './scripts/check-test-scripts.mjs'; console.log('imported');"],
    { cwd: directory, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "imported\n");
});

test("empty and partial stage observations cannot report all green", () => {
  for (const results of [[], [{ stage: "check", code: 0 }]]) {
    const summary = summarise({ label: "build", stages: ["check", "compile"], compileStage: "compile", results });
    assert.equal(summary.code, 2);
    assert.equal(summary.compileRan, false);
    assert.match(summary.lines.join("\n"), /stage-not-run/);
    assert.doesNotMatch(summary.lines.join("\n"), /all green/);
  }
  assert.equal(summarise({ label: "empty", stages: [], results: [] }).code, 2);
});

test("a real runner spawn refusal cannot claim the compile executed", t => {
  const directory = fixture(t);
  const run = stages(directory, ["compile"], { ...process.env, PATH: directory });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout, /stage-could-not-spawn/);
  assert.match(run.stdout, /compile .*DID NOT RUN — INCONCLUSIVE/);
  assert.doesNotMatch(run.stdout, /compile .*: ran/);
});

test("shell command refusals remain inconclusive through pnpm", t => {
  const directory = fixture(t);
  const refused = join(directory, "not-executable");
  writeFileSync(refused, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
  for (const command of ["./not-executable", "definitely-missing-316-command"]) {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: { compile: command } }));
    const run = stages(directory, ["compile"]);
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stdout, /stage-command-unavailable/);
    assert.match(run.stdout, /compile .*DID NOT RUN — INCONCLUSIVE/);
  }
});

test("native compiler exit two fails while a non-compile gate exit two is inconclusive", t => {
  const directory = fixture(t);
  writeFileSync(join(directory, "broken.ts"), "const value: string = 1;\n");
  const tsc = require.resolve("typescript/bin/tsc");
  const native = spawnSync(process.execPath, [tsc, "--skipLibCheck", "--noEmit", "broken.ts"], { cwd: directory, encoding: "utf8" });
  assert.equal(native.status, 2, native.stdout + native.stderr);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: {
    compile: `${JSON.stringify(process.execPath)} ${JSON.stringify(tsc)} --skipLibCheck --noEmit broken.ts`,
    check: 'node -e "process.exit(2)"',
  } }));
  const failed = stages(directory, ["compile"]);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stdout, /error TS2322/);
  assert.match(failed.stdout, /FAILED at stage 1 of 1: compile/);
  assert.match(failed.stdout, /compile .*: ran/);
  const unknown = stages(directory, ["check", "compile"]);
  assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
  assert.match(unknown.stdout, /INCONCLUSIVE/);
  assert.match(unknown.stdout, /compile .*DID NOT RUN/);
  assert.equal(classifyStageResult(native).code, 2);
});

test("misconfigured aggregate reports inconclusive because no stage could run", () => {
  const run = spawnSync(process.execPath, [join(scripts, "run-stages.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /INCONCLUSIVE/);
  assert.match(run.stderr, /no stage was run/);
});

test("stage output capture overflow reports inconclusive without forwarding truncated output", t => {
  const directory = fixture(t);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: { compile: "node output.mjs" } }));
  writeFileSync(join(directory, "output.mjs"), "process.stdout.write('x'.repeat(40 * 1024 * 1024));\n");
  const run = stages(directory, ["compile"]);
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stdout, /stage-result-unavailable/);
  assert.ok(run.stdout.length < 4096, "truncated stage output should not swamp its inconclusive report");
});

test("stage reporter preserves program output while omitting pnpm debug metadata", t => {
  const directory = fixture(t);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: { compile: "node output.mjs" } }));
  const records = [
    { check: "synthetic", status: "PASS" },
    { name: "pnpm:debug", private: "private-canary" },
    { name: "pnpm:lifecycle", line: "lifecycle-control" },
    { name: "pnpm", level: "error", code: "CONTROL", errno: "ENOENT", err: { message: "visible-control-error" } },
  ];
  writeFileSync(join(directory, "output.mjs"), records.map(record => `console.log(${JSON.stringify(JSON.stringify(record))});`).join("\n"));
  const run = stages(directory, ["compile"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /"check":"synthetic","status":"PASS"/);
  assert.match(run.stdout, /lifecycle-control/);
  assert.match(run.stderr, /visible-control-error/);
  assert.doesNotMatch(run.stdout + run.stderr, /private-canary/);
});
