# What this is

Harness is **our portable agent framework on Orchid and Herdr**, including the deterministic
coordination layer for an agent fleet. It turns
human intent into governed work: what may run next, which route may perform it,
who may evaluate it, and what evidence makes the result trustworthy. The owner
can observe progress and intervene without interrupting an agent to ask for status.

The product combines a work graph, configurable routing, resource admission,
durable execution records, independent evaluation and telemetry. This page
explains those responsibilities. The board (GitHub issues, read with `harness-board status`) and
[package guides](../../packages/README.md) track their implementation.

## Coordinate the agents

Agents perform research, planning, implementation and review. Harness coordinates
those activities through explicit lanes, gates and evidence. A plan or artifact
cannot certify itself, and a missing independent evaluator does not relax the rule.

Claude Code, Codex, OpenCode and other agent clients perform autonomous work
through the subagent seam. API and local-model calls use a separate seam, with
different resource accounting. [Two seams](02-the-two-seams.md) explains why these
remain distinct. Routing configuration supplies default model, effort and provider choices. A verified owner-native
override supplies its own exact route and authority; resource observations and physical checks
still inform admission before work starts.

Decisions are reproducible from their recorded inputs. The coordinator can replay
a journal and report nondeterminism when the same inputs produce different decisions.
The model's work is stochastic; coordination rules and their evidence are explicit.

## Keep each kind of truth in its proper place

GitHub holds the work graph: issues, milestones, dependencies, labels and pull
requests. [The board](03-the-board.md) projects that graph into useful views.
It does not create a competing authoritative task database.

Harness defines operational state boundaries for durable effect intents, receipts and telemetry.
The coordinator supplies storage ports and reference drivers; deployed adapters and checkpoint
recovery need their own proof. These records answer different questions from the GitHub board:
what was attempted, what was observed, and what remains uncertain after an interruption.
An admitted task is not proof of running execution, and an uncertain effect stays
unknown until supported reconciliation evidence exists.

Observation time, execution, certification and synchronization remain separate.
A connected client may be showing incomplete observations; a completed run may still
await evaluation. The product exposes those distinctions so a presentation layer
does not invent certainty from missing evidence.

## Reach the owner through the product backend

`rickylabs/atelier-cockpit` is the engineering cockpit and full application backend;
`rickylabs/atelier-mobile` is the native companion. The
[decision-4 amendment](https://github.com/rickylabs/harness/issues/30#issuecomment-5561573579)
records their repository relationship. The
[three-layer architecture](06-the-three-layers.md) owns the division of responsibilities.

Harness publishes [`@rickylabs/harness-contracts`](../../packages/contracts) as the
mechanism boundary. The backend consumes that package and explicitly pinned source readers, owns persistence, enrollment,
authorization, commands and application projections, and captures its OpenAPI artifact
and generated client. The native client consumes that generated product boundary for
observation, decisions and steering. No consumer uses cross-repository workspace imports.

## Framework

[Orchid](https://github.com/rickylabs/orchid) owns dispatch and physical launch admission;
[Herdr](https://github.com/herdrdev/herdr) owns terminal control. Harness owns the portable mechanisms
and method around them. [ADR 0005](../decisions/0005-harness-framework-identity.md)
supersedes the former dsh-only premise while retaining the earlier decisions as historical evidence.

The [package guide](../../packages/README.md) maps implemented, partial and stub boundaries.
[`forge`](../../packages/forge) installs the board process into another repository.

## Carry the method between projects

The method lives in [`DOCTRINE.md`](../DOCTRINE.md): one markdown page describing
how work is staged, reviewed and gated. The packages encode the parts a machine
can enforce. Domain knowledge belongs to each project.

> **Mechanics are portable. Knowledge is specific. Ship the mechanics; scaffold the knowledge.**

That distinction came from porting the method across unrelated stacks. The product
makes the coordination method reusable while leaving each project's knowledge,
routing configuration and priorities under its own control.
