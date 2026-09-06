# @rickylabs/llm-local

Where a `ctx.llm` request can be sent, and where it must not. LM Studio, llama-rocm, OpenRouter.

Owned by **E4 · [#34](https://github.com/rickylabs/harness/issues/34)**; the capability matrix is
**[#60](https://github.com/rickylabs/harness/issues/60)**. Nothing here reaches an endpoint.

## What is in here

| File | What it owns |
| --- | --- |
| `backends.ts` | The three destinations: base URL, locality, accelerator, readiness, diagnostics |
| `capability.ts` | The model × backend matrix — what runs where, what does not, and why |
| `budget.ts` | The token-budget floor, as a branded type |

## The line this package does not cross

[`routing`](../routing/README.md) owns every model id and the matrix that chooses between them. This
package answers *where do I send a request for `x`*, and never *should the request be for `x`*. Two
packages answering the second question is the failure mode: there would be no way to tell which
answer a run had used.

So the ids in `capability.ts` are imported, never spelled. A model `routing` does not pin cannot be
placed here — `checkCapability` reports it as a problem rather than inventing a row for it.

The dependency runs one way. `routing` does not know a backend exists.

## Local availability is not guessable from the id

Every asymmetry in the matrix cost a debugging session to find, and none of them can be inferred
from the model name, the vendor, or whether the weights are open:

- **GLM-5.3-Flash is relay-only.** `glm5next` is absent from this box's llama.cpp build, so neither
  local backend can load it. The accelerator is not the obstacle, which is why swapping to ROCm does
  not help.
- **Ling-3.0-flash is ROCm-only, with conditions.** It segfaults on Vulkan, and it needs
  `GGML_HIP_ENABLE_UNIFIED_MEMORY=1` and `--load-mode none` to come up at all. Without those the
  server starts fine and the first request fails, which reads as a model fault.
- **LM Studio will run Ling anyway, at about 3 tok/s on CPU.** This is the dangerous placement, and
  the reason `unusably-slow` is a refusal rather than a warning: a lane routed there does not fail,
  it takes an hour and looks like a hung agent.
- **Qwen3.8-27B on LM Studio, around 40 tok/s, is the local smoke and plan-evaluation seat.** Fast
  enough that routing there is a choice rather than a fallback.

## Three verdicts, because two would force a lie

`runs` and `refused` are the interesting ones. `unverified` exists because the alternative is worse:
with only two verdicts, every pair nobody has tried has to be filed as one or the other, and both
are false. A `refused` we cannot justify blocks a route that might be fine; a `runs` we have not
observed sends a dispatch somewhere it may die.

`canRun` fails closed on `unverified`, because the question it answers is *may I dispatch here
without probing first*.

The distinction is what makes totality worth enforcing. `checkCapability` requires a placement for
every model × backend pair, so a model that gains a pin in `routing` cannot silently have no row —
but that is only safe if the filler value is allowed to say "unknown".

Four refusal reasons, each with a distinct remedy, which is the test for whether one deserves to
exist: `absent-from-build` (rebuild), `crashes-on-backend` (use the other accelerator),
`unusably-slow` (do not route there), `not-served-here` (nothing changes this — it is a fact about
what the destination is).

## Readiness is probed, never inferred

`ReadinessCheck` has exactly one member, and that is deliberate. The llama-rocm container's
entrypoint is `sleep infinity`: starting the container does not start a server, so a scheduler that
reads "container is running" as "backend is ready" dispatches into a socket that is not listening and
reports the result as a model problem. There is no `"container-state"` member to select.

Each backend also carries where its failures are actually read. LM Studio is the case that proves
the field earns its place: a model that fails to load leaves nothing useful in the container's
stdout, so `nerdctl logs` shows a healthy server while every request fails. The evidence is in the
app's own log directory.

## A budget under 300 tokens is unrepresentable

Ask a model that reasons before it answers for a completion in ten tokens and it does not refuse. It
reasons for seventy-one, hits the ceiling mid-thought, and returns HTTP 200 with empty content and an
ordinary finish reason. A success-coded failure is the worst shape a bug can have, and this one is
preventable, because the budget is known before the request is sent.

`ReasoningBudget` is a branded number produced only by `reasoningBudget()`, which is the sole place
the floor is applied. A function taking a `ReasoningBudget` cannot be handed an unchecked one, and
the check cannot be forgotten at a new call site, because there is no way to spell the type without
going through the constructor.

The floor is unconditional rather than scoped to reasoning models. Scoping it would need a registry
of which models reason, and that registry is a time-sliding fact: a vendor turns reasoning on in a
point release, the table still says no, and the floor stops applying to exactly the model that needed
it. The cost of applying it everywhere is nil — a sub-300-token ceiling is not something anyone asks
for on purpose.

## Why this is a seam of its own

`ctx.llm` and `ctx.subagents` are separate because they fail differently, not because dsh happens to
name two extension points. A subscription run is metered by a quota window that refills; a relay run
is metered per token against a balance that does not. This package is the second kind, which is why
it is where a credential profile is bound — see
[`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).

The local endpoints sit here too, and they are the case that makes the split obvious: a model running
on the N5's own GPU costs nothing per token and is still not a subagent. It has no session, nothing
to steer, and nothing to observe.

`moonshotai/kimi-k3` is the mirror image, and is deliberately absent from the matrix even though
`routing` pins it: it is reached through opencode's own router, on the subagent seam. Listing it
would imply this package could send it somewhere, and no adapter here ever will.

## What is deliberately not here

No adapter, no client, no health probe. Every base URL is the N5 compose default, not a fact about a
deployment; resolving an override and proving anything reachable belongs to
**[#57](https://github.com/rickylabs/harness/issues/57)**, which consumes this table rather than
restating it.

Quota, spend and load are absent for a stronger reason: all three change while you read them, so a
committed copy is wrong by the time it ships. This package answers *could this ever work here*.
Whether it works right now is a probe: taking one is #57's, and what its result is worth —
how long, and when silence in its output is not evidence — is
[`routing`'s `probe.ts`](../routing/README.md#availability-expires-and-everything-else-here-does-not).

---

Workspace conventions: [`packages/README.md`](../README.md).
