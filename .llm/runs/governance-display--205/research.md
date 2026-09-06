# Governance display — #205 research

## Summary

The display half of #205 can proceed without choosing a production host channel. The published
contracts already own the three incomparable governance regimes, per-account subscription windows,
provider spend, host capacity, and `allow | throttle | pause`. Telemetry already builds a fresh
snapshot on every `status` or `tree` invocation and renders governance before work. What is missing is
a typed display input that joins those contracts to telemetry, carries safe provenance and an explicit
freshness bound, and attaches the existing refused-dispatch shape to an item number. That boundary can
be exercised entirely with synthetic JSON fixtures. The production adapter remains blocked on #62.

This is a display/fixture finding only. Passing its future gates will not satisfy #87's live-read
criterion, will not satisfy #205's ADR/integration criterion, and must not close either issue before
the full exact-head evaluation required by #205.

Source baseline inspected: `9d800b54e447a600d8afab2ff90d07455b13a9c7`.

## Scope and authority

- #205 explicitly separates display/fixture work from live host wiring, requires synthetic
  observations for tests, and leaves the latter behind ADR #62
  ([issue #205](https://github.com/rickylabs/harness/issues/205)).
- #62 remains an unresolved owner decision between an SSH executor and a privileged sidecar. Its
  owner follow-up says the fixture-backed telemetry view can proceed while the real N5 adapter waits
  ([issue #62](https://github.com/rickylabs/harness/issues/62),
  [owner follow-up](https://github.com/rickylabs/harness/issues/62#issuecomment-5562417421)).
- #87's independent exact-head evaluation found account-aware quota, capacity, and admission reasons
  absent from the integrated display and required #205 as a fix slice
  ([#87 evaluation](https://github.com/rickylabs/harness/issues/87#issuecomment-5562409874)).
- Repository doctrine forbids product mutation until a separately authored adversarial review and
  plan evaluation pass (`doctrine/WORKFLOW.md:59-85`; `doctrine/PRINCIPLES.md:21-29`). This run
  therefore stops at a plan for independent review.

## Repository findings

### The ratified vocabulary is already sufficient for the values

`RegimeStatus` is a discriminated union over subscription accounts, metered providers, and capacity
hosts. The nested types carry the required units and nullable readings: per-account windows and
timestamps, dollars and optional ceilings, and used/total VRAM and RAM bytes
(`packages/contracts/src/governance.ts:29-37`, `packages/contracts/src/governance.ts:58-93`,
`packages/contracts/src/governance.ts:95-136`). `RegimeState` is already the closed
`allow | throttle | pause` vocabulary (`packages/contracts/src/governance.ts:39-47`). A telemetry
display should consume these identities rather than create parallel quota, spend, or capacity types.

The economic regimes must remain separate. Subscription quota is a clock-refilled seat window;
metered spend is a non-refilling token balance; local capacity is instantaneous hardware headroom.
Adding them into one scalar destroys their failure meaning (`docs/concepts/02-the-two-seams.md:7-15`,
`docs/concepts/02-the-two-seams.md:41-56`).

`GovernanceState` is also already the published cockpit payload, and `governance.changed` replaces
that whole value in the event fold (`packages/contracts/src/governance.ts:198-209`,
`packages/contracts/src/events.ts:89-96`, `packages/contracts/src/fold.ts:468-489`). The fixture
boundary must not create a second published cockpit protocol.

### Two display facts need a telemetry-owned envelope

The contracts document that unread governance must be visible rather than omitted. The source types
put `observedAt` on accounts, providers, and hosts, but `RegimeStatus` itself has no timestamp. An
empty unread regime can therefore carry a note but cannot carry the documented top-level
`observedAt: null` (`packages/contracts/src/governance.ts:16-26`,
`packages/contracts/src/governance.ts:118-136`). This is a source/documentation mismatch. Changing the
ratified wire contract is outside this display slice; an observation envelope needs its own
`observedAt` and validity bound so the renderer can distinguish fresh, stale, and unavailable input
without guessing a global age threshold.

The existing refused `DispatchOutcome` has the actual machine reason and human detail, but its false
member has no item number (`packages/contracts/src/routes.ts:85-113`). The display boundary must join
that existing false member to an item identity and observation metadata. It must not infer a refusal
from the absence of a run or replace the actual detail with telemetry's generic log pointer.

The proposed envelope is telemetry input, not governance behavior:

    type RefusedDispatch = Extract<DispatchOutcome, { readonly accepted: false }>;

    interface GovernanceObservation {
      readonly observedAt: string;
      readonly validUntil: string;
      readonly provenance: string; // bounded safe identifier, never a path or URL
      readonly state: GovernanceState;
      readonly admissions: readonly AdmissionObservation[];
    }

    interface AdmissionItemRef {
      readonly number: number;
    }

    interface AdmissionObservation {
      readonly item: AdmissionItemRef;
      readonly regime: Regime;
      readonly state: "throttle" | "pause";
      readonly observedAt: string;
      readonly validUntil: string;
      readonly provenance: string;
      readonly outcome: RefusedDispatch;
    }

An allowed regime remains visible through `GovernanceState`; only a real refusal becomes an
item-scoped admission row. This avoids inventing an accepted dispatch result when no dispatch was
attempted. Each envelope and admission carries its own `validUntil`, so an old refusal cannot borrow
freshness from a newer capacity scan. At a fixed `--now`, compare parsed epoch milliseconds:
`now > validUntil` is stale, while any observation timestamp later than `now` makes the input
unavailable rather than maximally fresh. The future live producer decides each validity interval; the
display does not silently choose one.

### Telemetry already has the right pure/display seams

Telemetry's model promises that clocks, files, and environment values are read at adapters and
passed into pure snapshot functions (`packages/telemetry/src/model.ts:1-12`). `buildSnapshot` is a
pure function of explicit inputs, and currently reduces transcript quota to the latest reading per
source and limit (`packages/telemetry/src/snapshot.ts:1-12`,
`packages/telemetry/src/snapshot.ts:125-142`). The observation envelope belongs beside that explicit
snapshot input, not inside the governance package.

`status` and `tree` already rebuild the view on every invocation, after rereading disk, and derive
both text and JSON from the same snapshot (`packages/telemetry/src/cli.ts:406-428`,
`packages/telemetry/src/cli.ts:485-512`). A `--observations <path>` adapter read in that same path is
enough to prove that replacing a synthetic file changes the next display without an agent or a
persisted time-sliding value.

Both text views already put governance before progress, but they render only legacy transcript
quota and collapse missing quota to one sentence (`packages/telemetry/src/render.ts:143-169`,
`packages/telemetry/src/render.ts:290-317`). The new renderer must show the three regimes and any
item-scoped refusal in this leading block. Existing transcript quota can remain as fallback evidence
only when no typed observation is supplied; it must be labelled separately so it cannot masquerade
as the account-aware governance snapshot.

### JSON is a public allowlisted surface

Telemetry treats `--json` as a published surface and projects every field explicitly so a future
local path cannot escape by accident (`packages/telemetry/src/public.ts:1-20`). Its snapshot and tree
envelopes currently expose only legacy quota (`packages/telemetry/src/public.ts:87-96`,
`packages/telemetry/src/public.ts:176-184`). The governance observation needs an explicit public
projection in both envelopes; it must never expose a fixture path, home path, credential, environment
value, or raw production locator.

The ratified governance contract deliberately includes free producer prose (`note`, `notes`, approval
`summary`, and refused-dispatch `reason`/`detail`) (`packages/contracts/src/governance.ts:118-136`,
`packages/contracts/src/governance.ts:157-178`; `packages/contracts/src/routes.ts:105-113`). A display
cannot truthfully content-sanitize that prose without changing its meaning. The public projection must
enumerate it, and the producer inherits an explicit obligation to supply public-safe prose. The file
path and loader errors remain adapter-owned and are never projected verbatim.

The CLI currently accepts explicit board-item input, records parsing failures as notes, and marks a
requested unreadable file incomplete (`packages/telemetry/src/cli.ts:222-246`). The observation-file
adapter should follow this proven boundary: absent `--observations` is explicit unavailable state;
an explicitly requested unreadable or invalid file sets `complete: false` and exit 3. Existing exit 3
already means that the picture is incomplete (`packages/telemetry/src/cli.ts:57-70`).

### The governance package must stay empty in this slice

The governance package is a declared stub whose sole export is `PACKAGE_NAME`; its README assigns it
the future job of real readings and admission decisions and names #62 as the blocker
(`packages/governance/src/index.ts:1-12`, `packages/governance/README.md:26-48`). Display parsing,
fixture loading, projection, and rendering therefore belong to telemetry. No code in this slice may
read a budget, query a host, or refuse work.

## Prior-art findings

EIS-Chat's accepted RFC 0004 places stable value contracts and ports inward, concrete technologies
in adapters, and presentation in the dashboard. Plugin/host composition may connect those pieces but
must not acquire business rules (`/home/agent/projects/eis-chat/docs/rfcs/0004-modular-netscript-workspace.md:33-61`).
It also requires in-memory conformance adapters and contract tests for extracted features
(`/home/agent/projects/eis-chat/docs/rfcs/0004-modular-netscript-workspace.md:123-138`). Applied here,
the telemetry observation parser is an input adapter and synthetic fixtures exercise the display;
the E5 governor remains the future producer.

NetScript's observability documentation separates emission, transport, and viewing, and exposes a
typed read-side query port so tests and agents can verify telemetry without eyeballing a dashboard
(`/home/agent/projects/netscript/repo/docs/site/observability/index.md:7-15`,
`/home/agent/projects/netscript/repo/docs/site/observability/index.md:40-46`,
`/home/agent/projects/netscript/repo/docs/site/observability/telemetry.md:121-127`). Its in-memory span
recorder captures plain immutable snapshots without a live provider specifically for deterministic
tests (`/home/agent/projects/netscript/repo/packages/telemetry/src/testing/in-memory-span-recorder.ts:1-9`,
`/home/agent/projects/netscript/repo/packages/telemetry/src/testing/in-memory-span-recorder.ts:170-178`).
The transferable pattern is the typed, provider-neutral read boundary plus fixtures; OpenTelemetry
transport itself is not needed for this display slice.

## Constraints carried into the plan

1. Import or derive the existing `GovernanceState`, `Regime`, and refused `DispatchOutcome` types;
   do not duplicate their value shapes.
2. Keep the envelope local to `@rickylabs/telemetry`; it is not a new
   `@rickylabs/harness-contracts` wire version.
3. Parse fixture JSON from `unknown` at the file edge; require exactly one of each regime, finite
   non-negative measurements with used values no greater than totals, every `GovernanceState` member,
   valid ISO timestamps, independent validity intervals, positive admission item references, and safe
   bounded provenance identifiers. Compare times as epoch milliseconds; a future observation is
   unavailable, and a null leaf timestamp means “never read.”
4. Treat absent, invalid, unreadable, and stale observations explicitly. Never coerce null/missing
   measurements to zero and never render unknown input as healthy/allow.
5. Render the same governance block before progress in `status` and `tree`; publish the same
   allowlisted observation in both JSON envelopes.
6. Use only synthetic observations under the telemetry test surface. Do not read real homes,
   credentials, environment files, host telemetry, or live N5 state.
7. Do not modify `packages/governance`, choose SSH versus sidecar, or add a live adapter. #62 remains
   the activation gate.
8. Require independent plan review before implementation and an independent exact-head evaluation
   after the full #205 implementation. This display half alone cannot close #87 or #205.
9. Add `@rickylabs/harness-contracts: workspace:*` as an explicit telemetry dependency and
   `../contracts` as its TypeScript project reference. This coupling is deliberate: governance value
   identity is ratified and published, unlike telemetry's structural join to the board projection
   (`packages/telemetry/src/model.ts:157-169`; `packages/dsh-app/package.json:50-64`;
   `packages/dsh-app/tsconfig.json:10-16`).
