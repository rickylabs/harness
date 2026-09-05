# What this is

A **coordinator layer**. It decides what may run next, records what ran, and projects both onto a
board a human can read. It does not write code, and it does not hold state of its own.

That is a narrow job, and the narrowness is the design. Everything below is what it deliberately is
*not*, because each of those is a thing people reasonably expect a project with this name to be.

## It is not an agent

Nothing here calls a model to solve your problem. `dsh-coordinator` decides *who may* review a
piece of work; it never reviews it. `dsh-board` renders what the board says; it never files an
issue. The agents are Claude Code, Codex, opencode and agy — they already exist, they are already
capable, and this layer's entire value is that it outlives whichever one you opened this morning.

The consequence to notice: every binary in this repository is deterministic. Given the same inputs
they produce the same output, which is why `dsh-coordinator replay` can re-run a journal's
decisions and compare. A decision that comes back different from identical inputs is reported as
nondeterminism, not as a change of plan.

## It is not a task database

GitHub is the board ([03 — The board](03-the-board.md)). There is no second store of task state to
reconcile, no sync job, and no window in which the two disagree. `dsh-board` reads issues, labels,
milestones and pull requests, and renders a view.

## It is not a UI

The cockpits — an Expo app and a web app — live in `rickylabs/netscript`. This repository owes them
exactly one thing: [`@rickylabs/harness-contracts`](../../packages/contracts), a published package
of route and type definitions, consumed over npm and never as a workspace import. That is ratified
decision 4 on the [roadmap](https://github.com/rickylabs/harness/issues/30), and it is the reason
`contracts` is the only package here that is not `private: true`.

## What it actually is, then

Five binaries and the plugin packages behind them, composed into one `dsh` profile:

| | |
| --- | --- |
| **decide** | [`coordinator`](../../packages/coordinator) — who may review, what may run, and the gate that refuses |
| **project** | [`board`](../../packages/board) — GitHub → columns, and the anomalies that mean the board contradicts itself |
| **record** | [`telemetry`](../../packages/telemetry) — a bounded log of what ran, readable with nothing awake |
| **install** | [`forge`](../../packages/forge) — put this whole process into another repository |
| **compose** | [`dsh-app`](../../packages/dsh-app) — the profile and bundle patch that make the four into one `dsh` |

## Why `dsh`

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is everything-is-a-plugin over
Cordis: a `Context` is a service repository, a plugin claims `ctx.<key>`, and composition is
declarative — profiles list bundles, and patches layer bundle → profile → home → `--patch`. That
lets this project attach at almost any layer without forking anything, which is ratified decision 1:
**plugin-only, no core fork.**

The declarative composition is not incidental. A coordinator whose own wiring required imperative
setup code would be asking to be trusted on exactly the axis it exists to remove.

## Where the reasoning lives

- The method — how a piece of work is staged, reviewed and gated — is
  [`doctrine/`](../../doctrine/). It is portable markdown with no runtime and it works in any
  repository in any language.
- The mechanics — the parts of that method a machine can enforce — are the packages here.

> **Mechanics are portable. Knowledge is specific. Ship the mechanics; scaffold the knowledge.**

That sentence came out of porting this harness to three unrelated stacks. The port transferred
cleanly for mechanics and not at all for domain knowledge, and rather than treat the asymmetry as a
defect, this project treats it as the seam the product is cut along.
