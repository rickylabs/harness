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
- A provider nothing has marked with `markInstrumented` refuses the whole selection too, and for the
  same reason it is refused whole rather than passed over: on a half-wired registry, passing it over
  would keep dispatches succeeding through the wrapped half while the raw provider sat there reachable
  by anything iterating `registry.providers`. See [#208](https://github.com/rickylabs/harness/issues/208).
- Otherwise registration order wins, and every passed-over provider is reported with the rule that
  passed it over.

`conformanceProblems` and `registryProblems` check what a provider claims about itself before it is
asked to do anything — composition-time validation for `dsh-app`. Blind and unstoppable are reported
without being failed, because divybot is genuinely both and saying so is the contract working. The
two checks that live on the *registry* are the two a provider cannot answer about itself: whether
another provider took its id, and whether the composition root remembered to wrap it.

`markInstrumented(provider, wrapper)` is how a composition root states that it wrapped something —
`instrumentedBy` reads it back. It is a wiring assertion, not a security boundary: it proves that
something calling itself `wrapper` said it wrapped this object, and nothing about whether the sink
behind it works. Sink durability is checked where the sink is.

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

## Consuming UHP

Spike **S11 · #289**, over the wire contract spike **S10 · #288** established. Four modules, and the
shape of each one is an argument:

    uhp-wire.ts       the protocol, transcribed. Types and closed vocabularies, no behaviour
    uhp-stream.ts     SSE consumption, and freshness computed from timestamps
    uhp-lifecycle.ts  UHP status to RunLiveness, per #287
    uhp-gate.ts       whether the route the server reported permits a useful turn
    uhp-session.ts    multi-turn continuation on previous_response_id, keyed on runId

**The status field is authoritative, never the event name.** Streaming §1 defines three terminal
events and no `response.cancelled`: a cancelled task arrives as `response.failed` carrying
`status: "cancelled"`, and the chapter says in as many words that the status decides. An adapter that
switched on the event name would report every cancelled run as a failure — blaming an operator for a
stop they asked for, and handing a failure-keyed retry policy a reason to relaunch.

**A refused stream yields nothing.** Not the frames it understood, not the partial text: the refusal
type has no field to reach them through. "The task finished" and "the stream stopped" are different
facts, and a decoder that shares a representation between them reports a killed run as a short
answer. A refusal is also not a failure — `mapUhpOutcome` maps it to `unknown`, because a dropped
connection is a statement about the network and the spec is explicit that the work continues
server-side.

**Freshness cannot be derived from a lifecycle status.** `uhpFreshness` takes evidence, a clock
reading and two window bounds. There is no status parameter, no response parameter and no boolean,
so the violation is not expressible rather than merely discouraged. Only a delta or an output-item
frame mints evidence, the brand on that evidence is module-private, and a hand-written object cast to
the type is refused at runtime. A finished run that produced nothing is `quiet`; an unfinished run
that produced a token a second ago is `live`; the status decided neither. `stalled` is deliberately
unreachable here — it needs a *claim* that something is running, which is the executor's lifecycle
and `@rickylabs/telemetry`'s join (#206).

**A substitution is detected through `mismatches`, not through `status`.** `unknown` outranks
`mismatch` in `compareRouteIdentity`, and over UHP three of the four route fields are never reported,
so the status is pinned to `unknown` even when the server has said in writing that it substituted the
model. A gate keyed on `status === "mismatch"` therefore never fires and looks correct while never
firing. `uhpRouteVerdict` is handed the negatives — what was contradicted, what was unreported,
whether the evidence verified — and its parameter type has no status field at all. A contradiction
outranks a silence, and the status rides along only in the diagnostic, where it explains rather than
decides. `uhp-gate.test.ts` carries both defective implementations by name and runs them on the same
evidence, because `assert(!accepted)` passes for the correct gate and for both defects.

**Provenance is per dialect, and three UHP labels deliberately do not exist.** `RouteSource` is a closed
vocabulary so a diagnostic can say *where* a value came from, and `OBSERVED_SOURCES` is keyed on
`RouteDialect` (`codex | uhp`) so a UHP observation is not labelled as a Codex `thread/start` response
this repository never sent. The `uhp` row carries one label — `uhp/responses.result.model`, for
`Response.model` — and `null` for `provider`, `effort` and `cwd`, because the protocol defines no field
for any of them and a label for a field the wire cannot report is a name with no referent. A field whose
observed source is `null` is refused by `isRouteEvidenceVerified` outright: a value beside an absent
source came from somewhere this vocabulary cannot name. So the arm makes UHP provenance *honest* and
leaves every UHP route as unverifiable as it was — two independent refusals, and
[#294](https://github.com/rickylabs/harness/issues/294) owns the only thing that could change either.
`compareRouteIdentity`'s dialect argument is optional and defaults to `codex`, so no call site that
predates it changed. Decision and blast radius:
`.llm/runs/route-identity-uhp--s10/proposal-routesource-uhp.md`.

**A steer carries the route evidence a dispatch does.** `SteerResult.route` is the same optional field,
with the same fail-closed reading, and it exists because UHP continuation is `previous_response_id`: a
long session is mostly steers, so a server that honours the model on turn one and substitutes on turn
five was producing a structured record in which no substitution ever happened. The verdict stays
`delivered` — the message landed, and resending it would put two turns in one conversation — and the
contradiction is carried in `route`, where `decideUhpRoute` can refuse on it. Read it with
`isSteerRouteVerified`, or hand `route` to the gate; absence is unverified, never agreement.

**Runs are keyed on `runId`; the UHP `session_id` lives in `RunRef.external`.** The same rule
`lease.ts` is built on, with a UHP-specific edge: the protocol leaves room for a server to branch a
second chain from an earlier response, so one session id can legitimately cover two runs, and a
ledger keyed on it would have one silently become the other. A continued chain that comes back
reporting a *different* session id is refused: the specification requires the same one, and a
different one means a different working directory.

**What none of this proves.** No HarnessRouter has ever answered any of it. Every byte came from
`uhp-mock.ts`, written from the published specification, on a host with no container runtime. The
live clone/branch/commit/push/pull-request round-trip is [#294](https://github.com/rickylabs/harness/issues/294)
and is blocked on infrastructure. Read
`.llm/runs/uhp-stream-adapter--s11/verification.md` for the split between what the mock proved and
what remains unproven.

## `provider-uhp`

Issue **#286**, built on those five modules and composing them rather than restating any of them.
Four more files, and again each shape is an argument:

    uhp-provider.ts     the SubagentProvider: dispatch, observe, steer, stop
    uhp-harnesses.ts    the pinned console manifest, and the drift that refuses a dispatch
    uhp-transport.ts    the HTTP port, and the only place a credential exists
    uhp-redact.ts       the publication boundary, and the fence that checks it
    config/harnesses.v1.json   the pinned chrn_ ids, and their provenance

**Runs are keyed on `runId`, the UHP `session_id` rides in `RunRef.external`**, and the turn chain
lives in `uhp-session.ts`'s ledger — not in a second one here. What this provider keeps beyond that is
the pinned harness and the requested route for each run, because a `RunRef` cannot carry either.

**The harness is pinned, and the pin is checked before every dispatch.** `metadata.harness_id` selects
the configured harness (Tasks §1.2), and omitting it lets the deployment choose — which means the run's
own record could not say what executed it. So the id comes from `config/harnesses.v1.json`, and
`GET /v1/harnesses` is read first: an absent id, a changed `base`, a changed `defaultModel` or a listing
that cannot be read all refuse the dispatch before a task is sent. A rename is not drift; the chapter
says `name` is not an identifier. **The checked-in manifest has `reconciledAt: null`** — no console has
ever been read into it, its ids are obvious placeholders, and every dispatch through it will therefore
refuse. That is the intended behaviour of an unreconciled pin, and #294 is where it stops being one.

**A contradiction refuses, a silence is unknown, and the order is the whole rule.** The owner ratified
the strongest-negative rule on 2026-09-12 and `uhpRouteVerdict` already implements it. This provider
widens the *negatives* — `metadata.model_fallback`, a `requested_model` that disagrees, and `model`
named in `metadata.ignored_fields` join `evidence.mismatches` in the contradicted set — and lets the
gate decide. It never branches on `evidence.status` and it adds no status parameter to anything.
A server that names the harness selector in `ignored_fields` is refused outright: the work ran somewhere
this dispatch did not name.

**Nothing published carries a path.** `RouteIdentityEvidence.detail` documents itself as unsafe, and
`describeRouteEvidence` embeds field values verbatim on the `known` branch as well as the `mismatch`
branch — so `cwd` leaks on success, not only on failure. Every string this provider returns goes through
`redactPaths`, route evidence is published through `redactRouteEvidence` (which reduces `cwd` to
presence and regenerates the diagnostic from the reduced values, rather than scrubbing it afterwards),
and the unredacted form goes to a local diagnostic sink instead. `pathShapedStrings` is the independent
finder, run over each result before it is returned; it and the redactor share a pattern list and neither
calls the other, so breaking one does not silence the other.

Published evidence carries `verifiedBeforeRedaction`, because reducing `cwd` to presence makes
`isRouteEvidenceVerified` unrecomputable: the predicate needs an absolute path and an exact match, and a
presence token is neither. A consumer re-deriving it would therefore read `false` forever — which is the
"provider is uhp, therefore unverified" branch #286 warns would silently never accept a `known` after S10
widens `RouteSource`. The field is that fact, measured where the values still existed. Read it rather than
re-deriving it; the re-derivation fails closed, which is safe and is not the same as true.

**`steer` is turn-boundary continuation, not injection into a live turn.** Lifecycle §5 refuses a second
concurrent task in one session, so steering a running turn is refused locally rather than sent and
refused remotely. **`stop` keeps three answers apart**: `stopped` for an observed `cancelled`,
`already-over` for a task that was terminal before the request, and `unknown` for a 404, an expired
session, or a task the server has accepted the cancellation of but not yet stopped. No terminal state is
ever synthesized.

**`dispatch` sends `background: true` and does not stream.** A dispatch returns once the executor has
the run — streaming would hold the call open for the whole agent run — and Streaming §5 is explicit that
a client should treat the stream as an optimisation and the stored response as the source of truth,
which is why `observe` re-reads `GET /v1/responses/{id}`. A server that ignores `background` blocks and
returns a terminal response, and that shape is handled too.

**The credential is a profile name, never a value.** `uhp-transport.ts` resolves
`HARNESSROUTER_API_KEY` from the environment at call time and attaches the bearer header; the provider
never receives a token, so it cannot put one in a payload. `createUhpTransport` refuses a profile that
is not shaped like an environment variable name, which is the mistake that shape exists to prevent.
A call that never left the process is reported as `sent: false`, and only that produces a `refused`
dispatch — everything sent and unanswered is `unknown`, because Errors §5 says a client that gives up
must not assume the task stopped.

**Still unknown on purpose.** A conformant UHP response yields `unknown`: three route fields are
unreportable, so nothing here ever returns `accepted`. Whether a lane needing no route evidence may
proceed anyway, and whether the verdict vocabulary should separate "I cannot name this run" from "I can
name it but cannot attest three fields", are open owner questions (#286 F1). Both are left at their
fail-closed default. `.llm/runs/provider-uhp--e37/` carries the forks, the mutation campaign and the
split between what the mock proved and what only a live router could.

## Not here

- **Model selection.** The routing matrix answers that; #61 validates model ids at the boundary.
- **Storing the ledger.** `lease.ts` decides; nothing here writes. The compare-and-set that makes
  the decision binding belongs to whatever holds the file, and no such store exists yet.
- **Any provider over a vendor CLI.** Those four implementations are `provider-claude`,
  `provider-codex`, `provider-acp`, `provider-opencode`. `provider-uhp` is the exception and it lives
  here by the ownership boundary confirmed on #286: there is exactly one `SubagentProvider` for UHP and
  exactly one harness object registry, and both are in this package.
- **Any I/O, with three named exceptions.** The UHP stream reader takes its clock as a parameter and
  falls back to `new Date()` only when a caller supplies none, so a test never sleeps. `uhp-mock.ts`
  binds a loopback socket on an ephemeral port — it is test support, it is not exported from
  `index.ts`, and no production entry point imports it. `uhp-provider.ts` speaks HTTP through an
  injected port, and `loadPinnedHarnesses` reads one file from this package's own `config/`; neither
  is called unless a composition root builds the provider.
