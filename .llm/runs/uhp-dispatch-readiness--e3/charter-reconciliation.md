# Charter reconciliation — three passes, and why there were three

Coordinator receipt. Written 2026-09-14 on owner authorization ("just ship", "build ship ship
ship"). Merged under coordinator merge authority with five verifications per pull request.

## What shipped

| Pull request | Files | Merged |
| --- | --- | --- |
| 318 | `AGENTS.md`, `CLAUDE.md`, `README.md` | yes |
| 319 | `GOVERNANCE.md`, `docs/README.md` | yes |
| 320 | `AGENTS.md`, `CONTRIBUTING.md`, `README.md` | yes |

`ARCHITECTURE.md` §1 states the repository's charter is the portable agent runtime and that it
replaces the previous one, the `dsh` plugin layer. Six tracked documents still asserted the
previous one. Two of them asserted **both**, carrying the lock blockquote at the top and the
superseded framing further down as a ratified decision.

Post-merge sweep: no tracked file outside `.llm/runs/` asserts that the repository is the plugin
layer, and none routes a reversal or a ratification through the closed issue. The only remaining
matches are the negations written deliberately ("not a change to #30, which is closed").

## The defect I introduced, and the sweep property that caused it

318 marked decision 1 as scoped and decision 4 as superseded, in `AGENTS.md`. `README.md`
restates the same four decisions in its own section. I corrected that section's badge, its
reversal pointer and its scope paragraph, and left the enumerated list beneath them untouched.

So after 318 merged, `README.md:300` still asserted "This repo is the `dsh` layer only" flat and
unmarked, about twenty lines below a paragraph I had just edited to say the charter supersedes
exactly that. The root README contradicted itself inside one section, and the two entry points
disagreed about the status of two of four decisions.

That is the state 318's own commit message argues is worse than no reconciliation at all, because
the lock makes the contradiction look settled. I shipped it.

**Cause, stated as a property rather than as an apology.** I swept the input list I inherited from
issue 315 rather than the repository. A per-file reader over that list, plus a control proving the
reader fires, establishes that every file *in the list* was read. It establishes nothing about
whether the list enumerates every source. `CONTRIBUTING.md` carried the identical broken pointer
and was never in the list.

What found it: `grep` for the superseded claim across all tracked files, run after the merge,
against the repository rather than the list.

A coordinating peer independently named this exact property the same night, as the first of three
things it wanted an evaluation aimed at: a control proves the instrument fires, it does not prove
the instrument was pointed at everything. Two sessions reaching it from different artifacts is how
a rule separates from a preference. It belongs in the absent-signal catalogue as its own row.

**Corollary for the changed-file check.** The same peer asked that a multi-part pull request be
confirmed against its changed-file list rather than its body, after a three-part change arrived
with one part in it over six green gates. 318's changed files matched its body exactly and 318 was
still wrong: the files were right and the claim about what was done inside them was overstated. The
changed-file check catches a missing part. It does not catch an overstated one. For a documentation
change the cheap addition is a grep, after the merge, for the claim the change says it removed.

## Deliberately not changed

Recorded so a later sweep does not read these as gaps.

- `README.md:308`, `packages/netscript-bridge/README.md:31`,
  `docs/concepts/01-what-this-is.md:50` cite the decision-4 amendment comment. It records the
  cockpit and mobile repository relationship, which is the clause of decision 4 that still holds.
- `docs/concepts/03-the-board.md:4` cites ratified decision 3, which holds unchanged.
- `README.md:127` and `SUPPORT.md:11` send a reader to the epic for delivery progress. The
  generated `BOARD.md:93` still projects that epic with progress, so the sentence is not false
  today. It is downstream of issue 182, an epic orphaned by ratification, which is an owner
  decision.
- Ratified decisions 2 and 3 were left byte-unchanged because they still hold. Editing a true line
  to look thorough would weaken the claim that every other edit fixed something wrong.
- Occurrences under `.llm/runs/` are historical receipts and record what was true when written.

## Verification

Twelve build stages exit 0 on each branch before push, and CI green on each pull request before
merge. `check:links` 0 broken.

`check:docs` failed standalone on the first attempt with `MODULE_NOT_FOUND` on
`packages/dsh-app/dist/cli.js`. That was stage 10 run without stage 7's compile output, which is
the aggregate-ordering defect filed as issue 316, self-inflicted. It is weak evidence that 316 is
real and strong evidence that the aggregate teaches the wrong lesson on failure.

Issue 30's state was queried rather than inherited between commits: `CLOSED`, `NOT_PLANNED`,
closed 2026-09-13T15:09:32Z.

## Issue 315

Open, `status:triage`, `closedAt` null. It is an issue, not a pull request, so it never could have
merged. A peer reported it as "off the open list"; that was wrong and was corrected.
