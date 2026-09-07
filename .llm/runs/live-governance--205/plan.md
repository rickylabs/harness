# Live governance — #205 completion plan

> **Round 2, amended in flight 2026-09-07** after the owner named the data source and three live
> receipts were produced. Not a new round. Round-1 verdict `PASS_AFTER_NARROW_FIXES` is disposed in
> `disposition.md`; every withdrawal is recorded in `drift.md` and nothing is edited away.
> **Planning artifact — no product code has been changed. Returned for the same independent GLM
> evaluation.**

Baseline `eef24f9ea02563d318a2f6b1d6c2f26e268d9b61`. Evidence and receipts in `research.md`.
Netscript source authority: upstream HEAD `8ba53bc50ca02aab29e99ba5362728839b8f1713`, read-only
checkout `refs/netscript`; paths below are into its
`.llm/tools/agentic/`.

## Summary

Build **one governance source composition** in `packages/telemetry` with four independent legs, each
producing one part of the `GovernanceObservation` the shipped parser and renderer already consume.
Each leg fails to `unknown` on its own without taking the others down.

| Leg | Fact | Reader | Credential | Status |
| --- | --- | --- | --- | --- |
| **A** | subscription quota per account | `fetchOpenCodeGoUsageSnapshot` behind an injected env-only adapter | `OPENCODE_API_KEY` from the process environment | reachability **proven live this run** |
| **B** | metered spend | `GET https://openrouter.ai/api/v1/key` | `OPENROUTER_API_KEY` from the process environment | reachability **proven live this run** |
| **C** | local capacity at a declared scope | current cgroup memory; GPU unknown | none | collectable; scope is the container, never a host claim |
| **D** | structured admissions | recorded admission events, read back from the observability log telemetry already reads | none | read path buildable and testable now; the fact stays `unknown` until a real decision is recorded |

No credential is read from a file, at any leg. No leg invokes anything that reads
`~/.config/netscript-agentic/**`, `.env`, or a vendor auth file. Plus the round-2 renderer honesty fix
(D12). Nothing else.

## What this delivers against full #205 — and what would still be unproven

| # | Criterion | After implementation |
| --- | --- | --- |
| 1 | quota per account, spend, capacity headroom, with timestamps/provenance and explicit unknowns | quota (A) and spend (B) end to end; capacity (C) as an explicitly scoped container reading with GPU `unknown`. **Closed only once S6 exercises all three — not on the strength of the receipts.** |
| 2 | a paused/throttled item shows the actual admission decision and reason | the read path is complete and exercised against recorded events; **`unknown` until a real gate records one**, because no source examined carries item-scoped refusal evidence |
| 3 | changing live observations refreshes the display without an agent | closed, exercised at S6 |
| 4 | no time-sliding values committed; host telemetry private | held: every leg is a reader; nothing is written |
| 5 | ADR recorded, then an authorized integration check | ADR recorded (#257); S6 is the check, at the authorized scope |
| 6 | independent evaluator rechecks all #87 acceptance at exact head | S8, criterion by criterion |

**No criterion is claimed closed here.** A receipt proves reachability; only S6 proves a criterion.

## Mutation surface — exact

| Path | Change |
| --- | --- |
| `packages/telemetry/src/governance/usage.ts` (+test) | **new, pure.** Edge validation of the usage snapshot shape as `unknown`; mapping to the subscription regime. |
| `packages/telemetry/src/governance/spend.ts` (+test) | **new, pure.** Edge validation of the OpenRouter key payload as `unknown`; mapping to the metered regime. |
| `packages/telemetry/src/governance/capacity.ts` (+test) | **new, pure.** Parsing cgroup memory text; mapping to the capacity regime at a declared scope. |
| `packages/telemetry/src/governance/admissions.ts` (+test) | **new, pure.** The recorded-admission event shape, its edge validation, and mapping to `AdmissionObservation`. |
| `packages/telemetry/src/governance/compose.ts` (+test) | **new, pure.** Composes the four legs into one envelope; per-leg unknown handling; ordering. |
| `packages/telemetry/src/source.ts` (+test) | **new, pure.** Source descriptor, required fields, closed refusal vocabulary. |
| `packages/telemetry/adapters/opencode-usage-probe.ts` | **new, not in the TS project.** The Deno entry that calls the netscript function with injected dependencies. Excluded from `tsconfig` `include`; never imported by Node code. |
| `packages/telemetry/src/cli.ts` (+test) | `--observations-from <spec>`; the impure edge: one spawn (A), one fetch (B), one file read (C), the existing log read (D); exit mapping. |
| `packages/telemetry/src/render.ts` (+test) | D12 only. |
| `packages/telemetry/src/index.ts` | export the source descriptor and refusal union. |
| `packages/telemetry/README.md`, `docs/reference/cli/dsh-telemetry.md` | flags, config fields, failure table, the scope statement for C. |

**No** `package.json`, `tsconfig.json` or `pnpm-lock.yaml` change: `node:child_process`,
`node:fs/promises`, global `fetch`. **No import of any netscript module from Node code.**

Forbidden: `packages/contracts/**` (0.1.0 frozen); `packages/governance/**`; `packages/dsh-app/**`;
any threshold, cap or ceiling authored here; `reserveCopilotCredits` or any netscript task holding
`--allow-write`; `agentic:routing-state` and anything else that reads
`~/.config/netscript-agentic/**`; reading `.env`, vendor auth files or `~/.ssh`; any credential in
argv, notes, logs, prompts or receipts; publishing raw telemetry, operational counts, session ids,
worktree paths, host names or private project identifiers in any artifact or reviewer payload; new
dispatch; quota reservation; deployment; sibling writes; workflows; GitHub mutations; new issues;
merges; tags.

## Decisions

Round-2 D2 (preserve timestamps), D3 (decide nothing), D4 (fault ⇒ unknown, no fallback), D5 (no
default fiction), D9 (mutual exclusion), D10 (reader-owned provenance), D11 (reads only) and D12
(stale leaf may not ride a fresh badge) stand. D1, D6, D7, D8 and D13 are superseded per `drift.md`.

### D14 — an adapter, not a schema authority

Each leg validates its input as `unknown` at the edge exactly as telemetry already validates board
JSON (`packages/telemetry/src/model.ts:163-169`), then maps into telemetry's existing envelope.
`packages/contracts` is unchanged and nothing new is published, so read-only normalization at the
source boundary creates no parallel schema authority. netscript remains a service behind an adapter,
never a build-time dependency (`AGENTS.md:99`).

### D15 — environment-only auth, file access denied, proven not asserted

Leg A spawns `deno run --allow-env=OPENCODE_API_KEY --allow-net=opencode.ai` (no `--allow-read`,
no `--allow-write`, no `--allow-run`) on `adapters/opencode-usage-probe.ts`, which calls
`fetchOpenCodeGoUsageSnapshot` with `env` injected and `readTextFile`/`stat` rejected. Leg B uses
`fetch` with `OPENROUTER_API_KEY` taken from the process environment and placed in one header.

Rationale: `resolveCredential` returns the environment value first and only falls back to a file when
it is absent (`lib/provider-credential.ts:78-79`), so an injected credential with denied readers never
opens a file. This exact configuration was executed this run and exited 0 with all three windows
finite (`research.md`, receipts). The permission vector is pinned by a test so a widening is a
failure, not a silent change.

Rejected: invoking `agentic:expense-watch` or `agentic:routing-state`. Both resolve inputs from
prohibited paths under their default dependencies, and putting a subprocess between us and a forbidden
file does not make the read permitted.

### D16 — the CLI edge is insufficient; call the library

Leg A must obtain `capturedAt`. `runExpenseWatch` prints an `ExpenseDecision`
(`runtime/cli/expense-watch.ts:101-103`), which has no `capturedAt`
(`runtime/subscription-expense.ts:70-78`) — only `snapshotAgeMs`, a duration. A timestamp is never
reconstructed by subtracting an age from a local clock.

Rejected: `expense-watch --now` (it overwrites `capturedAt` and zeroes the age —
`runtime/cli/expense-watch.ts:87-89`), and deriving `observedAt` from `snapshotAgeMs`.

### D17 — `capturedAt` is a reader stamp, taken after the response, and labelled as such

The probe takes its `now` **after** the response is received and before parsing, so the stamp can
never be earlier than the fact it describes. `observedAt` is that instant, and the regime note states
that the provider payload carries per-window `resetsAt` but no provider capture instant.

Rationale: the injected `now` is called at the parse site (`runtime/provider-usage.ts:174`); which
side of the fetch it lands on is the adapter's choice, and only "after" is safe. Presenting a
reader stamp as a provider timestamp would be reconstructed freshness.

Rejected: stamping before the request, and presenting `capturedAt` as provider-observed.

### D18 — validity comes from the source's declared maximum age

`validUntil = observedAt + EXPENSE_SNAPSHOT_MAX_AGE_MS` (15 minutes,
`config/subscriptions.ts:5`) for leg A — the bound past which netscript itself refuses a snapshot as
`usage_stale` (`runtime/subscription-expense.ts:157-160`). Legs B and C carry their own declared
bounds as required configuration with no default. The value is pinned by a test so an upstream change
surfaces as a failure rather than as wrong freshness.

### D19 — regime states are `allow`, and every threshold belongs to a source

Legs A, B and C emit `state: "allow"` with real readings and honest nulls. This repository authors no
ceiling, no slack band and no burn rate, so it cannot emit `throttle` or `pause` from a reading.
`throttle`/`pause` reach the display only through leg D, from a decision someone with authority
recorded.

Rationale: D3. An earlier draft derived a regime state from `ExpenseDecision.warning`/`reason`; that
imported a dispatch gate's caution into a claim about the world and is withdrawn. A could-not-check
condition is rendered unread — `allow`, `observedAt: null`, note — per
`packages/contracts/src/governance.ts:16-26`.

### D20 — admissions come only from a recorded decision, and the producer is named

An `AdmissionObservation` is built only from an admission event carrying, explicitly: item number,
regime, `throttle | pause`, a closed reason, an operator detail, `decidedAt`, `validUntil` and
provenance. Telemetry reads those events from the observability log it already reads back
(`packages/telemetry/src/observability.ts`, `packages/telemetry/src/live.ts:73-115`). The writer is
whoever performs the gate — E5 `#66`'s wiring, outside this mutation surface. Our read path is
complete, and is exercised at S5 against recorded synthetic events, so it is a defined producer and a
testable plan rather than an open-ended dependency.

Until such an event exists, `admissions` is `[]` with a note saying no admission decision has been
recorded. **Routing state is not a substitute.** `RoutingState` is a routing transition, not an
item-scoped refusal: `affectedSession` is a session rather than a work item, a session quota
transition can be detected after the effect it describes has begun, and a fallback that changed a
route is not evidence that anything was refused
(`runtime/routing-state-machine.ts:50-67`). An earlier draft mapped it into admissions; that is
withdrawn, and no fallback mapping replaces it.

Rejected: inferring an item from `affectedSession`, from a branch name, or from provider-refusal
prose.

### D21 — capacity is reported at the scope actually read, and never as a host

Leg C reads the **current cgroup's** memory (`memory.current` / `memory.max` under the cgroup-v2
mount, with the v1 fallback path) and emits one `CapacityReading` whose `host` field is a configured
scope label declaring it a container scope. `vramUsedBytes`/`vramTotalBytes` are `null` with a note
saying GPU is unknown. When `memory.max` is unlimited, both byte fields are `null` with a note — an
unlimited cgroup has no headroom figure.

`os.totalmem()` is **not** used, and no reading is labelled as a physical-host figure. A host-scoped
capacity number is a different, unestablished scope; it is reported as `unknown` rather than
approximated, and this is a scope statement, not a policy question.

Rationale: the contract's whole point is that a wrong number with a green bar behind it is the
expensive failure (`packages/contracts/src/governance.ts:16-26`). A container figure honestly labelled
is useful; the same figure labelled "host" is not.

### D22 — each leg fails alone

A leg that cannot read emits its regime unread — `allow`, empty collection, `observedAt: null`, a
fixed note naming which leg was unavailable — and the envelope still renders with the other legs'
real values. Whole-envelope unavailability is reserved for a failure of composition itself.

Rationale: a spend outage must not blank a live quota reading; that is the availability answer the ADR
already reasons through for a different channel.

Rejected: all-or-nothing composition, and a cached last-good leg.

### D23 — nothing private leaves the boundary

Published: window ids, percents, statuses, reset instants, spend totals in USD, byte figures, the
declared capacity scope label, closed admission reasons and timestamps. **Not** published: any
credential, response body, stderr text, model identifier beyond the configured label, session id,
worktree path, repository or project name, host name, or operational count. Provenance is a fixed
short reader-owned identifier from a closed set (`reader:opencode-usage`, `reader:openrouter-key`,
`reader:cgroup-memory`, `reader:recorded-admission`) — never a path or URL.

Rationale: the projection publishes verbatim (`packages/telemetry/src/public.ts:224`), and the shipped
difference test forces any new field to be an explicit decision
(`packages/telemetry/src/public.test.ts:32-48`).

## The executable contract

### Descriptor

    type GovernanceSource = {
      readonly usage: { readonly denoBin: string; readonly probe: string;
                        readonly checkout: string; readonly model: string;
                        readonly credentialEnv: string; readonly timeoutMs: number;
                        readonly maxBytes: number } | null;
      readonly spend: { readonly url: string; readonly credentialEnv: string;
                        readonly windowLabel: string; readonly validForMs: number;
                        readonly timeoutMs: number; readonly maxBytes: number } | null;
      readonly capacity: { readonly cgroupRoot: string; readonly scopeLabel: string;
                           readonly validForMs: number } | null;
      readonly admissions: { readonly fromObservabilityLog: true } | null;
      readonly accountLabel: string;
    }

Supplied as `--observations-from <config-json-path>`; `file:<abs-path>` still accepts a pre-formed
envelope for offline tests. Every field of a non-null leg is required; no defaults (D5). A `null` leg
is explicitly "not configured" and renders unread — different from "configured and failed".

### Validation, before any I/O

Absolute paths only; `credentialEnv` must be a bare environment-variable name (no value, ever, in the
descriptor); `url` must be absolute `https:` with no userinfo, query or fragment; `model` must be a bounded provider/model routing string (slash permitted);
`accountLabel` and `scopeLabel` must match the shipped identifier grammar
(`packages/telemetry/src/observations.ts:82`); `timeoutMs` `1…60_000`; `maxBytes` `1…4_194_304`;
`validForMs` positive. Closed refusal codes; no message quotes a path, URL, model, credential name's
value, or any byte read.

### Mapping

| Envelope field | Source |
| --- | --- |
| `observedAt` | collection completion time; retain each original leaf stamp and reject future leaves |
| `validUntil` | the earliest still-valid successful leg expiry; expired legs become explicitly unavailable, never restamped |
| `provenance` | `reader:composed` |
| `subscription.accounts[]` | leg A: `accountLabel`, `seam` = the provider id, one window per `percentageWindows` entry (`usedPercent` = `percent`, `resetsAt`, fixed `windowMinutes` per window id, `binding` = false; note that no binding decision was observed), `observedAt` = leg A stamp, `state` = `allow` |
| `metered.providers[]` | leg B: `provider` = configured label, `spentUsd` = reported usage, `ceilingUsd` = `null`, `windowLabel` configured, `observedAt` = leg B stamp, `state` = `allow` |
| `capacity.hosts[]` | leg C: `host` = `scopeLabel`, `ramUsedBytes`/`ramTotalBytes` from the cgroup, VRAM `null`, note "GPU unknown; scope is the current cgroup, not a physical host" |
| `admissions[]` | leg D: recorded admission events only (D20); otherwise `[]` with a note |
| any unconfigured or failed leg | `allow`, empty collection, `observedAt: null`, fixed note (D22) |

### Error policy — public-safe

Fixed strings only; exit 0 when a leg is unread but the envelope is coherent, exit 3 when composition
or envelope validation fails, exit 2 for descriptor and usage errors. **stderr is never captured into
a note, artifact or projection.** Per-condition rows: leg not configured; credential env unset
(`<leg> credential is not bound`); spawn failed; timeout; oversize output; non-JSON; shape mismatch;
cgroup unreadable; cgroup unlimited; observability log unreadable; envelope validation failure.

## Authorized data scope

The owner authorized read-only other-project/NAS run data and pointed to the existing NetScript toolchain. This covers the env-only live usage/spend reads and local read-only capacity inspection already performed. No renewed permission question is required for the same scope. No provider dispatch, quota reservation, deployment, secret-file read, or sibling mutation is authorized by the observation path.

## Slices and DAG

1. **S1** — `source.ts`: descriptor, validation, refusals. Pure.
2. **S2** — the four leg mappers, each pure, each with edge validation as `unknown`.
3. **S3** — `compose.ts`: per-leg unknown handling, ordering, envelope construction. Pure.
4. **S4** — `adapters/opencode-usage-probe.ts` and the CLI edge: one spawn, one fetch, one file read,
   the existing log read, exit mapping.
5. **S5** — D12 renderer fix and the full offline test matrix.
6. **S6** — authorized integration proof: legs A, B and C exercised for real; refresh, staleness,
   unread rows and privacy canaries asserted. **Aggregate booleans only in any report.**
7. **S7** — record exact live evidence and any remaining unknown acceptance; no renewed permission request.
8. **S8** — independent exact-head evaluation, criterion by criterion.

       S1 -> S3 -> S4 -> S5 -> S6 -> S7 -> S8
       S2 -> S3

## Test matrix

L1–L20 are offline on captured synthetic payloads; L21–L24 are S6.

| ID | Case | Assertion |
| --- | --- | --- |
| L1 | `file:` source, valid envelope | identical to `--observations` with the same bytes |
| L2 | file replaced between invocations | display follows; nothing written; exit 0 both |
| L3 | leg A payload with three windows | windows carry `usedPercent`, `resetsAt`, binding; state `allow` |
| L4 | leg A payload missing a window / non-finite percent / bad status | leg unread with its note; other legs still render |
| L5 | leg B payload with total and monthly usage | `spentUsd` set, `ceilingUsd` null, `windowLabel` as configured |
| L6 | leg B payload with a negative or non-finite figure | leg unread; never `$0.00` |
| L7 | leg C cgroup with real current/max | RAM bytes and headroom; VRAM `unknown`; scope label present and not a host claim |
| L8 | leg C cgroup unlimited / unreadable | both byte fields `null` with a note; never `0 B` or `100% free` |
| L9 | every leg unconfigured | all three regimes unread with distinct notes; admissions `[]`; exit 0 |
| L10 | one leg fails, others succeed | failing regime unread; real values still rendered (D22) |
| L11 | leg stamp older than its declared validity at `--now` | envelope `stale`; values intact; exit 0 |
| L11a | one leaf older than the declared span | leaf `STALE`; regime line `(1 of N readings stale)`; badge still `FRESH` |
| L11b | every leaf older than the span | `FRESH` does not stand unqualified |
| L12 | equivalent instants `Z` and numeric offset | identical availability |
| L13 | recorded admission events, valid | one `AdmissionObservation` each, `observedAt = decidedAt`, closed reason, item preserved |
| L14 | recorded admission event missing an item, regime, or state | rejected and counted in a note; **never** rendered against an inferred item |
| L15 | a routing-state-shaped payload offered to leg D | **rejected** — leg D accepts only the recorded admission shape (D20) |
| L16 | no admission events present | `admissions: []` with a note; never a fabricated row |
| L17 | probe permission vector | the spawn argument vector is exactly `--allow-env=<credentialEnv> --allow-net=<host>`; no `--allow-read`, `--allow-write`, `--allow-run`, and no `--now` |
| L18 | credential canary | the credential value appears **once**, in the leg B `authorization` header only, and **never** in leg A's argv, in stdout, stderr capture, notes, projection or artifacts |
| L19 | privacy canary — payload carrying a session id, worktree path, repository name and host name | none appears in text, JSON, notes or projection |
| L20 | isolation | nothing created or modified under the temp home; the observability log and the netscript checkout byte-identical before and after |
| L21 | **real** leg A | exit 0; three finite windows; `observedAt` within seconds of the run and **not** equal to any supplied `--now` |
| L22 | **real** leg B | finite non-negative usage; `ceilingUsd` null; no body text anywhere in output |
| L23 | **real** legs A+B+C twice, minutes apart | timestamps advance; display refreshes with no agent and no write |
| L24 | **real** run, artifact scrub | the S6 report contains booleans and states only — no count, path, identifier or value |

## Verification gates

    pnpm --filter @rickylabs/harness-contracts test
    pnpm --filter @rickylabs/telemetry test
    pnpm --filter @rickylabs/telemetry typecheck
    pnpm --filter @rickylabs/dsh-app test
    pnpm run check:graph && pnpm run check:lifecycle && pnpm run check:links
    pnpm run check:metadata && pnpm run check:snapshots && pnpm run check:docs

## Integration gates

- **G1 — offline (runnable now).** L1–L20. Proves mapping, per-leg failure isolation, refresh,
  staleness, both canaries and the permission vector.
- **G2 — authorized integration (S6).** L21–L24 against the real endpoints and the real cgroup, within the already authorized read-only scope. This is #205's fifth criterion at the authorized scope. Reported as booleans.
- **G3 — full acceptance.** Independent evaluator at exact head. Criterion 2 stays `unknown` until a
  real gate records an admission; that must be stated, not rounded up.

## Risk register

| Risk | Likelihood | Impact | Gate |
| --- | --- | --- | --- |
| A routing transition is published as an item refusal | Medium | Critical | D20; L15 |
| A reader stamp is presented as a provider timestamp | Medium | High | D17; L21 |
| A timestamp is reconstructed from `snapshotAgeMs` | Medium | High | D16; no age→time path exists in the mapper |
| A subprocess reads a prohibited path on our behalf | Medium | Critical | D15; L17 permission-vector assertion |
| A cgroup figure is labelled a physical host | Medium | Critical | D21; L7 asserts the scope label and the absence of a host claim |
| Allowance percent is published as billed spend | Medium | High | leg separation; leg B is the only `spentUsd` source |
| A threshold is authored here and becomes a fake `throttle` | Medium | Critical | D19; only leg D can emit throttle/pause |
| One leg's outage blanks the others | Medium | High | D22; L10 |
| A credential reaches argv, a note or an artifact | Low | Critical | D15/D23; L18 |
| stderr leaks a path or host | Medium | High | error policy; L19 |
| An operational count or project identity is published | Medium | High | D23; L24; coverage receipts are booleans |
| Upstream changes the 15-minute validity bound unnoticed | Medium | Medium | D18 pinned constant |
| netscript becomes a build-time dependency | Low | High | D14; probe excluded from the TS project; `check:graph` |
| A receipt is reported as a closed criterion | **High** | High | "What this delivers"; G3; S8 wording |

## Stop condition

Stop here; return for the same independent GLM evaluation. No product edit before a PASS. On
authorization, implement S1–S5 offline, exercise S6 at the authorized scope, then record the result at S7. No dispatch, no quota reservation, no credential-file read, no deployment, no sibling write, no
merge, no tag.

## D24 — coordinator correction, 2026-09-07 (normative)

These bounded corrections resolve the review friction found in the previous draft. They take precedence over shorthand in earlier slices.

- Composition takes an injected collection-completion clock. Every retained leaf must be no later than that instant. Discard expired leg data with an explicit unavailable/stale-source note; do not change its timestamp to make it current. Envelope expiry is the earliest remaining leg expiry; with no successful leg use an unavailable view. Fresh retrieval and freshness of underlying evidence remain distinct. The CLI uses completion time when --now was omitted; an explicit --now remains the evaluation clock and can deliberately make a live observation future-invalid or stale.
- A requested source with missing, failed or unread evidence sets ParsedGovernance.ok=false, so the existing complete flag and exit3 expose incomplete evidence while the successful legs still render. Explicitly unconfigured legs carry notes; an all-unconfigured composition is unavailable, not a successful empty answer. Unavailable admissions also keep the live source incomplete until actual records exist. File-based observation mode retains its existing behavior.
- No binding window is inferred from maximum percentage. Emit binding:false and an honest binding-unobserved note. Window durations/labels must be supplied as validated source configuration; no guessed monthly duration. The configured account label denotes the one credential binding being read, not discovered fleet-wide account completeness.
- Spend source is exactly HTTPS openrouter.ai/api/v1/key, with redirect:error, bounded response and timeout. No arbitrary credential-bearing URL. Descriptor window is an enum total/daily/weekly/monthly mapped respectively to usage/usage_daily/usage_weekly/usage_monthly, with a fixed reader-owned window label. Never add BYOK figures, infer spend from balance, or pair a ceiling with a different accounting window. ceilingUsd stays null. Provider label is fixed openrouter; response label/user metadata never leaves the parser.
- A recorded admission is an existing TelemetryEvent envelope: {at,runId,kind:"governance.admission",detail:{item:{number},regime,state,observedAt,validUntil,outcome:{accepted:false,reason,detail}}}. runId is required log identity, not proof of execution; it is not published in AdmissionObservation. kind remains an open string in sink.ts, so no new core event-kind union is required. The detail observation timestamp must be explicit and valid; never use parseEvents' replacement at timestamp to establish decision freshness. Fixed reader provenance replaces any caller provenance. Validate the entire detail through the existing governance parser, with fixed error diagnostics. Select the newest valid observation per item/regime by decision timestamp, collapse identical duplicates, and mark same-time conflicting decisions unavailable; a malformed newest event must not resurrect a superseded refusal as current. Do not parse routing-state, arbitrary prose, or derive item identity from runId. Use the existing writer CLI in synthetic tests to demonstrate the producer-facing path; real decision production remains E5 wiring and is not falsely claimed by this PR.
- Capacity supports a configured cgroup-v2 directory and explicit configured-cgroup scope. Read memory.current and memory.max there; do not claim automatic current-cgroup discovery or silently fall back to v1 or host memory. Unsupported/unlimited capacity remains explicitly unknown; a finite unrelated ancestor is not a verified dispatch-host limit. Preserve known used bytes when total is unknown, with headroom unknown. Rendering partial known values is within the same truthful observation rule.
- The Deno probe uses a configured external checkout as an operational dependency, not a Node import/build dependency. It imports the existing usage library and its source max-age value at runtime; the serialized adapter result includes capturedAt and that validity bound. Its only credential source is the named inherited environment variable. Child environment is minimized; no broad environment dump, auth-file fallback or credential argv. Add a testable service injection seam so Node tests need no Deno or network. Do not pin production model IDs/efforts in TypeScript; E11 now owns configured routing.
- Mutation surface also includes ParsedGovernance's documentation in observations.ts if needed to accurately describe incomplete requested-source behavior; otherwise existing contracts and public projection schema remain unchanged. Tests must exercise the real CLI through a temp home and loopback/injected services, preserving argv isolation and file immutability. Root build and full workspace tests are required before PR readiness, plus the repository's existing metadata/check gates. No successful broad-source or pending-approval completeness claim may be fabricated.

The PR may be reviewable with honest unknown live admission/finite-capacity evidence and a Part of #205 relationship. It must not use a closing keyword or claim the original full live acceptance passed unless the independent evaluator has the corresponding actual receipts. User's current target is a reviewable PR; do all the authorized implementation and validation before handing it over. Humans merge.
