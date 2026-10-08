/**
 * The subcommands of `harness-coordinator`. Each one takes parsed flags and returns its exit code;
 * `cli.ts` only parses, routes and prints usage.
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";

import { EXIT, POLICIES, type Flags } from "./cli-contract.js";
import { OPPOSITE_FAMILY, selectEvaluator } from "./independence.js";
import {
  compareJournals,
  journalLine,
  parseJournal,
  type PersistedDecision,
} from "./journal.js";
import { admit, parseStates, planOf, statesOf } from "./plan.js";
import { admitTelemetryLine, planOutcome, planTelemetryLine, recordOf, telemetryLine } from "./record.js";
import {
  renderComparison,
  renderDecision,
  renderPlan,
  renderReplay,
  renderWorkflow,
  renderWorktrees,
} from "./render.js";
import { evaluatorEntry, planEntry, replayJournal } from "./replay.js";
import { parseRoster } from "./roster.js";
import { checkWorkflow } from "./workflow.js";
import {
  hazards,
  judge,
  keepFileBody,
  parseCensus,
  unprotectedWorktrees,
  KEEP_FILE,
} from "./worktree.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The rules themselves, printable. An agent that cannot read the rule cannot follow it. */
export function policies(): number {
  const lines: string[] = ["independence policies:", ""];
  for (const policy of Object.values(POLICIES)) {
    lines.push(`  ${policy.name}${policy === OPPOSITE_FAMILY ? "  (default)" : ""}`);
    lines.push(
      policy.requireDifferentFamily
        ? "    the evaluator's family must differ from the author's"
        : "    the evaluator must differ from the author in seam or in family",
    );
    if (policy.relayMustBeOpen) {
      lines.push("    an evaluator reached over the relay seam must be open-weights");
    }
    lines.push("");
  }
  lines.push("Under every policy: a session never evaluates itself, and a roster with no legal");
  lines.push("evaluator is a blocker — never permission for same-family review.");
  process.stdout.write(`${lines.join("\n")}\n`);
  return EXIT.ok;
}

export async function evaluator(flags: Flags): Promise<number> {
  if (flags.roster === null && process.stdin.isTTY === true) {
    process.stdout.write("no --roster and nothing on stdin — give a roster file or pipe one in\n");
    return EXIT.usage;
  }

  let text: string;
  try {
    text = flags.roster === null ? await readStdin() : await readFile(flags.roster, "utf8");
  } catch (error) {
    process.stdout.write(`roster could not be read: ${String(error)}\n`);
    return EXIT.unreadable;
  }

  const parsed = parseRoster(text);
  if (parsed.roster === null) {
    for (const note of parsed.notes) process.stdout.write(`${note}\n`);
    return EXIT.unreadable;
  }

  const decision = selectEvaluator(parsed.roster.author, parsed.roster.candidates, flags.policy);
  const runId = flags.run ?? parsed.roster.author.id;
  const record = recordOf(runId, flags.at, decision);

  // Recorded before it is announced. A gate whose journal write is best-effort is a gate that
  // quietly stops being replayable on exactly the days something goes wrong with the disk.
  let unrecorded: string | null = null;
  if (flags.journal !== null) {
    const entry = evaluatorEntry(`evaluator:${runId}`, flags.at, parsed.roster, flags.policy, decision);
    try {
      await appendFile(flags.journal, `${journalLine(entry)}\n`, "utf8");
    } catch (error) {
      unrecorded = String(error);
    }
  }

  if (flags.event) {
    process.stdout.write(`${telemetryLine(record)}\n`);
  } else if (flags.json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderDecision(decision)}\n`);
  }

  // Roster notes go to stderr so a `--json` or `--event` caller can pipe stdout without filtering,
  // and still cannot miss that some of its roster was dropped.
  for (const note of parsed.notes) process.stderr.write(`roster: ${note}\n`);

  if (unrecorded !== null) {
    process.stderr.write(`journal could not be written: ${unrecorded}\n`);
    process.stderr.write("the decision above stands, but nothing recorded it — it cannot be replayed\n");
    return EXIT.failed;
  }

  return decision.kind === "selected" ? EXIT.ok : EXIT.blocked;
}

/**
 * The definition, and whether it holds up.
 *
 * Exits 1 on a problem rather than printing a warning. A workflow that has lost a gate is not a
 * document with a defect, it is a governance system that no longer governs, and the only way that
 * gets noticed is if something refuses to proceed.
 */
export function workflowCommand(flags: Flags): number {
  const problems = checkWorkflow(flags.workflow);
  process.stdout.write(
    flags.json
      ? `${JSON.stringify({ workflow: flags.workflow, problems }, null, 2)}\n`
      : `${renderWorkflow(flags.workflow, problems)}\n`,
  );
  return problems.length > 0 ? EXIT.blocked : EXIT.ok;
}

/**
 * Read the state document, or decide there isn't one.
 *
 * A missing `--state` with nothing on stdin is not an error: a run that has not started has no
 * state, and every step is pending. It is announced on stderr, because "nothing has run yet" and "I
 * could not find your file" look identical in the output otherwise.
 */
async function readState(flags: Flags): Promise<ReturnType<typeof parseStates> | null> {
  if (flags.state === null && process.stdin.isTTY === true) {
    process.stderr.write("no --state and nothing on stdin: treating every step as pending\n");
    return { states: [], notes: [] };
  }
  let text: string;
  try {
    text = flags.state === null ? await readStdin() : await readFile(flags.state, "utf8");
  } catch (error) {
    process.stdout.write(`state could not be read: ${String(error)}\n`);
    return null;
  }
  return parseStates(text);
}

/** What the run looks like right now. The whole reason this milestone exists. */
export async function plan(flags: Flags): Promise<number> {
  const parsed = await readState(flags);
  if (parsed === null) return EXIT.unreadable;
  if (parsed.states.length === 0 && parsed.notes.length > 0) {
    for (const note of parsed.notes) process.stdout.write(`${note}\n`);
    return EXIT.unreadable;
  }

  const states = statesOf(flags.workflow, parsed.states);
  const computed = planOf(flags.workflow, states);

  // Written before it is announced, for the reason the evaluator gate gives.
  let unrecorded: string | null = null;
  if (flags.journal !== null) {
    const runId = flags.run ?? flags.workflow.name;
    const entry = planEntry(`plan:${runId}`, flags.at, flags.workflow, states, computed);
    try {
      await appendFile(flags.journal, `${journalLine(entry)}\n`, "utf8");
    } catch (error) {
      unrecorded = String(error);
    }
  }

  if (flags.event) {
    process.stdout.write(`${planTelemetryLine(flags.run ?? flags.workflow.name, flags.at, computed)}\n`);
  } else if (flags.json) {
    process.stdout.write(`${JSON.stringify(computed, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderPlan(computed)}\n`);
  }
  for (const note of parsed.notes) process.stderr.write(`state: ${note}\n`);

  if (unrecorded !== null) {
    process.stderr.write(`journal could not be written: ${unrecorded}\n`);
    process.stderr.write("the plan above stands, but nothing recorded it — it cannot be replayed\n");
    return EXIT.failed;
  }

  // Both the exit code and the event read the same outcome, so a recorded line cannot contradict
  // the status a caller branched on.
  const outcome = planOutcome(computed);
  return outcome === "complete" || outcome === "runnable" ? EXIT.ok : EXIT.blocked;
}

/**
 * One step, one question, one exit status.
 *
 * This is the shape a dispatcher can actually use: `admit --step dispatch-run || exit`. The rule
 * "nothing mutates before the gate" stops being a paragraph in `docs/DOCTRINE.md` at the moment a shell script cannot get past
 * this line, and that is the only form of it that survives contact with an agent in a hurry.
 */
export async function admitCommand(flags: Flags): Promise<number> {
  if (flags.step === null) {
    process.stdout.write("admit needs --step <id>: it answers a question about one step\n");
    return EXIT.usage;
  }
  const parsed = await readState(flags);
  if (parsed === null) return EXIT.unreadable;
  if (parsed.states.length === 0 && parsed.notes.length > 0) {
    for (const note of parsed.notes) process.stdout.write(`${note}\n`);
    return EXIT.unreadable;
  }

  const admission = admit(flags.workflow, parsed.states, flags.step);
  if (flags.event) {
    process.stdout.write(`${admitTelemetryLine(flags.run ?? flags.workflow.name, flags.at, admission)}\n`);
  } else if (flags.json) {
    process.stdout.write(`${JSON.stringify(admission, null, 2)}\n`);
  } else if (admission.admitted) {
    process.stdout.write(`admitted: ${admission.step} — ${admission.because}\n`);
  } else {
    process.stdout.write(`REFUSED: ${admission.step} [${admission.rule}] ${admission.detail}\n`);
  }
  for (const note of parsed.notes) process.stderr.write(`state: ${note}\n`);

  if (admission.admitted) return EXIT.ok;
  return admission.rule === "unknown-step" ? EXIT.usage : EXIT.blocked;
}

/**
 * What the archiver will take, and what it must not.
 *
 * The census is handed in rather than gathered, for the same reason the roster is: this command has
 * to be able to run on a laptop, in CI, and on a host where the coordinator has no business calling
 * `ps`. Whoever can see the fleet writes down what is running and what is on disk; this decides.
 *
 * `--write` is the one mutation in this binary, and it is deliberately the additive one. Creating a
 * `.archive-keep` can only cause a directory to survive; nothing here deletes, marks for deletion, or
 * emits a list somebody could pipe into `rm`. If this command is wrong, the cost is disk.
 */
export async function worktrees(flags: Flags): Promise<number> {
  if (flags.census === null && process.stdin.isTTY === true) {
    process.stdout.write("no --census and nothing on stdin — give a census file or pipe one in\n");
    return EXIT.usage;
  }

  let text: string;
  try {
    text = flags.census === null ? await readStdin() : await readFile(flags.census, "utf8");
  } catch (error) {
    process.stdout.write(`census could not be read: ${String(error)}\n`);
    return EXIT.unreadable;
  }

  const parsed = parseCensus(text);
  const census = parsed.census;
  if (census === null) {
    for (const note of parsed.notes) process.stdout.write(`${note}\n`);
    return EXIT.unreadable;
  }

  const judged = judge(census);
  const written: string[] = [];
  const failed: string[] = [];
  if (flags.write) {
    for (const path of unprotectedWorktrees(census, judged)) {
      const owner = judged.find((judgement) => judgement.path === path)?.owner ?? "an unnamed run";
      try {
        await writeFile(`${path}/${KEEP_FILE}`, keepFileBody(owner, flags.at), "utf8");
        written.push(path);
      } catch (error) {
        failed.push(`${path}: ${String(error)}`);
      }
    }
  }

  // Judged again over what is now true, so the table is the state after the writes rather than the
  // state that motivated them. A report that still lists a hazard somebody just fixed teaches its
  // reader to ignore it.
  const effective =
    written.length === 0
      ? census
      : {
          ...census,
          worktrees: census.worktrees.map((fact) =>
            written.includes(fact.path) ? { ...fact, keepFile: true } : fact,
          ),
        };
  const finalJudged = written.length === 0 ? judged : judge(effective);
  const found = hazards(effective, finalJudged);

  process.stdout.write(
    flags.json
      ? `${JSON.stringify({ worktrees: finalJudged, hazards: found, written, failed }, null, 2)}\n`
      : `${renderWorktrees(finalJudged, found)}\n`,
  );
  for (const note of parsed.notes) process.stderr.write(`census: ${note}\n`);
  for (const path of written) process.stderr.write(`wrote ${path}/${KEEP_FILE}\n`);
  for (const line of failed) process.stderr.write(`could not write ${line}\n`);

  if (failed.length > 0) {
    process.stderr.write("a worktree that should have been protected was not — it is still eligible\n");
    return EXIT.failed;
  }
  return found.length > 0 ? EXIT.blocked : EXIT.ok;
}

async function readJournal(path: string, label: string): Promise<readonly PersistedDecision[] | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    process.stdout.write(`${label} could not be read: ${String(error)}\n`);
    return null;
  }
  const parsed = parseJournal(text);
  for (const note of parsed.notes) process.stderr.write(`${label}: ${note}\n`);
  return parsed.decisions;
}

/**
 * The determinism check, as a command.
 *
 * `unchecked` exits 3 rather than 0. A replay that re-ran nothing has not shown that anything is
 * deterministic, and the one thing that must never happen is somebody pasting a green tick from a
 * journal this build could not read.
 */
export async function replay(flags: Flags): Promise<number> {
  if (flags.journal === null) {
    process.stdout.write("replay needs --journal <path>: there is nothing to re-run without one\n");
    return EXIT.usage;
  }
  const decisions = await readJournal(flags.journal, "journal");
  if (decisions === null) return EXIT.unreadable;

  const result = replayJournal(decisions);
  process.stdout.write(
    flags.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderReplay(result)}\n`,
  );
  if (result.verdict === "divergent") return EXIT.blocked;
  return result.verdict === "unchecked" ? EXIT.unreadable : EXIT.ok;
}

/** Two journals, and a named reason for every difference between them. */
export async function diff(flags: Flags): Promise<number> {
  if (flags.before === null || flags.after === null) {
    process.stdout.write("diff needs --before <path> and --after <path>\n");
    return EXIT.usage;
  }
  const before = await readJournal(flags.before, "before");
  if (before === null) return EXIT.unreadable;
  const after = await readJournal(flags.after, "after");
  if (after === null) return EXIT.unreadable;

  const comparison = compareJournals(before, after);
  process.stdout.write(
    flags.json ? `${JSON.stringify(comparison, null, 2)}\n` : `${renderComparison(comparison)}\n`,
  );
  return comparison.identical && comparison.changes.length === 0 ? EXIT.ok : EXIT.blocked;
}
