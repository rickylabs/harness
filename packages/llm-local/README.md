# @rickylabs/llm-local

`LlmAdapter` provider configuration for the `ctx.llm` seam — LM Studio, llama-rocm, OpenRouter.

**Status: stub.** Owned by **E4 · [#34](https://github.com/rickylabs/harness/issues/34)**. The only
export is `PACKAGE_NAME`. Nothing here reaches an endpoint.

## What it will own

Where a model is reachable, and under which credential profile — a base URL, a profile name, a
health check. Nothing else.

The line that keeps this package small is drawn from the other side.
[`routing`](../routing/README.md) owns every model id and the matrix that chooses between them, and
says so as a refusal: a model it does not pin cannot certify anything. So this package answers
*where do I send a request for `x`*, and never *should the request be for `x`*. Two packages
answering the second question is the failure mode; there would be no way to tell which answer a run
had used.

## Why it is a seam of its own

`ctx.llm` and `ctx.subagents` are separate because they fail differently, not because dsh happens to
name two extension points. A subscription run is metered by a quota window that refills; a relay run
is metered per token against a balance that does not. This package is the second kind, which is why
it is where a credential profile is bound — see
[`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).

The local endpoints sit here too, and they are the case that makes the split obvious: a model
running on the N5's own GPU costs nothing per token and is still not a subagent. It has no session,
nothing to steer, and nothing to observe.

## Why it is empty

E4 shipped its first half as [`routing`](../routing/README.md) — the matrix, and the invariants that
hold it together. This is the second half. #34 also owns making a wrong model id fail loudly at the
launch boundary, and that check has to know what a boundary looks like before it can be written.

Endpoints and profiles are also the part with credentials behind it, and nothing about that belongs
in a placeholder.

---

Workspace conventions: [`packages/README.md`](../README.md).
