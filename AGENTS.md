# AGENTS.md

Entry point for agent mode in `rickylabs/harness`.

## Invocation

```
use harness
```

Optionally scoped:

```
use harness, profile: architecture: design the run-state ownership model
```

This binds you to the doctrine in [`doctrine/`](doctrine/). Read
[`WORKFLOW.md`](doctrine/WORKFLOW.md) and [`PRINCIPLES.md`](doctrine/PRINCIPLES.md)
before your first mutation. They are short by design.

## What this repository is

A product being designed by its own method. There is **no product code yet**. The current
work is the founding architecture run at
[`.llm/runs/architecture-foundation--seed/`](.llm/runs/architecture-foundation--seed/).

Treat that run directory as the working surface. Treat everything else as either doctrine
(stable, change deliberately) or entry points (rarely change).

## Standing constraints

Every brief in this repository inherits these two. They are not restated per task.

**1. Citation bar.** Every load-bearing claim carries one of: a repository path with line
reference, a document page, or a URL retrieved during this run. A claim you believe but
cannot cite is a *finding for a spike*, not an input to a plan. Vendor marketing pages are
citable for intent and not for behaviour.

**2. No silent owner decisions.** When the answer depends on what the owner wants rather
than on what is true, you stop and file a numbered fork in `plan.md` with: the question, the
options, your recommendation, and the cost if the recommendation is wrong. You do not pick
and move on, and you do not bury it in prose.

## Prior art you are expected to read

This product generalises a pattern already proven in three repositories. Do not redesign
from first principles what has already been demonstrated.

| Source | Read it for |
|---|---|
| `rickylabs/netscript` — `.llm/harness/` | Harness v3 doctrine, archetypes, fitness gates |
| `rickylabs/netscript` — `packages/plugin-workers-core`, `plugin-sagas-core`, `plugin-triggers-core` | The runtime primitives this product will build on |
| `rickylabs/eis-chat` — `netscript.config.ts`, `workers/`, `streams/`, `aspire/` | Runtime harness at depth; how a daemon ships |
| `autocorner/website` — `.llm/harness/` | The doctrine port that proved portability |
| `autocorner/website` PR #14 | The most complete run artifact set produced to date |

These are **doctrine sources, read-only**. This run does not modify sibling repositories.

## Mode of work

- Artifacts over chat. Conclusions land in files under the run directory, not in replies.
- Summary first, then detail. Assume the reader is on a phone.
- Research before design; design before decisions; decisions before mutation.
- If the plan changes shape mid-run, record it in `drift.md` rather than rewriting history.
