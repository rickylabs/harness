# @rickylabs/subagents

The `ctx.subagents` seam. Owned by **E3 · #33**, defined by **#51**.

Two things live here, and they are one thing: the payload that describes a run to be launched, and
the interface anything capable of launching one implements. A third joined them once the seam had a
second caller — the lease that keeps one writer on a session.

    DispatchRequest  ──renderSwarm──▶  /swarm block  ──divybot──▶  an agent on a host
           │                                 │
           │                            parseSwarm
           ▼                                 ▼
    SubagentProvider.dispatch          DispatchRequest

Both paths carry the same payload. That is the point: #36 is explicit that there must be exactly
one dispatch request and one grammar for it, and #37's strangler-fig only works if the block it
writes and the request the seam takes are the same object under two encodings.

## Why the contract is not in `contracts`

`@rickylabs/harness-contracts` is E8's package, published to npm for the two UIs, and #79's acceptance draws
the line from the other side: **a type that only makes sense for one surface does not belong there.**
A UI reads a board; it never implements a provider.

A cockpit does ask for a dispatch, and that request is `contracts`' `DispatchCommand` — an issue and
a **lane**. The `DispatchRequest` below names a model, a host and a provider, and the coordinator
builds it only after routing resolves the lane. That gap is deliberate: a payload a client could
send that named a model would let a phone route around the rule that an evaluator may not be the
author.

This package depends on nothing else in the workspace, which is what lets both seams reach it —
E6's projection (`@rickylabs/board`, which re-exports the dispatch names so its public surface is
unchanged) and E7's forge — without either depending on the other.

## `unknown` is not `failed`

The word the provider interface is built around.

A provider that cannot reach its executor does not know whether the run is alive. A dispatch whose
confirmation was lost in flight may or may not have launched an agent. Reporting either as a failure
is not conservative — it is a specific, wrong claim, and the action that follows it is a retry.

divybot polls on a 30 second cycle. A retried dispatch that did in fact land puts two agents on one
branch, which is not a degraded outcome; it is a corrupted one, and it stays invisible until their
commits interleave. So `unknown` is a verdict rather than an error, and `isSafeToRetry` returns
`true` for exactly one case: an explicit refusal, where the executor was reached and said no.

## Capabilities are declared, not discovered by calling

divybot dispatches by writing an issue comment and has no channel back into a running agent. The
Codex app-server does. A contract where `steer` throws leaves every caller distinguishing "cannot"
from "is down" by reading exception messages.

`ProviderCapabilities` is therefore part of the interface — checked by `selectProvider` before a
dispatch and by `capabilityProblem` before any optional call, so an unsupported operation is a fact
the caller reads rather than an outcome it has to provoke.

## Selection

`selectProvider(registry, request)` is pure, which is what lets the decision be replayed from the
journal (#71) and checked in CI against a table of declarations with nothing installed.

- The request is validated with `validateDispatch` — the same wire-format validator the `/swarm`
  path uses. A second, laxer check here would accept a brief the other seam refuses.
- A provider that does not declare the harness is never chosen. The failure this prevents is the one
  divybot has on its own side: an unknown harness silently becomes Claude, so the run is not what
  the record says it is.
- A provider that cannot observe is passed over unless the caller writes `supervised: false`. This
  project exists because "status ?" was the only way to find out what was happening; a run nobody
  can see is the problem, not a cheaper option.
- Two providers under one id refuse the whole selection rather than tie-break. `RunRef.provider` is
  how a later `observe` or `stop` finds its executor, so an ambiguous id can route a stop to the
  wrong run.
- Otherwise registration order wins, and every passed-over provider is reported with the rule that
  passed it over.

`conformanceProblems` and `registryProblems` check what a provider claims about itself before it is
asked to do anything — composition-time validation for `dsh-app`. Blind and unstoppable are reported
without being failed, because divybot is genuinely both and saying so is the contract working.

## Holding a session

`lease.ts`, defined by **#56**. The failure it exists for has a message: *"Remote Control
disconnected — another connection took over this session (code 4090)."* Two `claude --resume
<same-id>` processes ran at once. Nothing broke loudly; one agent simply stopped being heard from
and carried on writing into a transcript nobody was reading.

**A run is keyed on our id, never the vendor's.** `claude --resume` is version-dependent: it has
both appended to an existing transcript and minted a fresh session id for the same logical run. An
identifier that changes underneath you is not a key. `runId` is ours and exists before the run does.
`admitResume` refuses `keyed-on-vendor-id` when the id it was handed is also one of the observed
transcripts' session ids — the shape the bug takes before it becomes two live processes.

**The vendor session is resolved, not remembered.** `resolveSession` takes the newest modification
time among the transcripts whose tail carries the marker, which defaults to the run id itself. Both
halves are load-bearing: mtime alone picks whichever agent wrote last, and the marker alone cannot
tell an abandoned transcript from the live one after a resume minted a second id. A tie on
modification time is `ambiguous`, never a tiebreak — choosing one would be a coin toss wearing a
rule's clothes.

**The lease carries a fence.** An expired lease is not a dead holder; it is a holder that stopped
renewing, and it may still be running. So every grant that changes hands takes a fence one higher
than any issued before it, a renewal keeps its fence, and a release never lowers the ledger's. A
holder that wakes after being taken over presents an old fence and is refused `stale-fence`.

    acquire ─▶ granted | renewed | taken-over | refused
    admitResume ─▶ admitted, or every reason it was not

`admitResume` collects every reason rather than returning the first. A caller told only "no lease"
fixes that, retries, and is told "session ambiguous" — two round trips to learn what one answer
could have carried, and in between, an operator who has started guessing. Two refusals are advisory
and do not block: `transcript-stale` and `mtime-unreadable`, neither of which is evidence that a
second writer exists.

### Where the atomicity is

Not in this module. Every function is pure — it reads a ledger and returns the one that should
replace it. Two callers reading the same ledger both compute a grant, and both compute the **same**
fence. The store has to apply the replacement under a compare-and-set on `ledger.fence`, and `holds`
is the check it performs before acting on a lease it read earlier. This is stated rather than
implied because the alternative is a module that looks like it provides mutual exclusion and does
not. `lease.test.ts` demonstrates exactly that: two acquires from one snapshot both mint fence 1,
and whichever ledger lands, the other holder's resume is refused.

## The Go grammar

`dispatch.ts` and `go-grammar.ts` are a port of Orchid's `parseOverrides`, pinned at commit
`d344bd037bcf10150fd12daef8ffa277576cd94a`. Go's line splitting, `unicode.IsSpace` and RE2's `\s`
each disagree with the JavaScript equivalent, and the disagreement is not pedantry: `model: a\rpayload`
is a key line to Go and prose to a JavaScript regex, which is how a prompt line once parsed as a key
and replaced the matrix-selected model at launch. `dispatch.conformance.test.ts` holds that port to
the original.

## Not here

- **Model selection.** The routing matrix answers that; #61 validates model ids at the boundary.
- **Storing the ledger.** `lease.ts` decides; nothing here writes. The compare-and-set that makes
  the decision binding belongs to whatever holds the file, and no such store exists yet.
- **Any provider.** The four implementations are `provider-claude`, `provider-codex`,
  `provider-acp`, `provider-opencode`.
- **Any I/O.** Nothing in this package touches a network, a clock or a filesystem.
