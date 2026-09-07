# Published governance read path — #205 / #87 — plan (locked, awaiting independent evaluation)

**No mutation is authorized by this file.** It plans the smallest published governance read path.
Product, test, docs, workflow and package changes listed in §7 happen only after an independent
plan PASS. Publishing and tagging remain owner steps and are outside this plan's authorization.

## Summary

Choose **Option A**: a standalone, versioned, strictly decoded `GovernanceReadSnapshot` exported from
`@rickylabs/harness-contracts` (root entry, pure, no I/O), produced by a new one-shot command
`dsh-telemetry governance --observations-from <descriptor>` that writes exactly one JSON document to
stdout, and consumed by a backend through the installed package's `readGovernanceSnapshot` decoder.
The document embeds the ratified protocol-1 `GovernanceState` unchanged and adds only what the producer
can attest: envelope timestamps and provenance, typed per-source coverage, typed admission refusals,
an explicit "pending approvals not observed" marker, and a `complete` flag equal to telemetry's `ok`.
`RemoteSnapshot`, `PROTOCOL_VERSION`, the hub and the fold are untouched. Release is
`@rickylabs/harness-contracts@0.2.0`, protocol 1.

**Option B** (additive envelope on `RemoteSnapshot`/`GovernanceState` through fold and hub) is rejected
for this slice: no `RemoteSnapshot` producer exists (research F3), so a producer would have to invent
`generation`, `complete`, `repo`, `lifecycle` and board arrays, or a resident service would have to be
built. Neither is requested. The chosen shape keeps B reachable later: a future hub producer can embed
the same `GovernanceState`, and coverage can travel as an additive optional field then.

## 1. What "meets the request" means here

| Requirement (brief / #205 comment) | How the plan meets it |
| --- | --- |
| Typed coverage, envelope, admission | `GovernanceReadSnapshot` §2, decoded by `readGovernanceSnapshot` §3 |
| Supported producer → consumer read path | `dsh-telemetry governance` → stdout JSON → installed decoder; proven by `scripts/check-installed-contracts.mjs` §6.3 |
| Per-source availability preserved | `sources.usage`, `spend`, `capacity`, `admissions` each carry status, timestamps and closed reason codes; no inference from `notes` |
| Original observedAt/validUntil/provenance | envelope fields copied from `GovernanceView`; leaf `observedAt` inside `state` untouched; composition `observedAt` never overwrites a leaf |
| Unavailable representable | `availability: "unavailable"` with `state: null` and closed `unavailableReason` |
| Partial success visible, failures never zero/healthy | `complete:false` plus failed coverage while `state` still carries the successful regime; decoder refuses `complete:true` when any source is failed or discarded |
| Admission ≠ execution, unknown ≠ failed | `admissions[]` are recorded refusals with `accepted:false` only; `sources.admissions.status` distinguishes `not-configured`, `failed(log-unreadable)`, `read` with `records`, `empty`, `dropped` |
| No sensitive config exported | producer projects field by field; decoder caps and identifier regexes; canary tests |
| Legacy DTOs not a second authority | the command refuses `--observations` and `file:`; `PublicGovernance` and the dsh-app projection are unchanged and not consumed |
| Version explicit | 0.2.0, protocol 1, `schema: 1` on the document; 0.1.0 consumers cannot decode and are told so §5 |

## 2. The document — `GovernanceReadSnapshot` (schema 1)

TypeScript in `packages/contracts/src/governance-read.ts` (new). Every field below is required unless
marked optional; there are no defaults in the decoder.

    export const GOVERNANCE_READ_SCHEMA = 1 as const;
    export const GOVERNANCE_SOURCE_NAMES = ["usage", "spend", "capacity", "admissions"] as const;
    export type GovernanceSourceName = (typeof GOVERNANCE_SOURCE_NAMES)[number];

    export const SOURCE_FAILURE_REASONS = ["credential-unbound", "spawn-failed", "timeout", "oversize",
      "non-json", "shape-mismatch", "request-failed", "cgroup-unreadable", "log-unreadable"] as const;
    export const SOURCE_DISCARD_REASONS = ["stale-source", "future-source", "shape-mismatch"] as const;
    export const ADMISSION_DROP_REASONS = ["admission-conflict", "stale-source", "shape-mismatch"] as const;
    export const UNAVAILABLE_REASONS = ["not-configured", "no-successful-sources", "envelope-invalid"] as const;

    export type MeterCoverage =
      | { readonly status: "not-configured" }
      | { readonly status: "failed"; readonly reason: SourceFailureReason }
      | { readonly status: "discarded"; readonly reason: SourceDiscardReason }
      | { readonly status: "read"; readonly observedAt: string; readonly validUntil: string;
          readonly freshness: "fresh" | "stale" };

    export type AdmissionCoverage =
      | { readonly status: "not-configured" }
      | { readonly status: "failed"; readonly reason: "log-unreadable" | "shape-mismatch" }
      | { readonly status: "read"; readonly records: number; readonly empty: boolean;
          readonly dropped: readonly AdmissionDropReason[] };

    export interface GovernanceSourceCoverage {
      readonly usage: MeterCoverage; readonly spend: MeterCoverage; readonly capacity: MeterCoverage;
      readonly admissions: AdmissionCoverage;
      /** Pending approvals have no producer today. The only value is "not-observed". */
      readonly approvals: { readonly status: "not-observed" };
    }

    export interface RecordedAdmission {
      readonly item: number; readonly regime: Regime; readonly state: "throttle" | "pause";
      readonly observedAt: string; readonly validUntil: string; readonly freshness: "fresh" | "stale";
      readonly provenance: string;              // safe identifier, e.g. reader:recorded-admission
      readonly reason: string;                  // producer machine code, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
      readonly accepted: false;
    }

    export type GovernanceReadSnapshot =
      | { readonly schema: 1; readonly protocol: 1; readonly producer: string;
          readonly evaluatedAt: string; readonly availability: "fresh" | "stale";
          readonly observedAt: string; readonly validUntil: string; readonly provenance: string;
          readonly complete: boolean; readonly sources: GovernanceSourceCoverage;
          readonly state: GovernanceState; readonly admissions: readonly RecordedAdmission[];
          readonly unavailableReason: null; readonly notes: readonly string[] }
      | { readonly schema: 1; readonly protocol: 1; readonly producer: string;
          readonly evaluatedAt: string; readonly availability: "unavailable";
          readonly observedAt: null; readonly validUntil: null; readonly provenance: null;
          readonly complete: false; readonly sources: GovernanceSourceCoverage;
          readonly state: null; readonly admissions: readonly [];
          readonly unavailableReason: UnavailableReason; readonly notes: readonly string[] };

Field semantics, supported today (S) or deferred (D):

| Field | Scope | Meaning and source of truth |
| --- | --- | --- |
| `schema` | S | document version; decoder accepts exactly 1 |
| `protocol` | S | the `GovernanceState` shape embedded is protocol 1 (`PROTOCOL_VERSION`); no frame semantics |
| `producer` | S | safe identifier label `dsh-telemetry`; never a path, host or free prose |
| `evaluatedAt` | S | the clock availability was judged against (`--now` or completion) |
| `observedAt`, `validUntil`, `provenance` | S | copied from `GovernanceView` (composition completion, earliest retained expiry, `reader:composed`) |
| `availability` | S | copied; consumers may re-judge from `validUntil` against their own clock and must not treat `fresh` as data completeness |
| `complete` | S | `ParsedGovernance.ok`: every configured source read and valid; the decoder refuses `true` when any source is `failed` or `discarded` |
| `sources.*` | S | from structured codes returned by `composeGovernance` and `mapAdmissions` (new `coverage` output), never from notes |
| `sources.approvals` | S | literal `not-observed`; `state.pending` is always `[]` today |
| `state` | S | the ratified `GovernanceState`, projected field by field as `publicState` does today; regime `state` is `allow` because no policy runs; `binding:false`, `ceilingUsd:null`, VRAM null, unbounded RAM → `ramTotalBytes:null` |
| `admissions[]` | S | recorded refusals only; `detail` and `approval` are **not** carried (private prose is withheld today; a fixed sentence is not information) |
| `notes` | S | informational fixed reader strings, capped; consumers must not parse them |
| pending approvals, regime policy states, binding window, ceilings, GPU, dispatch-host capacity | D | remain explicitly unknown; no field pretends otherwise |
| embedding in `RemoteSnapshot`, `governance.changed` coverage, hub/HTTP/socket transport | D | separate future change; additive and protocol-preserving only if `GovernanceState` semantics stay identical |
| #265 reconnect freshness | D | untouched; fold and client behaviour stay as shipped and are not made to look fixed |

## 3. The decoder — `readGovernanceSnapshot(value: unknown): GovernanceReading`

    export type GovernanceReading =
      | { readonly ok: true; readonly snapshot: GovernanceReadSnapshot }
      | { readonly ok: false; readonly reason: "unreadable"; readonly detail: string }
      | { readonly ok: false; readonly reason: "unsupported-schema"; readonly schema: number | null; readonly protocol: number | null }
      | { readonly ok: false; readonly reason: "invalid"; readonly detail: string };

Rules (each has a numbered negative test in §6.1):

1. Not an object → `unreadable`. Absent or non-integer `schema` → `unsupported-schema` with `schema: null`.
   Absent metadata is never defaulted. This is the 0.1.0 compatibility rule: a 0.1.0 producer cannot have
   written this document, and any undeclared document is refused rather than guessed at.
2. `schema` > 1 or `protocol` ≠ 1 → `unsupported-schema` reporting both numbers, so a consumer can
   count and report rather than crash (the `unknown-kind` precedent).
3. Any unknown key at any object level → `invalid` naming the path, never echoing the value. The
   document is strict on purpose; forward-compatible additions bump `schema`.
4. `availability` must agree with `state`, `observedAt`, `validUntil`, `provenance`, `unavailableReason`,
   `admissions` and `complete` per the union arm; mismatches are `invalid`.
5. Timestamps: ISO regex as `observations.ts:84`; `observedAt ≤ evaluatedAt`; `validUntil ≥ observedAt`;
   every leaf `observedAt` ≤ envelope `observedAt`; `state.generatedAt ≤ observedAt`; admission
   `validUntil ≥ observedAt` and `observedAt ≤ evaluatedAt`.
6. `state` reuses the parsing discipline of `parseState` (exactly three regimes, unique, sorted; used ≤ total;
   `usedPercent ≤ 100`) reimplemented in contracts without importing telemetry (README duplication rule).
7. Closed vocabularies: coverage `status`, failure/discard/drop reasons, `unavailableReason`, `freshness`,
   admission `state`, `regime`; anything else is `invalid`.
8. Consistency: `complete:true` with any `failed` or `discarded` meter, or `admissions.status` ≠ `read`,
   or `dropped` non-empty → `invalid`; a `read` meter with an empty regime leaf list → `invalid`;
   `admissions.records` ≠ `admissions.length` → `invalid`; `records:0` requires `empty:true`.
9. Caps: `notes` ≤ 64 entries, each 1–4096 chars, no control characters; `producer`, `provenance` and
   `reason` identifiers ≤ 128 chars; `admissions` ≤ 1000; leaf arrays ≤ 256; strings in `state`
   ≤ 256 (`account`, `host`, `provider`, labels) or ≤ 4096 (`note`). Over-cap → `invalid`. Byte size
   is the transport's concern; the producer's stdout is bounded by construction.
10. The decoder reads no clock and performs no I/O; `freshness` and `availability` are the producer's
    verdict at `evaluatedAt`.

## 4. The producer — `dsh-telemetry governance`

- Signature: `dsh-telemetry governance --observations-from <absolute-descriptor-path> [--now <iso>] [--home <path>]`.
  Output is always the JSON document (one object, trailing newline); `--json` is accepted and ignored.
- Refused with exit 2 before any I/O: missing `--observations-from`; the `file:` alias; `--observations`;
  `--items`, `--run`, `--kind`, `--limit`, `--since`. The legacy file envelope is not a producer input.
- Collection: `parseSource` → `readLiveLog` (admissions) → `collectGovernance(source, log, services, now?)`
  unchanged; no transcript backfill, no items, no rendering.
- Projection: new `packages/telemetry/src/governance/read.ts` maps `ParsedGovernance` plus the new
  structured `coverage` into `GovernanceReadSnapshot` field by field (the `public.ts` discipline), with a
  compile-time `satisfies` against contracts' closed reason tuples so the producer cannot emit an unlisted code.
- Structured coverage: `composeGovernance` returns `coverage: {usage, spend, capacity, admissions}`
  next to `notes`; `mapAdmissions` returns `codes` next to `notes`. Note strings stay for `status` and `tree`.
- Exit: 0 when `complete`; 3 otherwise (including `unavailable`); 2 usage; 1 internal failure.
- Privacy: descriptor paths, `denoBin`, `credentialEnv` names, model IDs, response metadata and
  admission `detail` never enter the document; a canary test asserts absence.

## 5. Version and compatibility decision

- `@rickylabs/harness-contracts` **0.1.0 → 0.2.0**, `PROTOCOL_VERSION` stays 1, `dsh.protocol` stays 1.
  Rationale: 0.1.0 is published (research §3); the change is additive exports only (README "Add before
  removing", 0.x minor rule); no frame, event, `RemoteSnapshot`, hub or fold semantics change, so no
  protocol bump and no protocol-1 semantics silently changed.
- #265 does not get 0.2.0. Its earlier draft expectation is superseded here (drift D-1); its version is
  recalculated when it has a source implementation. One release promise at a time.
- Consumer statement to publish in the contracts README: a consumer on 0.1.0 has no decoder and must
  install ≥ 0.2.0 to read `GovernanceReadSnapshot`; 0.2.0 removes nothing and changes no wire behaviour;
  the document is not served by the hub, not folded, and not part of `RemoteSnapshot`.
- Source merge and `npm pack` are not publication. Publication requires the owner to tag
  `harness-contracts-v0.2.0` on a `main` commit; downstream OpenAPI and client receipts are the backend's.

## 6. Executable tests and gates

### 6.1 Contracts decoder negatives (`src/governance-read.test.ts`, node --test)

| # | Input | Expected |
| --- | --- | --- |
| N1 | `null`, `"x"`, `[]` | `unreadable` |
| N2 | object without `schema` | `unsupported-schema`, `schema:null` |
| N3 | `schema:2` | `unsupported-schema`, `schema:2` |
| N4 | `protocol:2` | `unsupported-schema`, `protocol:2` |
| N5 | extra top-level key `admissionsDetail` | `invalid` naming the key |
| N6 | `availability:"unavailable"` with non-null `state` | `invalid` |
| N7 | `availability:"fresh"` with `state:null` | `invalid` |
| N8 | `sources` missing `approvals`, or `approvals.status:"read"` | `invalid` |
| N9 | meter `status:"read"` without `validUntil` | `invalid` |
| N10 | `usage` read but `subscription.accounts` empty | `invalid` |
| N11 | `failed` with `reason:"dns"` | `invalid` (closed vocabulary) |
| N12 | a note of 4097 characters, or a note containing an ASCII control character (U+0000 to U+001F) | `invalid` |
| N13 | admission with `accepted:true` | `invalid` |
| N14 | admission `state:"allow"` | `invalid` |
| N15 | admission `reason:"quota paced /home/x"` | `invalid` (identifier regex) |
| N16 | capacity leaf `observedAt` later than envelope `observedAt` | `invalid` |
| N17 | `validUntil` before `observedAt` | `invalid` |
| N18 | `evaluatedAt` before `observedAt` | `invalid` |
| N19 | two `metered` regimes, or only two regimes | `invalid` |
| N20 | 1001 admissions | `invalid` |
| N21 | `complete:true` with `spend` `failed` | `invalid` |
| N22 | `complete:true` with `admissions.dropped:["admission-conflict"]` | `invalid` |
| N23 | `ramUsedBytes:5` with `ramTotalBytes:4` → `invalid`; `ramTotalBytes:null` with used set → ok (unbounded) | as stated |
| N24 | all four sources `not-configured`, `unavailableReason:"not-configured"` | ok, `state:null` |
| N25 | `unavailableReason:"no live sources"` | `invalid` |
| N26 | `records:1` with `admissions:[]` | `invalid` |
| P1–P3 | committed fixtures decode `ok:true` with the expected coverage per fixture | pass |

### 6.2 Telemetry producer tests (`src/cli.test.ts`, `src/governance/read.test.ts`, `compose.test.ts`)

| # | Scenario (fake services, temp home, no network) | Expected |
| --- | --- | --- |
| T1 | `usage` probe rejects with `SourceError("timeout")`; `spend:null`; capacity fake `1024`/`4096`; log holds one recorded refusal (item 7, subscription, throttle, `quota-paced`) | exit 3; decodes `ok:true`; `sources` = usage `failed/timeout`, spend `not-configured`, capacity `read/fresh`, admissions `read, records:1, empty:false, dropped:[]`, approvals `not-observed`; `complete:false`; `availability:fresh`; capacity leaf `observedAt` = reader clock; admission `reason` `quota-paced`, no `detail` key |
| T2 | canaries: credential value, private detail, cgroup path, `denoBin`, model id, `credentialEnv` name | none appear in stdout |
| T3 | `--observations-from file:<x>`; `--observations <x>`; `--items <x>` | exit 2, fixed usage diagnostic, no source I/O (fake services assert zero calls) |
| T4 | descriptor all `null` | exit 3; `availability:unavailable`; `unavailableReason:not-configured`; `state:null`; all sources `not-configured` |
| T5 | `usage` configured, env unbound | `usage` `failed/credential-unbound` |
| T6 | degraded log → `admissions` `failed/log-unreadable`; conflicting same-time decisions → `read, records:0, empty:true, dropped:[admission-conflict]` | as stated |
| T7 | `--now` after `validUntil` | `availability:stale`; meters `freshness:stale`; admissions `freshness:stale` |
| T8 | `--now` before completion | `availability:unavailable`, `unavailableReason:envelope-invalid` |
| T9 | fixed clock → stdout byte-equal to committed fixture `mixed-timeout.json`; unavailable fixture likewise | pass |
| T10 | `composeGovernance` coverage codes equal the note codes for every refusal in `SourceRefusal` | pass (proves the two outputs agree; the producer path never parses notes) |

### 6.3 Installed-package end-to-end (`scripts/check-installed-contracts.mjs`, new; root script `check:installed`)

1. `pnpm -r build` prerequisite; `npm pack` contracts into a temp dir; `npm install --offline` the
   tarball into a temp consumer package (proven runnable 2026-09-07, research §4.1).
2. Write a synthetic descriptor: `usage.denoBin` = a temp executable that sleeps past `timeoutMs` (a real
   `timeout`), `usage.probe` and `checkout` = temp files, `spend: null`, `capacity.cgroupRoot` = temp dir with
   `memory.current` and `memory.max`, `admissions` from a temp `DSH_TELEMETRY_DIR` seeded via
   `dsh-telemetry record` with one `governance.admission` event.
3. Run `node packages/telemetry/dist/cli.js governance --observations-from <descriptor>`; expect exit 3.
4. Decode stdout with the **installed** `readGovernanceSnapshot`; assert `ok:true`, the coverage of T1,
   `complete:false`, admission present with `accepted:false`, and canary absence.
5. Repeat with an all-null descriptor; expect exit 3 and `unavailable`.
6. Exit non-zero on any assertion. Timestamps are whatever the run produces; nothing is committed.

### 6.4 Repository gates (all runnable here today)

`pnpm run typecheck`, `pnpm run build` (includes `check:publish` and `check:docs` after `pnpm run docs:cli`),
`pnpm test`, `pnpm run check:installed`, `git diff --check`. CI (`ci.yml`) runs the first three; the plan
adds `check:installed` as a CI step after `test`.

## 7. Mutation inventory (finite; nothing else)

| Path | Change |
| --- | --- |
| `packages/contracts/src/governance-read.ts` | new: types, constants, `readGovernanceSnapshot` |
| `packages/contracts/src/governance-read.test.ts` | new: §6.1 |
| `packages/contracts/src/index.ts` | export the above from the root entry |
| `packages/contracts/test-fixtures/governance-read/mixed-timeout.json`, `unavailable-not-configured.json`, `stale.json` | new synthetic fixtures with fixed synthetic timestamps; outside `src`, not in the tarball |
| `packages/contracts/package.json` | `version` 0.1.0 → 0.2.0 |
| `packages/contracts/README.md` | section "Governance read document" and the compatibility statement §5 |
| `packages/telemetry/src/governance/compose.ts`, `admissions.ts` | return structured `coverage` and `codes` beside notes |
| `packages/telemetry/src/governance/read.ts` and `read.test.ts` | new projection to `GovernanceReadSnapshot` |
| `packages/telemetry/src/cli.ts` | `governance` command, usage text, refusals |
| `packages/telemetry/src/cli.test.ts`, `governance/compose.test.ts` | §6.2 |
| `packages/telemetry/README.md` | command section; "not a second authority" note on the file envelope |
| `docs/reference/cli/dsh-telemetry.md` | regenerated by `pnpm run docs:cli` |
| `scripts/check-installed-contracts.mjs`, root `package.json` | §6.3 |
| `.github/workflows/ci.yml` | one step: `pnpm run check:installed` |
| `.llm/runs/published-governance--205/*` | run artifacts |

Untouched: `snapshot.ts`, `events.ts`, `fold.ts`, `server.ts`, `client.ts`, `routes.ts`, `connection.ts`,
`packages/dsh-app`, `packages/governance`, `packages/netscript-bridge`, `packages/board`, sibling repos,
hosts, GitHub state, tags.

## 8. Decisions

1. **Option A over B.** Rationale in the summary; alternative rejected: a fabricated `RemoteSnapshot`.
2. **Root entry, no new subpath.** The decoder is pure and small; a new export target would also change
   `check-publish`'s required-file list for no consumer benefit. Rejected: a `./governance` subpath.
3. **Strict document, versioned by `schema`.** Unknown keys are refused; additions bump `schema`.
   Rejected: the frame rule "payload not validated", because here the payload is the contract.
4. **`protocol: 1` carried in the document** to pin the embedded `GovernanceState` shape; changing that
   shape is a protocol change wherever it appears. Rejected: omitting it and inferring from the package.
5. **Coverage from structured codes, never notes.** `composeGovernance` and `mapAdmissions` grow a typed
   output; notes remain for text rendering. Rejected: a regex over `"<leg>: <code>"`.
6. **Admission `detail` and `approval` not carried.** Today's detail is a fixed sentence and approval is
   withheld; publishing a placeholder would invite consumers to render it as information.
7. **`sources.approvals: not-observed` is explicit** rather than letting `pending: []` read as "none".
8. **The command refuses the legacy file envelope**, so the observation file cannot become a producer
   input that silently reports `complete:true` (research §4.2).
9. **0.2.0, protocol 1; #265 recalculated later.** §5.
10. **Fixtures live in contracts** (`test-fixtures/`, outside the tarball); telemetry tests byte-lock the
    producer to them under a fixed clock; the installed check compares structurally under a real clock.
11. **No `--clock` flag.** Completion stays the real clock; tests inject `services.clock`; `--now` keeps its
    documented meaning as the evaluation clock.
12. **CI gains one step.** A gate that only runs by hand is unproven (PRINCIPLES §6).

## 9. Owner steps and non-forks

No open owner fork. The version choice was owner-steered (supervisor.md); the product boundary
(governance read before #265, no dispatch, no server) is accepted. Owner-only steps after merge:
tag `harness-contracts-v0.2.0` on the merged `main` commit; the backend installs 0.2.0 and returns its
own decode receipt. Neither is claimed by this plan.

## 10. Dependency order

S0 lock this plan (independent evaluation) → S1 contracts type, decoder, fixtures, negatives →
S2 telemetry structured coverage (compose, admissions) with tests → S3 `governance` command, read
projection, byte-lock tests → S4 `check:installed` script, CI step, both READMEs, `docs:cli` →
S5 full gates (§6.4) → S6 independent implementation evaluation at the exact head → owner merge →
owner tag and publish → backend receipt. S1 and S2 are independent; S3 needs both; S4 needs S3.

## 11. Risk register

| Risk | Likelihood | Impact | Gate |
| --- | --- | --- | --- |
| Producer emits a reason code outside contracts' tuple | low | consumer refuses the document | compile-time `satisfies`; T10 |
| Two copies of the state parser drift (contracts vs telemetry) | medium | decoder refuses valid output | T9 byte-lock, P1–P3, `check:installed` |
| Consumer treats `availability:fresh` as completeness | medium | false health | `complete` refused when inconsistent (N21, N22); README statement |
| `check:docs` fails after usage text change | high if forgotten | build red | `pnpm run docs:cli` in S4 |
| Fixture timestamps read as real observations | low | misleading evidence | fixtures named synthetic, `producer` label, no host labels |
| `npm install --offline` unavailable on a host without an npm cache | low | check:installed cannot run there | the packed tarball has no dependencies; the script falls back to `--prefer-offline` |
| 0.2.0 seen as covering #265 | medium | wrong expectations | drift D-1; README sentence; #265 stays open |
| Oversize stdout from a hostile descriptor | low | consumer memory | producer caps inherited (`maxBytes`, notes ≤ 64); decoder caps |

## 12. Stop condition

This run stops after the independent plan evaluation. Implementation starts only on `PASS` or
`PASS AFTER NARROW FIXES` with the fixes recorded in `drift.md`.

[source: research.md §1–§5 (this run); topic: evidence for every decision above; 2026-09-07]
[source: supervisor.md; topic: authorization and ordering; 2026-09-07]
[source: packages/contracts/README.md:190-233; topic: versioning and deprecation policy; read 2026-09-07]
