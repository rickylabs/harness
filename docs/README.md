# Documentation

Four kinds of page, because four different questions bring a reader here. A page that mixes two of
them serves neither: someone following steps gets interrupted by options, and someone looking up a
flag has to read a story.

| Directory | The question it answers | Written by |
| --- | --- | --- |
| [`tutorials/`](tutorials/) | *I have never done this. Walk me through it once.* | a person |
| [`how-to/`](how-to/) | *I know what I want. What are the steps?* | a person |
| [`reference/`](reference/) | *What exactly does this flag do? What does exit 3 mean?* | **a generator** |
| [`concepts/`](concepts/) | *Why is it built this way?* | a person |

[`glossary.md`](glossary.md) defines the words the rest of the repository uses without stopping to
explain them.

## Start here

- New to the project → the [root README](../README.md), then [concepts](concepts/).
- Want to run something → [Quickstart](../README.md#quickstart).
- Want a flag, a subcommand or an exit code → [CLI reference](reference/cli/README.md).
- Want to understand a design decision → [`concepts/`](concepts/) for the model,
  [`doctrine/`](../doctrine/) for the method, and the
  [E0 roadmap](https://github.com/rickylabs/harness/issues/30) for what is ratified.
- Want the details of one subsystem → its package README under [`packages/`](../packages/). Those
  are the deepest documents in the repository and they are where design rationale lives.

## The rule these docs are held to

> **Every document either states facts it owns, or is generated from the code that owns them.**

Reference pages are generated from the CLIs themselves, so a flag that changes changes here too.
Concept pages state the reasoning, which no generator can produce. Neither restates the other, and
neither restates a package README — they link.

A document that repeats a fact owned elsewhere is a fact that will eventually disagree with itself,
and the failure is silent: nothing goes red, the page just becomes a lie that the next agent reads
first. In a repository whose product is a coordinator for agents, that is a correctness bug.

## Concepts

| Page | What it settles |
| --- | --- |
| [01 — What this is](concepts/01-what-this-is.md) | The coordinator layer, and the two things it is not |
| [02 — Two seams, not one](concepts/02-the-two-seams.md) | `ctx.subagents` vs `ctx.llm`, and everything that follows |
| [03 — The board](concepts/03-the-board.md) | Why GitHub holds board truth and `dsh` only projects it |
| [04 — What "run" means](concepts/04-the-run.md) | The word means two different things here. Both are correct. |
| [05 — Determinism](concepts/05-determinism.md) | Generated files, golden snapshots, and why drift is a bug |
