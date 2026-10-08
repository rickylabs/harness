#!/usr/bin/env node
/**
 * `harness-coordinator` — the gate, as a command.
 *
 * The working rule "nothing mutates before the gate" (`docs/DOCTRINE.md`) needs a process. A gate
 * that only exists inside an agent's reasoning cannot stop anything: the agent decides it has
 * passed, and the world is mutated by the same process that decided. So the gate is a process with
 * an exit status, and the exit status is the whole point — **1 means blocked**, and a dispatcher
 * that ignores it is visibly ignoring it in a script somebody can read.
 *
 * The roster comes in on a pipe or a file rather than being fetched. Choosing an evaluator must
 * work when the network is down, when the quota API is unreachable, and inside CI with no
 * credentials, because those are the conditions under which somebody is most tempted to skip the
 * gate. Whoever knows the fleet's current shape — routing, governance, a human — writes the roster;
 * this command only decides.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  admitCommand,
  diff,
  evaluator,
  plan,
  policies,
  replay,
  workflowCommand,
  worktrees,
} from "./cli-commands.js";
import { EXIT, EXIT_MEANINGS, eventFlagProblem, parseFlags, type Flags } from "./cli-contract.js";

// `scripts/cli-reference.mjs` reads every binary's exit table from its own `dist/cli.js`, so the
// binary module exports the table it exits with.
export { EXIT, EXIT_MEANINGS };

const EXIT_BLOCK = Object.entries(EXIT)
  .map(([name, code]) => `  ${code}  ${EXIT_MEANINGS[name as keyof typeof EXIT]}`)
  .join("\n");

const USAGE = `harness-coordinator — the deterministic gate between authoring and review

usage:
  harness-coordinator evaluator [options]   choose an evaluator, or refuse to
  harness-coordinator policies              the independence rules, and what each requires
  harness-coordinator workflow [options]    print a workflow definition, and check it
  harness-coordinator plan [options]        what may run next, given the state — the "status ?" answer
  harness-coordinator admit [options]       may this one step run? exit 1 says no, and why
  harness-coordinator worktrees [options]   which worktrees are live, and what the archiver will take
  harness-coordinator replay [options]      re-run a journal's decisions from their own inputs
  harness-coordinator diff [options]        compare two journals, and name what changed

options:
  --roster <path>    roster JSON (default: stdin)
  --policy <name>    opposite-family (default) or seam-or-family
  --state <path>     plan/admit: the step states (default: stdin)
  --workflow <name>  which workflow (default: milestone)
  --step <id>        admit: the step being asked about
  --census <path>    worktrees: what is running and what is on disk (default: stdin)
  --write            worktrees: write the missing keep files
  --run <id>         the run this decision belongs to, for the record
  --at <iso>         timestamp on the record, so a replay is byte-identical
  --json             the record as JSON instead of prose
  --event            evaluator/plan/admit: one JSONL line for "harness-telemetry
                     record". Needs --run. A usage error on any other command.
  --journal <path>   evaluator/plan: append the decision and its inputs here
                     replay: the journal to re-run
  --before <path>    diff: the journal to compare from
  --after <path>     diff: the journal to compare to
  --help

The roster is { "author": {...}, "candidates": [...] }. An actor is
{"id","seam","family","model","effort"}, where seam is "subscription" or "relay"
and family is any token you like — it is compared, never interpreted. A candidate
adds {"openWeights": true|false} (required) and {"blockedBy": "..."} (optional,
null when it can run).

The state is { "steps": [ {"id","outcome","citations","note"} ] }, where outcome is
pending, done, blocked or forked. A step nobody wrote down is pending, so a missing
or partial file means less runs, never more. Citations are a map from the evidence
name a step declares to the thing being cited, and each one has to refer to
something: a URL, #123 or owner/repo#123, run:<id>, a path like src/plan.ts:190, or
a 7-40 character sha. Prose is not a citation. A step may also pin the kind — "land"
must cite a sha, not the pull request that contains it — and "workflow" prints what
each step owes.

"admit" is the gate a dispatcher calls. It walks the step's transitive prerequisites
and refuses an effect while any gate among them is unpassed — checking only the
direct needs would be satisfied by a hand-edited state file, which is the case the
rule exists for.

The census is { "runs": [{"id","cwd"}], "worktrees": [{"path","keepFile","idleHours"}],
"sessions": [...] }. A worktree is owned when a run's actual cwd is that directory or
inside it, compared at segment boundaries — never by name and never by prefix, because
the inverted form of that mistake reports a live worktree as abandoned to something
that deletes. A run whose cwd cannot be read protects every worktree it cannot rule
out, so an incomplete census produces a shorter sweep list, never a longer one.

A journal is JSONL, one decision per line, holding the inputs a decision was made
from as well as its output. That is what makes "replay" possible: the same inputs
go back through the same code, and the answers are compared. A decision that comes
back different from identical inputs is nondeterminism, and is reported as that
rather than as a change of plan.

exit codes:
${EXIT_BLOCK}
`;

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

  const command = String(flags.rest[0]);
  const eventProblem = eventFlagProblem(command, flags.event, flags.run);
  if (eventProblem !== null) {
    process.stdout.write(`${eventProblem}\n`);
    return EXIT.usage;
  }
  if (command === "evaluator") return await evaluator(flags);
  if (command === "policies") return policies();
  if (command === "workflow") return workflowCommand(flags);
  if (command === "plan") return await plan(flags);
  if (command === "admit") return await admitCommand(flags);
  if (command === "worktrees") return await worktrees(flags);
  if (command === "replay") return await replay(flags);
  if (command === "diff") return await diff(flags);

  process.stdout.write(`unknown command: ${String(command)}\n\n${USAGE}`);
  return EXIT.usage;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stdout.write(`harness-coordinator failed: ${String(error)}\n`);
      process.exitCode = EXIT.failed;
    });
}
