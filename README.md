# harness

**The deterministic coordinator layer for an agent fleet: a monorepo of
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugins, and the
portable doctrine those plugins encode.**

> Status lives on the board, not in this file — see the
> [E0 roadmap](https://github.com/rickylabs/harness/issues/30) for what is built and what is not.
> This repository is scoped to the harness doctrine, the run artifacts, and the `dsh` plugin
> layer — nothing else: the cockpits that consume it live in `rickylabs/netscript`
> (decision 4 below).

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

## Ratified decisions

Four decisions are **ratified** in the *Decisions taken* table of the
[E0 roadmap](https://github.com/rickylabs/harness/issues/30). They are restated here because
root documents are what an agent reads first, and a root document that contradicts a ratified
decision propagates the contradiction silently. They are not re-opened in a run, a PR, or a
prompt; reversing one is a change to #30 first.

1. **Plugin-only, no core fork.** Depend on published
   [`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness). We ship our Cordis
   plugin packages and one profile. Only
   [`runzhliu/deepseek-harness-docker`](https://github.com/runzhliu/deepseek-harness-docker)
   is forked, upstream remote kept for updates.
2. **Node + pnpm.** netscript stays a service behind an adapter, not a build-time dependency.
3. **GitHub is the source of truth for the board**; dsh projects the live view.
4. **This repo is the dsh layer only.** The Expo cockpit and the web cockpit both live in
   netscript. Consequence: `contracts` must be a *published* package, not a workspace import.

Two further decisions — the MIT licence, and the divybot/herdr strangler-fig — are recorded in
#30 as **taken, reversible**. They are not restated as settled here; read them on the board.

## What this becomes

Three layers, deliberately separable — and only the first two are built here:

**1. Doctrine** — portable, plain markdown, zero runtime.
Run lifecycle, artifact templates, profiles, principles, gates. Works in any repository in any
language today, with no daemon installed. This is what already ported at 7/10.

**2. Coordinator** — dsh plugins on Node and pnpm. *This repository.*
Everything-is-a-plugin over Cordis: a `Context` is a service repository, a plugin claims
`ctx.<key>`, and composition is declarative. What ships here is plugin packages and one
profile — no fork of dsh itself (decision 1); see [`packages/`](packages/) for the layout.
NetScript is **not** a build-time dependency of this layer (decision 2). Its runtime
primitives — tasks, jobs, workers, sagas, triggers, streams; KV-backed with optimistic
concurrency; multi-runtime execution
(`deno | python | shell | powershell | dotnet | executable`) with explicit permission sets;
OS-service deployment (systemd, Windows Service) so a supervised daemon never needs an agent to
rescue it — are reached **as a service, behind an adapter**, so nothing here has to build
NetScript to use them.

**3. Control plane** — the missing piece, and *not a layer of this repository.*
A mobile-first dashboard bound to one or more local agents (in the OTLP sense — a supervised
process on your machine, not an LLM). Projects, runs, and the full agent tree from orchestrator
down to leaf. Steer from a phone; review on a desktop. Both cockpits — the Expo app and the web
app — live in `rickylabs/netscript`, not here (decision 4). What this repository owes them is
`contracts`: a **published** package of route and type definitions, consumed over npm and never
as a workspace import. The board they render is projected, not owned — GitHub holds board truth
and dsh projects the live view (decision 3).

## Design commitments

- **Artifacts over chat.** If it is not in a run artifact, it did not happen.
- **Citations or it is not a claim.** Every load-bearing statement carries a repo path, a document page, or a URL.
- **Owner forks are raised, never resolved silently.** Ambiguity is escalated with a recommendation and a cost-if-wrong.
- **Nothing mutates before a gate passes.** Plans are locked and evaluated before the board, the code, or the world is touched.
- **Deterministic work belongs in the daemon.** Anything an agent is asked to do repeatedly and identically is a bug in the harness.
- **Local first, vendor neutral.** Claude Code, Codex, opencode, Copilot — the harness outlives whichever one you opened this morning.

The [E0 roadmap](https://github.com/rickylabs/harness/issues/30) makes each commitment
executable in a named epic:

| Commitment | Executable in |
|---|---|
| Artifacts over chat | [E9 — Telemetry: the "status ?" killer](https://github.com/rickylabs/harness/issues/39) — *partial* |
| Citations or it is not a claim | [E6 — Coordinator: workflows, task DAG, board projection](https://github.com/rickylabs/harness/issues/36) — *partial* |
| Owner forks are raised, never resolved silently | [E6 — Coordinator](https://github.com/rickylabs/harness/issues/36) → [E7 — Forge: GitHub bridge, Orchid absorption](https://github.com/rickylabs/harness/issues/37) |
| Nothing mutates before a gate passes | [E5 — Governance: tri-regime admission control](https://github.com/rickylabs/harness/issues/35) |
| Deterministic work belongs in the daemon | [E6 — Coordinator](https://github.com/rickylabs/harness/issues/36) |
| Local first, vendor neutral | [E3 — Subagent providers over structured protocols](https://github.com/rickylabs/harness/issues/33) |

Two mappings are marked *partial* because no epic owns them outright: E9 makes artifacts
durable but does not decide what has to become one, and E6 carries evidence between steps
but sets no citation bar. Both need an owner before the commitment is real. A tidy table
that hid this would be worth less than the gap it papered over.

## Current run

`.llm/runs/architecture-foundation--seed/` — the founding architecture run.
It designs this product using this product's own method. See
[`doctrine/WORKFLOW.md`](doctrine/WORKFLOW.md) for how to pick it up from any CLI.

## Repository map

```
doctrine/           doctrine — how to work here (stable, portable)
packages/           the dsh plugin layer — one package per subsystem
.llm/runs/          run artifacts — durable, reviewed via PR
AGENTS.md           entry point, agent mode
CLAUDE.md           entry point, standard mode
```

## Licence

**MIT**, matching dsh, so the plugin packages can carry the `dsh-plugin` topic. Taken in
[#30](https://github.com/rickylabs/harness/issues/30) as reversible; the `LICENSE` file lands
with the first package that publishes.
