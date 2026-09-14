// The claim this aggregate makes is about what a reader can tell from its last few lines, so every
// test below asserts on those lines. Each case is a state the `&&` chain could not express.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { INCONCLUSIVE_EXIT, summarise } from "./run-stages.mjs";

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

test("importing the module runs no stages", () => {
  // The guard that keeps the executable half from firing on import. If it regresses, the test suite
  // itself would start shelling out to pnpm, which is the kind of failure that looks like a hang.
  const run = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import ${JSON.stringify(join(dirname(script), "run-stages.mjs"))};console.log("imported-clean")`],
    { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /imported-clean/);
});
