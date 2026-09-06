# Tutorials

*I have never done this. Walk me through it once.*

A tutorial is a lesson, not a manual. It has one path, no branches, and a definite end at which the
reader has something working. Options, alternatives and edge cases all belong somewhere else — a
tutorial that pauses to explain a choice has stopped teaching and started documenting.

| Page | What you end up with | Needs |
| --- | --- | --- |
| [01 — From a clone to a moving board](01-from-clone-to-board.md) | A built workspace, a board process installed in a repository of yours, an item moved a column, and a run recorded and read back | Node 24, pnpm 11, `gh` authenticated, a scratch repository cloned beside this one |

Shorter than a tutorial and already runnable: the [local proof](../../README.md#local-proof-first)
in the root README — install, build, and the commands that do something real.

## What belongs here

Few pages, each earned. A tutorial is expensive to keep true, because it is the one kind of document
where a single stale command wastes a stranger's afternoon. One more is worth the cost:

- **From a board to an agent that moves it.** Point an agent at the generated skill and watch the
  status labels change as it works. That one waits on the dispatch path being runnable off the N5.

## What does not belong here

- A task for someone who already knows the goal → [`how-to/`](../how-to/).
- Anything that begins "you could also…" → that sentence is what separates a tutorial from
  reference.
- Why any of it works this way → [`concepts/`](../concepts/), after the reader has something running.

## Writing one

Every command must be run, in order, in a clean clone, by the person writing it — not recalled.
State the prerequisites at the top and never add one mid-way. Show expected output, so a reader who
has diverged finds out immediately rather than three steps later. Keep it to one path even where a
better one exists for some readers; the better path is a how-to.

One hazard belongs in any tutorial that touches this repository's own board: the `harness` label
dispatches a real agent. It is not a category tag, and it should never appear in an example someone
is being encouraged to copy.

---

Back to [docs](../README.md)
