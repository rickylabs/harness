# @rickylabs/provider-codex

A `SubagentProvider` over the Codex app-server JSON-RPC protocol, for the `codex` and `codex-run`
harnesses on the `ctx.subagents` seam.

**Status: stub.** Owned by **E3 · [#33](https://github.com/rickylabs/harness/issues/33)**. The only
export is `PACKAGE_NAME`. Nothing here speaks JSON-RPC to anything yet.

## What it will own

The app-server session: opening it, dispatching into it, reading state back out, and closing it.
Plus the id join — `RunRef.external` is where the app-server's own session id goes, so a run this
repository names can still be found by the tool that is actually executing it.

## Why this one is the interesting provider

It is the provider that can **steer**. divybot dispatches by writing an issue comment and has no
channel back into a running agent; the app-server has one. That asymmetry is the reason
[`subagents`](../subagents/README.md) makes `ProviderCapabilities` part of the interface at all
rather than letting `steer` throw where it is unsupported: with two providers this far apart, a
caller distinguishing *cannot* from *is down* by reading exception messages gets it wrong.

So the shape of this package is already implied. It declares `steer: true`, and it is the reference
implementation for the optional calls — `capabilityProblem` exists because of the gap between this
provider and a blind one, and something has to sit on the capable side of that gap for the check to
mean anything.

## What already constrains it

`SubagentProvider`, `DispatchResult`, `Observation` and `conformanceProblems` are shipped and tested
in [`subagents`](../subagents/README.md). The model id arrives pinned from
[`routing`](../routing/README.md); translating that pin into an app-server argument is this
package's job, and choosing it is never this package's job.

## Why it is empty

E3 has not landed. The seam was built first so that all four providers are written against a
contract that already refuses retry-on-unknown, silent harness substitution and ambiguous provider
ids — none of which are visible from inside a single provider.

---

Workspace conventions: [`packages/README.md`](../README.md). Why there are two seams rather than
one: [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).
