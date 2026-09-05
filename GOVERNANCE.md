# Governance

`rickylabs/harness` has one owner: Eric Chautems ([@rickylabs](https://github.com/rickylabs)), who
holds final authority over the roadmap, the architecture, what merges, and when anything is
released. That is the ordinary single-maintainer arrangement, and it would not need a file.

What needs a file is the part that is not ordinary. Most of the work here is done by agents, and an
agent cannot be trusted to know when a question stopped being technical. So the decision procedure
is explicit, mechanical, and the same for a person and a machine.

## Where a decision lives

**Ratified decisions live on the board, not in a document.** The four that constrain everything else
are in the *Decisions taken* table of [#30](https://github.com/rickylabs/harness/issues/30). They
are restated in [`README.md`](README.md#ratified-decisions) and
[`AGENTS.md`](AGENTS.md#ratified-decisions-you-inherit) because root documents are what a reader
meets first and a root document that contradicts a ratified decision propagates the contradiction
silently — but #30 is the record. Reversing one is a change to #30 before it is a change to code.

A decision is one of three things, and the difference is load-bearing:

| Kind | What it means | Who may change it |
| --- | --- | --- |
| **Ratified** | Settled. Not re-derived in a run, a pull request, or a prompt. | The owner, on #30 |
| **Taken, reversible** | Decided, and expected to be revisited — the MIT licence, the divybot strangler-fig | The owner, on #30 |
| **Owner fork** | Open. Depends on what the owner wants, not on what is true. | Only the owner |

Architecture decision records live in [`doctrine/decisions/`](doctrine/decisions/) for the reasoning
that outlives the issue thread.

## Owner forks: the escalation primitive

This is the rule that makes autonomous work safe here, and it is the one thing this file genuinely
owns:

> When the answer depends on what the owner wants rather than on what is true, **stop and file a
> numbered fork** with the question, the options, a recommendation, and the cost if the
> recommendation is wrong. Do not pick one and move on. Do not bury it in prose.

An agent that resolves an owner fork silently has not saved anyone time; it has made a decision
nobody knows was made, in a place nobody will look. A fork raised and left open is a healthy state.
A fork answered by anyone other than the owner is not.

The corollary binds reviewers too: a fork raised in review is resolved by the owner, not by the
reviewer and not by the author.

## Merging

**Nothing auto-merges.** Every pull request is merged by a human, deliberately, after CI is green.
Automerge would make the board's `status:ready-merge` column a formality, and that column is the
last place a person looks before work becomes history.

Review independence is not a convention here — it is enforced. An evaluator must not be the author
of the artifact it evaluates, and `node packages/coordinator/dist/cli.js policies` prints the rules
that decide who may review whose work. Where a policy and a preference disagree, the policy wins and
the disagreement is a finding.

## The board is the record, so the board is not edited destructively

Two consequences of GitHub being the source of truth
([decision 3](README.md#ratified-decisions)) that read as governance rather than tooling:

- **A label is never deleted, only retired.** Deleting one strips it from every item that carried
  it, and an item that recorded a decision stops saying so. Retired rows keep a `superseded_by:`
  and stay on the repository.
- **A closed item keeps saying how it ended.** Completed work closes to `status:shipped`; work
  closed as not-planned has its phase label removed entirely, because it did not ship. The
  distinction is the difference between a record and a tidy list.

## Releases

`@rickylabs/harness-contracts` is the only package that leaves this repository. It is published by
[`release-contracts.yml`](.github/workflows/release-contracts.yml), triggered by a
`harness-contracts-v*` tag — never from a local machine, never by a merge, and never by `ci`, which
holds read-only permissions and publishes nothing. The pipeline is inert until the owner adds an
`NPM_TOKEN`. Contributors do not publish.

## If this changes

This model fits a private repository with one owner and a fleet of agents. If the repository opens
up or gains maintainers, the model should change — toward a maintainers' group, a contribution
agreement, and branch protection that does not depend on one person's discipline. Any such change is
proposed and documented here before it takes effect.
