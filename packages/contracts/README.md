# @rickylabs/harness-contracts

The types the coordinator and its cockpits agree on: what work exists, what is running, what may be
spent, and what is waiting on a person.

```bash
npm install @rickylabs/harness-contracts
```

Owned by epic E8 · #38. See [`packages/README.md`](../README.md) for workspace conventions.

## Why this is the one published package

Both user interfaces live outside this repository — a phone-sized cockpit for glancing and
approving, and a full web workhorse with no complexity limit. Neither can import a private workspace
package, so the only way they can share a definition is for that definition to be on npm.

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
import { openCockpit, stepCockpit } from "@rickylabs/harness-contracts";        // both cockpits
import { openHub, publish } from "@rickylabs/harness-contracts/server";         // the coordinator
```

`Hub` produces the frames `EventFold` consumes, so both halves live in one package — the property
that matters, that folding what the hub sent reproduces the board the hub holds, is only assertable
where both exist. But only the coordinator runs a hub, and a phone bundle should not carry one. So
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

Releases are cut by tag, never by merge:

```bash
git tag harness-contracts-v0.1.0 && git push origin harness-contracts-v0.1.0
```

That tag triggers [`release-contracts.yml`](../../.github/workflows/release-contracts.yml), which
trusts the tag with nothing. It re-runs the whole workspace against the tagged tree — a green CI run
on the merge commit does not license a publish from a tag, because the tag may not be that commit —
then checks that the commit is an ancestor of `main`, so a tag pushed to a branch that never opened a
pull request cannot ship, and that the tag and the manifest name the same version. Only then does it
publish, with npm provenance: signed with an OIDC token minted per run, so the tarball is traceable
to that workflow at that commit rather than to whoever held a token.

**One thing still gates the first publish, and only the owner can supply it: the tag.** The
`NPM_TOKEN` repository secret was added on 2026-09-06; until a `harness-contracts-v*` tag exists the
workflow can be read and reviewed but cannot publish. To exercise it without releasing, dispatch it
manually — the manual path defaults to a dry run and prints the tarball contents instead of
uploading them.

`check:publish` runs as the last step of `pnpm run build`, so the things that have no undo are caught
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
