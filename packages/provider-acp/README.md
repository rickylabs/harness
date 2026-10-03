# @rickylabs/provider-acp

A `SubagentProvider` over ACP — the agent-client protocol — at the internal native-task boundary. The optional dsh composition calls that service `ctx.subagents`.

**Status: stub.** Owned by **E3 · [#33](https://github.com/rickylabs/harness/issues/33)**. The only
export is `PACKAGE_NAME`. Nothing here speaks ACP yet.

## What it will own

One provider covering every ACP-speaking agent, instead of one package per vendor. The protocol is
the abstraction; each proposed native tool requires an exact protocol/round-trip proof before
this package can claim support. AGY native CLI dispatch in Orchid is a separate boundary.

## The open question this package carries

`subagents` pins its native harness vocabulary, including `agy`; that identifier alone does not
prove ACP compatibility. Additional native tools require their own declared contract and evidence.

That is deliberate rather than an oversight, and it is the decision E3 has to make here. A harness
id is not a local detail — it is what the `/swarm` block carries, what telemetry records, and what a
provider is matched against. Adding one is a change to a contract two seams read, so it happens in
[`subagents`](../subagents/README.md) with the tests that pin it, not quietly inside a provider that
decided it could launch something new.

Until then, describing this package as covering three agents would be describing a plan as a
capability.

## What already constrains it

The interface and its refusals are shipped: capabilities are declared rather than probed, `unknown`
is a verdict rather than a failure, and a provider that does not declare a harness is never sent a
request for it — which is the guard that keeps an unknown harness from silently becoming Claude and
producing a run that is not what the record says it is.

## Why it is empty

This ACP implementation has not landed. Implemented SDK/server adapters elsewhere and native
Orchid transports do not complete it by implication.

---

Workspace conventions: [`packages/README.md`](../README.md). Why there are two seams rather than
one: [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).
