# @rickylabs/harness-contracts

The types the coordinator and its cockpits agree on: what work exists, what is running, what may be
spent, and what is waiting on a person.

```bash
npm install @rickylabs/harness-contracts
```

Owned by epic E8 · #38. See [`packages/README.md`](../README.md) for workspace conventions.

## Why this is the one published package

The consumers of this layer are separate products: the product backend that
adapts the Harness feed, and the native client it serves. A native client
cannot import a private workspace package any more than it can import this
repository — and under the locked three-layer architecture it does not import
this package at all: the backend is the one deployment that consumes the
published contracts directly and runs the fold, and the native client
consumes the backend-generated API/client package
([06 — The three layers](../../docs/concepts/06-the-three-layers.md) owns that
boundary). Publication is what makes the boundary a versioned artifact rather
than a workspace import, which is why it is the only package here that is not
`private: true`.

That is also why this package has **no dependencies**, workspace or otherwise. A `workspace:*` edge
to a private package makes it unpublishable, so where a shape here mirrors one in `board` or
`telemetry`, it is restated rather than imported. The duplication is the price of the boundary and
it is deliberate — the same trade `telemetry` already makes by not importing `board`.

## Scope: if a type only makes sense for one surface, it does not belong here

The test is not "could both use it" but **"do both mean the same thing by it"**. Column widths,
navigation stacks and shortcut tables are one surface's business.

The consequence worth stating out loud: **agent chat is deliberately absent.** It is real and it is
wanted, and a conversation is the one thing on this system that carries operator prose — the payload
this package is most careful about. It gets its own contract when someone has decided what its shape
is, not a placeholder here.

## Published, therefore no paths and no prompts leave

Everything here becomes a field a client logs, a crash reporter captures, and a cache keeps. So no
field in this contract carries a filesystem path or an agent prompt outward.

That is inherited, not re-decided: the telemetry record dropped its `title` and `cwd` for exactly
this reason, and its `origin` path is present internally and absent from its published projection.
`RUN_VIEW_FIELDS` is the same discipline — every published field listed by hand, so a server that
assembles a run by spreading its internal record can be caught by a key-set assertion instead of by
someone noticing a home directory on a phone.

The contract is therefore **asymmetric on purpose**. A prompt travels inward on
`DispatchCommand.prompt` and never travels back: no snapshot, no event and no outcome carries it. A
cockpit that wants to show what it just sent remembers what it sent.

## The four decisions

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
of a list that already exists twice — in `board` and in the labels `dsh-forge` stamps — and those two
drifted once, silently: every correctly labelled item read as "no status" and a freshly filled board
reported itself empty. `scripts/check-lifecycle.mjs` compares exactly those two. A third copy,
versioned and compiled into two clients on their own release cadence, would be the one copy nothing
can check.

### A dispatch names a lane, never a model

A cockpit says "do docs polish on #79". `@rickylabs/routing` owns the table that turns that into a
model — including the fallback chain, the permitted effort escalations, and the rule that an
evaluator may not be the author. A client that could name a model could route around every one of
those, by accident, from a phone, with no reviewer.

Two consequences: a routing change reaches every cockpit with no client release, and
`accepted: true` means **admitted, not launched** — the dispatcher polls on its own interval and the
agent starts about half a minute later. The launch arrives as a `run.upserted` event, which is the
only thing that means running.

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

## Connection recovery in the 0.4.0 candidate

This source prepares 0.4.0 over published 0.3.0; protocol remains 1 and no wire shape changes.
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

The governor **fails open**: it only ever refuses new admissions, never touches a run in flight, and
allows when it cannot read a meter. That is right, and it has one bad consequence on a screen —
"allowed" and "we could not check" look identical. So every regime carries `observedAt`, an unread
regime reports `allow` with `observedAt: null` and a note, and no regime is ever omitted. A green bar
with no reading behind it is the most expensive wrong thing to show someone deciding whether to
dispatch.

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

## Using it

```bash
pnpm --filter @rickylabs/harness-contracts test
```

```ts
import { commandPath, readServerEvent, MUX_PATH, type RemoteSnapshot } from "@rickylabs/harness-contracts";

const res = await fetch(commandPath("snapshot"), { method: "POST", body: "{}" });
const snapshot: RemoteSnapshot = await res.json();

socket.addEventListener("message", (e) => {
  const reading = readServerEvent(JSON.parse(e.data));
  if (reading.ok) apply(reading.event);
  else if (reading.reason === "unknown-kind") advanceSeq(reading.seq); // counted, not applied
});
```

## Two entry points

```ts
import { openCockpit, stepCockpit } from "@rickylabs/harness-contracts";        // root entry — backend-side fold
import { openHub, publish } from "@rickylabs/harness-contracts/server";         // the coordinator
```

The root entry carries the pure connection-and-fold bindings. Under the
three-layer architecture the deployment that imports them and runs the fold
is the product backend's Harness adapter — exactly one reducer owns a run
card there. A native client consumes the backend-generated API/client package
and never imports this package directly; these names remain the shipped API
for the backend-side consumer, not native adoption instructions.

`Hub` produces the frames `EventFold` consumes, so both halves live in one package — the property
that matters, that folding what the hub sent reproduces the board the hub holds, is only assertable
where both exist. But only the coordinator runs a hub, and a client bundle should not carry one. So
the hub is reachable **only** from `/server`, and nothing on the root entry imports it. That is not a
convention; `pnpm run check:publish` fails the build if `dist/index.js` ever names `server.js`.

## Versioning, and the window a deployed cockpit gets

The cockpits ship on a cadence this repository does not control. A phone build can sit on a device
for weeks after it is superseded, and an npm version is immutable — there is no revert. So the rules
here are stricter than semver alone.

**The protocol pins the major.** `PROTOCOL_VERSION` is the wire contract, and it is mirrored in the
manifest as `dsh.protocol`. Those two must agree, and `check:publish` fails the build when they do
not. The rule they enforce: **a `PROTOCOL_VERSION` bump is always a package major.** The converse
does not hold — removing an export or narrowing a type is a major with the protocol unchanged.

**While 0.x, the minor plays the role of the major.** Semver permits 0.x minors to break; this
package uses that permission and nothing more. A breaking change goes `0.1 → 0.2` and still gets the
full deprecation courtesy below. `1.0.0` is cut when the first cockpit reaches a device the owner
cannot redeploy at will — that is the event the version number exists to mark, not a maturity
judgement.

**The window.** A cockpit built against protocol *N* must keep working until its replacement has
actually rolled out. Today the hub serves exactly one protocol and answers anything else with
`protocol-mismatch`, which is correct for a single deployment and is *not* a window. So the rule is
written for the change that will need it: **the release that introduces protocol 2 must, in the same
change, teach the hub to accept protocol 1 on `hello` and serve it a protocol-1 view.** Introducing
the new protocol first and the tolerance afterwards is the ordering that bricks a deployed build,
and it is the one thing this section exists to forbid.

## The deprecation path

Written before the first breaking change, because a deprecation policy authored after one is a
description of what already happened.

1. **Add before removing.** The replacement lands as an optional field or a new export, and the old
   one keeps being populated. This is a minor. Both cockpits keep compiling untouched.
2. **Say so in the types.** The superseded export gets a `@deprecated` JSDoc line naming its
   replacement in the *same* release that adds it. This is the notice that actually reaches people:
   it shows up struck through in both UIs' editors on the next `pnpm update`, without anyone reading
   a changelog.
3. **Let a release pass.** At least one published minor carries both the old and the new. A
   deprecation and its removal in the same version is a removal with a comment attached.
4. **Then remove, in a major.** With the protocol rule above, and the window if the wire moved.
5. **Mark the old range on npm.** `npm deprecate '@rickylabs/harness-contracts@<1.0.0'` with a
   message naming the successor, so an install of the superseded range says what to do next.
6. **Never unpublish, never reuse a version.** A version that shipped, shipped. If it was wrong,
   the answer is a new version and a deprecation notice on the old one.

## Releasing

```bash
pnpm run check:publish     # what the release pipeline asserts, runnable locally
```

Releases are cut by tag, never by merge. First prepare a new, unpublished manifest
version, complete review and CI, and merge its release preparation. The owner then
authorizes publication of that exact source. Never recreate an existing release
tag or reuse a published version.

From the authorized release checkout, derive the tag from its manifest
(instructions, not an execution receipt):

```bash
set -e
release_version=$(node -p "JSON.parse(require('node:fs').readFileSync('packages/contracts/package.json', 'utf8')).version")
git tag -a "harness-contracts-v${release_version}" -m "harness-contracts ${release_version}"
git push origin "harness-contracts-v${release_version}"
```

That tag triggers [`release-contracts.yml`](../../.github/workflows/release-contracts.yml), which
trusts the tag with nothing. It re-runs the whole workspace against the tagged tree — a green CI run
on the merge commit does not license a publish from a tag, because the tag may not be that commit —
then checks that the commit is an ancestor of `main`, so a tag pushed to a branch that never opened a
pull request cannot ship, and that the tag and the manifest name the same version. Only then does it
publish, with npm provenance: signed with an OIDC token minted per run, so the tarball is traceable
to that workflow at that commit rather than to whoever held a token.

**Published releases.** The first publication no longer awaits anything:
0.2.0 shipped as the owner release of the reviewed governance read boundary
([#279](https://github.com/rickylabs/harness/issues/279)), and 0.3.0 —
protocol 1, adding the repository run observation — is published at source
`97e9d058`. The owner's public receipt records the registry artifacts and the
publishing workflow run:
[issue #39 comment](https://github.com/rickylabs/harness/issues/39#issuecomment-5582710963).
To exercise the pipeline without releasing, dispatch it manually — the manual
path defaults to a dry run and prints the tarball contents instead of
uploading them.

`check:publish` runs as part of `pnpm run build`, so the things that have no undo are caught
in the ordinary loop: the manifest name against the compiled `PACKAGE_NAME`, the protocol against
`dsh.protocol`, the export map against what the build actually emitted, the hub against the root
entry, and the tarball against itself — no test artefacts, and no source map naming a file the
tarball omits. That last one is why `src/` is published: the declaration maps point there, and a map
that dangles is worse than no map at all.

## What is not here yet

- Agent chat — see the scope section above for why its absence is a decision rather than a backlog
  item.
- `run.removed`. The union has `task.removed` and no counterpart for runs, so a run that vanishes
  from the coordinator's view can only be communicated by a snapshot. That is a protocol gap, not an
  export gap: closing it is a `PROTOCOL_VERSION` bump, and therefore a major here.

## Coordinator storage port

[`state-store.ts`](src/state-store.ts) owns the durable coordinator store interfaces, full intent
identity, terminal effect statuses and named refusals. The coordinator imports these types; this
published package still has no dependency on private coordinator code. Constructors, validators,
the local filesystem implementation and the memory fake live in `coordinator`.

This is an internal storage boundary, not a cockpit event or mux projection. Owner PID and opaque
start/host identity are local ownership metadata and are not added to transport frames or snapshots.
The contract carries no storage directory path or effect prompt.

`SessionPending` is distinct from terminal `EffectStatus`. Only pending can be supplied to receipt
settlement. `unknown` is terminal and cannot become `unsent`; the latter requires a branded proof
constructed from a validated negative receipt. Callers await durable intent success before attempting
an effect and durable receipt success before acknowledging it. No result grants retry authority.

## Governance read document (0.2.0)

`GovernanceReadSnapshot` is a standalone schema-1, protocol-1 document produced by
`dsh-telemetry governance --observations-from <absolute-descriptor-path>`. Import
`readGovernanceSnapshot` and the document/coverage/admission types from the package root:

```ts
import { readGovernanceSnapshot } from "@rickylabs/harness-contracts";

const reading = readGovernanceSnapshot(JSON.parse(stdout));
if (reading.ok) {
  const { availability, complete, sources, state, admissions } = reading.snapshot;
  // Inspect typed coverage. Notes are informational; never parse them for status.
}
```

The command emits one JSON object on exits 0 (complete) and 3 (incomplete or unavailable).
Exit 1 emits no document; exit 2 is invalid usage/input configuration. Check the exit status
and decode stdout before using evidence. The decoder performs no I/O and reads no clock.
`evaluatedAt` records the producer's evaluation clock; consumers judging freshness later must
compare their own clock with `validUntil`. Freshness is not completeness.

`complete` means all configured requested evidence was successfully read and valid, preserving
collector distinctions. Failed/discarded meters, failed admissions and dropped/conflicting
admissions force incomplete. Unconfigured admissions alone do not make successful meters
incomplete. An observed empty log reports `read`, `records:0`, `empty:true`, with collection
provenance/time and no invented decision timestamp; the current collector still marks that
result incomplete. This describes only the configured log scope. `approvals: not-observed`
and empty `state.pending` never claim an approval census.

Every read meter retains its source `observedAt`, `validUntil`, freshness and safe reader/scope
provenance. Admission coverage has a separate `collectedAt`; each recorded refusal retains its
original decision interval and provenance. Admission is not execution evidence. Producer-selected
provenance identifies a reader/scope, not an account, a path or cryptographic trust. An unavailable
union carries null state/envelope fields and no admission payload; coverage may still report read
sources if the overall envelope was invalid. For available envelopes, non-read sources have empty,
noted regimes, read sources have nonempty leaves, and the envelope expires at the earliest retained
source/admission expiry.

The pure, dependency-free decoder is specified for JSON-derived values. It rejects unknown fields,
unsafe code identifiers, invalid calendars, nonfinite or inconsistent numbers, inconsistent clocks,
wrong prototypes, accessor properties and sparse arrays. Output consists of independently owned
readonly typed data. It accepts no defaults for missing schema/protocol metadata. Diagnostics name
schema-owned fields and never echo unknown keys or values. Limits are 1000 admissions, 256 leaves
per array, 64 notes per list, 128-character identifiers, 256-character labels and 4096-character
notes. The producer applies these limits before serialization and refuses over-cap evidence without
truncation or invented drop reasons. Transport byte limits remain the caller's concern.

Portable JavaScript cannot inspect arbitrary Proxies without executing traps. Inspection throws
are contained, and ordinary getters are not invoked; no trap-free, side-effect-free or bounded-time
claim is made for hostile Proxy traps that themselves loop or allocate. Schema traversal is bounded
for JSON input. Accessors may also have run before the decoder receives a value.

This decoder released in 0.2.0
([#279](https://github.com/rickylabs/harness/issues/279)) and ships unchanged
in 0.3.0. It was additive: no exports were removed and no wire behavior
changed — `PROTOCOL_VERSION` and `dsh.protocol` remain 1. The document is not
a `RemoteSnapshot`, is not folded, is not served by the hub, and does not
implement reconnect freshness (#265).

The producer half — the CLI that collects configured sources and emits the
document — is built from this repository's source and documented in the
[telemetry README](../telemetry/README.md#published-governance-read-command).
The consumer half decodes with the decoder published to npm, so a consumer
pins a released decoder version instead of rebuilding one from source.
Source merge, tests and `npm pack` are not publication; publication is the
owner's tag-triggered release (see [Releasing](#releasing)). A release
implies no downstream API/client compatibility, no upgrade receipt and no
live #205/#87 acceptance; real-source and live acceptance remain separate
gates.

## Standalone repository run observation (0.3.0, protocol 1)

`readRepositoryRunObservation(unknown)` validates a `RepositoryRunObservation` independently
of snapshots, folds, hubs and transport. It returns `{ok:true, observation}` with owned nested
data, `{ok:false, reason:"invalid"}`, or `{ok:false, reason:"unsupported-schema", schema, protocol}`.
The root export and declarations require no dependencies, Node APIs or I/O. Unknown keys,
accessors, wrong unions, unsafe counters and noncanonical/impossible dates are rejected. Dates
are UTC ISO strings with exactly three fractional digits. No invalid input is echoed.

The exact root is `{schema:1, protocol:1, binding, capturedAt, coverage, verification, run}`.
Binding is `{namespace,id,revision,sourceScopeId,repo:{owner,name}}`. Each identifier, including
`run.nativeId`, is case-sensitive, 1..128 characters and matches
`^[A-Za-z0-9][A-Za-z0-9._:-]*$`. Identifiers are equality-only; no ordering is implied.
Owner is 1..39 ASCII alphanumerics/hyphens with alphanumeric ends. Repository name is 1..100
ASCII alphanumerics/dot/underscore/hyphen, excluding `.` and `..`. These are encoding checks,
not proof that a repository exists.

Coverage is exactly one of:

- `{status:"read",reason:null}`: nonnull run and verification.
- `{status:"incomplete",reason}`: `malformed-record`, `unknown-envelope`, `source-changed`,
  `binding-changed`, `invalid-timestamp` or `invalid-evidence`; run and verification null.
- `{status:"unavailable",reason}`: `source-missing`, `source-unreadable`, `source-too-large`,
  `scope-unverified`, `scope-mismatch`, `identity-missing` or `identity-mismatch`; both null.

Verification is `{basis:"enrollment-and-local-worktree",verifiedAt}` and requires
`verifiedAt <= capturedAt`. It records local validation completion. Enrollment asserts the
logical repository association; local Git identity and native cwd corroborate the selected
worktree. This is neither cryptographic provenance nor durable historical membership.

A run has `source:"codex"`, `nativeId`, `firstObservedAt`, `lastObservedAt`, `identity`, `usage`,
`execution` and `relationships`. Identity contains independently timestamped nullable provider,
model and effort leaves `{value,observedAt}` (1..200 ASCII letters/digits/underscore/dot/colon/
slash/hyphen). Usage is null or `{observedAt,inputTokens?,outputTokens?,reasoningTokens?,cacheReadTokens?}`
with at least one nonnegative safe integer count. These are cumulative source totals, never
summed, and missing fields remain absent. No cost or quota is supported. Execution is
`{status:"unknown",observedAt:null}` or a timestamped `source-reported-complete` /
`source-reported-error`. A later native task start clears terminal evidence. Relationships
`parent`, `agent`, `task`, `messages`, `certification` are all exactly `"unavailable"`.
All source evidence timestamps lie within the first/last envelope interval. Collection and
verification clocks do not refresh evidence; source clock skew past collection is permitted.

The native identity tuple is `(namespace,sourceScopeId,source,nativeId)`, never bare nativeId.
The enrollment authority allocates opaque namespace/binding/revision/store identifiers; none
are derived from paths or prose. It must enforce uniqueness and never reuse a store identifier
for a different store. Binding id remains stable for the association. Allocate a never-reused
revision when the repository, selected run, store, source root/file, worktree, expected Git common
directory or binding scope changes. File growth alone does not rotate the revision.

The backend owns enrollment, authentication, authorization and revocation. Before persistence
and protected delivery it must atomically compare current namespace/id/revision/sourceScopeId.
A delayed observation for A cannot be relabeled as B. Prior authorized evidence may remain stale
under its original binding/times per backend policy, but unavailable reads never extend grants,
refresh native evidence or mint binding ownership. Revocation/expiry overrides retention. This
package does not implement those backend fences or an offline revocation guarantee.

This observes one selected native file, not a repository census, decision certification or
liveness signal. Whole-run withholding includes malformed tails. The reader detects observed
before/after changes in trusted local storage, not hostile ABA changes or an atomic filesystem
snapshot. This document released in 0.3.0 (receipt under
[Releasing](#releasing)); packed synthetic gates do not establish real-source or downstream
API/client compatibility — real-source acceptance remains a separately authorized coordinator gate.
