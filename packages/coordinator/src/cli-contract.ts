/**
 * The argv and exit contract of `harness-coordinator`: exit codes and their meanings, the flags, and
 * the one rule about `--event`. Pure, so every subcommand and the tests read the same definitions.
 */
import {
  OPPOSITE_FAMILY,
  SEAM_OR_FAMILY,
  type IndependencePolicy,
} from "./independence.js";
import { MILESTONE_WORKFLOW, WORKFLOWS, type Workflow } from "./workflow.js";

/**
 * Disjoint, and 1 is load-bearing.
 *
 * Following `harness-board`'s shape rather than `harness-telemetry`'s: 1 is "the thing you asked about is
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

/**
 * One sentence per code, keyed on `EXIT` — so a code added without a meaning is a type error
 * rather than an undocumented number a dispatcher has to guess at.
 *
 * This is the only statement of these meanings. The `exit codes` block in `USAGE` renders from it,
 * and so does `docs/reference/cli/harness-coordinator.md`, which `pnpm run check:docs` byte-compares.
 * Which command produced the code is a question the command list in `USAGE` answers; this table says
 * what the number means, and stays short enough to be read at the point of failure.
 */
export const EXIT_MEANINGS: Readonly<Record<keyof typeof EXIT, string>> = {
  ok: "clean: the question was answered and nothing is in the way",
  blocked: "blocked, refused, forked, stalled, divergent, or a live worktree is at risk",
  usage: "the command line was wrong",
  unreadable: "the input could not be read, or nothing could be checked",
  failed: "harness-coordinator itself failed",
};

export const POLICIES: Readonly<Record<string, IndependencePolicy>> = {
  [OPPOSITE_FAMILY.name]: OPPOSITE_FAMILY,
  [SEAM_OR_FAMILY.name]: SEAM_OR_FAMILY,
};

export interface Flags {
  readonly roster: string | null;
  readonly policy: IndependencePolicy;
  readonly state: string | null;
  readonly workflow: Workflow;
  readonly step: string | null;
  readonly census: string | null;
  readonly write: boolean;
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

/** The subcommands that reach a decision worth recording. Everything else refuses `--event`. */
export const EVENT_COMMANDS: ReadonlySet<string> = new Set(["evaluator", "plan", "admit"]);

/**
 * Why `--event` cannot be honoured, or null when it can.
 *
 * One place, and pure, because this was three copies of the same condition in three subcommands and
 * a fourth subcommand that had none — which is how `plan --event` came to accept the flag, print
 * prose, and hand a dispatcher's pipeline nothing to record. A rule enforced in each command
 * separately is a rule that is missing wherever nobody remembered it.
 */
export function eventFlagProblem(command: string, event: boolean, run: string | null): string | null {
  if (!event) return null;
  if (!EVENT_COMMANDS.has(command)) {
    return `--event is not available on ${command}: only ${[...EVENT_COMMANDS].join(", ")} produce a recordable decision`;
  }
  if (run === null) return "--event needs --run: an event with no run is not attached to anything";
  return null;
}

export function parseFlags(argv: readonly string[]): Flags {
  let roster: string | null = null;
  let policy: IndependencePolicy = OPPOSITE_FAMILY;
  let state: string | null = null;
  let workflow: Workflow = MILESTONE_WORKFLOW;
  let step: string | null = null;
  let census: string | null = null;
  let write = false;
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
      case "--state":
        state = next();
        break;
      case "--workflow": {
        const name = next();
        const found = WORKFLOWS.find((w) => w.name === name);
        if (found === undefined) {
          throw new Error(`unknown workflow ${name} — expected ${WORKFLOWS.map((w) => w.name).join(" or ")}`);
        }
        workflow = found;
        break;
      }
      case "--step":
        step = next();
        break;
      case "--census":
        census = next();
        break;
      case "--write":
        write = true;
        break;
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
  return {
    roster,
    policy,
    state,
    workflow,
    step,
    census,
    write,
    run,
    at,
    json,
    event,
    journal,
    before,
    after,
    help,
    rest,
  };
}
