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

## R1 — CI repair review: snapshot-guard fixture inventory (final verdict: PASS)

Historical verdict preserved: PASS at `8185ea6` (product `e6c14d9`) stands as the review of
that source. What follows is the separate repair review at the exact final source below; the
earlier PASS is not carried forward blindly.

CI correction accepted: run `34170219400` on PR #278 failed the build at `check:snapshots`
because the first full local build ran before the seven new governance JSON fixtures were
tracked, so the check's `git ls-files` scan omitted them; `pnpm test` was skipped in that CI
run. The writer's correction (drift D-9, verification repair section) states this plainly and
does not claim the old build receipt covered the final tree. No CI PASS or CI test result is
claimed for the failed run.

Bounded repair under review: `459afc6` changes exactly three product files —
`scripts/check-snapshots.mjs` (exact seven path-and-SHA-256 fixture inventory, fail-closed),
`scripts/check-snapshots.test.mjs` (new 7-case isolated guard suite), root `package.json`
(`check:snapshots` now also runs the guard suite; the guard stays wired into the existing
`build` chain). Verified: zero diff `8185ea6..fd38b6d` across `packages/`, `.github/`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml` and `scripts/check-installed-contracts.mjs` — no
contracts/telemetry/workflow semantic change and no fixture-byte change after the reviewed
source. The seven inventoried SHA-256 digests all match the working-tree fixture bytes
(independently recomputed this session).

What the guard guarantees, verified by execution rather than reading:

- Exact inventory, never a directory exemption: only an exact path AND byte-digest match is
  skipped; the skip is per-path (`approvedFixtures`), so identical fixture bytes at any other
  path still face ordinary key/name detection (own probe G2; suite cases for new-file and
  copied-bytes).
- Changed/missing/unreadable inventoried fixtures fail even with snapshot keys removed: a
  trailing-newline change fails, a `{}` replacement fails, a deleted fixture fails (suite
  cases; the failure message names the path and the SHA-256 rule, never file contents).
- Symlink refusal: a symlink at an inventoried path is refused via `lstatSync` even when it
  resolves to byte-identical content (own probe G1).
- Isolation: every git invocation in the guard test runs in a scratch repository with
  `HOME`, `GIT_CONFIG_NOSYSTEM` and `GIT_CONFIG_GLOBAL` pinned and scratch cleanup; the
  checker itself runs exactly one git command, read-only `git ls-files -z` (own probe G4).
  A hostile operator gitconfig left present-but-unpinned does not disturb the guard (own
  probe G3). The real worktree index was verified untouched (clean `git status` before and
  after all guard runs).
- Operator snapshots outside the inventory still fail ordinary detection (suite case), and
  diagnostics never echo values (suite asserts absence of the planted canary string).

Overclaim check on the correction: the packed candidate receipt is byte-identical to the
historical one — version 0.2.0, protocol 1, 73 files, same SHA-256 digest as verified by my
own installed-gate run below — so "unchanged digest" is confirmed, not repeated. The
"2,878 tests" figure is the repair author's count; I did not rerun the full workspace suite
and do not independently assert that total — I ran the repair-relevant gates listed below,
which include both affected-area suites (contracts 184, telemetry 431) at the final head.

Repair-relevant gates actually run this session at the final head (owned executable TMPDIR
outside the worktree, raw logs outside git):

| Command | Result |
| --- | --- |
| `node scripts/check-snapshots.mjs` (own run) | exit 0 — 91 tracked data files, 7 exact synthetic fixtures verified |
| `node --test scripts/check-snapshots.test.mjs` (own run) | 7 passed, 0 failed/skipped/cancelled/todo |
| Own guard adversarial probe, 4 groups | pass — G1 symlink-at-inventory refused, G2 symlinked-copy detected, G3 hostile-gitconfig isolation, G4 pinned-env/read-only-checker source proof |
| `pnpm run typecheck` | exit 0, whole workspace |
| `pnpm run build` (full, tracked-sensitive) | exit 0 — snapshot gate plus guard suite pass inside the chain; publish/docs/tutorial checks pass (3 tutorial blocks remain declared untested, as before) |
| contracts suite at final head | 184 passed, 0 failed/skipped/cancelled/todo |
| telemetry suite at final head | 431 passed, 0 failed/skipped/cancelled/todo |
| `pnpm run check:installed` (own run) | exit 0 — same tarball digest as historical receipt; root/server runtime and compiled declarations; real CLI synthetic probe started, terminated, reaped, no grandchildren |
| `pnpm run check:publish` | contracts 0.2.0, protocol 1, 73 files, no tests |
| `git diff --check`, `git status --porcelain` | diff-check clean; status shows only this authored eval-file modification — no product/test/doc repairs by this session |

Original decoder/CLI adversarial evidence (20 + 9 + 1 probe groups from the prior session) is
retained without rerun because every product file it exercises is byte-identical between the
reviewed and final heads (zero diff verified above); the repair touches only the snapshot
guard, its test, and script wiring.

**Final verdict: PASS** at exact final source
`fd38b6db71d2152fe2b83b26464dc7712df5ae9a` (repair `459afc6`; receipt commit adds only run
evidence). Scope of this PASS: the snapshot-guard repair is correctly bounded, fail-closed,
isolated, wired into the existing build, and green across the gates above, with no semantic
change to the previously reviewed slice. Remaining scope is unchanged: synthetic-only
evidence; live #205/#87 acceptance, #265, approval/ceiling/GPU/dispatch-host unknowns, and
Proxy/log-reader limits as listed above. This claims no registry publication and no
downstream compatibility; the next receipt-only commit is coordinator-owned. No
commit/repair/push/merge/board/tag/publish performed by this session.
[source: scripts/check-snapshots.mjs:81-92,113-128; scripts/check-snapshots.test.mjs;
package.json; topic: repair under review; read this session]
[source: matrix-implementation-evaluation-ci-repair.json (this run; coordinator copies after
review); topic: repair-review route, unchanged feature evaluator Muse Spark 1.3 xhigh and
loop policy; read this session]

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
