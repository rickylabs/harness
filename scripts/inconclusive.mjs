// A third gate state, held apart from pass and from fail.
//
// A check that cannot run must say so. Reporting a definite verdict it has not earned is the
// defect this module exists to remove: PRINCIPLES.md principle 6 states that a gate which cannot
// execute in the current repository is unproven and is never assumed green, so an inconclusive
// result is deliberately not exit zero. It is distinguishable from both other states by exit code
// and by a structured status, because a caller that can only see zero or non-zero cannot act on it.
//
// Nothing here crosses the output boundary except a reason code from a closed vocabulary and a
// fixed remedy string. The scratch preflight additionally reports its owned location and a closed
// execution code. Never reflect arbitrary error text, unowned paths or child output.
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Exit code for a gate that did not reach a verdict. Distinct from 0 (pass) and 1 (fail). */
export const INCONCLUSIVE_EXIT = 2;

export class Inconclusive extends Error {
  constructor(reason, remedy, details = {}) {
    super(reason);
    this.name = "Inconclusive";
    this.reason = reason;
    this.remedy = remedy;
    this.location = details.location;
    this.execution = details.execution;
  }
}

/**
 * Throws Inconclusive when the directory cannot execute a file it owns.
 *
 * A fixture that is a real executable cannot be tested around, so this is a property of the host
 * rather than of the code under test. `spawner` is injectable only so the failure branch can be
 * driven in a test on a host where every filesystem happens to be executable.
 */
export function requireExecutableDirectory(directory, spawner = spawnSync, platform = process.platform) {
  if (platform === "win32") {
    throw new Inconclusive("posix-shebang-host-required",
      "the executable fixture needs a POSIX shebang host; run this gate on Linux or macOS",
      { location: directory });
  }
  const probe = join(directory, "exec-preflight");
  let attempt;
  try {
    writeFileSync(probe, `#!${process.execPath}\nprocess.exit(0);\n`);
    chmodSync(probe, 0o700);
    attempt = spawner(probe, [], { stdio: "ignore", timeout: 5000 });
  } catch (error) {
    attempt = { error };
  } finally {
    try { rmSync(probe, { force: true }); } catch (error) { attempt = { error }; }
  }
  if (attempt.error || attempt.status !== 0) {
    const code = attempt.error?.code;
    const execution = ["EACCES", "EPERM", "ENOENT", "ENOEXEC", "ENOTDIR", "EROFS", "ENOSPC", "ETIMEDOUT"].includes(code)
      ? code : "probe-did-not-complete-successfully";
    throw new Inconclusive("scratch-not-executable",
      "could not execute the Node shebang fixture in the scratch location; check permissions, mount options and interpreter availability, or point TMPDIR at an executable filesystem",
      { location: directory, execution });
  }
}

/** The record a caller reads. `established` exists so no reader mistakes this for a negative. */
export function inconclusiveRecord(check, stage, error) {
  return {
    check,
    status: "INCONCLUSIVE",
    stage,
    reason: error.reason,
    remedy: error.remedy,
    established: "nothing; the gate did not run to a verdict",
    ...(error.location === undefined ? {} : { location: error.location }),
    ...(error.execution === undefined ? {} : { execution: error.execution }),
  };
}
