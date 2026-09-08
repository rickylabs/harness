# @rickylabs/governance

Tri-regime admission control: whether the system may spend, right now, on this.

**Status: stub.** Owned by **E5 · [#35](https://github.com/rickylabs/harness/issues/35)**. The only
export is `PACKAGE_NAME`. Nothing here reads a budget or refuses anything.

## What it will own

Reading the three regimes and turning them into a verdict. Not the vocabulary — that is already
published — but the part that costs: getting a real reading, and deciding.

There are two gates in this system and they are not the same gate.
[`coordinator`](../coordinator/README.md) decides *who may evaluate* — a rule about independence,
answerable offline from a roster. This package decides *whether the system may spend* — a rule about
capacity, answerable only by looking at the world. That is why they are separate packages: one is
pure and the other is not.

## Why there are three of them

Not a taxonomy — a consequence. The two seams plus the local models admit work on incomparable
grounds, so there is no one number to compare them on, and any package that produced one would be
inventing it. [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md) is where that split is
argued; this package is where it gets read.

## What already constrains it

[`contracts`](../contracts/README.md) ships the shape, because the cockpits render it:

- `REGIMES` is `subscription | metered | capacity` — a quota window, a token balance, a GPU.
  `RegimeStatus` is a discriminated union rather than three numbers, because those three have
  different units and fail in different ways; a client that only knows how to draw a percentage
  draws the one that has one and says so, instead of inventing a percentage for a GPU.
- `REGIME_STATES` is `allow | throttle | pause`.
- Every regime carries `observedAt`, an unread regime reports `allow` with `observedAt: null` and a
  note, and **no regime is ever omitted**. A green bar with no reading behind it is the most
  expensive kind of wrong, and a missing regime is indistinguishable from one that does not exist.

So the honest half of this package's job is already specified: whatever it cannot read, it must say
it could not read, rather than passing.

## Why it is empty

The decision E5 waited on is answered: the sandboxctl sidecar was ratified on
**[#257](https://github.com/rickylabs/harness/issues/257)**, and the channel
it names is what a live admission reading reaches through. The published
governance *read* boundary already ships through `telemetry` and `contracts`
(see the [telemetry README](../telemetry/README.md#published-governance-read-command));
this package — the part that decides whether the system may spend — remains a
stub until E5 implements it. Building it before the epic that owns it defines
the contract would mean building the readings twice.

---

Workspace conventions: [`packages/README.md`](../README.md).
