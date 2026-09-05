# @rickylabs/provider-claude

A `SubagentProvider` over `claude-agent-sdk`, for the `claude` harness on the `ctx.subagents` seam.

**Status: stub.** Owned by **E3 · [#33](https://github.com/rickylabs/harness/issues/33)**. The only
export is `PACKAGE_NAME`. Nothing here launches, observes, steers or stops anything, and nothing in
the workspace depends on it doing so.

## What it will own

Turning a `DispatchRequest` into a running Claude agent, and turning that agent's state back into an
`Observation`. Specifically: translating the pinned model id the matrix chose into whatever spelling
the SDK wants on the way in, and mapping the SDK's session state onto `queued | running | finished |
failed | unknown` on the way out.

The translation direction matters and is already settled from the other side.
[`routing`](../routing/README.md) is the single owner of every model id, and it says plainly that
turning a pin into a launch argument is this package's boundary — so a vendor's alternative spelling
for the same model lives here, and never becomes a second answer to *which model*.

## What already constrains it

The seam landed before any provider did, on purpose. [`subagents`](../subagents/README.md) defines
`SubagentProvider`, and it already refuses the mistakes a first implementation makes:

- `capabilities` is **declared**, not discovered by calling. Whether this provider can observe,
  steer and stop is a fact a caller reads before dispatching, not an outcome it provokes by getting
  an exception.
- `unknown` is a verdict, not an error. A dispatch whose confirmation was lost has not failed, and
  reporting it as failed is what puts two agents on one branch.
- `conformanceProblems` checks the declaration itself, with nothing installed, so this package can
  be wrong about itself in CI rather than in production.

## Why it is empty

E3 has not landed. The interesting question — whether a `claude-agent-sdk` run is genuinely
steerable in flight, or only startable and stoppable — is a capability declaration, and declaring it
wrong is worse than not declaring it. That answer belongs to the epic.

---

Workspace conventions: [`packages/README.md`](../README.md). Why there are two seams rather than
one: [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).
