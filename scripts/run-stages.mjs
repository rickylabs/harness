// A staged aggregate that says which stage decided the result.
//
// The problem this replaces: `a && b && c` exits 1 whichever link fails, and the terminal lines a
// reader or a CI summary actually sees carry no stage name. So "build failed" was compatible with a
// broken markdown link and with code that does not compile, and the twelve-stage chain put the
// compile at stage 7 — six checks could fail before the compiler was ever invoked.
//
// Three things are reported that the chain could not report: which stage failed, whether the
// designated compile stage ran, and whether any stage returned INCONCLUSIVE rather than a verdict.
// The third matters because an aggregate that flattens "did not run" into "failed" loses exactly the
// distinction scripts/inconclusive.mjs exists to preserve.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const INCONCLUSIVE_EXIT = 2;

/**
 * Signal deaths as an intermediate runner reports them. Neither `pnpm` nor `sh` propagates a signal;
 * each translates the child's death into 128 + signal number and exits normally, so these arrive as
 * ordinary statuses and would otherwise read as very specific failures. Measured both ways: a child
 * that SIGTERMs itself under `sh` and under `pnpm run` both give status 143, signal null, error null.
 *
 * An enumerated set, and `status > 128` would be **wrong rather than merely generous.** The question
 * is not how large the code is, it is whether the stage chose its own death:
 *
 *     129 = 128 + 1   SIGHUP    terminal or parent went away   inconclusive
 *     130 = 128 + 2   SIGINT    interrupted                    inconclusive
 *     137 = 128 + 9   SIGKILL   killed, often OOM              inconclusive
 *     143 = 128 + 15  SIGTERM   terminated                     inconclusive
 *     134 = 128 + 6   SIGABRT   died of its own defect         FAIL
 *     139 = 128 + 11  SIGSEGV   died of its own defect         FAIL
 *
 * A stage that aborts or segfaults has told you something true about the code, and calling that
 * inconclusive would suppress a real failure. The four above are deaths the stage did not choose and
 * say nothing about the repository. So widening this to a range would misclassify exactly the two
 * codes that matter most.
 *
 * 131, SIGQUIT, is deliberately left as a failure despite also arriving from outside. A quit signal
 * is conventionally sent to dump a process that is already misbehaving, so the death is a response to
 * the code rather than independent of it. That is a judgement rather than a measurement, and it is
 * recorded here so it can be argued with.
 *
 * The residual trade: a script deliberately exiting one of the four would be misreported. None does
 * here, it would still be non-zero, and it would still name the signal it believed it saw.
 */
const SIGNAL_EXIT_CODES = new Map([
  [129, "SIGHUP"], [130, "SIGINT"], [137, "SIGKILL"], [143, "SIGTERM"],
]);

/**
 * Classify what a spawned stage actually did.
 *
 * Three conditions are not failing stages, and all three were being reported as one. Each was
 * measured rather than reasoned about, because the first diagnosis of this defect was wrong about
 * which path Ctrl-C actually takes:
 *
 *     pnpm itself killed by a signal   status null, signal set     OOM killing the runner
 *     the stage runner not on PATH     status null, error ENOENT    host not set up
 *     the stage's own child killed     status 143, signal null      Ctrl-C during a long build
 *
 * The third is the common one and it does not go through `status === null` at all, because pnpm
 * translates it. A first fix that handled only the null cases would have looked complete and left
 * the everyday path misreporting.
 *
 * The reasons stay apart because the responses differ. An interrupted stage says nothing about the
 * repository. A stage that could not be spawned says the host is not set up to run it.
 */
export function classifyStageResult(result) {
  if (result.error) {
    return { code: INCONCLUSIVE_EXIT, reason: "stage-could-not-spawn",
      remedy: "the stage runner could not be started on this host; check that pnpm is on PATH" };
  }
  const interrupted = result.status === null
    ? (typeof result.signal === "string" && result.signal.length > 0 ? result.signal : "a signal")
    : SIGNAL_EXIT_CODES.get(result.status);
  if (interrupted !== undefined) {
    return { code: INCONCLUSIVE_EXIT, reason: "stage-interrupted",
      remedy: `the stage was terminated by ${interrupted} before it reached a verdict; nothing is known about it` };
  }
  return { code: result.status };
}

/** Pure, so the reporting can be driven in a test without spawning twelve real stages. */
export function summarise({ label, stages, compileStage, results }) {
  const ran = results.map(r => r.stage);
  const failed = results.find(r => r.code !== 0 && r.code !== INCONCLUSIVE_EXIT);
  const inconclusive = results.filter(r => r.code === INCONCLUSIVE_EXIT).map(r => r.stage);
  const compileRan = compileStage === undefined ? undefined : ran.includes(compileStage);
  const decided = failed ?? (inconclusive.length > 0 ? { stage: inconclusive[0], code: INCONCLUSIVE_EXIT } : undefined);
  const position = decided ? stages.indexOf(decided.stage) + 1 : stages.length;
  const lines = [];
  if (failed) {
    lines.push(`${label} FAILED at stage ${position} of ${stages.length}: ${failed.stage}`);
  } else if (inconclusive.length > 0) {
    lines.push(`${label} INCONCLUSIVE — ${inconclusive.length} stage(s) did not reach a verdict: ${inconclusive.join(", ")}`);
    for (const result of results.filter(r => r.code === INCONCLUSIVE_EXIT)) {
      const why = result.reason ? `${result.reason}: ${result.remedy ?? "no remedy recorded"}` : "reason not recorded by the stage";
      lines.push(`  ${result.stage} — ${why}`);
    }
    lines.push(`  nothing is established about ${inconclusive.join(", ")}; this is not a pass and not a failure`);
  } else {
    lines.push(`${label} ok — ${stages.length} stage(s), all green`);
  }
  if (compileStage !== undefined) {
    lines.push(`  compile (${compileStage}, stage ${stages.indexOf(compileStage) + 1}): ${compileRan ? "ran" : "DID NOT RUN"}`);
  }
  if (decided) {
    const skipped = stages.slice(position);
    if (skipped.length > 0) lines.push(`  never reached: ${skipped.join(", ")}`);
  }
  return { code: failed ? failed.code : (inconclusive.length > 0 ? INCONCLUSIVE_EXIT : 0), compileRan, inconclusive, lines };
}

function parse(argv) {
  const stages = [];
  let label = "stages", compileStage;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--label") { label = argv[++index]; continue; }
    if (argv[index] === "--compile-stage") { compileStage = argv[++index]; continue; }
    stages.push(argv[index]);
  }
  if (stages.length === 0) throw new Error("run-stages needs at least one stage");
  if (compileStage !== undefined && !stages.includes(compileStage)) {
    throw new Error(`--compile-stage ${compileStage} is not one of the stages, so its report would be a lie`);
  }
  return { label, compileStage, stages };
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (invokedDirectly()) {
  try {
    const { label, compileStage, stages } = parse(process.argv.slice(2));
    const results = [];
    for (const stage of stages) {
      const run = spawnSync("pnpm", ["run", stage], { stdio: "inherit", shell: process.platform === "win32" });
      const classified = classifyStageResult(run);
      results.push({ stage, ...classified });
      if (classified.code !== 0) break;
    }
    const summary = summarise({ label, stages, compileStage, results });
    console.log("");
    for (const line of summary.lines) console.log(line);
    process.exitCode = summary.code;
  } catch (error) {
    // A misconfigured runner is not a stage verdict and must not be readable as one. Said in a
    // sentence rather than left as a stack trace: a reader who sees a trace here goes looking for a
    // bug in a stage, when the fault is in the argv that named the stages.
    console.error(`run-stages configuration error — no stage was run: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
