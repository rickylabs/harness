# CLAUDE.md

> **Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before anything else.** It is the locked charter
> of this repository (owner-amended through ADR 0005, 2026-10-03) and it supersedes
> [#30](https://github.com/rickylabs/harness/issues/30). It states what is built, what is
> parked, and the four invariants every run is held to. Amendments require a recorded owner
> decision; an agent may not silently build against another architecture.

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

- Ratified decisions: [`AGENTS.md`](AGENTS.md#ratified-decisions-you-inherit) — owner-amended through
  [ADR 0005](doctrine/decisions/0005-harness-framework-identity.md), superseding the former
  dsh-only premise — this repository is **our framework on Orchid and Herdr**;
  netscript is a service behind an adapter, not a build-time dependency.
- Workspace layout and **the two seams** — native tasks and API/local-model calls: [`AGENTS.md`](AGENTS.md#workspace-layout-and-the-two-seams), with the
  package-by-package table in [`packages/README.md`](packages/README.md).
- Doctrine lives in [`doctrine/`](doctrine/) — portable, plain markdown, zero runtime:
  [`WORKFLOW.md`](doctrine/WORKFLOW.md), [`PRINCIPLES.md`](doctrine/PRINCIPLES.md),
  [`GATES.md`](doctrine/GATES.md), [`TOOLCHAIN.md`](doctrine/TOOLCHAIN.md)
- The board, without asking an agent: `harness-board status`, `harness-board check`.
- The founding [architecture run](.llm/runs/architecture-foundation--seed/) is historical.
  Resume the active brief and its declared context/evidence surface.
- Existing `dsh-*` core CLI names remain compatibility naming until cleanup PR 2;
  the optional dsh composition is not the framework host.
