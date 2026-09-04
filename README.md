# harness

**An agentic harness and toolchain for TypeScript projects, built on [NetScript](https://github.com/rickylabs/netscript).**

> Status: **pre-architecture**. This repository currently contains no product code.
> It contains the harness doctrine and the seed run that is designing the product.

---

## The problem

Coding agents produce output faster than humans can review it. The bottleneck moved.

Today the working loop looks like this: open a mobile agent client, triage which daemons
died, step into the one that matters, steer it, back out, watch the orchestrator, repeat —
and reach for a desktop only to review real work. The agents are capable. What is missing is
**a substrate that makes their work legible, resumable, and reviewable** across projects,
machines, and vendors.

Two references bracket the gap:

- **[t3.codes](https://t3.codes)** is a control panel *over agent sessions* — multi-vendor, mobile,
  remote-capable. It manages conversations. It has no opinion about the work.
- **[Linear](https://linear.app)** is a board growing agent teammates — structure, initiatives,
  roadmap. It manages intent. It does not touch the run.

Neither owns the middle: the **process substrate** — staged runs, cited research, locked
decisions, explicit owner forks, adversarial review, drift registers, and gates that must pass
before anything mutates. That substrate already exists here, proven across three unrelated
codebases. This repository turns it into a product.

## The thesis

The harness has been run in production against three stacks with nothing in common:

| Repo | Stack | Role |
|---|---|---|
| `rickylabs/netscript` | Deno 2.x, JSR, Aspire | Origin. Runtime spine + harness v3 doctrine. |
| `rickylabs/eis-chat` | Deno, oRPC, Turso, Deno KV | Runtime harness at depth: services, workers, sagas, streams, MSI. |
| `autocorner/website` | Next.js 16, React 19, Sanity, bun | Doctrine port across a total stack swap. |

The port to a non-Deno, non-NetScript codebase transferred **cleanly for mechanics and not at
all for domain knowledge**. That asymmetry is not a defect — it is the product seam:

> **Mechanics are portable. Knowledge is specific. Ship the mechanics; scaffold the knowledge.**

## What this becomes

Three layers, deliberately separable:

**1. Doctrine** — portable, plain markdown, zero runtime.
Run lifecycle, artifact templates, profiles, principles, gates. Works in any repository in any
language today, with no daemon installed. This is what already ported at 7/10.

**2. Runtime** — NetScript as foundation.
Tasks, jobs, workers, sagas, triggers, streams; KV-backed with optimistic concurrency;
multi-runtime execution (`deno | python | shell | powershell | dotnet | executable`) with
explicit permission sets; OS-service deployment (systemd, Windows Service) so a supervised
daemon never needs an agent to rescue it.

**3. Control plane** — the missing piece.
A mobile-first dashboard bound to one or more local agents (in the OTLP sense — a supervised
process on your machine, not an LLM). Projects, runs, and the full agent tree from orchestrator
down to leaf. Steer from a phone; review on a desktop.

## Design commitments

- **Artifacts over chat.** If it is not in a run artifact, it did not happen.
- **Citations or it is not a claim.** Every load-bearing statement carries a repo path, a document page, or a URL.
- **Owner forks are raised, never resolved silently.** Ambiguity is escalated with a recommendation and a cost-if-wrong.
- **Nothing mutates before a gate passes.** Plans are locked and evaluated before the board, the code, or the world is touched.
- **Deterministic work belongs in the daemon.** Anything an agent is asked to do repeatedly and identically is a bug in the harness.
- **Local first, vendor neutral.** Claude Code, Codex, opencode, Copilot — the harness outlives whichever one you opened this morning.

The [E1 roadmap](https://github.com/rickylabs/harness/issues/31) makes each commitment
executable in a named epic:

| Commitment | Executable in |
|---|---|
| Artifacts over chat | [E9 — telemetry sink](https://github.com/rickylabs/harness/issues/39) |
| Citations or it is not a claim | [E6 — workflow step contract](https://github.com/rickylabs/harness/issues/36) |
| Owner forks are raised, never resolved silently | [E6 — coordinator](https://github.com/rickylabs/harness/issues/36) → [E7 — issue bridge](https://github.com/rickylabs/harness/issues/37) |
| Nothing mutates before a gate passes | [E5 — admission control and sandbox boundary](https://github.com/rickylabs/harness/issues/35) |
| Deterministic work belongs in the daemon | [E6 — coordinator](https://github.com/rickylabs/harness/issues/36) |
| Local first, vendor neutral | [E3 — two-seam provider split](https://github.com/rickylabs/harness/issues/33) |

## Current run

`.llm/runs/architecture-foundation--seed/` — the founding architecture run.
It designs this product using this product's own method. See
[`doctrine/WORKFLOW.md`](doctrine/WORKFLOW.md) for how to pick it up from any CLI.

## Repository map

```
doctrine/           doctrine — how to work here (stable, portable)
.llm/runs/          run artifacts — durable, reviewed via PR
.agents/skills/     behavioural skills — how to decide (project-specific)
AGENTS.md           entry point, agent mode
CLAUDE.md           entry point, standard mode
```

## Licence

Not yet chosen. Tracked as an open owner fork in the seed run.
