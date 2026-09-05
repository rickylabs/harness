# @rickylabs/coordinator

The decisions, made deterministically. Owned by **E6 · [#36](https://github.com/rickylabs/harness/issues/36)**.

**Status: shipped, partially wired.** Every command below runs today and its answers can be relied
on. What is missing is not the deciding but the wiring — [nothing writes the state file yet, and
nothing runs the census on a schedule](#what-is-not-built-yet).

```
dsh-coordinator evaluator    # choose an evaluator, or refuse to
dsh-coordinator plan         # what may run next, given the state
dsh-coordinator admit        # may this one step run? exit 1 says no, and why
dsh-coordinator workflow     # print a workflow definition, and check it
dsh-coordinator policies     # the independence rules, and what each requires
dsh-coordinator worktrees    # which worktrees are live, and what the archiver will take
dsh-coordinator replay       # re-run a journal's decisions from their own inputs
dsh-coordinator diff         # compare two journals, and name what changed
```

Every flag and exit code is in the generated
[`dsh-coordinator` reference](../../docs/reference/cli/dsh-coordinator.md). This page is the argument
behind them.

## What it is for

`board` says what the state of the work is. `telemetry` says what ran. This package decides — and
the reason it is a separate package with no workspace dependencies is that deciding must keep
working when the other two cannot run.

It reads JSON on stdin and writes JSON or prose on stdout. No credentials, no network, no clock.
That is what lets the gate run inside CI, on a laptop, and inside a container with no GitHub token,
which is precisely the set of situations where skipping the gate is most tempting and least visible.

## The gate came first, and that ordering is the design

The obvious first thing to build in a coordinator is the workflow engine. This package built the
**refusal** first.

`doctrine/WORKFLOW.md` says an independent evaluation stage must "use a model that did not author the
artifact under review". As a sentence, that is addressed to whoever is reading it — and whoever is
reading it is usually the author. An author deciding under time pressure whether they may review
their own work, with the only other candidate rate-limited, is not a gate. It is a temptation with a
paragraph attached.

`selectEvaluator` takes an author and a roster of candidates and returns one of exactly two things: a
named evaluator with the rule that made it legal, or a **blocker**. There is no degraded third
outcome. A roster with no legal evaluator produces a blocker, never permission for same-family
review, because the moment scarcity can soften the rule the rule only binds when it costs nothing.

Two commitments keep this portable, and both are load-bearing:

- **Nothing here knows a vendor's name.** `family` is an opaque token, compared and never parsed.
  "Is this open-weights" is a boolean the roster carries, not something inferred from a model id.
  Model ids are renamed, deprecated and re-tiered constantly; a rule that has to be edited whenever a
  vendor ships is a rule that is out of date at the moment it matters. `routing` owns those facts.
  This package owns the rule *about* them.
- **The answer does not depend on roster order.** Candidates are ranked by a total order derived
  from their own fields, so the same roster shuffled yields the same evaluator. A decision that is
  stable under a shuffle is a decision that can be replayed.

Preference order puts the **author's own seam first**, which surprises people who expect maximum
distance. Crossing from `subscription` to `relay` silently escalates a quota window that is already
paid for into a per-token meter that is not — see
[concepts/02 — Two seams, not one](../../docs/concepts/02-the-two-seams.md). Distance from the author
is bought by `family`, not by seam.

Two policies ship. `OPPOSITE_FAMILY` is the default and requires a different family; `SEAM_OR_FAMILY`
relaxes that and requires only a different seam. Both require an open-weights relay candidate.

`recordOf` writes the decision down **with its rejections**, and that is the expensive half worth
keeping. *"codex reviewed it"* is an outcome. *"codex reviewed it because the two anthropic
candidates were the author's own family and the relay candidate was not open-weights"* is a decision
someone can check, re-derive, and disagree with. One `RuleId` exists purely to keep that record
honest: `not-preferred` marks a candidate that was **legal and simply ranked lower**. Without it, a
roster with three viable evaluators and a roster with exactly one produce identical records — and
*"there was no alternative"* is the claim a reader most needs to be able to test.

## The workflow is inert data; the plan is a pure function

A workflow expressed as code that calls things can only be inspected by running it, and running it is
exactly what you may not do before its gates pass. So `MILESTONE_WORKFLOW` is a list of steps: what
each needs, and what it must cite. Eleven steps across five stages — decompose, dispatch, gate,
review, land — of which three are effects and every one of those three sits behind a gate.

Two words collide and it is worth being plain about it. A step's `stage` is where it sits in the
story. Its `kind` is what it *is*: a `read` gathers evidence, an `effect` changes the world, a `gate`
can refuse. Most gates live in the `gate` stage; not all of them do, because a decomposition has to
be gated before anything is written down, and that gate belongs to decompose.

`checkWorkflow` enforces one structural rule by name rather than by convention: **every effect step
must have a gate somewhere in what it needs.** A workflow whose effects are reachable without passing
a gate does not have a governance problem — it does not encode governance at all, and
`ungated-effect` refuses it.

`planOf` and `admit` then answer *what may run next* as a pure function of the definition and the
current state. Three doctrine principles are executable here, each as a named refusal:

| Refusal | What it enforces |
| --- | --- |
| `ungated-effect` | Nothing mutates before the gate — walking an effect's **transitive** prerequisites, because checking only direct needs is satisfied by a hand-edited state file, which is the case the principle exists for |
| `uncited` | A step is not done without a citation for every piece of evidence its definition declares, and the missing ones are named |
| `upstream-forked` | An owner decision is raised, not resolved. A forked step is terminal for its branch: nothing downstream becomes runnable and no default is chosen |

A step nobody wrote down is `pending`, so a missing or partial state file makes **less** run, never
more.

## Decisions are journalled with their inputs, and replayed against them

An outcome log says `run-codex-review` reviewed the change. That is a fact, and it is nearly useless
six weeks later, because the question people arrive with is *"why did it pick that one, and would it
pick it again?"* Neither is answerable from an outcome; both are answerable from the inputs.

So every journal entry carries the arguments the decision was made from, canonically serialised, with
a digest of the inputs and a digest of the output. Three things follow:

- `replay` feeds the persisted inputs back through the same code and compares. This is the half that
  cannot be faked: a journal proves what the coordinator *said*, only a replay proves it would say it
  again. The two come apart the moment something reads a clock, a file, an environment variable or a
  random number — and each of those arrives as an innocent convenience inside a decider, never as a
  line labelled "nondeterminism".
- `diff` compares two journals and attributes a changed plan to a **named** input that changed.
- A changed output with unchanged inputs has nowhere to hide. It is not a plan change; it is
  nondeterminism, reported under its own name.

Two details are deliberate and easy to get wrong in a reimplementation. `at` is in the entry and in
**neither digest** — a replay an hour later is the same decision, and a journal whose digests move
with the clock reports drift every time it is checked, which is the fastest way to teach everyone to
ignore it. And `canonicalJson` sorts object keys but **keeps array order**: a list whose order does
not matter must be sorted by whoever builds it. Sorting arrays here would quietly erase real
differences, because a plan that dispatches B before A is a different plan.

A journal entry whose `kind` has no registered decider comes back **named as unreplayable**, and a
replay where nothing could be re-run is reported as a broken check rather than a passing one.

## The worktree census, where being wrong destroys work

An auto-archiver runs every 12h on `ai-agents`. It tars-then-removes any worktree untouched for more
than 48h, and archives-then-kills tmux sessions idle for more than 48h. Neither is a bug — the disk
fills otherwise — but both are indifferent to whether a coordinated run is in the middle of using
what they delete. A milestone that takes three days is, from the archiver's side, indistinguishable
from abandoned scratch.

The mitigation is a `.archive-keep` file, so the whole question is *which directories get one*. That
question has a wrong answer that is very easy to reach: deciding ownership by matching strings.
`/p/x/worktrees/feat-6` is a prefix of `/p/x/worktrees/feat-69`; the name `feat-69` exists under two
roots at once; a `cwd` arrives with a trailing slash, or a `.`, or a doubled separator. Each of those
makes a substring test answer confidently and wrongly, and the direction that matters is the one
where a live worktree is judged unowned — because something acts on that judgement by deleting.

So ownership is exactly one thing: a run's real `--cwd`, normalised, **is** the worktree or is inside
it, compared at segment boundaries. Nothing is matched by name.

The second rule is that not knowing is not the same as knowing there is no owner. An unreadable `cwd`
removes the ability to prove a worktree *unowned*; it does not remove the ability to prove one owned.
So it protects everything it cannot rule out, and an incomplete census yields a **shorter** sweep
list, never a longer one.

## What it deliberately does not do

- **It does not perform steps.** Deciding what may run and doing it are kept apart, and that
  separation is what makes the deciding replayable at all. Performing is the daemon's job (E7 · #37).
- **It does not import another workspace package.** The two places it meets the rest of the system
  are a JSON roster coming in and a telemetry event going out — structural shapes, not imports. That
  is why the gate is affordable to run everywhere.
- **It does not resolve owner forks.** It names them so they can be routed to the issue bridge.
- **It does not know what a model is.** Model ids, families, effort tiers and availability are
  `routing`'s, and arrive as roster fields.

## What the tests protect

The suites are written against the failure, not the feature. `independence.test.ts` asserts that a
roster with no legal evaluator blocks rather than degrades, and that shuffling a roster does not
change the answer. `worktree.test.ts` is the longest file in the package because every prefix,
separator and normalisation case that could report a live worktree as abandoned has its own case.
`plan.test.ts` covers the transitive-gate walk against a hand-edited state file. `canonical.test.ts`
pins key sorting *and* array-order preservation, since erasing the second would make the whole replay
check pass vacuously.

## What is not built yet

`WORKFLOWS` contains one workflow. Nothing writes the state file the planner reads — today it is
supplied by whoever runs the command. `worktrees` is not yet called on a schedule, so the census is
a command someone runs rather than a guard that stands. `normalizePath` is POSIX-only by design,
which is correct for the N5 and wrong for a Windows worktree. Each of those is tracked against
E6 · [#36](https://github.com/rickylabs/harness/issues/36).
