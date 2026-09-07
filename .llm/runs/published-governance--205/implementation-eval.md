# Implementation evaluation — published governance read slice (#205 / #87)

**Verdict: PASS.** The reviewed slice — versioned standalone governance JSON producer
(`dsh-telemetry governance`) → installed contracts decoder (`readGovernanceSnapshot`) —
implements plan.md as governed by coordinator-amendment.md and plan-eval.md BI-1–BI-10,
at the exact source head below. No repair required; no repair made. This PASS covers the
tested source head only. It is not registry publication, backend/OpenAPI/native
compatibility, full #205/#87 live acceptance, recovery #265, or a release. Owner alone
releases 0.2; protocol stays 1.

## Basis

| What | Value |
| --- | --- |
| Exact source head | `8185ea6394bbd0dc9006ffd04abe841122ccbbca`, working tree clean before and after all checks |
| Product implementation | `e6c14d9` (one product commit over receipt-only `89933b6`; head commit `8185ea6` adds only run-identity/verification receipts) |
| Baseline diffed | `8fd096d` (main baseline); all product/test/script/docs changes reviewed file by file |
| Reviewer route | Fresh independent reviewer, `muse_spark_1_3` / xhigh, family meta — different family from implementer Astra/OpenAI; recheck confirms unchanged route/loop policy; identity coordinator-verified as `muse-spark-1.3-contributor` / `opencode-go` / xhigh |
| Scope | One reviewed code slice only: `GovernanceReadSnapshot` producer → installed contracts decoder. Not full live acceptance, not #265, not release. No replacement coordinator or subagents |
| Method | Read-only source review plus independently executed gates and adversarial probes; writer receipts re-ran, never trusted. No product/test/docs edits, commits, pushes, PRs, board, tag, publish, host actions, sibling writes, credential/`.env`/operator-config reads, or live providers |

## What was attacked and what held

Per-source provenance: each meter `read` arm carries `observedAt`, `validUntil`,
`freshness` plus a safe producer-selected provenance identifier; admissions `read` carries
`records`, `empty`, `dropped`, `provenance` and a separate `collectedAt` (log-read clock,
never a manufactured decision time); item admissions keep original stamps. Decoder requires
all of them and rejects path-shaped provenance.
[source: packages/contracts/src/governance-read.ts:15-26,367-398;
packages/telemetry/src/governance/compose.ts:17,54-55,63-67]

Clock relations: `availability`/`freshness` are validated against `evaluatedAt` and the
validity intervals (fresh ⟺ `evaluatedAt ≤ validUntil`); leaf `observedAt` ≤ envelope
`observedAt`; `generatedAt ≤ observedAt`; admission intervals against the envelope; envelope
`validUntil` is the earliest retained expiry; real-calendar dates and finite numerics
enforced. False-fresh, reversed-interval, future-envelope, February-30, hour-24, NaN and
Infinity inputs are all refused (own probes D6, D11, D16).
[source: packages/contracts/src/governance-read.ts:141-152,357-365,447-474]

Stale vs failed/unconfigured: staleness is availability (`--now` past `validUntil` yields
`stale` with `complete:true` and exit 0 — stale is not incompleteness); failure and
not-configured are coverage states with closed reason codes, and the producer's structured
codes agree with the fixed display notes (suite T10 equivalent re-verified).
[source: packages/telemetry/src/governance/compose.ts:38-56;
packages/contracts/src/governance-read.ts:367-379]

Configured-complete vs empty census: `complete:true` is invalid iff a configured meter is
`failed`/`discarded`, admissions is `failed`, or a `read` admissions source is
self-inconsistent (`records ≠ length`, `records:0` without `empty:true`, non-empty
`dropped`); a `not-configured` admissions source alone does not invalidate `complete:true`
(BI-2, verified with the `complete-without-admissions` fixture); all-unconfigured stays
`unavailable` + `complete:false`. Collector vs decoder on the empty log, stated precisely:
the current collector reports an observed empty log as `read`/`records:0`/`empty:true` with
collection provenance/time and still emits `complete:false` (its `ok` requires zero notes,
and the empty scope adds a `no-admissions` note) — that is producer policy, and the README
labels it as the current collector's behavior. The decoder permits `complete:true` alongside
self-consistent empty-read admissions coverage (see targeted follow-up below); it does not
reject it, and this evaluation claims no such decoder rejection. No invented decision
timestamp, no claim beyond the configured log scope either way. `approvals:not-observed` is
the only value and `state.pending` must stay empty; a non-empty pending is refused, so no
empty array can read as an approval census (probes D1, D8, D18).
[source: packages/contracts/src/governance-read.ts:438-445,466-476;
packages/telemetry/src/governance/compose.ts:60-69;
packages/telemetry/src/governance/admissions.ts:95-97]

Admission refusals, not execution: only `accepted:false` with `state` throttle/pause decodes;
`accepted:true`, `state:allow`, and non-identifier reasons (spaces, slashes, paths) are
refused; `detail`/`approval` are never carried — the projection emits no `detail` key at all
(probes D9, C8).
[source: packages/contracts/src/governance-read.ts:400-408;
packages/telemetry/src/governance/read.ts:14-18]

Leaf pairing: every non-`read` meter pairs with an empty, noted regime; every `read` meter
pairs with nonempty leaves whose `observedAt` equals the coverage `observedAt`; admissions
`records` equals payload length and `collectedAt` equals the envelope observation
(probe D13). Discarded-with-partial-success round-trips: a discarded usage alongside a
retained capacity leaf decodes `complete:false`, and the same document with `complete:true`
is refused (own inline probe).
[source: packages/contracts/src/governance-read.ts:453-474]

Decoder containment and privacy: the whole decode is exception-contained (top-level throws
→ `unreadable`, inner throws → `invalid`); diagnostics name schema-owned fields/indices and
never echo input keys or values (canary-bearing negatives verified byte-absent); output is
deep-cloned independently owned readonly data — input mutation after decode is inert and no
alias into caller input is returned (probes D14, D15, D17). Cyclic, sparse, null-prototype,
wrong-prototype, revoked-proxy and throwing-accessor inputs are refused without invoking
accessors (call counts zero) and without uncaught throws. No Node-only import enters
contracts. The README states the honest Proxy limit: JSON is the operational boundary.
[source: packages/contracts/src/governance-read.ts:75-104,341-348,413-481;
packages/contracts/README.md]

CLI discipline: `governance` refuses missing `--observations-from`, the `file:` alias, and
`--observations`/`--items`/`--run`/`--kind`/`--limit`/`--since` (plus extra positionals and
bad `--now`) with exit 2 and a fixed stderr diagnostic before any source I/O; it scans no
transcripts (regular-file-as-home succeeds) and performs no rendering; `--json` is accepted
and ignored. Over-cap composed evidence fails closed through the projection's pre-serialization
decoder check: exit 1, empty stdout, fixed stderr — verified end to end with 1001 real
admission events through the real binary (probe C9), not only at unit level.
[source: packages/telemetry/src/cli.ts:479-496; packages/telemetry/src/governance/read.ts:19-23]

Actual source-code provenance and privacy: descriptor paths, `denoBin`, `credentialEnv`
names, model IDs, credential bytes and admission `detail` have no route into the document;
stdout contains none of them and no `detail` key (probe C8; installed gate asserts the same
with runtime-generated canaries).
[source: scripts/check-installed-contracts.mjs:129-143,158-174]

No inadvertent boundary changes: zero diff against the baseline for `snapshot.ts`,
`governance.ts`, `events.ts`, `fold.ts`, `server.ts`, `client.ts`, `connection.ts`,
`routes.ts`, `packages/dsh-app`, `packages/governance`, `.github/workflows` and
`pnpm-lock.yaml`. `PROTOCOL_VERSION` and `dsh.protocol` remain 1. `index.ts` gains only the
additive governance-read export; `PublicGovernance` and the dsh-app projection are untouched
and not consumed by the new path. No shadow consumer DTO exists: the only document/decoder
definition is `governance-read.ts`, and the telemetry projection delegates validation to the
decoder rather than reimplementing it. The command refuses the legacy file envelope, so the
legacy display cannot become a second authority.

## Checks actually run (this session, at the head above)

| Command | Result |
| --- | --- |
| `git rev-parse HEAD`, `git status --porcelain` | exact head, clean before and after; no workflow/lockfile diff |
| contracts suite | 184 passed, 0 failed/skipped/cancelled/todo |
| telemetry suite | 431 passed, 0 failed/skipped/cancelled/todo (includes 7 byte-locked fixture round-trips, fixed-clock CLI byte-locks, T1–T8, BI-9 exit-1/no-stdout) |
| `pnpm run typecheck` | exit 0, whole workspace |
| `pnpm run check:installed` (own run) | exit 0 — offline-only pack/install with isolated empty config/cache; tarball `rickylabs-harness-contracts-0.2.0.tgz`, digest matches writer receipt, 0.2.0 / protocol 1, root+server runtime imports, strict compiled consumer declarations with negative `@ts-expect-error` controls, real CLI synthetic cgroup/log/probe-timeout fixture (probe started, terminated, reaped, no grandchildren), mixed-timeout and all-unconfigured decoded via the installed package, canary absence |
| `pnpm run check:publish` | contracts 0.2.0, protocol 1, 73 packed files, no tests |
| `pnpm run check:docs` | 6 pages match built binaries |
| `git diff --check` | clean |
| Own decoder probe, 20 groups | pass — BI-2 completeness both directions, all 7 fixtures, stale/fresh contradictions, unavailable shape + closed reasons, approvals/pending, refusal-only admissions, closed vocabularies, clock/calendar/numeric relations, provenance requirements, pairing both directions, no-echo diagnostics, hostile-shape containment, caps, alias independence, unreadable/unsupported-schema/invalid partition, unbounded-RAM acceptance |
| Own real-CLI probe, 9 groups | pass — all flag refusals exit 2 before I/O, all-unconfigured exit 3 unavailable, `--now`-future stale (exit 0, `complete:true`), no-transcript-scan, canary absence, 1001-event over-cap exit 1 with empty stdout |
| Own discarded-partial-success probe | pass — discarded usage + retained capacity leaf decodes `complete:false`; `complete:true` refused |
| Targeted follow-up: coordinator empty-log probe (decoder + collector reproduction) | pass — decoder accepts `read`/`records:0`/`empty:true`/`dropped:[]` with `complete:true` (intended generic semantics, §E1); collector still emits `complete:false` for the observed empty log (producer policy) |

Two probe drafts failed on probe-side errors (an identifier-legal reason treated as
must-refuse; a stale-but-complete run expected as exit 3), were corrected to the specified
semantics, and then passed. No product behavior was changed or needed changing.

## E1 — Disposition: empty-log `complete:true` is permitted, not a BI-2 defect (PASS stands)

Coordinator probe: a copy of the committed `complete-without-admissions` fixture with
`sources.admissions` replaced by `read`/`records:0`/`empty:true`/`dropped:[]` plus the
reader provenance and `collectedAt` equal to the envelope `observedAt`, `complete` left
`true`. Reproduced against the built contracts output: the decoder returns `ok:true` with
`complete:true`. Reproduced against the built telemetry composer with empty log events: the
coverage is exactly `read`/`records:0`/`empty:true`/`dropped:[]` with collection
provenance/time, `ok` is `false` (the empty scope adds the `no-admissions` note), and the
projected document carries `complete:false`. Both reproductions ran this session; raw logs
stay outside the tracked tree.

This asymmetry is intended, and no repair is warranted:

1. BI-2 enumerates exactly when `complete:true` is invalid (failed/discarded configured
   meter, failed admissions, or self-inconsistent read admissions). A self-consistent
   empty-read admission source is in none of those arms, so the decoder accepts it —
   faithful implementation of the ratified binding, not a deviation from it.
   [source: plan-eval.md BI-2; packages/contracts/src/governance-read.ts:466-476]
2. The collector's `complete:false` for the empty log flows from its note policy (`ok`
   requires zero notes; the empty scope records one), i.e. producer-side scope
   conservatism. The decoder cannot replicate note-parsing without violating the design
   rule both documents share — notes are informational and consumers must not parse them —
   so decoder invariants cover coverage-contradictions only.
   [source: packages/telemetry/src/governance/compose.ts:60-69;
   packages/telemetry/src/governance/admissions.ts:95-97]
3. Amendment item 2's "matching the producer's ok" describes what this producer emits; its
   decoder-relevant sentences (failed/discarded/dropped force incomplete) are all enforced,
   and its empty-log sentence ("document empty-log coverage without claiming no admissions
   exist outside that observation scope") is satisfied — the document reports scope counts
   with collection time and makes no global claim.
   [source: coordinator-amendment.md item 2]
4. The schema lives in the shared contracts package and is built for future producers (a
   hub producer may embed the same state later); a producer with an authoritative empty
   admissions scope could legitimately claim `complete:true`. Baking this collector's
   conservatism into the shared decoder would be the wrong layer, and adding a new invalid
   case now would invent a requirement beyond ratified BI-2, which this evaluation will not do.
5. No consumer is misled in practice: the coverage honestly reports `records:0`/
   `empty:true`, and this producer never emits the `complete:true` combination — so no
   round-trip lie exists on the supported path.

Wording corrected accordingly: the paragraph above no longer presents `complete:false` on
the empty log as a decoder invariant; it attributes that behavior to the collector and
records the decoder's acceptance as permitted generic document semantics.

Bounds on this document vs the underlying log reads: this review verifies the produced
JSON document and its decoder, plus the CLI's exit/stdio contract. It does not verify the
live accuracy of the underlying usage/spend/cgroup/log readers beyond the synthetic
fixtures, and it makes no claim about live quota, real dispatch-host capacity, or the
fidelity of any operator log content.

## Material residual limits (unchanged by this PASS)

- Synthetic evidence only; live #205/#87 acceptance remains unverified and unclaimed.
- POSIX shebang host with an executable temporary filesystem is required: the host default
  temp and one shared scratch mount reject execution, so gates were run with `TMPDIR` set
  to an owned executable temporary directory outside the worktree (script-owned cleanup);
  without that the probe-timeout fixture cannot start. This is a recorded environment
  requirement, not a false PASS.
- Approval census, binding windows, spend ceilings, GPU and dispatch-host capacity, regime
  policy states, hub/HTTP/socket transport, fold, `RemoteSnapshot`, `governance.changed`
  and reconnect #265 are outside the slice and remain unknown or untouched.
- Portable Proxy/accounting limits from the contracts README apply: JSON is the operational
  boundary; hostile traps that loop or allocate cannot be made bounded or side-effect-free.
- Contracts 0.2.0 is a candidate only — merge, tag `harness-contracts-v0.2.0`, publication
  and any downstream OpenAPI/client/backend compatibility are owner/backend steps, none of
  them claimed here. Same-session repair policy: none triggered; any future repair is the
  coordinator's to dispatch.

## Sources

[source: .llm/runs/published-governance--205/supervisor.md, plan.md,
coordinator-amendment.md, plan-eval.md (BI-1–BI-10), drift.md, implementation.md,
verification.md, context-pack.md, implementation-identity.json; topic: authority, bindings
and writer claims re-verified; read 2026-09-08]
[source: packages/contracts/src/governance-read.ts, packages/contracts/src/index.ts,
packages/contracts/src/governance-read.test.ts,
packages/contracts/test-fixtures/governance-read/ (7 fixtures); topic: decoder semantics;
read 2026-09-08]
[source: packages/telemetry/src/cli.ts:479-496, packages/telemetry/src/governance/read.ts,
packages/telemetry/src/governance/compose.ts, packages/telemetry/src/governance/admissions.ts,
packages/telemetry/src/cli.test.ts, packages/telemetry/src/governance/read.test.ts;
topic: producer/CLI semantics; read 2026-09-08]
[source: scripts/check-installed-contracts.mjs, package.json, packages/contracts/package.json,
packages/contracts/README.md, packages/telemetry/README.md,
docs/reference/cli/dsh-telemetry.md; topic: gate wiring, versioning, published statements;
read 2026-09-08]
[source: matrix-implementation-evaluation.json, matrix-implementation-evaluation-recheck.json,
implementation-evaluation-identity.json (this run; recheck confirms unchanged route/loop
policy and coordinator-verified reviewer identity); topic: implementer vs reviewer route
independence; read follow-up session, host-clock 2026-09-07]
[source: executed gates and probes table above; topic: results this evaluation ran;
run 2026-09-08, follow-up probe host-clock 2026-09-07 (dates are attribution, not ordering)]
