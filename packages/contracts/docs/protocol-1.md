# Contracts: retained protocol-1 design

Part of the [`@rickylabs/harness-contracts` README](../README.md), split out to keep each page
under the 500-line cap. Each section states the release that introduced it.

## Retained protocol-1 design decisions

### The server classifies, the client counts

Every task carries the `phase` it sits in and the `bucket` it counts as, both computed by the
projection. Shipping raw labels instead would put two independent reimplementations of the
classifier in front of the same board, and they would disagree.

That is not hypothetical. The projector's own counter once derived "in progress" as the remainder
after the buckets it knew about, and reported `60 running` on a board with two agents running. A
rule that subtle, hand-reimplemented in two UI codebases, is wrong twice.

What is left for the client is arithmetic and grouping — and counting a field the server already
decided stays correct under deltas, which a re-derivation does not.

### The snapshot is normalized

A cockpit wants a kanban board, a tree of epics and a list of running agents. Those are three views
of the same tasks, and shipping them pre-grouped breaks the moment anything changes: one task moving
column becomes a coordinated edit in three places, and any delta protocol built on it either resends
everything or leaves a task drawn in two columns at once.

So every task appears once, every run appears once, and grouping is a plain group-by on `phase`,
`epic`, `milestone` or `parentId`.

The lifecycle travels **on the snapshot, as data**. A published constant here would be a third copy
of a list that already exists twice — in `board` and in the labels `harness-forge` stamps — and those two
drifted once, silently: every correctly labelled item read as "no status" and a freshly filled board
reported itself empty. `scripts/check-lifecycle.mjs` compares exactly those two. A third copy,
versioned and compiled into two clients on their own release cadence, would be the one copy nothing
can check.

### Legacy DispatchCommand names a lane

A cockpit says "do docs polish on #79". `@rickylabs/routing` owns the table that turns that into a
model — including the fallback chain, the permitted effort escalations, and the rule that an
evaluator may not be the author. A client that could name a model could route around every one of
those, by accident, from a phone, with no reviewer.

This legacy command grants no model override authority. The current verified owner-native port
uses its own provenance and exact route while retaining admission and accounting. In both cases,
`accepted: true` means **admitted, not launched**. Native binding and observed execution establish
running; neither a polling interval nor an elapsed duration guarantees launch.

### Deltas carry whole values, and connecting is subscribing

`task.upserted` carries an entire task, not the fields that changed. A patch protocol needs every
patch, in order, applied to the state the sender assumed — so one dropped frame corrupts state
silently and stays corrupted. Whole values are idempotent and order-tolerant. The cost is bandwidth
on a LAN, which is the resource this system has most of.

`generation` increments per accepted connection, so the losing half of a race between an old
socket's last frames and a new socket's snapshot is identified by data rather than by timing. `seq`
is per-generation, starts at 0 with `hello`, and increments by exactly one; a gap means resync.

There is no subscribe frame — a client connects, gets `hello`, then a `snapshot`, then deltas. A
subscription filter that can change mid-stream quietly breaks the property the protocol rests on
("the snapshot plus every subsequent delta is the current state"), and the bug it produces is a
stale row no future event will ever correct. One repository's board is small enough that filtering
is a client-side concern.

## Retained connection recovery introduced in 0.4.0

The 0.4.0 release introduced connection recovery over 0.3.0; the compatibility protocol remains 1.
Packing or merging it is not publication or consumer adoption. The 0.x minor discloses changed
client behavior: `EventFold.bound` is optional for source compatibility, and old-shaped folds use
`bound ?? (generation !== null)`. New empty folds explicitly start unbound.

`generation` alone is a display value, not proof of a current connection. `foldFromSnapshot`
retains a cold HTTP board and its original timestamps with `bound: false`, `lastSeq: null` and
`needsResync: true`. HTTP answers are taken only outside live; answers racing a live stream are
discarded. Every connect and accepted live-to-non-live transition clears binding and sequence
immediately while retaining board and counters. A lower-generation hello can bind an unbound
current link after a host restart. Bound hello checks remain strictly increasing. Non-hello
frames before binding are discarded; abandoned-link messages never reach the fold, even counters.
Direct fold callers must supply that link fence themselves.

Use `boardStatus(cockpit): BoardStatus` for the derived `absent | retained | synchronized` query.
`absent` means `board(cockpit)` is null. Synchronization requires a present board, live loop,
non-null loop generation matching the bound fold, and no pending resync. Hello alone does not
restore it: a valid subsequent snapshot must land. The existing `cockpitStatus` glance line adds
`(stale)` while a board is retained and removes it after recovery. Here stale describes stream
synchronization, not source evidence age; an empty or partial board can be synchronized.

It says only that this connection's board is the one the currently bound stream last sent.
It is not completeness — that is RemoteSnapshot.complete and the anomalies beside it.
It is not evidence recency — generatedAt is when the board was produced, not when it was received.
It is not run execution: admitted is not running, and pending or unknown effects stay their own dimension.
It is not certification or capability — nothing about authority, approval or what a caller may do is expressed here.

A retained or synchronized board grants no display, persistence or command right. Backend authorization
and revocation remain separate; late HTTP answers do not restore revoked permission.
Revocation overrides retention. This package does not implement backend authorization or an
authorization epoch. It refreshes no observation timestamps and never turns unknown outcomes into
failed outcomes or automatically resends commands on recovery.

`resyncFrame` on an unbound fold returns generation 0, the existing no-generation sentinel.
Hubs never assign 0. A mismatched resync closes the link, so sending the unbound frame is a
transport fault, not a recovery request. Bound and legacy no-`bound` folds retain their former
generation/lastSeq behavior. Reconnect and await hello before requesting in-band repair.

## Reading a frame has three verdicts, not two

```ts
readServerEvent(value): { ok: true, event } | { ok: false, reason: "unreadable", detail }
                                            | { ok: false, reason: "unknown-kind", kind, generation, seq }
```

The third case is the one that matters. A frame with an unrecognised kind is almost always a server
that learned to report something this client predates. Calling that unreadable would hide a normal
condition behind an error *and* lose the `seq` — so every forward-compatible addition would look to
the fold exactly like a dropped frame, and trigger a resync that fetches the same unknown event
again. **A client must be able to count a frame it cannot understand.**

For the same reason the payload is deliberately not validated. A published contract that rejected a
payload carrying an unfamiliar field would make every additive server change a breaking one. The
envelope is what the fold's correctness rests on, so the envelope is what is checked.

## The three regimes

Capacity is not a scalar, so `RegimeStatus` is a discriminated union:

| regime | unit | how it fails |
| --- | --- | --- |
| `subscription` | % of a rolling window, per account | runs out, then refills on its own clock |
| `metered` | USD per token | runs out and stops |
| `capacity` | bytes of VRAM and RAM per host | does not stop — it thrashes, serving everything slowly |

The legacy `RegimeStatus` display permits an unread regime to carry `allow`, `observedAt: null`
and an explanation. That is display vocabulary, not proof of Orchid launch admission or a paid
provider budget. Strict current observation schemas preserve unavailable/unknown facts; Orchid
applies its actual physical checks and source-based accounting. Do not turn an absent meter into
a fabricated green reading or use another transport's quota source.

## Closed vocabularies and open ones

One rule decides: **close a union when an unknown value would make a client render something false;
leave it open when an unknown value is merely a new name to display.**

Closed — `ItemKind`, `TaskState`, `ProgressBucket`, `RunSource`, `RunOutcome`, `LivenessState`,
`LivenessEvidence`, `IssueEvidence`, `Regime`, `RegimeState`, `ApprovalVerdict`, `EventKind`,
`CommandName`, `CommandErrorCode`. Every one of these changes a number, a filter, or which branch of
a switch runs.

Open — phase names, anomaly kinds, lanes, harnesses, approval kinds. Each is a string plus a
`KNOWN_*` list for clients that want to special-case a familiar value. An anomaly kind the projector
learned last week is a sentence to display, and refusing to display it is how a fleet stalls waiting
on something nobody was shown.

