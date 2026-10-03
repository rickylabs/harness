# AGENTS.md

Entry point for agent mode in `rickylabs/harness`.

> **Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before anything else.** It is the locked charter
> of this repository (owner-amended through ADR 0005, 2026-10-03) and it supersedes
> [#30](https://github.com/rickylabs/harness/issues/30). It states what is built, what is
> parked, and the four invariants every run is held to. Amendments require a recorded owner
> decision; an agent may not silently build against another architecture.

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

**Our portable agent framework on Orchid and Herdr.** The core packages own routing,
native observations, provider boundaries, board/coordination mechanics and published contracts.
The method and run record make the work resumable and reviewable. [ADR 0005](doctrine/decisions/0005-harness-framework-identity.md)
records Eric's Decision Q; [ARCHITECTURE.md](ARCHITECTURE.md) owns the charter.

`packages/dsh-app` is the retained optional dsh-router experiment. It currently remains in the
workspace; its approved relocation to `experiments/routers/dsh` and default-check exclusion are
pending. It is not the framework host or the native launch path. Live testing waits until after
the next APK and separate authorization.

[BOARD.md](BOARD.md) is a generated projection. Where it and an issue disagree, the issue wins.
The founding [architecture run](.llm/runs/architecture-foundation--seed/) is historical evidence,
not the active run for every new task. Work on the authorized brief and mutation surface;
retain run evidence in its declared location, and never publish private operational material.

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

## Runtime

Node 24 is the supported floor and Node 26 is the development target. CI currently
runs Ubuntu with Node 24; local release checks also passed on Linux with Node 26.8.1.
Issue [#244](https://github.com/rickylabs/harness/issues/244) owns engine enforcement,
the development pin and dual-version CI. Use pnpm as declared in package.json.

## Workspace layout, and the two seams

A pnpm workspace with fourteen core packages and one retained dsh composition experiment.
[packages/README.md](packages/README.md) owns the responsibility and implementation table.
Stubs reserve a boundary; their existence does not prove implemented or deployed behavior.

```text
packages/                    flat core packages, plus dsh-app until its approved move
profiles/                    stable root process/routing entrypoints
doctrine/                    portable method; canonical home migration is pending
.llm/runs/                   retained committed historical run evidence
.llm/harness/                existing templates; compatibility preserved during migration
.llm/tools/                  existing gates and method tools
.claude/skills/              generated board-process rulebook
```

Native task and API/local-model boundaries remain separate. Native CLIs own their loops;
call adapters own only the semantics they implement. `ctx.subagents` and `ctx.llm` are the
optional dsh composition's service-key vocabulary, not a required host for the core.
Read [Two seams](docs/concepts/02-the-two-seams.md) before changing either boundary.

Keep exposed core paths, root profiles and `@rickylabs/harness-contracts` stable. Later operator
or wire naming migrations require exact paired consumer pins and rollout evidence.

## Ratified decisions you inherit

[ADR 0005](doctrine/decisions/0005-harness-framework-identity.md) supersedes the former dsh-only
premise while retaining historical decisions. Do not reinterpret an old roadmap as the current charter.

1. Harness is our framework on Orchid and Herdr; dsh is an optional additional-router experiment.
2. Node and pnpm remain the package runtime/toolchain. NetScript is an external service boundary,
   never a cross-repository build-time workspace dependency.
3. GitHub owns the board. Harness projects it; native stores and launch receipts establish execution.
4. Cockpit and mobile are separate products. The public npm name and exports stay stable, and the
   native product runtime uses cockpit's captured/generated API rather than private backend code.
5. The matrix is the default routing authority. A verified Eric-authorized native override records
   its own provenance and retains physical checks/accounting. Different vendor families and
   separate evaluator sessions are still mandatory.

The coordinator-approved cleanup uses one PR at a time. PRs 1–4 establish documentation, core CLI
compatibility, experiment isolation and method/run-record homes; their merge unblocks the vault
refresh. Naming migrations 5–7 remain pending until paired consumers/operators are ready. No live
settings, host operations or deployments follow from a source merge without explicit GO.

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
