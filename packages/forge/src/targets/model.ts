/**
 * The dispatch table: which inbox label sends whose work, in which repository, to which agent.
 *
 * Owned by E7 · #37, defined by #74. This is the mapping divybot already runs on — the same one,
 * read the same way, not a second table that happens to look like it. Every function here
 * corresponds to a named function in `cmd/divybot/main.go` of `rickylabs/orchid` and is a
 * deliberate transliteration of it, in the same spirit as `go-grammar.ts` in `@rickylabs/subagents`:
 * when the dispatcher's behaviour changes, this file is the one that has to change with it.
 *
 * ## Why the mapping is worth having on this side at all
 *
 * divybot resolves a target and dispatches. It never says what it resolved, and it never says what
 * it *declined* to resolve — a label with no target is skipped in a loop with no log line. So the
 * questions an operator actually asks about the board ("why did nothing spawn on #142?", "which
 * account is this repo metered against?", "is that second `harness` row doing anything?") have no
 * answer anywhere today. They are all answerable from the config file alone, offline, for free.
 *
 * ## The three behaviours worth writing down
 *
 * - **First match wins, in config order.** `targetFor` returns the first target whose label is on
 *   the issue. A second target naming the same label is unreachable, and nothing anywhere says so.
 * - **The agent list is an overflow preference, not a choice.** Admission takes the first agent
 *   whose *account* still has governor budget, so the agent that runs is a function of live quota.
 *   `agentsOf` gives the order; which one wins is not decidable from the table.
 * - **Accounts are coarser than harnesses.** `accountOf` pools `opencode` onto the codex account.
 *   That is what ships, and it is transliterated rather than corrected — see the note there.
 */

import { HARNESSES, parseGoDuration } from "@rickylabs/board";

/**
 * One row of the table: an inbox label, the repository its issues are worked in, and the agent.
 *
 * Field names are this package's; the JSON spellings divybot reads are in `config.ts`, which is the
 * only place that knows them. Everything downstream of a parse works on this shape.
 */
export interface Target {
  /** The inbox label that selects this target. */
  readonly label: string;
  /** `owner/name` of the repository the work is done in. */
  readonly repo: string;
  /**
   * The ordered agent-overflow preference, already normalised and deduplicated.
   *
   * Never empty: a row that named no agent at all resolves to the dispatcher's default, because
   * that is what the dispatcher does with it. Storing the default explicitly here rather than
   * leaving the field absent keeps every reader from having to know the default too.
   */
  readonly agents: readonly string[];
  /** A host capability the target requires, when it needs one (`build-deno`, `x86`). */
  readonly needCap?: string;
  /** Whether the dispatcher may squash-merge a green PR itself. Off for our targets — see #37. */
  readonly automerge: boolean;
  /** Admission order; higher goes first each tick. Absent in the file means 0. */
  readonly priority: number;
  /** Extra per-target scope guidance injected into the worker goal. */
  readonly promptHint?: string;
  /** New spawns paused. Live jobs keep running and keep being supervised. */
  readonly disabled: boolean;
}

/**
 * The git-backed shared memory store, with the dispatcher's defaults already applied.
 *
 * `repo` is not optional here even though it is optional in the file, and that is the entire point
 * of this type: the field's *default* is the inbox repository, so a config that simply omits it is
 * a config that puts an unreviewed five-minute commit loop on the inbox's default branch. Applying
 * the default at the parse is what lets `checkTargets` refuse the omission and the explicit spelling
 * with one rule instead of two — see `doctrine/decisions/0001-doctrine-and-memory.md`.
 */
export interface MemoryStore {
  readonly enabled: boolean;
  readonly repo: string;
  readonly branch: string;
  readonly dir: string;
  readonly interval: string;
}

/** The dispatcher's configuration, reduced to the parts that decide where an issue goes. */
export interface TargetTable {
  /** The repository whose labelled issues are polled. This repository is its own inbox. */
  readonly inbox: string;
  /** The login whose comments carry override authority — the security property #78 preserves. */
  readonly botLogin: string;
  /** Prefix of the branch a dispatched run pushes to. `orch/divybot-` in the live config. */
  readonly branchPrefix: string;
  readonly pollInterval: string;
  readonly targets: readonly Target[];
  readonly memory: MemoryStore;
}

/**
 * The dispatcher's own default agent, from `accountKey("")`.
 *
 * Spelled here rather than imported as `DEFAULT_HARNESS` because they are two different defaults
 * that happen to agree. One is what a `/swarm` block means by an absent `harness:`; this one is
 * what a target row means by an absent `agent`. They live in different programs.
 */
export const DEFAULT_TARGET_AGENT = "claude";

/**
 * Every way a table can be wrong, as a closed set.
 *
 * Closed so the suite can assert it reaches all of them. An open set of strings is a set where the
 * refusal nobody has produced yet is also the one nobody notices stopped working.
 */
export const TARGET_REFUSALS = [
  "no-targets",
  "missing-label",
  "missing-repo",
  "malformed-repo",
  "duplicate-label",
  "unknown-agent",
  "automerge-enabled",
  "memory-on-inbox",
  "malformed-duration",
  "missing-branch-prefix",
  "missing-bot-login",
] as const;

export type TargetRefusal = (typeof TARGET_REFUSALS)[number];

/** One thing wrong with the table, naming the row it is about where there is one. */
export interface TargetProblem {
  readonly reason: TargetRefusal;
  readonly message: string;
  /** The label of the offending row, or `null` for a problem about the table as a whole. */
  readonly label: string | null;
}

/**
 * `accountKey` — the governor's pacing account for an agent.
 *
 * A faithful transliteration, including the part we would have written differently. Orchid pools
 * `opencode` onto the codex account, which is right for a fleet where OpenCode drives the Codex
 * subscription and wrong for ours, where it goes over OpenRouter and spends credit that no
 * subscription window meters. Correcting it here would make this table describe a dispatcher that
 * does not exist: divybot would still count an opencode spawn against codex's cap and still refuse
 * the spawn when codex is exhausted, and the operator reading our output would have no way to
 * explain either. The divergence belongs in the fleet's config or in Orchid, not in the mirror.
 */
export function accountOf(agent: string): string {
  switch (agent) {
    case "":
    case "claude":
      return "claude";
    case "opencode":
    case "opencode-run":
    case "codex-run":
      return "codex";
    default:
      return agent;
  }
}

/**
 * `Target.agentList` — the overflow preference, normalised to accounts and deduplicated.
 *
 * Note what normalising costs: `["opencode", "codex"]` collapses to `["codex"]`, so a row that
 * asked to prefer OpenCode and fall back to Codex gets one candidate. That is divybot's behaviour,
 * and `checkTargets` does not refuse it — a table is not wrong for saying something the dispatcher
 * then flattens. It is visible in `dsh-forge targets show`, which is where it can be acted on.
 */
export function agentsOf(agents: readonly string[], fallback: string): readonly string[] {
  const out: string[] = [];
  for (const agent of agents) {
    const account = accountOf(agent);
    if (!out.includes(account)) out.push(account);
  }
  if (out.length === 0) out.push(accountOf(fallback));
  return out;
}

/** A resolved dispatch: the row that wins, and the rows the winner hides. */
export interface TargetMatch {
  readonly target: Target;
  /**
   * Rows that also match these labels and will never be reached, because resolution stops at the
   * first. Empty in the ordinary case; non-empty is the silent misconfiguration this exposes.
   */
  readonly shadowed: readonly Target[];
}

/**
 * `targetFor` — which target an issue's labels select.
 *
 * First match in table order, exactly as the dispatcher resolves it. The difference is that the
 * losers are returned rather than discarded: an issue carrying two target labels is dispatched to
 * one repository and looks, on the board, like it might have gone to either.
 */
export function resolveTarget(table: TargetTable, labels: readonly string[]): TargetMatch | null {
  const matching = table.targets.filter((target) => labels.includes(target.label));
  const [first, ...rest] = matching;
  if (first === undefined) return null;
  return { target: first, shadowed: rest };
}

/** The branch a dispatched run pushes to: `orch/divybot-142`. */
export function dispatchBranch(prefix: string, issue: number): string {
  return `${prefix}${String(issue)}`;
}

/**
 * The inbox issue a branch was dispatched for, or `null` when the branch is not one of ours.
 *
 * Strict about the suffix on purpose. `orch/divybot-142-retry` is a branch a person made by hand
 * from a dispatched one, and reading it as issue 142 would attribute their work to the run.
 */
export function issueOfBranch(prefix: string, branch: string): number | null {
  if (prefix === "" || !branch.startsWith(prefix)) return null;
  const suffix = branch.slice(prefix.length);
  if (!/^[0-9]+$/.test(suffix)) return null;
  const issue = Number.parseInt(suffix, 10);
  return Number.isSafeInteger(issue) && issue > 0 ? issue : null;
}

const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

const isHarness = (agent: string): boolean => HARNESSES.some((harness) => harness === agent);

/**
 * Every table-level invariant, as problems rather than exceptions.
 *
 * The same shape as `checkPolicy` in `@rickylabs/routing` and `checkCapability` in
 * `@rickylabs/llm-local`, for the same reason: this runs in a CI check and in a CLI that has to
 * print *all* of what is wrong, not the first thing that stopped it.
 *
 * What is deliberately not checked: whether `need_cap` names a capability any host has. Hosts are
 * operational state that changes without the table changing, and a rule that goes red when a box is
 * rebuilt is a rule that gets suppressed.
 */
export function checkTargets(table: TargetTable): readonly TargetProblem[] {
  const problems: TargetProblem[] = [];
  const say = (reason: TargetRefusal, label: string | null, message: string): void => {
    problems.push({ reason, message, label });
  };

  if (table.targets.length === 0) {
    say("no-targets", null, "the table has no targets — divybot refuses to start without at least one");
  }
  if (table.branchPrefix === "") {
    say(
      "missing-branch-prefix",
      null,
      "no branch prefix: a dispatched run's branch cannot be told from anyone else's",
    );
  }
  if (table.botLogin === "") {
    say(
      "missing-bot-login",
      null,
      "no bot login: nothing distinguishes an override comment from the bot from one by anybody else",
    );
  }
  if (parseGoDuration(table.pollInterval) === null) {
    say("malformed-duration", null, `poll interval ${JSON.stringify(table.pollInterval)} is not a Go duration`);
  }

  const seen = new Map<string, string>();
  for (const target of table.targets) {
    if (target.label === "") {
      say("missing-label", null, `a target for ${target.repo || "an unnamed repository"} has no label`);
    } else {
      const owner = seen.get(target.label);
      if (owner === undefined) seen.set(target.label, target.repo);
      else {
        say(
          "duplicate-label",
          target.label,
          `label ${JSON.stringify(target.label)} is already taken by ${owner}: ` +
            `resolution stops at the first match, so this row never runs`,
        );
      }
    }

    if (target.repo === "") {
      say("missing-repo", target.label, `${target.label || "a target"} names no repository`);
    } else if (!REPO_SLUG.test(target.repo)) {
      say("malformed-repo", target.label, `${JSON.stringify(target.repo)} is not an owner/name slug`);
    }

    for (const agent of target.agents) {
      if (isHarness(agent)) continue;
      say(
        "unknown-agent",
        target.label,
        `agent ${JSON.stringify(agent)} is not a harness this fleet knows (${HARNESSES.join(", ")})`,
      );
    }

    if (target.automerge) {
      say(
        "automerge-enabled",
        target.label,
        `${target.repo} has automerge on — PRs in this fleet are merged by humans (#37)`,
      );
    }
  }

  problems.push(...checkMemory(table));
  return problems;
}

/**
 * The one rule `doctrine/decisions/0001-doctrine-and-memory.md` asked for something to enforce.
 *
 * The store is a five-minute commit loop, driven by agents, pushing straight onto a branch. Pointed
 * at the inbox it would run that loop on the repository that holds `doctrine/`, `packages/` and the
 * board's own rulebook. The ADR closes with "nothing enforces this boundary mechanically"; this is
 * the mechanism.
 *
 * Checked against the *resolved* repository, so the omission and the explicit spelling are one
 * rule. Silent when the store is off, which is how it ships today — a rule that fires on a feature
 * nobody enabled teaches operators to ignore it before it ever means anything.
 */
function checkMemory(table: TargetTable): readonly TargetProblem[] {
  if (!table.memory.enabled) return [];
  const problems: TargetProblem[] = [];
  if (table.memory.repo === table.inbox) {
    problems.push({
      reason: "memory-on-inbox",
      label: null,
      message:
        `the memory store resolves to the inbox ${table.inbox} on ${table.memory.branch}: ` +
        `that is an unreviewed agent-driven commit loop on the branch that holds the doctrine. ` +
        `Set memory.repo explicitly (ADR 0001)`,
    });
  }
  if (parseGoDuration(table.memory.interval) === null) {
    problems.push({
      reason: "malformed-duration",
      label: null,
      message: `memory interval ${JSON.stringify(table.memory.interval)} is not a Go duration`,
    });
  }
  return problems;
}

/** One problem as a line an operator can act on. */
export function describeProblem(problem: TargetProblem): string {
  const where = problem.label === null ? "" : ` [${problem.label}]`;
  return `${problem.reason}${where}: ${problem.message}`;
}
