# Two seams, not one

Two things in this system both look like "call a model". They are not the same thing, they are not
metered the same way, and running out of one does not resemble running out of the other. dsh gives
them two separate attachment points, and this project keeps them apart on purpose.

| | `ctx.subagents` | `ctx.llm` |
| --- | --- | --- |
| What attaches | autonomous vendor CLIs — Claude Code, Codex, opencode, ACP | API-key and local models — LM Studio, llama-rocm, OpenRouter |
| What you are buying | a **seat**: the right to run an agent for a while | **tokens**: units of text, priced per unit |
| Metered by | a **quota window** that refills on a clock | **per token**, until the balance is gone |
| Running out means | *wait* — the window reopens on its own | *pay* — nothing reopens without a top-up |
| What it does | reads the repository, edits files, opens pull requests | answers a prompt |
| Whose loop runs | **theirs** — their own loop, tools and context | **`dsh`'s** — so gates, sandbox and approval policy apply |
| Packages | `provider-claude`, `provider-codex`, `provider-acp`, `provider-opencode` (E3 · [#33](https://github.com/rickylabs/harness/issues/33)) | `llm-local` (E4 · [#34](https://github.com/rickylabs/harness/issues/34)) |

**This page owns that split.** Where the rest of the repository needs it —
[`AGENTS.md`](../../AGENTS.md), [`packages/dsh-app/README.md`](../../packages/dsh-app/README.md) —
it links here rather than restating it.

## One split, two vocabularies

The same distinction has two names, because two layers name it for two reasons, and a reader who
meets them separately will reasonably assume they are separate concepts. They are not.

| Layer | Names it | Named for |
| --- | --- | --- |
| dsh composition | `ctx.subagents` / `ctx.llm` | the service key a plugin attaches to |
| coordinator | `subscription` / `relay` | the metering regime a run is paid out of |

`Seam` in [`packages/coordinator/src/independence.ts`](../../packages/coordinator/src/independence.ts)
is a closed two-member union for this reason, and its comment says so outright: *the two seams are
the architecture, not vendor trivia.* Adding a third member there is an architectural change, not a
config change — which is the property the closed type exists to enforce.

## Why collapsing them is the design error

The tempting abstraction is `callModel(prompt) → text`. Both sides satisfy it. Write it, and four
things break at once — and each one breaks quietly, which is worse than breaking loudly.

**Exhaustion stops meaning one thing.** A subscription agent that has hit its window is *temporarily*
unavailable; the correct response is to queue the work and pick it up later. An API key with no
credit is *indefinitely* unavailable; the correct response is to tell a human. Behind one interface
both surface as the same failure, so the coordinator either waits on a wall or escalates a delay.

**Cost stops being comparable.** One side's budget is a clock, the other's is a balance. Adding them
produces a number that means nothing, and a scheduler that optimises it optimises nothing. This is
why a [`telemetry`](../../packages/telemetry) run record carries two measures side by side — token
`usage` and `quota` readings — and no single "cost" field that would have to lie about one of them.
A snapshot keeps the most recent quota reading *per seam*, because that is the reading an operator
can act on.

**Concurrency stops being a property you can reason about.** Seats are few and long-lived — you have
two Claude sessions, not two hundred. Token calls are many and short. A pool sized for one is wrong
for the other in the direction that hurts: sized for seats it wastes an API, sized for an API it
thrashes a subscription.

**The unit of work is different.** You hand `ctx.subagents` a *task* and it comes back having changed
the repository, minutes or hours later. You hand `ctx.llm` a *prompt* and it comes back with text,
in seconds. Only one of those needs a workspace, a branch, and a story about what happens if it dies
halfway.

## Where the gate can stand

The row that decides the most is *whose loop runs*, and it has one consequence worth stating
outright: **`dsh` cannot gate a tool call happening inside a vendor CLI's child process.**

On the `ctx.llm` seam, `dsh` is running the loop. Every tool call passes through it, so a policy can
sit at the tool call — this call, on this path, with this approval.

On the `ctx.subagents` seam the agent runs its own loop with its own tools, and by the time anything
comes back the edits are made. There is no interception point, and pretending there is one produces
security theatre: a policy object that inspects nothing. So the gate moves outward, to the sandbox
boundary and to what the agent is allowed to reach at all — which is a genuinely different control,
with a different failure mode, chosen because the seam permits nothing else.

This is why "just wrap both in one interface" is not merely inelegant. The wrapper would have to
present a gating surface that only half of what is behind it can honour.

## What this buys, concretely

It is what makes a subscription-driven fleet schedulable at all. Claude Code and Codex subscriptions
are the cheap capacity in this system — flat-rate, already paid for, and idle most of the day.
Treating their windows as a first-class resource is what lets the coordinator answer *can this run
now?* instead of discovering the answer by failing.

And it is what makes local models useful rather than decorative. An LM Studio model on the N5 costs
nothing per token and is far weaker than a frontier model. On the `ctx.llm` seam, where the currency
is tokens, that is a real trade you can make deliberately — summarise here, classify there. Behind a
merged interface it is a strictly worse agent, and it never gets picked.

## Where the seam does *not* reach

The seam says how a model is paid for. It says nothing about which model is good at what — that is
routing, and it belongs to a different axis:

> family is a property of the model, not of the harness

[`packages/routing/README.md`](../../packages/routing/README.md) owns that argument and the matrix
behind it. Seam and family are independent axes, and the coordinator reads both. Three places are
worth knowing about, because each is somewhere the seam's economics reach into a decision that looks
like it should be about quality:

- **The independence policy.** `seam-or-family` accepts *either* a different family *or* the other
  seam as enough independence for a review. `opposite-family` — the default — accepts only a
  different family, on the grounds that two runs of one family share training, tokenizer and blind
  spots, so an evaluator inside it is a rubber stamp with a different session id. Which one is in
  force is a deployment setting, and an unknown value is a boot-time error rather than a silent
  fallback ([`packages/dsh-app/README.md`](../../packages/dsh-app/README.md)).
- **The preference order.** Among candidates that are *all* legal, the author's own seam ranks
  first. That reads backwards until you price it: crossing to the other seam for independence
  usually means leaving a window that is already bought for a meter that bills per token — an
  escalation nobody asked for, made silently, on every review.
- **The relay constraint.** An evaluator reached over the relay seam must be open-weights, under
  both policies. Money leaves the building on that seam; what it is spent on is therefore
  constrained rather than left to whatever the router happens to offer.

## What is actually built

The seam is a decision, not a promise of code. At the current baseline:

- [`packages/subagents`](../../packages/subagents) ships the registry and selection behind
  `ctx.subagents`, and `dsh-app` registers it **empty**. A dispatch into an unconfigured system
  returns `no-providers` with a sentence saying why, instead of throwing on `undefined` — an
  unconfigured daemon and a broken one should not look alike.
- Two of the four provider packages are implemented against that contract:
  [`provider-claude`](../../packages/provider-claude), with the Claude Agent SDK injected by a
  composition root, and [`provider-opencode`](../../packages/provider-opencode), which talks to a
  long-lived `opencode serve` it does not own. [`provider-codex`](../../packages/provider-codex)
  ships only a transport-free route-identity and pre-turn protocol prerequisite; attachment and its
  full provider remain gated by #53. [`provider-acp`](../../packages/provider-acp) remains an empty
  stub. No Codex provider is composed into `ctx.subagents`. None of the four is registered by the
  profile: the composed registry is still empty, so *implemented* is not *composed*, and a clone
  cannot dispatch into this seam until a composition root registers a provider.
- [`packages/llm-local`](../../packages/llm-local) is implemented — three destinations,
  `lm-studio`, `llama-rocm` and `openrouter`, plus capability and budget tables — and `dsh-app`'s
  `harness-llm` row registers an adapter for all three on dsh's own `ctx.llm` service. Whether any
  destination answers is a host fact: reachability and credentials are resolved at dispatch, not
  at boot.

The split was stated before any of this code existed, so the shape was fixed while there was
nothing to be tempted into merging. Now that both seams carry implementations, they still attach
at two different points, and are still metered two different ways — which is the whole point of
having refused to merge them.

---

Next: [03 — The board](03-the-board.md) · Back to [docs](../README.md)
