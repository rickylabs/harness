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
 * Signal deaths as an intermediate runner reports them. `pnpm` does not propagate a signal; it
 * translates the child's death into 128 + signal number and exits normally, so these arrive as
 * ordinary statuses and would otherwise read as three very specific failures.
 *
 * Deliberately three values and not `status > 128`. Treating every high code as a signal would
 * reclassify a genuine failure as inconclusive, and inconclusive is the weaker report — the
 * strongest-negative rule says never trade a failure down. A script that deliberately exits 130,
 * 137 or 143 exists in principle; in this repository none does, and the misreport would still be
 * non-zero and would still name which signal it believed it saw.
 */
const SIGNAL_EXIT_CODES = new Map([[130, "SIGINT"], [137, "SIGKILL"], [143, "SIGTERM"]]);

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
}
