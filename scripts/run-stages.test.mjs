// The claim this aggregate makes is about what a reader can tell from its last few lines, so every
// test below asserts on those lines. Each case is a state the `&&` chain could not express.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { INCONCLUSIVE_EXIT, classifyStageResult, summarise } from "./run-stages.mjs";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "run-stages.mjs");
const STAGES = ["one", "two", "compile", "four"];
const base = { label: "build", stages: STAGES, compileStage: "compile" };

test("all green reports the count and that the compile ran", () => {
  const result = summarise({ ...base, results: STAGES.map(stage => ({ stage, code: 0 })) });
  assert.equal(result.code, 0);
  assert.equal(result.compileRan, true);
  assert.match(result.lines[0], /ok — 4 stage\(s\), all green/);
  assert.match(result.lines.join("\n"), /compile \(compile, stage 3\): ran/);
});

test("a failure before the compile names the stage and says the compile did not run", () => {
  const result = summarise({ ...base, results: [{ stage: "one", code: 0 }, { stage: "two", code: 1 }] });
  assert.equal(result.code, 1);
  assert.equal(result.compileRan, false);
  assert.match(result.lines[0], /FAILED at stage 2 of 4: two/);
  assert.match(result.lines.join("\n"), /compile \(compile, stage 3\): DID NOT RUN/);
});

test("the stages never reached are named, so nothing is mistaken for having passed", () => {
  const result = summarise({ ...base, results: [{ stage: "one", code: 1 }] });
  assert.match(result.lines.join("\n"), /never reached: two, compile, four/);
});

test("a failure after the compile still reports that the compile ran", () => {
  const result = summarise({ ...base,
    results: [{ stage: "one", code: 0 }, { stage: "two", code: 0 }, { stage: "compile", code: 0 }, { stage: "four", code: 1 }] });
  assert.equal(result.compileRan, true);
  assert.match(result.lines[0], /FAILED at stage 4 of 4: four/);
});

test("an inconclusive stage is not reported as a failure and not as a pass", () => {
  const result = summarise({ ...base,
    results: [{ stage: "one", code: 0 }, { stage: "two", code: INCONCLUSIVE_EXIT }] });
  assert.equal(result.code, INCONCLUSIVE_EXIT);
  assert.deepEqual(result.inconclusive, ["two"]);
  assert.match(result.lines[0], /INCONCLUSIVE/);
  assert.doesNotMatch(result.lines[0], /FAILED/);
  assert.doesNotMatch(result.lines[0], /all green/);
  assert.match(result.lines.join("\n"), /nothing is established about two/);
});

test("a real failure outranks an inconclusive, because the strongest negative wins", () => {
  const result = summarise({ ...base,
    results: [{ stage: "one", code: INCONCLUSIVE_EXIT }, { stage: "two", code: 1 }] });
  assert.equal(result.code, 1);
  assert.match(result.lines[0], /FAILED at stage 2 of 4: two/);
});

test("a compile stage that is not among the stages is refused rather than mis-reported", () => {
  const run = spawnSync(process.execPath, [script, "--compile-stage", "absent", "one"], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /is not one of the stages/);
});

test("no stages at all is refused", () => {
  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /at least one stage/);
});

// These drive the classification with results from REAL spawnSync calls, because the previous
// version of this suite only ever fed `summarise` codes it had chosen by hand. The mapping from a
// spawned process to a stage code was the one line the correctness of every other line depended on
// and the one line no test executed. Found in review, after merge, by a second reader.

test("a stage killed by a signal is inconclusive, not a failure", () => {
  const killed = spawnSync(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]);
  assert.equal(killed.status, null, "this test is meaningless unless spawnSync really reports null here");
  const classified = classifyStageResult(killed);
  assert.equal(classified.code, INCONCLUSIVE_EXIT);
  assert.notEqual(classified.code, 1, "Ctrl-C during a build must not attribute a failure to a stage");
  assert.equal(classified.reason, "stage-interrupted");
  assert.match(classified.remedy, /SIGTERM/);
});

test("a stage that could not be spawned is inconclusive, and says so differently", () => {
  const missing = spawnSync("definitely-not-a-real-binary-for-this-test", []);
  assert.ok(missing.error, "this test is meaningless unless spawnSync really reports an error here");
  const classified = classifyStageResult(missing);
  assert.equal(classified.code, INCONCLUSIVE_EXIT);
  assert.equal(classified.reason, "stage-could-not-spawn");
  assert.notEqual(classified.reason, "stage-interrupted", "two different conditions, two different responses");
});

test("a real non-zero exit is still a failure and keeps its own code", () => {
  const failing = spawnSync(process.execPath, ["-e", "process.exit(3)"]);
  const classified = classifyStageResult(failing);
  assert.equal(classified.code, 3);
  assert.equal(classified.reason, undefined, "a real verdict carries no inconclusive reason");
});

test("a real zero exit is a pass", () => {
  const ok = spawnSync(process.execPath, ["-e", ""]);
  assert.deepEqual(classifyStageResult(ok), { code: 0 });
});

test("a stage that exits 2 of its own accord is inconclusive and says its reason is unrecorded", () => {
  // check:installed does exactly this. The aggregate must not invent a reason it was not given.
  const own = spawnSync(process.execPath, ["-e", "process.exit(2)"]);
  const classified = classifyStageResult(own);
  assert.equal(classified.code, INCONCLUSIVE_EXIT);
  const result = summarise({ ...base, results: [{ stage: "one", ...classified }] });
  assert.match(result.lines.join("\n"), /reason not recorded by the stage/);
});

test("the interrupted reason reaches the reported lines", () => {
  const killed = spawnSync(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]);
  const result = summarise({ ...base, results: [{ stage: "two", ...classifyStageResult(killed) }] });
  const text = result.lines.join("\n");
  assert.match(text, /INCONCLUSIVE/);
  assert.doesNotMatch(text, /FAILED/);
  assert.match(text, /two — stage-interrupted/);
});

test("a signal death translated by pnpm into 128 + N is inconclusive, not a failure", () => {
  // The path the first diagnosis of this defect missed, and the common one. pnpm does not propagate
  // a signal; it exits 143 for SIGTERM, so this never reaches the status === null branch. Measured
  // against a real pnpm stage that kills its own child: status 143, signal null, error null.
  for (const [code, signal] of [[130, "SIGINT"], [137, "SIGKILL"], [143, "SIGTERM"]]) {
    const classified = classifyStageResult({ status: code, signal: null, error: undefined });
    assert.equal(classified.code, INCONCLUSIVE_EXIT, `exit ${code} must not read as a failure`);
    assert.equal(classified.reason, "stage-interrupted");
    assert.match(classified.remedy, new RegExp(signal));
  }
});

test("a high exit code that is not a known signal translation stays a failure", () => {
  // Three values, not `> 128`. Inconclusive is the weaker report and a genuine failure must never be
  // traded down to it.
  for (const code of [129, 131, 136, 142, 144, 255]) {
    const classified = classifyStageResult({ status: code, signal: null, error: undefined });
    assert.equal(classified.code, code, `exit ${code} is not a signal translation and must stay a failure`);
    assert.equal(classified.reason, undefined);
  }
});

test("a stage that aborted or segfaulted stays a failure, because that is its own defect", () => {
  // The reason the set is a classification and not a threshold. 134 is SIGABRT and 139 is SIGSEGV:
  // the process died of something wrong with itself, which is a true report about the code. The
  // three that are inconclusive are deaths imposed from outside and say nothing about the code.
  // Widening to `status > 128` would suppress exactly these two.
  for (const [code, signal] of [[134, "SIGABRT"], [139, "SIGSEGV"]]) {
    const classified = classifyStageResult({ status: code, signal: null, error: undefined });
    assert.equal(classified.code, code, `${signal} means the stage failed, not that it did not run`);
    assert.notEqual(classified.code, INCONCLUSIVE_EXIT);
    assert.equal(classified.reason, undefined);
  }
});

test("importing the module runs no stages", () => {
  // The guard that keeps the executable half from firing on import. If it regresses, the test suite
  // itself would start shelling out to pnpm, which is the kind of failure that looks like a hang.
  const run = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import ${JSON.stringify(join(dirname(script), "run-stages.mjs"))};console.log("imported-clean")`],
    { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /imported-clean/);
});
