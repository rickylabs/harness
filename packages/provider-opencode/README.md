# @rickylabs/provider-opencode

A `SubagentProvider` over `@opencode-ai/sdk`, for the `opencode` and `opencode-run` harnesses on the
`ctx.subagents` seam.

**Status: stub.** Owned by **E3 · [#33](https://github.com/rickylabs/harness/issues/33)**. The only
export is `PACKAGE_NAME`. Nothing here talks to an OpenCode server yet.

## What it will own

Launching and observing OpenCode runs — and, uniquely among the four providers, honouring the
**router**. `subagents` pins the set (`n5air`, `n5air-rocm`, `openai`, `openrouter`), and
[`routing`](../routing/README.md) already requires every opencode route in the matrix to name one.

That is the thing to get right here. For the other three providers, where a run executes follows
from which provider was chosen. For this one it does not: the same harness reaches a local GPU on
the N5 or a per-token relay depending on a field in the request. Dropping the router, or defaulting
it, silently moves a run from a machine that is already paid for onto a meter — which is exactly the
confusion [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md) exists to prevent, arriving
through a provider rather than through a seam.

## What already constrains it

[`subagents`](../subagents/README.md) ships the interface and its refusals: capabilities are
declared rather than probed, `unknown` is a verdict rather than a failure, and a provider that does
not declare a harness is never handed a request for it. `conformanceProblems` checks all of that
against the declaration alone, with nothing installed.

The model id arrives pinned from the matrix. This package translates it for the SDK; it never picks
it.

## Why it is empty

E3 has not landed. The router question above is a contract detail as much as an implementation one,
and it is cheaper to answer once, in the epic, than to discover four times across four providers.

---

Workspace conventions: [`packages/README.md`](../README.md).
