# ADR 0001 — `doctrine/` and agent memory are separate stores

**Status:** accepted · **Date:** 2026-09-05 · **Supersedes:** nothing

> *About these records.* Doctrine states standing rules; a decision record states one choice, when
> it was made, and what it costs. They are different genres, so they live in different files.
> Records are numbered, immutable once accepted, and superseded rather than edited.

---

## Decision

**They do not merge, and agent memory does not live in this repository.**

| | `doctrine/` | agent memory |
|---|---|---|
| Author | humans, and agents proposing | agents, unattended |
| Gate | reviewed pull request | none — a background commit loop |
| Scope | portable to any repository | scoped to a target repo, shaped by a host |
| Lifetime | changed deliberately | rewritten and deleted freely |
| Home | this repository | a **separate operational repository** |

Neither store writes to the other. An agent that believes doctrine is wrong opens a pull request
against it; it never edits doctrine from a run, and the memory loop never touches `doctrine/`.

## Context

This is principle 9 — *each fact has one home* — applied to the one boundary where the two homes
would otherwise be one directory apart, and principle 8 — *mechanics are portable, knowledge is
not* — deciding which side a given note falls on.

Orchid's memory store is Claude's own auto-memory redirected per target repo into
`<dir>/<owner>/<repo>/`, committed and rebased onto a real branch every few minutes
(`rickylabs/orchid`, `docs/memory.md`). Two of its defaults are load-bearing here: `repo` defaults
to **the inbox repo**, and `dir` defaults to **`memory`** on `main`. This fleet's inbox is
`rickylabs/harness`. Enabling the feature as it ships would therefore put an unreviewed,
five-minute, agent-driven commit loop on the default branch of the repository that holds
`doctrine/`, `packages/` and the board's own rulebook. Orchid's documentation recommends against
exactly this, and so does this record.

Two observations from the fleet as of this date, both of which shaped the rule rather than
decorating it:

**The store is not switched on.** The live dispatcher config has no `memory` block at all, and
`main` here carries no `memory/` tree. The premise of the task that produced this record — that
Orchid "already syncs" such a subtree — was not true when it was checked. What runs today is
Claude's *unredirected* auto-memory, and that is namespaced by working directory: a dispatched run
gets an ephemeral worktree named after its issue, so it also gets a fresh, empty memory namespace
and inherits nothing.

**So knowledge does not accumulate — it is re-derived.** Four separate run namespaces on the
current host each wrote their own note describing the shape of this repository, independently. They
now disagree: the earliest states that there is no build and no tests to run, which was accurate
when written and is simply false now. That is principle 7's failure mode — an agent doing the same
work the same way repeatedly — and it is also the strongest argument for the promotion rule below,
because those four notes are the evidence of what belongs in doctrine and what does not.

## What promotes, and who ratifies it

**The test.** A memory note is a candidate for doctrine only if it would still be true **in a
repository that has never met this host**. That is principle 8 used as a filter, and it sorts the
observed notes cleanly:

- *Promotes.* "Post reviews as PR comments; never `gh pr review`; humans merge here." A standing
  rule of the project, independently rediscovered — which is the signal.
- *Never promotes — host and tool facts.* "`gh pr create` has no JSON flag", "`gh pr edit` needs a
  scope workaround", "pnpm is missing because `/ephemeral` is `noexec`". True of one host and one
  tool version. Doctrine that names them stops being portable the day either changes.
- *Never promotes — repository snapshots.* "Docs-only seed repo, no build or tests." A photograph
  of a moving thing. These go stale fastest and are the most damaging as doctrine, because a reader
  cannot tell a stale rule from a live one.

**The trigger** is recurrence: the same fact written independently in two or more run namespaces.
One agent learning something is a note. Two agents learning it separately is a gap in doctrine.

**Promotion is a rewrite, not a copy.** A memory note is written *to a host*; doctrine is written
*to any repository*. Copying carries across the host-specific framing that made it memory.

**Ratification is the ordinary doctrine gate: the owner, via pull request.** An agent may propose,
by opening a PR that cites the memory notes it is generalising. An agent may not promote by
writing. There is no automatic path from the memory loop into `doctrine/`, and adding one would
delete the only review this store has.

## Consequences

- Turning the memory store on requires setting `repo` explicitly. The default is wrong for this
  fleet, and this record is the reason to check.
- Memory has no eviction. Notes go stale silently, and staleness is its characteristic failure —
  so curation is a real duty: **contradicted notes are deleted, not appended to.**
- Doctrine stays small and slow-moving by construction, because the cheap place to write something
  down is memory and the expensive place is a pull request. That asymmetry is intended.
- Nothing enforces this boundary mechanically. It is a configuration choice plus a review habit; if
  either lapses, the failure is quiet.
