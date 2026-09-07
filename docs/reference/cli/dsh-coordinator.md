<!-- Generated from packages/coordinator/src/cli.ts by scripts/cli-reference.mjs. Do not edit; run "pnpm run docs:cli". -->

# `dsh-coordinator`

> the deterministic gate between authoring and review

Shipped by [`packages/coordinator`](../../../packages/coordinator). This page is *what it does*;
*why it does it that way* is [`packages/coordinator/README.md`](../../../packages/coordinator/README.md).

## Exit codes

| code | name | meaning |
| --- | --- | --- |
| `0` | `ok` | clean: the question was answered and nothing is in the way |
| `1` | `blocked` | blocked, refused, forked, stalled, divergent, or a live worktree is at risk |
| `2` | `usage` | the command line was wrong |
| `3` | `unreadable` | the input could not be read, or nothing could be checked |
| `4` | `failed` | dsh-coordinator itself failed |

Read from `EXIT` and `EXIT_MEANINGS` in [`packages/coordinator/src/cli.ts`](../../../packages/coordinator/src/cli.ts). The `exit codes`
block in the help text below renders from those same two constants, so this table, that block
and the number the process actually returns cannot disagree.

## `dsh-coordinator --help`

```text
dsh-coordinator — the deterministic gate between authoring and review

usage:
  dsh-coordinator evaluator [options]   choose an evaluator, or refuse to
  dsh-coordinator policies              the independence rules, and what each requires
  dsh-coordinator workflow [options]    print a workflow definition, and check it
  dsh-coordinator plan [options]        what may run next, given the state — the "status ?" answer
  dsh-coordinator admit [options]       may this one step run? exit 1 says no, and why
  dsh-coordinator worktrees [options]   which worktrees are live, and what the archiver will take
  dsh-coordinator replay [options]      re-run a journal's decisions from their own inputs
  dsh-coordinator diff [options]        compare two journals, and name what changed

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
  --event            one JSONL line for "dsh-telemetry record"
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
  0  clean: the question was answered and nothing is in the way
  1  blocked, refused, forked, stalled, divergent, or a live worktree is at risk
  2  the command line was wrong
  3  the input could not be read, or nothing could be checked
  4  dsh-coordinator itself failed
```

---

Generated by [`scripts/cli-reference.mjs`](../../../scripts/cli-reference.mjs).
Editing this file by hand fails `pnpm run check:docs`; edit the CLI and run `pnpm run docs:cli`.
Back to [reference](../README.md) · [docs](../../README.md)
