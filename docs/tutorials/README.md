# Tutorials

*I have never done this. Walk me through it once.*

A tutorial is a lesson, not a manual. It has one path, no branches, and a definite end at which the
reader has something working. Options, alternatives and edge cases all belong somewhere else — a
tutorial that pauses to explain a choice has stopped teaching and started documenting.

**This directory is empty today.** [#145](https://github.com/rickylabs/harness/issues/145) writes the
first one: taking a repository from nothing to a working board, run end to end on a clean clone with
no N5 host and no credentials beyond a GitHub token. Until it lands, the
[Quickstart](../../README.md#quickstart) in the root README is the shortest honest path — install,
build, and four commands that do something real.

## What belongs here

Few pages, each earned. A tutorial is expensive to keep true, because it is the one kind of document
where a single stale command wastes a stranger's afternoon. Two candidates are worth the cost:

- **From an empty repository to a working board.** Install the taxonomy, file something, move it
  through a phase, see it appear in a column.
- **From a board to an agent that moves it.** Point an agent at the generated skill and watch the
  status labels change as it works.

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
