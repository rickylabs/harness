# Two seams, not one

Native autonomous tasks and API/local-model calls have different loop, enforcement and lifecycle
boundaries. Harness keeps those boundaries explicit. [ADR 0005](../../method/doctrine/decisions/0005-harness-framework-identity.md)
records the framework on Orchid and Herdr; the retained dsh router is an optional composition.

| Boundary | Native autonomous task | API/local-model call |
| --- | --- | --- |
| Work | A task with tools, context and a potentially long-lived process | A request to a configured model endpoint |
| Loop | The native CLI or SDK owns its agent loop | The calling adapter/runtime owns any surrounding loop |
| Admission | Route authority, workspace, credentials, process capacity and source-based budgets | Endpoint capability, credentials, spend and local capacity where applicable |
| Evidence | Exact native session binding, persisted activity, usage and explicit end/error facts | Actual response/usage and the caller's own effect receipts |
| Enforcement | Only the boundaries the native transport really exposes | Only the tool/API boundaries the caller really owns |

A native transport is not a billing regime. Claude and Codex quota windows, a paid OpenCode
provider's spend and an unmetered transport's static cap are separate facts. AGY must not consume
the Claude meter merely because both are native agents. Missing quota, access or price observations
stay unknown; connectivity never establishes paid eligibility. Local calls can consume physical
capacity without a per-token bill. Do not add these units into a fictional common cost.

## Where the gate can stand

A dispatcher can verify authority and physical prerequisites before launching a native process.
It cannot claim to inspect every tool call inside that process unless an implemented native
integration provides that control and evidence. Native trust, sandbox and permissions still need
their exact transport-specific configuration and scope.

An API caller may own the surrounding tool loop, but an endpoint adapter alone does not prove
sandbox enforcement, approval policy or durable recovery. State the actual interception point and
its tests. A route declaration, an implemented provider and a deployed integration are different
claims.

## Routing and independence

Concrete model/provider/effort choices belong to replaceable routing data and measured native facts.
The matrix supplies the default for agentic launches; verified owner-native authority can select an
exact route while retaining physical checks and budget accounting. Requested effort is not observed
support or proof that a CLI applied it.

Evaluators use separate sessions and different vendor families. No missing provider, quota fallback
or owner route waives that rule. A model's family is independent of the transport carrying it.
[Routing](../../packages/routing/README.md) owns the current configuration and resolver contracts.

## What the package adapters implement

| Package | Source boundary |
| --- | --- |
| [`subagents`](../../packages/subagents) | Native request/provider contract, registry and selection |
| [`provider-claude`](../../packages/provider-claude) | Claude Agent SDK injected by a composition root |
| [`provider-opencode`](../../packages/provider-opencode) | Configured OpenCode server; does not start or own it |
| [`provider-codex`](../../packages/provider-codex) | Partial route-identity and pre-turn prerequisite; not a composed provider |
| [`provider-acp`](../../packages/provider-acp) | Empty ACP stub |
| [`llm-local`](../../packages/llm-local) | API/local adapter destinations and capability/budget configuration |

These adapters are distinct from Orchid's native CLI transports and Herdr's terminal control.
An Orchid Codex or AGY launch does not finish a missing workspace provider. UHP-hosted dispatch
remains parked under [ADR 0004](../../method/doctrine/decisions/0004-uhp-park-evidence.md).

## Retained experiment vocabulary

The optional [`harness-router-dsh`](../../experiments/routers/dsh/README.md) attaches native provider services to
`ctx.subagents` and API/local adapters to `ctx.llm`. Its native registry is composed empty;
a missing provider yields `no-providers` rather than proof of a working launch. The API adapter
has configured destinations, whose reachability and credentials are host facts.

The coordinator's existing `Seam` union uses `subscription` and `relay`, and its policies include
`opposite-family` and `seam-or-family`. These are source contracts used by the retained composition,
not permission to infer a native transport's billing or relax the fleet's evaluator rule. The
experiment's relay open-weights constraint and preference order are documented in its own
[README](../../experiments/routers/dsh/README.md); they do not assert that every paid native route is a relay.
Actual service keys, upstream package names and historical fixtures remain unchanged.

---

Next: [03 — The board](03-the-board.md) · Back to [docs](../README.md)
