# Governance display — #205 plan

> **AMENDED AFTER `PASS AFTER NARROW FIXES` — DISPLAY/FIXTURE HALF ONLY.** The independent review is
> disposed in `disposition.md`; implementation remains paused until the parent confirms the corrected
> gate. Even after implementation, this half does not close #87 or #205; live adapter activation
> remains gated by #62 and the full issue requires an independent exact-head evaluation.

## Summary

Add a telemetry-owned, typed governance observation file boundary and use it in both `status` and
`tree`. The envelope reuses `GovernanceState`, `Regime`, and the refused member of
`DispatchOutcome`, while adding only the display facts those contracts do not carry: a safe source
identifier, an explicit validity interval, and the item number for a refusal. Text will show
per-account quota, provider spend, local RAM/VRAM headroom, and actual throttle/pause reasons before
progress. JSON will expose the same data through an explicit allowlist. Synthetic fixtures will pin
fresh, stale, unavailable, malformed, unknown-value, refresh, ordering, and privacy behavior.

No code will be added to `packages/governance`; no host is contacted; no production channel is
selected. The later producer can write the same observation shape only after #62 is accepted.

## Mutation surface for the later implementation

Allowed:

- `packages/telemetry/src/observations.ts` and `observations.test.ts` — local envelope, parser,
  normalization, and fixture helper.
- `packages/telemetry/src/model.ts`, `snapshot.ts`, `tree.ts`, `render.ts`, `public.ts`, `cli.ts`,
  `index.ts` and their existing tests — carry, render, project, and load the observation.
- `packages/telemetry/testdata/governance/*.json` — static synthetic inputs only.
- `packages/telemetry/README.md`, `docs/reference/cli/dsh-telemetry.md` — CLI and output contract.
- `packages/telemetry/package.json`, `packages/telemetry/tsconfig.json`, and `pnpm-lock.yaml` — add the
  required `@rickylabs/harness-contracts: workspace:*` dependency and `../contracts` project
  reference.
- After rebasing the separately owned #204 change only: its exact strict `PublicTree` consumer and
  focused test in `packages/dsh-app`, if required to accept telemetry's new public governance member.
  Extend that owner surface from telemetry's exported public type; do not create a second governance
  schema in dsh-app.

Forbidden:

- `packages/governance/**` runtime behavior.
- Production host adapters, SSH, sidecars, `sandboxctl`, workflows, credentials, `.env`, auth files,
  or any real home/host telemetry.
- Contract protocol changes, sibling-repository changes, GitHub mutations, and issue closure.

## Decisions

### D1 — One telemetry-owned observation envelope, composed from ratified contracts

Define `GovernanceObservation` in telemetry with `observedAt`, `validUntil`, `provenance`,
`state: GovernanceState`, and item-scoped `admissions`. Define the admission item reference as the
minimal structural `{ readonly number: number }`; the snapshot joins it to the current board item by
number rather than accepting duplicate title/state prose. Define each admission with that `item`,
`regime`, `state: "throttle" | "pause"`, its own `observedAt`, `validUntil`, provenance, and
`outcome: Extract<DispatchOutcome, { accepted: false }>`.

Rationale: the ratified contracts already define values and refusal language, but the false outcome
does not identify an item and the regime union has no top-level freshness field
(`packages/contracts/src/routes.ts:96-113`; `packages/contracts/src/governance.ts:118-136`). The
envelope supplies display metadata without changing the cockpit protocol.

Rejected: a second telemetry-owned quota/spend/capacity vocabulary. It would diverge from the
published `GovernanceState` consumed by cockpits (`packages/contracts/src/snapshot.ts:54-69`).

### D2 — `validUntil` supplies freshness; telemetry chooses no global stale duration

Parse `now`, `observedAt`, and `validUntil` to epoch milliseconds before every comparison; never
compare ISO strings lexically. At explicit `now`, classify an envelope as fresh when
`observedAt <= now <= validUntil` and stale when `now > validUntil`. An envelope `observedAt` later
than `now`, an invalid timestamp, or `validUntil < observedAt` makes the whole input unavailable.
Always print age and provenance. Stale values may remain visible for diagnosis but carry a prominent
`STALE` marker; their regime state must not be styled or worded as current health.

Each admission has an independent validity interval and uses the same epoch rule. A stale admission
is marked independently even when the envelope is fresh; a future-dated or reversed admission
interval makes the input unavailable. This avoids inventing a universal maximum admission age and
prevents an old pause from borrowing freshness from a newer capacity scan.

Rationale: telemetry already takes `now` explicitly for reproducible ages
(`packages/telemetry/src/render.ts:143-149`; `packages/telemetry/src/cli.ts:196-200`). A hard-coded age
threshold would be an unratified production policy. The future producer knows the sampling contract
and can set the bound.

Rejected: silently treating any parseable timestamp as fresh, or selecting a fixed number of minutes
inside the renderer. Both can present old host state as current.

### D3 — `--observations <path>` is the fixture/live-adapter handoff

Add the option to `tree` and `status` only. Read and parse it on every invocation before snapshot
construction. Do not copy it into the observability log or any repository state.

- No flag: emit an explicit `governance observations unavailable: no --observations supplied`; keep
  legacy transcript quota visibly labelled as transcript evidence if present.
- Requested file valid: use its typed observation as the authoritative governance block.
- Requested file unreadable or invalid: emit an unavailable governance block, add a bounded parse
  note, set JSON `complete: false`, and exit 3.
- `runs`, `why`, `record`, and `where` remain unchanged.

Rationale: `status` and `tree` already rebuild the view from disk each time
(`packages/telemetry/src/cli.ts:406-428`, `packages/telemetry/src/cli.ts:485-512`), and `--items`
establishes the repository's explicit-file parsing/error pattern (`packages/telemetry/src/cli.ts:222-246`).

Rejected: embedding observations in source, writing them to the telemetry log during a read, or
polling a host. Those approaches commit time-sliding facts, make a read mutate state, or cross #62.

### D4 — Validate at the file edge and normalize before rendering

Parse JSON as `unknown`. Accept one object only and require:

- valid ISO envelope and admission `observedAt`/`validUntil`, compared as epoch milliseconds, with
  each bound not before its observation and no observation later than explicit `now`;
- short provenance identifiers matching a conservative identifier grammar (letters, digits, `.`,
  `_`, `:`, `-`; no slash, whitespace, URL, or path syntax);
- exactly one `subscription`, one `metered`, and one `capacity` member;
- every nested regime field, with bounded non-empty account/seam/provider/host/window labels, valid
  closed regime/state names, boolean `binding`, valid nullable `resetsAt`, finite non-negative
  dollar/byte/window values, used percentages in `[0,100]`, paired RAM/VRAM `used <= total`, and
  nullable readings preserved as null;
- every other `GovernanceState` member: valid `generatedAt` not later than envelope `observedAt`,
  bounded string-array `notes`, and a `pending` array whose ids are unique and whose complete
  `PendingApproval` fields (`id`, `kind`, `summary`, nullable positive `item`, nullable `runId`,
  nullable valid `regime`, `requestedAt`, and nullable `expiresAt`) are validated without defaults;
  `requestedAt` may not exceed the envelope observation and `expiresAt`, when present, may not precede
  it;
- every account/provider/host leaf `observedAt` is either null or a valid time no later than the
  envelope observation; null means `never read` and never means fresh/healthy;
- unique account/seam, provider, host, and item/refusal identities within their scopes;
- admission state only `throttle | pause`, a positive `item.number`, and `accepted: false` with non-empty
  bounded `reason` and `detail`.

Sort accounts by seam/account, windows by binding then label, providers by provider, hosts by host,
admissions by item number/regime/state/provenance, governance and loader-appended notes by code-unit
order, and pending approvals by id. Snapshot bytes must be independent of fixture order.

Rationale: telemetry already validates board JSON where `unknown` crosses the file boundary
(`packages/telemetry/src/model.ts:163-169`), and its snapshot determinism excludes host collation and
input order (`packages/telemetry/src/snapshot.ts:1-12`).

Rejected: a type assertion over `JSON.parse`, or permissive dropping of malformed members. Either can
turn an incomplete regime set into apparent health.

### D5 — One governance renderer shared by `status` and `tree`

Replace the duplicated quota-only blocks with `renderGovernance(observation, legacyQuota, now)` and
call it before progress in both views.

For a fresh observation, render:

- subscription: each `seam/account`, state, binding window first, usage/reset, observation age;
- metered: each provider, state, `$spent / $ceiling` or `ceiling unknown`, window, age;
- capacity: each host, state, used/total and computed headroom for VRAM and RAM, age; if either operand
  is null, show `unknown`, never `0 B` or `100% free`;
- admissions: `#item.number`, throttle/pause, exact `outcome.reason`, human `outcome.detail`, each
  admission's independent freshness/age and provenance, immediately above work/progress.

For stale input, prepend `STALE as of ...`; for unavailable input, print `UNKNOWN/UNAVAILABLE` and
the bounded reason. Derive each account/provider/host age from that leaf's `observedAt`; render null
as `never read`. Display regime notes beside their regime. Do not convert `state: allow` with
missing/null or never-read readings into a green/healthy sentence.

Rationale: the acceptance question is why work is not running, and both current renderers already put
governance first (`packages/telemetry/src/render.ts:149-169`,
`packages/telemetry/src/render.ts:290-317`). The contracts require incomparable units to retain their
own renderers (`packages/contracts/src/governance.ts:29-37`).

Rejected: a footer, a single capacity score, or only a link to dispatcher logs.

### D6 — Publish the same allowlisted observation in status and tree JSON

Add an explicit `governance` member to `PublicSnapshot` and `PublicTree`; project field by field.
Its enumerated shape is: `availability`, nullable envelope `observedAt`/`validUntil`/`provenance`,
nullable `state`, `admissions`, and nullable bounded `unavailableReason`. When state is present,
explicitly project `generatedAt`, all three complete regime members and their nested contract fields,
`pending` with every `PendingApproval` field, and `notes`. For each admission, project the minimal
item reference, regime/state, its computed `availability`, timestamps/provenance, and the refused
outcome's reason/detail and optional approval with every `PendingApproval` field. Never expose `--observations` path or any read
error containing a real home path; sanitize file errors to a generic source label in public notes.

The prose fields just enumerated are contract-authorised public producer prose: regime `note`, state
`notes`, approval `summary`, and refusal `reason`/`detail`. They are bounded but published verbatim;
the producer inherits the contracts' obligation to generate public-safe operator prose. The display
must not claim to detect arbitrary secrets or paths inside meaningful prose. Adapter-owned fixture
paths, raw parse failures, and environment values are never members of the public projection.

Rationale: `--json` is consumed outside the machine and every field is deliberately allowlisted
(`packages/telemetry/src/public.ts:1-20`). `status` and `tree` are two projections of the same snapshot
and must not disagree (`packages/telemetry/src/cli.ts:485-512`).

Rejected: serializing the internal loader result or raw parsed JSON.

#204 is concurrently adding a strict `PublicTree` schema in dsh-app. Before this slice is declared
integrated, rebase onto its exact result, inspect that consumer, and prove it accepts the new
governance member. If an edit is required, extend #204's owning schema/test from telemetry's public
surface rather than introducing another independent validator. Run the focused dsh-app test after the
rebase; a passing telemetry test alone cannot prove the composed strict consumer still accepts output.

### D7 — Legacy transcript quota remains labelled fallback evidence

Do not delete `QuotaReading` or the transcript backfill in this slice. When a typed observation is
available, it supplies the governance view; legacy quota can be omitted from the text governance
block to avoid duplicate/conflicting windows while remaining in the compatibility JSON field during
this private package's transition. When observations are unavailable, render it under
`transcript quota (account unknown)` with its age, never as the complete governance state.

Rationale: current quota is recovered from run transcripts and only keyed by source/limit, with no
account field (`packages/telemetry/src/model.ts:59-76`, `packages/telemetry/src/snapshot.ts:125-142`).
It remains useful evidence but cannot meet the account-aware contract by itself.

Rejected: mapping `source` to an account handle or merging transcript quota into a contract account.
That would invent identity.

## Owner forks

None in this display slice. The production authority choice is already the explicit owner fork in
#62 and is neither repeated nor resolved here. `validUntil` leaves the sampling-validity policy with
the future authorised producer instead of silently deciding it in the display.

## Implementation slices and dependency DAG

1. **S1 — Dependency, input contract, and parser.** Add
   `@rickylabs/harness-contracts: workspace:*`, the `../contracts` project reference and lockfile
   update, then add derived types, whole-value validation, normalization, freshness helper, and
   synthetic fixture factory/tests. This explicit coupling is intentional because the three-regime
   value identity is a published contract; telemetry's board join remains structural because board is
   a separate projection (`packages/telemetry/src/model.ts:157-169`;
   `packages/dsh-app/package.json:50-64`; `packages/dsh-app/tsconfig.json:10-16`).
2. **S2 — Snapshot carriage.** Add the optional/unavailable observation result to `SnapshotInput`,
   `TelemetrySnapshot`, and `ActivityTree`; preserve deterministic ordering.
3. **S3 — Text renderer.** Add the shared three-regime/admission renderer and replace both duplicated
   quota blocks.
4. **S4 — Public projection.** Add explicit governance projection to status/tree JSON and privacy
   allowlist tests.
5. **S5 — CLI adapter.** Add `--observations`, load per invocation, propagate incompleteness, and
   preserve unrelated command behavior.
6. **S6 — End-to-end fixtures/docs.** Run the canonical matrix through CLI text and JSON; update
   README/reference output only after behavior is pinned.
7. **S7 — Independent implementation evaluation.** On exact head, recheck the display half and record
   that live host integration and full #87/#205 acceptance remain open.

    S1 -> S2 -> S3
              -> S4
    S1 -> S5
    S3 + S4 + S5 -> S6 -> S7

Before S1, a separate session must review this plan and issue one doctrine verdict. `FAIL_FIX` or
`FAIL_RESCOPE` returns to planning; only `PASS` (or completed narrow fixes under
`PASS AFTER NARROW FIXES`) permits implementation (`doctrine/WORKFLOW.md:59-85`).

## Canonical synthetic fixture matrix

All timestamps and `--now` values are fixed literals. No case reads process time, environment, a real
home, or production telemetry.

| ID | Input | Required text result | Required JSON/exit result |
| --- | --- | --- | --- |
| F1 | Fresh full observation: two accounts/windows, two providers, one host, all allow | Account handles, spend, and byte-formatted RAM/VRAM headroom before progress; no admission row | `governance` contains all three regimes and provenance; `complete: true`, exit 0 |
| F2 | Fresh throttle refusal for item 205 | `#205 throttle`, exact reason and detail beside/before progress | Item, regime, state, refusal and timestamps preserved; exit 0 |
| F3 | Fresh pause refusal for item 87 | `#87 pause`, exact reason and detail; absence of run does not hide it | Same refusal in status and tree JSON; exit 0 |
| F4 | Null ceiling, null used/total capacity components, and null leaf `observedAt` under allow | `ceiling unknown`, `headroom unknown`, and `never read`; no `$0`, `0 B`, `100% free`, or healthy wording | Nulls remain null |
| F5 | Observation expired before fixed `--now` | Prominent `STALE`, values aged and not worded as current health | Freshness is stale with original values/times intact; exit 0 |
| F6 | No `--observations`, no transcript quota | Explicit `UNKNOWN/UNAVAILABLE`; never an empty or green governance section | Explicit unavailable governance; ordinary scan completeness unchanged |
| F7 | No observations, aged transcript quota present | `transcript quota (account unknown)` with age; no claim of complete governance | Legacy `quota` retained, governance unavailable |
| F8 | Requested file missing/unreadable | Generic unavailable reason without the fixture/home path | `complete: false`, bounded note, exit 3 |
| F9 | Malformed JSON; missing, duplicate, or unknown regime; bad state; missing `generatedAt`/`pending`/`notes`; NaN-like/non-finite, out-of-range, or used-greater-than-total value; invalid/reversed time | Unavailable, no partial regime values rendered and no default empty approvals | `complete: false`, exit 3 for every member of table-driven invalid corpus |
| F10 | Unsafe provenance containing path, URL, whitespace, or over-bound text | Unavailable; canary absent from text | `complete: false`; canary absent from published JSON/notes, exit 3 |
| F11 | Same logical observation with data, pending, and notes arrays reversed/shuffled | Byte-identical text at fixed `--now` | Deep-equal/byte-identical JSON |
| F12 | Invoke with fixture A, replace with fixture B, invoke again | Second output shows B immediately without an agent or telemetry-log write | Generated envelope changes only where input changed; both exit 0 |
| F13 | Status and tree over same items/runs/observation | Identical governance prefix before each view's progress | Deep-equal `governance` members |
| F14 | Admission exact detail differs from generic diagnostic pointer | Actual refusal detail shown; pointer is not substituted | Actual reason/detail preserved |
| F15 | Envelope or admission `observedAt` later than fixed `--now` | `UNKNOWN/UNAVAILABLE`, never `under a minute ago` or current health | `complete: false`, no future values projected as valid, exit 3 |
| F16 | Fresh envelope containing an independently expired admission | Regimes remain fresh; refusal row carries its own `STALE` marker and age | Envelope and admission availability differ honestly; exit 0 |
| F17 | Valid non-empty pending approval, plus invalid/missing pending members in the negative corpus | Valid approval summary is visible only where governance is rendered; invalid input is unavailable, never defaulted to no approvals | Every `PendingApproval` field explicitly projected; invalid case exits 3 |
| F18 | Equivalent instants written with `Z` and numeric offsets | Fresh/stale result follows chronological instant, not lexical spelling | Same availability from epoch comparison |

Add compile-time assertions that the envelope's `state` is assignable to `GovernanceState`, admission
`regime` to `Regime`, and `outcome` to the refused member of `DispatchOutcome`. Add a public-projection
difference test analogous to the current `RunRecord.origin` gate so any new internal observation field
requires an explicit publication decision (`packages/telemetry/src/public.test.ts:32-48`).

## Verification gates

Run after implementation, from the repository root, in the order shown. The telemetry test runs
`tsc -b` and creates `dist/cli.js`; the direct CLI checks therefore come after it
(`packages/telemetry/package.json:27-31`).

    pnpm --filter @rickylabs/harness-contracts test
    pnpm --filter @rickylabs/telemetry test
    pnpm --filter @rickylabs/telemetry typecheck
    pnpm run check:docs
    pnpm --filter @rickylabs/dsh-app test

Then run two explicit CLI fixtures at fixed time for both human and JSON output:

    env -u DSH_TELEMETRY_DIR -u DSH_TELEMETRY_ARCHIVE node packages/telemetry/dist/cli.js status --home <temporary-empty-home> --items <synthetic-items> --observations <fresh-fixture> --now 2026-09-07T12:00:00.000Z
    env -u DSH_TELEMETRY_DIR -u DSH_TELEMETRY_ARCHIVE node packages/telemetry/dist/cli.js tree --home <temporary-empty-home> --items <synthetic-items> --observations <stale-fixture> --now 2026-09-07T12:00:00.000Z --json

The fixture test process also deletes or overrides all `DSH_TELEMETRY_*` variables before invoking
`main`, so ambient configuration cannot redirect a nominal temporary-home test into a real
observability store. No command reads credentials, `.env`, or a real home.

The implementation evaluation must inspect the exact committed head, verify no changes under
`packages/governance`, confirm all test inputs are synthetic, and explicitly return a display-half
verdict. It must state that no live host integration was exercised and therefore cannot close #87 or
#205.

## Spikes and integration gates

- **No pre-implementation spike is needed for display behavior.** The missing item join and freshness
  metadata are proven directly in current source (`packages/contracts/src/routes.ts:96-113`;
  `packages/contracts/src/governance.ts:118-136`).
- **Live producer integration gate (blocked):** after #62 records an accepted ADR, the E5 owner may
  implement an adapter that produces this envelope. Its authorised integration check must prove live
  changes refresh the display and unavailable host telemetry stays unknown. This gate is outside the
  display implementation and remains required by #205
  ([issue #205](https://github.com/rickylabs/harness/issues/205)).
- **Full acceptance gate:** an independent evaluator rechecks every original #87 criterion on the
  resulting exact head after live wiring. A display fixture PASS is evidence for only the
  display/fixture half.

## Risk register

| Risk | Likelihood | Impact | Gate |
| --- | --- | --- | --- |
| Parallel telemetry types drift from published governance contracts | Medium | High | D1 derived-type compile assertions; contracts + telemetry typecheck |
| Stale or future data appears current | Medium | High | F5/F15/F16/F18 fixed-time fixtures; shared renderer test |
| Missing/null readings or approvals become zero, healthy, or empty | Medium | High | F4/F6/F9/F17 negative assertions in text and JSON |
| Refusal is detached from the affected item or replaced by a log hint | Medium | High | F2/F3/F14 end-to-end cases |
| Status and tree disagree | Medium | Medium | F13 shared-prefix and deep-equality gate |
| Adapter-owned fixture/home path or environment value escapes through JSON/notes | Low | High | safe provenance grammar, explicit public allowlist, F8/F10 privacy canaries; public-safe producer prose obligation |
| Input order changes output bytes | Low | Medium | F11 shuffled fixture gate at fixed `--now` |
| Requested invalid observations still exit 0/complete | Medium | High | F8/F9 CLI exit/envelope checks |
| Legacy quota is mistaken for per-account governance | Medium | Medium | D7 label and F7 assertion |
| Display work accidentally activates E5 behavior or chooses host authority | Low | Critical | mutation-surface diff gate; exact-head evaluator; #62 remains open |
| A display PASS is used to close #87/#205 | Medium | High | verdict wording required in S7 and full acceptance gate above |
| #204's strict `PublicTree` consumer rejects the new member after rebase | Medium | High | D6 integration inspection and focused `@rickylabs/dsh-app` test; no duplicate schema |

## Stop condition

Stop after recording the independent review disposition. Do not implement from this amended draft,
mutate GitHub, or activate a live adapter until the parent confirms the narrow fixes satisfy the plan
gate. Code then begins only in the isolated implementation worktree; live wiring still waits on #62.
