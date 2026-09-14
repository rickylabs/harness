// The claim this aggregate makes is about what a reader can tell from its last few lines, so every
// test below asserts on those lines. Each case is a state the `&&` chain could not express.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/** A single quote, so a shell command can be built without fighting the surrounding literal. */
const Q = String.fromCharCode(39);

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
  // The runner process itself dying, which is what an OOM kill aimed at pnpm looks like. NOT what a
  // terminal Ctrl-C looks like: that signals the whole foreground process group, so the reporter
  // dies too and no summary prints at all. Measured — SIGINT to the process group produced no
  // summary block, exit signal SIGINT. The wording used to claim Ctrl-C here and was wrong.
  const killed = spawnSync(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]);
  assert.equal(killed.status, null, "this test is meaningless unless spawnSync really reports null here");
  const classified = classifyStageResult(killed);
  assert.equal(classified.code, INCONCLUSIVE_EXIT);
  assert.notEqual(classified.code, 1, "an imposed death must not be attributed to the stage as a failure");
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

test("a REAL translated signal death is inconclusive, not a failure", () => {
  // This is the path the whole change is about, so it is driven by a real intermediate process
  // waiting on a real child that dies of a real signal. It was previously asserted against a
  // hand-written `{ status: 143 }` literal, with the measurement recorded in a comment beside it —
  // and a comment cannot fail. If an intermediate ever starts propagating the signal instead of
  // translating it, this test goes red where the comment would have stayed true-looking.
  for (const [signal, code] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
    const real = spawnSync("sh", ["-c", `node -e ${Q}process.kill(process.pid, "${signal}")${Q}`]);
    assert.equal(real.status, code, `sh must translate ${signal} to ${code} for this test to mean anything`);
    assert.equal(real.signal, null, "a translated death arrives as an ordinary status, not as a signal");
    const classified = classifyStageResult(real);
    assert.equal(classified.code, INCONCLUSIVE_EXIT, `a real ${signal} death must not read as a failure`);
    assert.equal(classified.reason, "stage-interrupted");
    assert.match(classified.remedy, new RegExp(signal));
  }
});

test("pnpm specifically translates rather than propagates, since the comment names pnpm", () => {
  // The code comment claims this about pnpm, so pnpm is measured rather than assumed from sh.
  const scratch = mkdtempSync(join(tmpdir(), "run-stages-xlate-"));
  try {
    writeFileSync(join(scratch, "package.json"), JSON.stringify({
      name: "xlate-probe", private: true,
      scripts: { suicide: `node -e "process.kill(process.pid,${Q}SIGTERM${Q})"` },
    }));
    const real = spawnSync("pnpm", ["run", "suicide"], { cwd: scratch, stdio: "ignore" });
    assert.equal(real.status, 143, "pnpm must report 143 for this change's premise to hold");
    assert.equal(real.signal, null);
    assert.equal(classifyStageResult(real).reason, "stage-interrupted");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("a REAL abort arrives as 134 and stays a failure", () => {
  // The boundary of the classification, against a real process rather than a literal. A stage that
  // aborts has told you something true about the code.
  // `ulimit -c 0` matters: without it this writes a half-gigabyte core file into whatever the cwd
  // happens to be, which is how a test suite silently fills a repository. Found by doing it once.
  const scratch = mkdtempSync(join(tmpdir(), "run-stages-abort-"));
  try {
    const real = spawnSync("sh", ["-c", `ulimit -c 0; node -e ${Q}process.abort()${Q}`],
      { cwd: scratch, stdio: "ignore" });
    assert.equal(real.status, 134, "sh must translate SIGABRT to 134 for this test to mean anything");
    assert.deepEqual(readdirSync(scratch), [], "the abort probe must not leave a core dump behind");
    const classified = classifyStageResult(real);
    assert.equal(classified.code, 134);
    assert.notEqual(classified.code, INCONCLUSIVE_EXIT, "an abort is the code failing, not the stage not running");
    assert.equal(classified.reason, undefined);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("a high exit code that is not a known signal translation stays a failure", () => {
  // Three values, not `> 128`. Inconclusive is the weaker report and a genuine failure must never be
  // traded down to it.
  for (const code of [131, 136, 142, 144, 255]) {
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
