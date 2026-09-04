# CLAUDE.md

See [`AGENTS.md`](AGENTS.md). The protocol is identical in standard mode; the only difference
is that you are expected to ask before mutating anything outside the active run directory.

Quick orientation:

- Ratified decisions: [`AGENTS.md`](AGENTS.md#ratified-decisions-you-inherit) — the four taken in
  [#30](https://github.com/rickylabs/harness/issues/30). This repository is the `dsh` layer only;
  netscript is a service behind an adapter, not a build-time dependency.
- Doctrine: [`doctrine/WORKFLOW.md`](doctrine/WORKFLOW.md), [`doctrine/PRINCIPLES.md`](doctrine/PRINCIPLES.md)
- Active run: [`.llm/runs/architecture-foundation--seed/`](.llm/runs/architecture-foundation--seed/)
- Start with that run's `context-pack.md` — it is written to be the single file that resumes the work.
