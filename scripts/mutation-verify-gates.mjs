#!/usr/bin/env node
// Deliberately break one guard at a time in disposable copies. A red assertion is evidence;
// a missing test, broken import, syntax error, signal or timeout is not a killed mutant.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));
const regression = "gates-regressions.test.mjs";
const mutants = [];
function mutation(id, file, before, after, test, suite = regression) {
  mutants.push({ id, file, before, after, test, suite });
}
mutation("installed-preflight-wiring", "check-installed-contracts.mjs", "requireExecutableDirectory(scratch);", "/* bypass preflight */",
  "installed entrypoint preserves preflight inconclusive status and location");
mutation("installed-inconclusive-boundary", "check-installed-contracts.mjs", "if (error instanceof Inconclusive)", "if (false)",
  "installed entrypoint preserves preflight inconclusive status and location");
mutation("scratch-spawn-refusal", "inconclusive.mjs", "if (attempt.error || attempt.status !== 0)", "if (false)",
  "a spawn that cannot execute produces Inconclusive, not a failure", "inconclusive.test.mjs");
mutation("scratch-nonzero-refusal", "inconclusive.mjs", "attempt.error || attempt.status !== 0", "attempt.error",
  "a non-zero probe exit also produces Inconclusive, so a silent noexec cannot pass", "inconclusive.test.mjs");
mutation("windows-preflight", "inconclusive.mjs", 'platform === "win32"', "false",
  "preflight refuses Windows before spawning or writing a shebang fixture");
mutation("node-shebang", "inconclusive.mjs", "#!${process.execPath}", "#!/bin/sh",
  "preflight fixture uses the same Node interpreter as the installed fixture");
mutation("caught-preflight-error", "inconclusive.mjs", "attempt = { error };\n  } finally", "attempt = { status: 0 };\n  } finally",
  "preflight setup and thrown spawn errors are inconclusive without raw errors");
mutation("preflight-cleanup-error", "inconclusive.mjs", "catch (error) { attempt = { error }; }", "catch (error) { /* ignored */ }",
  "preflight cleanup failure is inconclusive");
mutation("owned-location", "inconclusive.mjs", "{ location: directory, execution }", "{ execution }",
  "preflight diagnostic names only owned location and closed execution reason");
mutation("closed-execution-code", "inconclusive.mjs", '? code : "probe-did-not-complete-successfully"', '? "wrong-code" : "probe-did-not-complete-successfully"',
  "preflight diagnostic names only owned location and closed execution reason");
mutation("raw-error-boundary", "inconclusive.mjs", "{ location: directory, execution }", "{ location: directory, execution: attempt.error?.message }",
  "preflight diagnostic names only owned location and closed execution reason");
mutation("generic-path-boundary", "inconclusive.mjs", "check,\n    status:", "check,\n    leakedPath: process.env.TMPDIR || '/tmp',\n    status:",
  "the record carries no path, so a diagnostic cannot leak one", "inconclusive.test.mjs");
mutation("workspace-empty", "check-test-scripts.mjs", "if (packages.length === 0)", "if (false)",
  "workspace inventory missing or empty is inconclusive, not a verdict");
mutation("workspace-inaccessible-manifest", "check-test-scripts.mjs", 'if (error.code === "ENOENT") return [];', 'return [];',
  "an inaccessible package cannot disappear from an otherwise valid inventory");
mutation("workspace-nonpackage-directory", "check-test-scripts.mjs", 'if (error.code === "ENOENT") return [];', 'if (false) return [];',
  "workspace declarations pass, missing tests fail and the missing package is named");
mutation("workspace-unreadable", "check-test-scripts.mjs", 'throw new Inconclusive("workspace-unreadable",', 'throw new Error("workspace-unreadable",',
  "workspace inventory missing or empty is inconclusive, not a verdict");
mutation("manifest-syntax-failure", "check-test-scripts.mjs", "if (typeof error.code !== \"string\" || typeof error.syscall !== \"string\") throw error;", "/* classify syntax as inconclusive */",
  "workspace unreadable manifest is inconclusive but invalid JSON fails");
mutation("workspace-import-boundary", "check-test-scripts.mjs", "if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))", "if (!process.argv[1] || realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))",
  "importing a workspace audit does not inspect or certify the workspace");
mutation("missing-test-script", "check-test-scripts.mjs", "!p.hasTestScript && !declaredNames.has(p.name)", "false",
  "workspace declarations pass, missing tests fail and the missing package is named");
mutation("stale-exemption", "check-test-scripts.mjs", "byName.get(d.name)?.hasTestScript === true", "false",
  "a declaration that outlived its reason is reported, so the list cannot rot", "check-test-scripts.test.mjs");
mutation("incomplete-results", "run-stages.mjs", "missing.length > 0 || stages.length === 0", "false",
  "empty and partial stage observations cannot report all green");
mutation("spawn-execution-report", "run-stages.mjs", 'executed: false, reason: "stage-could-not-spawn"', 'executed: true, reason: "stage-could-not-spawn"',
  "a real runner spawn refusal cannot claim the compile executed");
mutation("unavailable-command", "run-stages.mjs", "result.commandUnavailable || result.status === 126", "false",
  "shell command refusals remain inconclusive through pnpm");
mutation("pnpm-enoent-record", "run-stages.mjs", "run.commandUnavailable = true;", "run.commandUnavailable = false;",
  "shell command refusals remain inconclusive through pnpm");
mutation("compile-exit-two", "run-stages.mjs", "compile && result.status === INCONCLUSIVE_EXIT ? 1 : result.status", "result.status",
  "native compiler exit two fails while a non-compile gate exit two is inconclusive");
mutation("noncompile-exit-two", "run-stages.mjs", "compile && result.status === INCONCLUSIVE_EXIT ? 1 : result.status", "result.status === INCONCLUSIVE_EXIT ? 1 : result.status",
  "native compiler exit two fails while a non-compile gate exit two is inconclusive");
mutation("not-run-compile-wording", "run-stages.mjs", "DID NOT RUN — INCONCLUSIVE; compilation was not established", "DID NOT RUN",
  "a real runner spawn refusal cannot claim the compile executed");
mutation("named-failure", "run-stages.mjs", ": ${failed.stage}`", ": unnamed`",
  "a failure before the compile names the stage and says the compile did not run", "run-stages.test.mjs");
mutation("translated-signal", "run-stages.mjs", "SIGNAL_EXIT_CODES.get(result.status)", "undefined",
  "a REAL translated signal death is inconclusive, not a failure", "run-stages.test.mjs");
mutation("configuration-status", "run-stages.mjs", "process.exitCode = INCONCLUSIVE_EXIT;", "process.exitCode = 0;",
  "misconfigured aggregate reports inconclusive because no stage could run");

mutation("capture-started-guard", "run-stages.mjs", "if (result.pid > 0)", "if (false)",
  "bounded output capture is inconclusive after the runner started");
mutation("capture-execution-report", "run-stages.mjs", 'reason: "stage-result-unavailable"', 'executed: false, reason: "stage-result-unavailable"',
  "bounded output capture is inconclusive after the runner started");

mutation("unknown-execution-code", "inconclusive.mjs", '? code : "probe-did-not-complete-successfully"', '? code : code',
  "preflight unknown execution codes cannot reflect arbitrary input");
mutation("capture-bound", "run-stages.mjs", "maxBuffer: 32 * 1024 * 1024", "maxBuffer: 128 * 1024 * 1024",
  "stage output capture overflow reports inconclusive without forwarding truncated output");
mutation("truncated-output-boundary", "run-stages.mjs", "if (run.error) return run;", "/* forward incomplete output */",
  "stage output capture overflow reports inconclusive without forwarding truncated output");
mutation("debug-metadata-boundary", "run-stages.mjs", 'if (typeof record.line === "string") console.log(record.line);', 'console.log(line); if (typeof record.line === "string") console.log(record.line);',
  "stage reporter preserves program output while omitting pnpm debug metadata");
mutation("program-output-forwarding", "run-stages.mjs", "} else console.log(line);", "} else { /* discard program output */ }",
  "stage reporter preserves program output while omitting pnpm debug metadata");

mutation("lifecycle-output-forwarding", "run-stages.mjs", 'if (typeof record.line === "string") console.log(record.line);', 'if (typeof record.line === "string") { /* discard lifecycle output */ }',
  "stage reporter preserves program output while omitting pnpm debug metadata");
mutation("lifecycle-error-forwarding", "run-stages.mjs", 'else if (record.level === "error") console.error(record.err?.message ?? record.message ?? record.code);', 'else if (record.level === "error") { /* discard lifecycle error */ }',
  "stage reporter preserves program output while omitting pnpm debug metadata");
mutation("pnpm-error-code-boundary", "run-stages.mjs", '["ELIFECYCLE", "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL"].includes(record.code)', 'true',
  "stage reporter preserves program output while omitting pnpm debug metadata");

const files = ["inconclusive.mjs", "check-installed-contracts.mjs", "check-test-scripts.mjs", "run-stages.mjs", regression,
  "inconclusive.test.mjs", "check-test-scripts.test.mjs", "run-stages.test.mjs"];
const root = mkdtempSync(join(tmpdir(), "gate-mutations-"));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function runControl(directory, mutant, phase) {
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern", `^${escapeRegex(mutant.test)}$`, join(directory, "scripts", mutant.suite)];
  console.log(`\n${phase}: ${mutant.id}\ncommand: ${[process.execPath, ...args].map(quote).join(" ")}`);
  const run = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  console.log(`exit code: ${run.status}\nstdout:\n${run.stdout ?? ""}\nstderr:\n${run.stderr ?? ""}`);
  assert.equal(run.error, undefined, `${phase} did not execute: ${run.error?.code}`);
  assert.equal(run.signal, null, `${phase} was interrupted`);
  assert.doesNotMatch(run.stdout + run.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError:|ReferenceError:/, "a broken module is not mutation evidence");
  assert.match(run.stdout, new RegExp(`^# Subtest: ${escapeRegex(mutant.test)}$`, "m"), "the selected test must actually run");
  if (phase === "baseline") {
    assert.equal(run.status, 0, "baseline must be green before mutation");
    assert.match(run.stdout, /^# pass 1$/m);
    assert.match(run.stdout, /^# fail 0$/m);
  } else {
    assert.equal(run.status, 1, "mutant must fail with test-runner status 1");
    assert.match(run.stdout, new RegExp(`^not ok \\d+ - ${escapeRegex(mutant.test)}$`, "m"));
    assert.match(run.stdout, /ERR_ASSERTION/, "the mutant must trip an assertion");
    assert.match(run.stdout, /^# fail 1$/m);
  }
}
try {
  for (const mutant of mutants) {
    const directory = join(root, mutant.id);
    mkdirSync(join(directory, "scripts"), { recursive: true });
    for (const file of files) copyFileSync(join(source, file), join(directory, "scripts", file));
    symlinkSync(resolve(source, "../node_modules"), join(directory, "node_modules"), "dir");
    const target = join(directory, "scripts", mutant.file);
    const original = readFileSync(target, "utf8");
    assert.equal(original.split(mutant.before).length - 1, 1, `${mutant.id}: mutation must match exactly once`);
    runControl(directory, mutant, "baseline");
    console.log(`mutation: ${mutant.file}\nreplace: ${JSON.stringify(mutant.before)}\nwith: ${JSON.stringify(mutant.after)}`);
    writeFileSync(target, original.replace(mutant.before, mutant.after));
    runControl(directory, mutant, "mutant");
  }
  console.log(`\nMutation verification: ${mutants.length}/${mutants.length} killed by targeted assertions.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
