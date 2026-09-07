# Published governance read path — #205 / #87 — independent plan evaluation

**Verdict: PASS.** The candidate under evaluation is `plan.md` **as governed by
`coordinator-amendment.md`** — the amendment is in force, not a proposal, and every one of its seven
corrections is implementable against code that exists at this head. With the binding interpretations
in §5, implementation may proceed (S1–S5 per plan §10). No owner fork remains open. This PASS is a
plan PASS at the exact head below; it is not an implementation PASS, and the synthetic end-to-end
gate it requires is evidence the plan demands, not evidence this evaluation ran a producer against
live sources.

**Summary of what was attacked and what held.** The plan-plus-amendment satisfies the first supported
governance read — standalone `GovernanceReadSnapshot` + one-shot `dsh-telemetry governance` CLI →
stdout JSON → `readGovernanceSnapshot` from the **packed, installed** contracts package — with no fake
`RemoteSnapshot` (none can be produced: `openHub` demands a full snapshot, and telemetry's inputs
cannot supply `generation`/`complete`/`repo`/`lifecycle`/board arrays) and no resident server. The
plan's three real defects (per-source provenance absent from `MeterCoverage`/`AdmissionCoverage`;
`complete:true` semantics that would invalidate the producer's own all-meters-read +
admissions-not-configured output; a `.github/workflows/ci.yml` edit the host cannot make) are each
settled by a specific amendment item, and I verified the producer/compose code confirms each
correction was necessary. One residual engineering hole neither document closes — the producer can in
principle emit more admissions than the decoder's 1000 cap accepts, contradicting "stdout is bounded
by construction" — is closed by binding interpretation BI-9 (fail closed, no invented truncation).
Everything else I attempted to break — three-clock discipline, unavailable-reason vocabulary mapping,
exit-code fit, flag-refusal feasibility, privacy canaries, version arithmetic, offline install —
verified sound against source.

## 1. Evaluation basis

| What | Value |
| --- | --- |
| Repository head | `01c523e894270700a8765d1bb0371cdaa7c0f1b8` ("docs: preserve repository-relative research citations"), branch `fix/205-published-governance`, 2 commits ahead of `origin/main`, working tree clean (verified before and after all checks; the only writes were gitignored `dist/` build state) |
| Session | Fresh independent plan evaluation, 2026-09-08. Route: `matrix-plan-evaluation.json` — role `plan_evaluation`, feature tier, `glm_5_3`/`provider_default` — distinct from the planner route (`matrix-plan.json`, plan: `fable_5_1` low) and from the coordinator-correction session |
| Inputs read | `plan.md` (locked, 2026-09-07), `research.md`, `coordinator-amendment.md` (governing over `plan.md`), `supervisor.md`, `drift.md`, `worklog.md`, `matrix-plan.json`, `matrix-plan-evaluation.json` |
| Method | Read-only source verification plus executable gates; no product edits, no commits, no push, no board mutation, no dispatch, no credential or `.env` access. The only file authored by this session is this one |
| Scope guard | No private consumer internals and no operator paths enter this artifact; all citations are repository-relative paths with line references |

## 2. Checks actually run (this session, 2026-09-08, at the head above)

| Command | Result |
| --- | --- |
| `git status --porcelain` / `git rev-parse HEAD` | clean; `01c523e…` (re-verified empty after all checks) |
| `pnpm --filter @rickylabs/harness-contracts test` | exit 0, fail 0 |
| `pnpm --filter @rickylabs/telemetry test` | exit 0, fail 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run check:publish` | `publish ok — @rickylabs/harness-contracts@0.1.0, protocol 1, 68 files, no tests` |
| `npm view @rickylabs/harness-contracts version dist-tags --json` | `0.1.0`; `latest: 0.1.0` (retrieved 2026-09-08 — the version baseline claim holds at evaluation time, not only from research) |
| Source inspection | `packages/contracts/src/{governance,snapshot,events,server,index}.ts`, `packages/contracts/{package.json,README.md}`, `scripts/check-publish.mjs`, `scripts/cli-reference.mjs`, root `package.json`, `.github/workflows/ci.yml`, `packages/telemetry/src/{cli,source,observations,public}.ts`, `packages/telemetry/src/governance/{compose,admissions,usage,spend,capacity}.ts`, `packages/telemetry/src/live.ts`, `packages/telemetry/src/cli.test.ts` — line-level reads cited per finding |

## 3. Findings and dispositions

Each finding names the attack, the evidence, and the disposition. "Settled by amendment" means the
amendment item is adopted as governing text and §5 states the binding interpretation implementation
follows.

**F-1 — Per-source provenance missing from the plan's coverage types (settled by amendment 1).**
`plan.md` §2 `MeterCoverage` read arm carries `observedAt`/`validUntil`/`freshness` but no provenance,
and `AdmissionCoverage` carries neither provenance nor a read timestamp; only `RecordedAdmission` has
`provenance`. Amendment item 1 requires each meter read to carry a safe producer-selected provenance
identifier, and admissions coverage to carry one plus a separate collected/evaluated timestamp, with
no manufactured decision-`observedAt` for an empty log. The code confirms this is implementable
without new producer capability: per-leg `observedAt`/`validUntil` already exist
(`packages/telemetry/src/source.ts:131-132`), reader-scope labels already exist in leg notes
(`usage.ts:20`, `spend.ts:11`, `capacity.ts:18-19`), and admission provenance is replaced reader-side
(`admissions.ts:63-65`). Binding: BI-1.

**F-2 — Plan rule 8 contradicts the producer's own completeness (settled by amendment 2).**
`plan.md` §3 rule 8 refuses `complete:true` when `admissions.status ≠ "read"`. But the producer's
`ok` stays `true` with a null admissions source (`compose.ts:42-46`), so all-three-meters-read +
admissions-not-configured emits `complete:true` — which the plan's decoder would call `invalid`.
Amendment item 2 fixes the semantics: completeness = all **configured** requested evidence read and
valid; a not-configured admissions source alone cannot force invalid; all-unconfigured remains
unavailable/incomplete (`compose.ts:48-50` returns `ok:false` there — T4/N24 unchanged). The plan's
N21 (configured `spend` failed + `complete:true`) and N22 (`dropped` non-empty + `complete:true`)
remain valid negatives under the amended reading. Binding: BI-2.

**F-3 — Availability/freshness not checked against the clock (settled by amendment 3).**
Plan rule 5 orders timestamps but never verifies `availability`/`freshness` agree with `evaluatedAt`
and the validity intervals. Amendment item 3 requires it, plus real-calendar validation and finite
numeric ranges. The repository already owns the real-date discipline the decoder must reimplement:
`source.ts:57-69` rejects February 30 and hour 24 that the ISO regex alone
(`observations.ts:84`) would admit. Binding: BI-3.

**F-4 — Unread sources could carry data, and the fixture set does not round-trip every producer
outcome (settled by amendments 1 and 3).** A failed/discarded/not-configured leg becomes an unread
placeholder regime (`compose.ts:18-22`, `:40`); a read leg carries leaves. The plan's decoder does
not check that coverage status agrees with the paired regime payload, and its three fixtures
(mixed-timeout, unavailable-not-configured, stale) omit outcomes the amendment explicitly requires
to round-trip: no-successful-meter-but-valid-admissions, degraded log, conflicting admissions.
Binding: BI-4, BI-5.

**F-5 — Decoder hostile-shape and exception bounds unspecified (settled by amendment 4).**
Plan rules 1–9 cover unknown keys, vocabularies, caps and timestamp ordering but say nothing about
cyclic input, throwing accessors, sparse arrays, `Object.create(null)`, nonfinite numbers,
wrong-prototype values, or exception containment. Amendment item 4 supplies the requirement, adds
honest limits (no side-effect-freedom claim for arbitrary hostile JS; JSON is the operational
boundary), requires independently owned readonly normalized output, and forbids Node-only imports in
contracts (the package has zero dependencies — `packages/contracts/package.json` declares none).
Binding: BI-6.

**F-6 — CI workflow edit is both unnecessary and outside host authority (settled by amendment 5).**
Plan §6.4 and §7 add a step to `.github/workflows/ci.yml`. Amendment item 5 replaces that with an
existing CI-executed root script. Verified executable today: root `test` is `pnpm -r run test`
(root `package.json:27`), CI runs `pnpm run build` then `pnpm test` (`.github/workflows/ci.yml:61-63`),
and each package's `test` script builds itself (`tsc -b && node --test`), so chaining the installed
gate after the recursive test satisfies "after the workspace build" with zero workflow mutation. The
amendment also forbids the plan §11 `--prefer-offline` fallback: the tarball has no dependencies, so
`npm install --offline <tgz>` needs no network and no cache of remote metadata; failure remains
failure. Binding: BI-7. Plan §6.4/§7's `ci.yml` line is **superseded** — record in `drift.md` when
implementation begins.

**F-7 — Installed-package receipt too thin in the plan (settled by amendment 6).**
Plan §6.3 step 4 decodes stdout with the installed decoder. Amendment item 6 extends the receipt to
root **and** `/server` runtime+types from the actual packed installed package, plus
version/digest/unchanged-protocol, and forbids any downstream API/client compatibility claim. The
exports map already serves both targets (`packages/contracts/package.json:29-39`). Binding: BI-8.

**F-8 — Artifact-hygiene corrections (settled by amendment 7).** Worklog `20:1xZ` entries are
ordering placeholders, not receipts; `research.md:5-6` "reachable solely as a field of `RemoteSnapshot`"
means the missing runtime read path, not that the types are unimportable — `GovernanceState` and
friends are direct root-entry exports (`packages/contracts/src/index.ts:117-134`, verified). Relative
links in run artifacts are corrected when the implementation run touches them. Binding: BI-10.

**F-9 — Producer-side cap enforcement hole (my finding; closed by binding interpretation).**
Plan §3 rule 9 caps `admissions` at 1000 (N20 refuses 1001) and §3 claims "the producer's stdout is
bounded by construction", but no producer mechanism enforces the document caps: the log read is an
unbounded `readFile` (`packages/telemetry/src/live.ts:73-77`) and rotation bounds only the writer
(`observability.ts:138-145`). A log holding >1000 distinct current `item:regime` refusal groups would
make the producer emit a document its own decoder refuses. Closed by BI-9 (fail closed; no
truncation, which would be invented evidence; no new drop reason, which is a schema change). This is
an engineering consequence, not an owner fork.

**F-10 — Verified sound; no fix needed.** Attacked and held:

- *Three clocks stay distinct.* Usage `observedAt` is probe capture time (`usage.ts:9`), spend and
  capacity are reader-stamped (`spend.ts:9-10`, `capacity.ts:15-16`), completion is separate
  (`cli.ts:752`), `--now` is the evaluation clock, and the decoder orders leaf ≤ envelope, envelope
  ≤ evaluatedAt, `generatedAt ≤ observedAt` (plan rule 5; `compose.ts:51-53` sets
  `generatedAt = completion`).
- *Unavailable-reason vocabulary mapping is coherent.* The producer emits free prose
  (`compose.ts:21`, `:49`, `:56` — "no successful live sources"); the document's closed
  `UNAVAILABLE_REASONS` (`plan.md` §2) is derived by the projection from structured coverage
  (all-not-configured → `not-configured`; otherwise no successful expiry → `no-successful-sources`;
  `envelope-invalid` as-is), and N25 proves the decoder refuses the raw prose. T4's
  `not-configured` expectation is therefore reachable, not asserted.
- *Exit codes fit the existing disjoint vocabulary.* `EXIT = {ok:0, failed:1, usage:2, incomplete:3,
  notFound:4}` (`cli.ts:63-69`); the governance exits (0/3/2/1) reuse it, and `EXIT_MEANINGS` + USAGE
  regenerate through `docs:cli` — `scripts/cli-reference.mjs` byte-compares
  `docs/reference/cli/dsh-telemetry.md` against the built binary, so the plan's "check:docs fails
  after usage text change" risk (§11) is real and gated in S4.
- *Strict flag refusal is implementable before any I/O.* The flags the governance command must
  refuse all exist in today's parser (`cli.ts:222-252`, USAGE `:102-111`); `--observations` and
  `--observations-from` are already mutually exclusive and `--observations-from` is already
  command-gated (`cli.test.ts:951-952`), so extending `parseFlags` for the `governance` command while
  refusing `file:`, `--observations`, `--items`, `--run`, `--kind`, `--limit`, `--since` in the
  command handler is a bounded change. T3's "fake services assert zero calls" enforces the
  before-any-I/O property.
- *No transcript backfill on the governance path.* Current `main` scans unconditionally before
  command dispatch (`cli.ts:483`); the plan's "no transcript backfill, no items, no rendering" (§4)
  means the governance path short-circuits ahead of it. Implementation constraint, inside the
  `cli.ts` mutation.
- *Option A is the only honest shape.* No `RemoteSnapshot` producer exists; `openHub` requires a full
  snapshot (`packages/contracts/src/server.ts:124`), `RemoteSnapshot` requires
  `generation/complete/repo/lifecycle`/board arrays (`snapshot.ts:54-70`), and the hub opens nothing
  (`server.ts:14-17`). Option B would fabricate board data or need a resident service; neither is
  requested. `RemoteSnapshot`, `PROTOCOL_VERSION`, hub, fold are untouched (plan §7), so no board
  protocol changes.
- *Version arithmetic is right.* 0.1.0 is published (npm registry, retrieved this run); the change
  is additive exports only; the README's 0.x rule makes it a minor and "Add before removing" governs
  (`packages/contracts/README.md:190-214`, `:220-232`); `check:publish` enforces
  `PROTOCOL_VERSION === dsh.protocol` (`scripts/check-publish.mjs:145-149`); releases are cut by
  owner tag only on a `main` ancestor (`README.md:240-252`). Protocol stays 1; 0.2.0 is a candidate
  and is **unpublished until the owner tags `harness-contracts-v0.2.0`**. Drift D-1 stands: #265 gets
  a version when it has a source implementation.
- *Privacy discipline is inherited, not invented.* The projection follows the `public.ts` allowlist
  doctrine (`public.ts:1-21`); admission detail is withheld and replaced reader-side
  (`admissions.ts:61-65`); canary tests already prove credential/private-detail/cgroup-path absence
  in the live path (`cli.test.ts:722-725`, `:825`); T2 and §6.3 step 4 extend the same canaries to
  the governance document and the installed path. Descriptor paths, `denoBin`, `credentialEnv` names
  and model IDs have no route into the document fields; coverage fields are codes, timestamps and
  safe identifiers only. The `account`/`host` labels carried inside `state` are operator-configured
  `safeLabel`s already published today via `PublicGovernance` — no new exposure.
- *Approvals stay honestly unknown.* `pending` is always `[]` from the live composer
  (`compose.ts:16`, `:53`); the document says `approvals: not-observed` instead of letting an empty
  array read as "none" (plan decision 7).
- *Unbounded capacity is representable.* `memory.max` = `max` → `ramTotalBytes: null`
  (`capacity.ts:13`), and decoder N23 accepts used-set/total-null while refusing used > total.

## 4. Test and gate deltas required beyond the plan's written inventory

All are consequences of governing amendment items, not new design; record them in `drift.md` when the
implementation run begins:

1. §6.1 negatives gain: read meter without provenance; read admissions coverage without
   provenance/collected timestamp; `complete:true` with `admissions.status:"not-configured"` (valid,
   per BI-2); unread meter with populated regime (BI-4); availability/freshness contradicting
   `evaluatedAt`; non-real calendar date (e.g. February 30) that the regex admits; nonfinite numeric
   field; cyclic object, throwing accessor, sparse array, `Object.create(null)`, over-cap collection
   (BI-6).
2. Fixtures (still `test-fixtures/`, outside `src`, not in the tarball — the `files` list is
   `["dist","src",…]`, `packages/contracts/package.json:40-45`) extend per BI-5: admissions-only
   success, degraded log, conflicting admissions, all-meters-read + admissions-not-configured.
3. §6.2 producer tests gain: the BI-2 complete-true case and the BI-9 over-cap admissions case
   (exit 1, nothing on stdout).
4. §6.3 executes via the root `test` chain (BI-7) and asserts the BI-8 receipt.
5. §7 mutation inventory: **remove** the `.github/workflows/ci.yml` row; root `package.json` gains
   both the `check:installed` script and the test-chain hook; fixture files grow per BI-5.
   `--prefer-offline` is deleted from §11.

## 5. Binding interpretations (implementation proceeds on these)

- **BI-1 Provenance fields.** `MeterCoverage` read arm gains `provenance: string`; `AdmissionCoverage`
  read arm gains `provenance: string` and `collectedAt: string` (the producer's log-read clock —
  completion — never a decision `observedAt`; an empty log therefore never manufactures one). Values
  are safe identifiers (≤128 chars, `^[A-Za-z0-9][A-Za-z0-9._:-]*$`), producer-selected per reader
  scope, naming reader/scope only — not trust, not an account identity, not a path. Item-level
  `RecordedAdmission` keeps its original stamps and provenance. The decoder requires these on read
  arms. Fixtures prove each source survives independently.
- **BI-2 Completeness.** `complete:true` is invalid iff any *configured* meter is `failed`/`discarded`,
  or admissions is `failed`, or a `read` admissions source is self-inconsistent
  (`records ≠ length`, `records:0` without `empty:true`, non-empty `dropped`). A `not-configured`
  admissions source does not alone invalidate `complete:true`. All-unconfigured stays
  `unavailable` + `complete:false` (exit 3).
- **BI-3 Clock consistency.** `availability:"fresh"` ⟺ `evaluatedAt ≤ validUntil`; `"stale"` ⟺
  `evaluatedAt > validUntil`; meter and admission `freshness` judged identically against their own
  `validUntil` and `evaluatedAt`. Timestamps must be real calendar instants (days-in-month, hour ≤ 23,
  per the `source.ts:57-69` discipline) and every numeric field must be finite.
- **BI-4 Coverage↔regime pairing.** `usage↔subscription`, `spend↔metered`, `capacity↔capacity`. A
  non-`read` meter must pair with the unread placeholder (empty leaf array, non-null note); a `read`
  meter must pair with nonempty leaves (plan rule 8 / N10 already gives one direction).
- **BI-5 Round-trip fixtures.** The committed fixture set covers every producer outcome: partial
  success (mixed-timeout), all-unconfigured, stale, admissions-only success, degraded log,
  conflicting admissions, and complete-true-with-admissions-not-configured.
- **BI-6 Decoder containment.** The whole decode is exception-contained: any throw becomes a refusal
  (`unreadable` at the top level, `invalid` below it); diagnostics name schema-owned paths/indices,
  never input values; the returned snapshot/state is deep-cloned, independently owned readonly data
  — never an alias into the caller's input; no Node-only import enters contracts. The contracts
  README states the honest limit: the decoder is specified for JSON-derived values; arbitrary hostile
  JS may run accessors before the decoder is called, and no side-effect-freedom is claimed for it.
- **BI-7 Gate wiring.** Root `package.json` gains `check:installed` and the root `test` chain runs it
  after `pnpm -r run test`; **no `.github/workflows` mutation**. Install is `npm install --offline
  <tarball>` only — the `--prefer-offline` fallback is removed; failure remains failure. The script
  asserts required `dist` files exist (clear failure for a direct run on an unbuilt tree), owns its
  temp dirs and children with cleanup on exit, and relies on the CLI's own SIGKILL-on-timeout
  (`cli.ts:671-675`) so the timeout fixture leaks no grandchildren.
- **BI-8 Installed receipt.** The packed installed consumer asserts: version `0.2.0`;
  `PROTOCOL_VERSION === 1 === dsh.protocol`; root entry runtime import yields
  `readGovernanceSnapshot` as a function; the `/server` subpath resolves at runtime and both
  `dist/index.d.ts` and `dist/server.d.ts` exist in the installed tree; the tarball digest is
  recorded in the receipt. The receipt claims nothing about downstream APIs, clients, or upgrades.
  Publication stays owner-only: tag `harness-contracts-v0.2.0` on a merged `main` commit.
- **BI-9 Producer cap enforcement.** The read projection enforces the document's own caps
  before serialization. On over-cap composed evidence (e.g. >1000 admission groups) the producer
  fails closed: exit 1, no document on stdout ("output is always the JSON document" applies to exits
  0/3), a fixed non-input diagnostic on stderr. No truncation (invented evidence) and no new drop
  reason (a schema change this slice does not need). A producer negative test covers it.
- **BI-10 Artifact hygiene.** Worklog clock entries are approximate ordering, not exact receipts;
  run artifacts use dated attribution; the research wording correction (F-8) is adopted; relative
  links in run artifacts are corrected when next touched.

## 6. What this PASS does not claim

- 0.2.0 is a **candidate**; it is unpublished until the owner tags and releases it. No upgrade path,
  downstream OpenAPI, or client compatibility is implied or inferred — a 0.1.0 consumer has no
  decoder and must install ≥ 0.2.0 (plan §5).
- Live operational acceptance of #205/#87 is **not** closed by this slice: the end-to-end evidence
  is synthetic by design, and the amendment's acceptance line stands. #265 (reconnect freshness)
  remains open and untouched.
- Named unknowns stay unknown, not passing: pending approvals (`not-observed`), binding windows,
  spend ceilings, GPU capacity, dispatch-host capacity, regime policy states.
- No hub, HTTP or socket transport is added; `RemoteSnapshot`, the fold, `governance.changed`, the
  hub and the dsh-app projection are untouched; no live dispatch and no new provider surface.
- This evaluation ran gates and source verification only; a partial passing probe anywhere is not
  an implementation PASS — that is S6's separate step at the exact head.

## 7. Sources

[source: .llm/runs/published-governance--205/plan.md, research.md, coordinator-amendment.md,
supervisor.md, drift.md, worklog.md, matrix-plan.json, matrix-plan-evaluation.json; topic: the
candidate under evaluation and its governance; read 2026-09-08]
[source: packages/contracts/src/governance.ts:36-47,118-136,204-209; snapshot.ts:54-70;
events.ts:54,140-225; server.ts:14-17,124; index.ts:117-134; topic: published shapes, protocol,
hub purity; read 2026-09-08]
[source: packages/contracts/package.json:3,29-45; README.md:190-214,220-252;
scripts/check-publish.mjs:140-176; topic: version policy, exports, publish gates; read 2026-09-08]
[source: packages/telemetry/src/source.ts:4-69,87-132; governance/compose.ts:15-59;
governance/admissions.ts:6-94; governance/usage.ts:5-21; governance/spend.ts:4-14;
governance/capacity.ts:10-22; observations.ts:53-84,142-173,303-369,385-430; public.ts:1-21,223-245;
cli.ts:63-69,78-84,185-252,452-480,483,565-605,627-754; live.ts:58-106; topic: producer
capability, coverage loss points, clocks, services seam, log bounds; read 2026-09-08]
[source: packages/telemetry/src/cli.test.ts:43-56,145-181,720-849,951-952; topic: existing test
seams, canaries, flag parser constraints; read 2026-09-08]
[source: root package.json:25-27; .github/workflows/ci.yml:53-63; scripts/cli-reference.mjs:1-45;
topic: gate wiring without workflow mutation, docs byte-compare; read 2026-09-08]
[source: https://registry.npmjs.org/@rickylabs/harness-contracts (via npm view); topic: 0.1.0
publication state at evaluation time; retrieved 2026-09-08]
[source: executed checks §2; topic: baseline green at 01c523e; run 2026-09-08]
