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

The **`dsh` layer** of a deterministic coordinator for an agent fleet: Cordis plugin packages
and one profile over published
[`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness), plus the portable
harness doctrine they encode. It is a product being designed by its own method — the founding
architecture run at
[`.llm/runs/architecture-foundation--seed/`](.llm/runs/architecture-foundation--seed/)
records that design; the board says what is built.

Treat that run directory as the working surface. Treat everything else as either doctrine
(stable, change deliberately), the plugin layer in [`packages/`](packages/), or entry points
(rarely change).

## Operational hazard: this repository is a live inbox

**`rickylabs/harness` is the Orchid dispatch inbox, not a quiet workspace.** divybot polls it
on a 30-second cycle, and applying the **`harness`** label to an issue starts a real agent on a
real host against that issue's body. There is no draft state and no confirmation step. Tidying
up the board is enough to spend a run.

What follows from that, every time you touch an issue here:

- **Label deliberately.** `harness` is a trigger, not a tag. Everything else in the taxonomy is
  inert; this one is not.
- **The body of a dispatched issue is a prompt, and a dispatcher reads it to find one.** Write
  no fenced code blocks in it — use four-space indented blocks and single-backtick inline code.
  A parser that stops at a fence takes everything above it and runs, so the failure mode is a
  brief silently half as long as the one you wrote, with no error and nothing on the issue to
  say the agent read less than what is there. Keep `#` out of any `key: value` line as well.
- **Read the brief back with `gh issue view` before you apply the label.** What that prints is
  the whole prompt only if it is the whole of what you wrote.

The full rules, generated from the taxonomy actually installed here, are in
[`.claude/skills/board-process/SKILL.md`](.claude/skills/board-process/SKILL.md). Read it before
your first board mutation, not after.

## Workspace layout, and the two seams

A pnpm workspace: one package per Cordis plugin under [`packages/`](packages/), each owned by a
numbered epic, plus `dsh-app` which composes them. [`packages/README.md`](packages/README.md)
holds the authoritative table of package → owning epic → what it attaches to, and the
conventions every package inherits. Most directories are still **empty, buildable stubs**; do
not add behaviour to one before the epic that owns it has defined its contract.

```
doctrine/                    portable doctrine — how to work here (stable)
packages/                    the dsh plugin layer — one package per subsystem
.llm/runs/                   run artifacts — durable, reviewed via PR
.claude/skills/              generated skills; board-process is the board's rulebook
AGENTS.md / CLAUDE.md        entry points
```

**Doctrine lives in [`doctrine/`](doctrine/)** — plain markdown, zero runtime, portable to any
repository in any language. It is the layer that already ported; treat it as stable and change
it deliberately. Run artifacts under `.llm/runs/` are durable evidence, not scratch space.

The plugin split is not arbitrary. Two subsystems that both look like "call a model" attach to
two *different* dsh seams — `ctx.subagents` for autonomous vendor CLIs, `ctx.llm` for API-key and
local models — and the packages are separated to match (#30, "two seams, not one"). Collapsing
them into one abstraction is the design error the split exists to prevent.

**Read [`docs/concepts/02-the-two-seams.md`](docs/concepts/02-the-two-seams.md) before touching
either side.** It owns that distinction — what each seam is metered by, what running out of one
means, and the three places the coordinator reads it — so this file does not restate it.

## Ratified decisions you inherit

These four are ratified in the *Decisions taken* table of
[#30](https://github.com/rickylabs/harness/issues/30). They are **not** owner forks and not
open questions: do not re-derive them, do not design against them, and if evidence contradicts
one, raise it as a change to #30 rather than resolving it inside a run.

1. **Plugin-only, no core fork.** Depend on published `@deepseek-ai/dsh`. We ship our Cordis
   plugin packages and one profile. Only `runzhliu/deepseek-harness-docker` is forked,
   upstream remote kept for updates.
2. **Node + pnpm.** netscript stays a service behind an adapter, not a build-time dependency.
3. **GitHub is the source of truth for the board**; dsh projects the live view.
4. **This repo is the dsh layer only.** The Expo cockpit and the web cockpit both live in
   netscript. Consequence: `contracts` must be a *published* package, not a workspace import.

Decisions 2 and 4 are load-bearing for [E2](https://github.com/rickylabs/harness/issues/32) and
[E8](https://github.com/rickylabs/harness/issues/38). A design that adds NetScript as a
build-time dependency of this repository, or that puts a cockpit in it, is wrong before it is
reviewed.

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
| `rickylabs/netscript` — `packages/plugin-workers-core`, `plugin-sagas-core`, `plugin-triggers-core` | The runtime primitives this product calls through an adapter (decision 2) — read them, do not depend on them at build time |
| `rickylabs/eis-chat` — `netscript.config.ts`, `workers/`, `streams/`, `aspire/` | Runtime harness at depth; how a daemon ships |
| `autocorner/website` — `.llm/harness/` | The doctrine port that proved portability |
| `autocorner/website` PR #14 | The most complete run artifact set produced to date |

These are **doctrine sources, read-only**. This run does not modify sibling repositories.

## Mode of work

- Artifacts over chat. Conclusions land in files under the run directory, not in replies.
- Summary first, then detail. Assume the reader is on a phone.
- Research before design; design before decisions; decisions before mutation.
- If the plan changes shape mid-run, record it in `drift.md` rather than rewriting history.
