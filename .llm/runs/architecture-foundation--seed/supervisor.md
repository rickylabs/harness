# Supervisor — architecture-foundation--seed

**Stage A.** Identity, baseline, and declared mutation surface for the founding architecture run.

---

## Run identity

| Field | Value |
|---|---|
| Run slug | `architecture-foundation--seed` |
| Repository | `rickylabs/harness` |
| Baseline | initial commit (repository created 2026-08-14) |
| Branch | `main` for the seed commit; subsequent stages on `harness/architecture-foundation--seed` |
| Opened | 2026-08-14 |
| Supervisor | GitHub Copilot CLI (Claude Opus 5), Windows host, chat session `f97fdd1c` |
| Stage reached | **A complete, B partial** |

The supervising session is expected to change. This run is explicitly designed to be picked up
by Claude Code, Codex, opencode or Copilot interchangeably — that requirement is a product
requirement being dogfooded, not a convenience. `context-pack.md` is the handoff surface.

---

## Objective

Produce the **architectural foundation document** for a standalone agentic harness and
toolchain product, built on NetScript, that allows any TypeScript project to adopt the harness
mechanism proven across three unrelated codebases.

Explicitly **not** a mirror of the existing implementations. The existing implementations are
evidence that the pattern is portable; the product is a rethink.

## Non-objective

- No product code in this run.
- No modification of `rickylabs/netscript`, `rickylabs/eis-chat`, or `autocorner/website`.
- No decision on licence, pricing, or open-source posture beyond raising them as owner forks.

---

## Declared mutation surface

This run may write to:

```
.llm/runs/architecture-foundation--seed/**
.llm/harness/**          (doctrine, on the first seed commit only)
README.md  AGENTS.md  CLAUDE.md   (entry points, on the first seed commit only)
```

This run must **not** write to:

```
any path in rickylabs/netscript
any path in rickylabs/eis-chat
any path in autocorner/website
.github/**               (no CI, no workflows, until Stage H)
any product source tree  (none exists; creating one is out of scope)
```

Anything found outside the declared surface is recorded in `drift.md` and dispositioned. It is
not silently absorbed into scope.

---

## Doctrine sources (read-only)

Pinned so that later stages can detect drift in the evidence base itself.

| Repository | Branch | Baseline | Read for |
|---|---|---|---|
| `rickylabs/netscript` | `main` | `f7898dba` | Harness v3 doctrine; runtime primitives; CLI shape; deploy targets |
| `rickylabs/eis-chat` | `master` | `a9b31d4` | Runtime harness at depth; daemon packaging; MSI/desktop shipping |
| `autocorner/website` | `main` | `d77bcaf` | Doctrine port across a total stack swap |
| `autocorner/website` PR #14 | `claude/autocorner-plan-repo-architecture-xeiboa` | — | Most complete run artifact set produced to date |

If any of these advances during the run, the divergence is a `drift.md` entry, because
conclusions in `research.md` are cited against these SHAs.

---

## Stage ledger

| Stage | State | Artifact |
|---|---|---|
| A — Supervisor | **complete** | `supervisor.md` |
| B — Discovery | **partial** — repo leg drafted, external leg started, document leg not begun | `research.md` |
| C — Synthesis | not started | — |
| D — Design packs | not started | `architecture/`, `orchestration/` |
| E — Plan lock | not started | `plan.md` |
| F — Adversarial review | not started | `adversarial-review.md` |
| G — Plan evaluation | not started | `plan-eval.md` |
| H — Ratification | blocked on G | — |

**Gate status: mutation of the world is BLOCKED.** Stage G has not run.
