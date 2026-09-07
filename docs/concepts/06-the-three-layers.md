# The three layers

There is one chain from a label on an issue to a control on a phone, and it
passes through three deployments. Each deployment owns a different question, and
none of them may answer another's. This document describes all three at the same
depth, because the failures that cost the most are the ones that live in the
seams between them — and a seam is only visible when both sides are drawn.

![Three-layer architecture; this repository's build scope in orange](./three-layers.svg)

Orange marks what **this repository** builds. Everything else in the drawing is
somebody else's deployment, described here only so that the interface can be
argued about honestly. This is the owner-locked responsibility model, not a
claim that these deployments or their integration gates have already shipped.
The GitHub board and executable receipts establish delivery status.

---

## Layer 1 — coordination  ·  **this repository**

A Node and pnpm workspace, deployed on its own host. It owns three questions:
what may run, who may certify it, and what actually ran.

**board.** GitHub is the store, not a cache of one. Issues, labels and
milestones are the record; columns, lanes and anomalies are projections computed
from that record and never written back as a second source. The `harness` label
is a dispatch trigger; the other taxonomy labels are inert board metadata.

**delegation matrix.** The single routing authority is an explicit, wholly replaced document.
Version 1 holds lane chains and tier implement/review pairs; configuration-first resolvers
read those selections without a compiled fallback. The shipped document is a compatibility
transcription, not fleet parity. Dispatch names a
lane through the matrix, which owns model selection. Requested and observed
model identities still belong in contracts and receipts. Two
rules earn their keep: an author may not be its own evaluator, and a quota
trigger never falls back to a sibling model on the same subscription — that
would be a fallback in name only. The trigger union is closed at six members;
adding a seventh is a deliberate edit, not an incidental one.

**coordinator.** Admission. It decides whether a request may become a run, and
records the decision before anything is launched. `accepted: true` means
admitted, not started.

**telemetry.** Run observations, dispatch receipts, and the evidence that
attaches to both. A dispatch the provider refused is not a run, and the record
has to be able to say so without inventing a state.

**the two seams.** This is the layer's central distinction and the reason it
exists at all. `ctx.subagents` buys a **seat**, metered by a refill window;
`ctx.llm` serves API-key and local models. Paid API tokens consume a balance;
local models consume local capacity without a per-token bill. A subscription
window refills, while a depleted paid balance requires funding. Collapsing them into one
"capacity" concept makes both meters wrong. The union is closed at two members.

**sandbox boundary.** The seat seam cannot be gated inside a vendor CLI's child
process — there is no interception point there, and pretending otherwise
produces security theatre. So the gate moves outward to the sandbox boundary,
where the process actually starts. This is an admission about where control is
real, not a preference.

**forge.** Bootstraps a target repository's label taxonomy and emits the process
skill that reads it. Planning computes changes; applying or ejecting a taxonomy
can mutate the target repository and requires authorization for those writes.

---

## Layer 2 — the product backend

A NetScript application on Deno and Fresh: one operator-managed stack of
independently restartable processes. It is not a client of the backend. **It is
the backend.**

NetScript supplies definition builders, runtime primitives and ports. The
application owns composing and configuring those primitives into working,
durable services and proving their behavior. It does not have to reimplement
every runtime. For example, `defineJobHandler` returns a handler and the same
workers package provides `createWorkersRuntime`; neither fact alone proves the
application's lease, retry or dead-letter policy. A trigger processor can use a
no-op `dispatchAction` default until real dispatch is supplied.

The work below is **owned engineering**: persistence, authorization, recovery
and delivery evidence belong to this application, including when an upstream
runtime supplies part of the implementation.

**HTTPS gateway.** One entry point in front of the whole stack. Every process
behind it restarts independently; none of them is a singleton whose death takes
the others with it.

**Fresh frontend + API.** Serves the application's own routes and the routes
contributed by feature plugins. The rendering half of this is the only thin part
of the whole system.

**harness adapter.** Consumes the contracts package's mux, folds the deltas, and
projects the result. **Exactly one reducer owns a run card.** If the phone also
folded the mux, two projections would disagree under partition and the
disagreement would surface as a user-visible flicker with no correct resolution.
The fold happens here, once.

**worker runner.** Dispatcher, payload validation, attempt policy with backoff,
lease acquisition and renewal under compare-and-swap, cancellation, dead-letter
routing, and an idempotency store. This application owns their composition,
configuration and executable guarantees.

**saga runner + outbox.** A transactional outbox with claim, commit and recovery
paths; a durable step-and-compensation journal; and a recovery runner that can
resume a compensating saga after a crash. Without the runner, compensation is a
one-way door.

**trigger scheduler.** Persisted schedule state, leader fencing so two
schedulers cannot both fire, real dispatch into the typed enqueue path, and a
*required* delivery receipt — because a scheduler that cannot prove delivery is
a scheduler that silently stops.

**durable-stream service.** Installed and authenticated as a real service, with
tenant-qualified resource paths, and every write awaiting `receipt.completion`
rather than assuming it.

**PostgreSQL.** The authoritative record: principals, grants, command intents
and their receipts, the saga journal, the outbox, schedules, and plugin
configuration. Identity is `(tenantId, repositoryId, objectId)` throughout —
never a bare id that happens to be unique today.

**Deno KV queue.** The queue storage, selected explicitly rather than inherited
as a default, so that the choice can be argued with later.

**feature plugins.** A product feature is a **pure core package plus a thin
NetScript plugin**. The plugin contributes routes, background processors and
configuration; the core package holds the logic and knows nothing about hosting.
A directory under `plugins/` that does not define or contribute a plugin is not
a plugin — it is a package or an adapter, and should be renamed to say so. The
plugin registry and the AppHost bindings are **generated** from the manifests
and the authored settings; they are never hand-edited. The composition authority
is authored config plus plugin manifests; the runtime graph authority is the
authored settings file. Everything downstream of those two is derived.

**plugin host + doctor.** Order, axis and collision validation over the
registry, and a per-plugin **doctor receipt** showing the bindings that plugin
actually acquired — so an enabled-looking no-op default is a failure with
evidence, not a silence.

**Fresh islands + desktop shell.** The only genuinely thin part: a rendering
surface over the application above, plus a shell that hosts it.

**The outward surface.** `defineService` derives REST and OpenAPI from the
service definitions. That OpenAPI document is *captured* as a versioned
artifact, and a client package is generated from the capture. A backend router
type is never exported across the boundary; the artifact is.

---

## Layer 3 — the client

An Expo native application on bun and React Native, routed with expo-router.

**generated client.** Consumes the backend-owned captured OpenAPI artifact and
the client generated from that capture. OpenAPILink over `expo/fetch` is a
candidate transport until the exact generated package and native execution
receipt establish compatibility. The native client consumes backend resources
only: no Harness mux, direct Harness dependency or duplicate fold.

**native stream adapter.** Consumes the backend's published stream resource
contracts on a transport verified for the native runtime. It does not consume
Harness stream frames or reconstruct the Harness fold.

**expo-router tabs.** Chat, projects, activity, settings.

**bundle boundary gate.** A build-time gate that walks the application import
graph *and* scans the exported bundle. It refuses Node built-ins, Prisma, Deno
globals, AppHost and worker or daemon runtimes, any `/server` leaf, and every
private backend runtime package. The generated product client is the phone
boundary; the phone does not import the Harness contracts package directly.
Before the first generated-package import, publication must establish the exact
allowed package names and exports and enforce both source-import and exported-
bundle rules against that artifact. A phone bundle that can reach
a backend runtime is a leak, and the gate is what makes that statement testable
rather than aspirational.

**three vocabularies, kept apart.** *Execution* is queued, running, finished,
failed, and **state unknown**. *Evidence* retains its original observation time
when available; unavailable evidence has no invented timestamp. *Certification*
is uncertified or outdated. These describe semantic distinctions, not a second
set of native wire enums. Before live data arrives, local illustrative vocabulary
fixtures must yield to the generated backend contract. Connection synchronization
is separate from all three dimensions. Merging them produces the
specific bug this product exists to eliminate: an interface that reports missing
evidence as failure. **"State unknown" never triggers an automatic redispatch.**

**offline notebook.** Offline is a dated notebook of fetched state and unsent
drafts. It is never a controller, and it never invents a state transition it did
not observe.

---

## The two carriers

Between the layers sit two published surfaces. They are the only sanctioned way
across, and their rules are deliberate.

**Coordination → backend: the contracts package (protocol 1).**
Protocol 1 specifies POST for `snapshot`, `dispatch` and `approve`. Mutating
`dispatch` and `approve` requests require idempotency keys; the snapshot request
does not. The method alone does not establish idempotency or authorization.
The read half is a WebSocket mux carrying **whole-value deltas, never patches**,
with a `generation` per connection and a `seq` that increments by one within a
generation. Connecting is subscribing. An unknown kind is a third decode
outcome, distinct from malformed input. The decoder validates the envelope,
not the full payload schema; it is not an authorization or payload-validation
boundary. A resync supplies a current snapshot, not a journal replay.

**Backend → client: the generated client package.**
A captured, versioned OpenAPI artifact and the client generated from it. The
capture is the contract; the running server is not. This is what lets the phone
be built against a version rather than against a host. Closure requires the
backend source identity, captured OpenAPI digest, generated package version and
exports, and matching native transport, authorization/error and bundle receipts.
This architecture diagram proves none of those artifacts or their compatibility;
absence of an adapter call site is not a no-schema-impact receipt.

---

## What this repository builds

Everything in orange: the whole of layer 1, and the contracts package that
leaves it. Concretely:

1. The board projections, and the discipline that keeps them projections.
2. The delegation loader and immutable resolvers that load and resolve an explicit document
   whose data is the routing authority, with a closed trigger union and the two rules that
   make fallback meaningful.
3. Admission, and the record that a decision was made before anything launched.
4. The two seams, kept apart, and the sandbox boundary that makes the seat seam
   enforceable where it is actually enforceable.
5. Telemetry that can say a dispatch was refused without inventing a run.
6. **The published contracts package** — protocol 1, versioned, tagged.

## What this repository must not build

**A product feature.** Layer 1 answers what may run and what did run. It does
not render, schedule product work, or hold product state.

**A second outward surface.** One published package, one protocol version. A
consumer that needs a private package is a consumer that has been handed the
wrong boundary.

**An independent model-selection policy outside the matrix.** Dispatch resolves
a lane through the matrix. Recording the requested and observed model identities
is necessary evidence, not a second routing authority.

---

## Gaps, stated plainly

**The contracts package is not published.** Both downstream layers are written
against a specification rather than an installed artifact. This is the single
highest-leverage unblock in the chain: nothing below layer 1 can be integration-
tested against a version until the tag exists.

**Fidelity decision — documented loss in v0.1.0, protocol 1.** Provider
`RunLiveness` is execution state (`queued`, `running`, `finished`, `failed`,
`unknown`). Wire `RunView.liveness.state` is evidence freshness (`live`,
`recent`, `stalled`, `quiet`), computed from dated evidence and a running claim.
They are independent dimensions, not five values being converted to four.
Wire `RunView.outcome` separately supports `running`, `complete`, `failed` and
`unknown`; it cannot express the provider's `queued` state.

For this first release, the exact provider lifecycle is intentionally not a
lossless public surface. Consumers must not infer it from freshness, present
admission as execution, or map unknown to failed. A provider-only queued
observation is not sufficient to invent a started run record or its `startedAt`.
Its absence from run observations does not prove that no work was admitted.
Board queue membership remains a separate fact. This decision does not assert
that a provider-to-wire adapter has shipped.

The alternative is a versioned structured provider-state field with its own
observation time. That would preserve queued separately, but requires producer
implementation and downstream adapter, captured OpenAPI and generated-client
evidence. It is deferred from v0.1.0. The cost of the selected loss is that a
consumer cannot offer exact provider-queue status from this release. Connection
freshness recovery is an additional, separately tracked limitation in #265.

---

## A note on naming

This document describes two downstream deployments without naming them. That is
deliberate while the question of which consumer names may appear in public
documentation remains an open owner decision. The roles — *the product backend*,
*the client* — are the load-bearing part; the repository names are not, and
adding them later costs nothing.

## Consulted sources

Source marker: Harness source; topic: protocol, execution and freshness fidelity;
date: 2026-09-07. At release candidate `684840b61d4cbccec69f0ff015d2715941ca16b8`,
see `packages/contracts/src/routes.ts:37,82,121`,
`packages/contracts/src/runs.ts:46,132,160`,
`packages/subagents/src/provider.ts:126`, and
`packages/telemetry/src/liveness.ts:121`:
[commands](../../packages/contracts/src/routes.ts),
[run views](../../packages/contracts/src/runs.ts),
[provider observations](../../packages/subagents/src/provider.ts),
[freshness classifier](../../packages/telemetry/src/liveness.ts), and
[the two seams](02-the-two-seams.md). The fidelity decision above is made by
the protocol owner under the architecture-lock directive of 2026-09-07.

Source marker: NetScript source; topic: supplied runtime versus application
composition; date: 2026-09-07; source commit
`08f581e8334485c29c845b39615276c59b48cc35`. Consulted `packages/plugin-workers-core/src/public/root.ts`
at line 350 (`defineJobHandler`, `createWorkersRuntime`) and
`packages/plugin-triggers-core/src/runtime/trigger-processor.ts`
at line 81 (`dispatchAction` default). These examples establish composition obligations,
not a deployment receipt.


Source marker: anonymized native architecture review supplied to the Harness
coordinator; topic: generated-artifact boundary, transport verification and
unavailable evidence; date: 2026-09-07. These are consumer acceptance requirements,
not claims of delivered runtime behavior. Harness source
`packages/contracts/src/runs.ts:148` permits a null evidence timestamp. Private
consumer identifiers and links are deliberately excluded.
