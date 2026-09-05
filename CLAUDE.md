# CLAUDE.md

See [`AGENTS.md`](AGENTS.md). The protocol is identical in standard mode; the only difference
is that you are expected to ask before mutating anything outside the active run directory.

## Before you touch the board

**This repository is the Orchid dispatch inbox.** divybot polls it every 30 seconds, and
applying the **`harness`** label to an issue starts a real agent on a real host against that
issue's body — no draft state, no confirmation. Label deliberately: tidying up the board is
enough to spend a run. A dispatched issue body must contain **no fenced code blocks**, because a
parser that stops at a fence runs the truncated brief without reporting that it did.

The generated rulebook is [`.claude/skills/board-process/SKILL.md`](.claude/skills/board-process/SKILL.md);
the hazard is stated in full in [`AGENTS.md`](AGENTS.md#operational-hazard-this-repository-is-a-live-inbox).

Quick orientation:

- Ratified decisions: [`AGENTS.md`](AGENTS.md#ratified-decisions-you-inherit) — the four taken in
  [#30](https://github.com/rickylabs/harness/issues/30). This repository is the `dsh` layer only;
  netscript is a service behind an adapter, not a build-time dependency.
- Workspace layout and **the two seams** — `ctx.subagents` for vendor CLIs, `ctx.llm` for API and
  local models: [`AGENTS.md`](AGENTS.md#workspace-layout-and-the-two-seams), with the
  package-by-package table in [`packages/README.md`](packages/README.md).
- Doctrine lives in [`doctrine/`](doctrine/) — portable, plain markdown, zero runtime:
  [`WORKFLOW.md`](doctrine/WORKFLOW.md), [`PRINCIPLES.md`](doctrine/PRINCIPLES.md)
- The board, without asking an agent: `dsh-board status`, `dsh-board check`.
- Active run: [`.llm/runs/architecture-foundation--seed/`](.llm/runs/architecture-foundation--seed/)
- Start with that run's `context-pack.md` — it is written to be the single file that resumes the work.
