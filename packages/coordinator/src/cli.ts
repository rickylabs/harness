#!/usr/bin/env node
/**
 * `dsh-coordinator` — the gate, as a command.
 *
 * Principle 5 says nothing mutates before the gate. A gate that only exists inside an agent's
 * reasoning cannot stop anything: the agent decides it has passed, and the world is mutated by the
 * same process that decided. So the gate is a process with an exit status, and the exit status is
 * the whole point — **1 means blocked**, and a dispatcher that ignores it is visibly ignoring it in
 * a script somebody can read.
 *
 * The roster comes in on a pipe or a file rather than being fetched. Choosing an evaluator must
 * work when the network is down, when the quota API is unreachable, and inside CI with no
 * credentials, because those are the conditions under which somebody is most tempted to skip the
 * gate. Whoever knows the fleet's current shape — routing, governance, a human — writes the roster;
 * this command only decides.
 */

import { appendFile, readFile } from "node:fs/promises";

import {
  OPPOSITE_FAMILY,
  SEAM_OR_FAMILY,
  selectEvaluator,
  type IndependencePolicy,
} from "./independence.js";
import {
  compareJournals,
  journalLine,
  parseJournal,
  type PersistedDecision,
} from "./journal.js";
import { recordOf, telemetryLine } from "./record.js";
import { renderComparison, renderDecision, renderReplay } from "./render.js";
import { evaluatorEntry, replayJournal } from "./replay.js";
import { parseRoster } from "./roster.js";

const USAGE = `dsh-coordinator — the deterministic gate between authoring and review

usage:
  dsh-coordinator evaluator [options]   choose an evaluator, or refuse to
  dsh-coordinator policies              the independence rules, and what each requires
  dsh-coordinator replay [options]      re-run a journal's decisions from their own inputs
  dsh-coordinator diff [options]        compare two journals, and name what changed

options:
  --roster <path>    roster JSON (default: stdin)
  --policy <name>    opposite-family (default) or seam-or-family
  --run <id>         the run this decision belongs to, for the record
  --at <iso>         timestamp on the record, so a replay is byte-identical
  --json             the record as JSON instead of prose
  --event            one JSONL line for "dsh-telemetry record"
  --journal <path>   evaluator: append the decision and its inputs here
                     replay: the journal to re-run
  --before <path>    diff: the journal to compare from
  --after <path>     diff: the journal to compare to
  --help

The roster is { "author": {...}, "candidates": [...] }. An actor is
{"id","seam","family","model","effort"}, where seam is "subscription" or "relay"
and family is any token you like — it is compared, never interpreted. A candidate
adds {"openWeights": true|false} (required) and {"blockedBy": "..."} (optional,
null when it can run).

A journal is JSONL, one decision per line, holding the inputs a decision was made
from as well as its output. That is what makes "replay" possible: the same inputs
go back through the same code, and the answers are compared. A decision that comes
back different from identical inputs is nondeterminism, and is reported as that
rather than as a change of plan.

exit status:
  0  an evaluator was selected · a replay was identical · two journals agree
  1  blocked, divergent, or the plan changed. Read the reason before proceeding.
  2  the command line was wrong
  3  the input could not be read, or nothing could be checked
  4  dsh-coordinator itself failed
`;

/**
 * Disjoint, and 1 is load-bearing.
 *
 * Following `dsh-board`'s shape rather than `dsh-telemetry`'s: 1 is "the thing you asked about is
 * not clean" and 4 is "I broke". A gate needs those to be different numbers, because a caller that
 * cannot tell "no legal evaluator exists" from "the tool crashed" will eventually treat both as
 * noise and dispatch anyway.
 */
export const EXIT = {
  ok: 0,
  blocked: 1,
  usage: 2,
  unreadable: 3,
  failed: 4,
} as const;

const POLICIES: Readonly<Record<string, IndependencePolicy>> = {
  [OPPOSITE_FAMILY.name]: OPPOSITE_FAMILY,
  [SEAM_OR_FAMILY.name]: SEAM_OR_FAMILY,
};

interface Flags {
  readonly roster: string | null;
  readonly policy: IndependencePolicy;
  readonly run: string | null;
  readonly at: string;
  readonly json: boolean;
  readonly event: boolean;
  readonly journal: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly help: boolean;
  readonly rest: readonly string[];
}

export function parseFlags(argv: readonly string[]): Flags {
  let roster: string | null = null;
  let policy: IndependencePolicy = OPPOSITE_FAMILY;
  let run: string | null = null;
  let at = new Date().toISOString();
  let json = false;
  let event = false;
  let journal: string | null = null;
  let before: string | null = null;
  let after: string | null = null;
  let help = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${String(arg)} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--roster":
        roster = next();
        break;
      case "--policy": {
        const name = next();
        const found = POLICIES[name];
        if (found === undefined) {
          throw new Error(`unknown policy ${name} — expected ${Object.keys(POLICIES).join(" or ")}`);
        }
        policy = found;
        break;
      }
      case "--run":
        run = next();
        break;
      case "--at": {
        const raw = next();
        if (!Number.isFinite(Date.parse(raw))) {
          throw new Error("--at needs a time, like 2026-09-05T00:00:00Z");
        }
        at = raw;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--event":
        event = true;
        break;
      case "--journal":
        journal = next();
        break;
      case "--before":
        before = next();
        break;
      case "--after":
        after = next();
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (arg !== undefined) rest.push(arg);
    }
  }
  return { roster, policy, run, at, json, event, journal, before, after, help, rest };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The rules themselves, printable. An agent that cannot read the rule cannot follow it. */
function policies(): number {
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

async function evaluator(flags: Flags): Promise<number> {
  if (flags.event && flags.run === null) {
    process.stdout.write("--event needs --run: an event with no run is not attached to anything\n");
    return EXIT.usage;
  }
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
async function replay(flags: Flags): Promise<number> {
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
async function diff(flags: Flags): Promise<number> {
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

export async function main(argv: readonly string[]): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    process.stdout.write(`${String(error instanceof Error ? error.message : error)}\n\n${USAGE}`);
    return EXIT.usage;
  }
  if (flags.help) {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }

  const command = flags.rest[0];
  if (command === "evaluator") return await evaluator(flags);
  if (command === "policies") return policies();
  if (command === "replay") return await replay(flags);
  if (command === "diff") return await diff(flags);

  process.stdout.write(`unknown command: ${String(command)}\n\n${USAGE}`);
  return EXIT.usage;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("cli.js") || invoked.endsWith("dsh-coordinator")) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stdout.write(`dsh-coordinator failed: ${String(error)}\n`);
      process.exitCode = EXIT.failed;
    });
}
