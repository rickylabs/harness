# Verification — connection recovery 265

Implementation is ready for coordinator-owned independent final review, **not merge or release**.
The 0.4.0/protocol-1 candidate retains the board immediately on accepted connection loss and
requires a valid current-link hello plus snapshot to synchronize again. Local contracts tests,
workspace package suites, typecheck, build, publish-shape and offline-installed candidate probes
pass. The original root test failed at the installed gate's 0.3.0 assertion; that failure remains
recorded. The coordinator then supplied narrow source-manifest version maintenance in
`coordinator-gate-amendment.md:1`. **The maintained `pnpm run test` now passes**: 2,909 package tests
plus all installed fixtures. This worker did not author the gate edit. It remains coordinator-owned and is excluded from the
worker implementation commit, alongside `coordinator-gate-amendment.md` and `coordinator-gates.json`.
The passing amended root run is evidence for the combined working tree; the worker commit by itself
still carries the original pinned gate until the coordinator commits its amendment. No producer
source changed.
Evidence: `final-gates.json:1` (historical), `amended-gates.json:1` (final root test),
`source-verification.json:1`, `packed-recovery-receipt.json:1`, `installed-candidate-receipt.json:1`.

## Source, identity and scope

- Execution base: `4cdf23c424634e5cbff29dcecca69c465b88882a`, owned branch
  `fix/265-connection-recovery`. The final delivery commit is the commit containing this artifact;
  its full SHA is reported in the worker handoff, avoiding a self-referential commit hash here.
- Existing independent Stage G PASS and six criteria govern execution. The historical proposed
  0.2.0 remains untouched in the plan/review; `baseline-amendment.md:3` governs 0.4.0 over
  published 0.3.0, protocol 1. No plan redesign or evaluator dispatch occurred.
- The coordinator-supplied `matrix-implementation.json:10` was already untracked at entry and is
  retained unchanged: selected first route astra/low, fallback muse_spark_1_3/xhigh. This worker
  is the provided Codex session; no fallback selection or additional agent launch occurred.
  Independent provider/model/effort attestation is not exposed to this worker and is not claimed.
- Runtime used: Node **v26.8.1**, pnpm **11.25.0**. Node 24 remains the repository floor;
  a local Node 24 execution was **not performed** (`final-gates.json:1`, root `package.json:9`).
- Product changes are exactly contracts `src/fold.ts`, `src/client.ts`, `src/index.ts`, existing
  `src/client.test.ts`, `README.md`, `package.json`. The coordinator separately supplied the
  installed-gate edit and `coordinator-gate-amendment.md`; remaining changes are current-run evidence.
  The lock importer is `packages/contracts: {}` and needs no version update. Lock, connection,
  server and events are byte-identical to the execution base. The gate was unchanged during the
  original worker checks, then changed by the coordinator; its current hash is in `amended-gates.json:1`.
  The `packages/telemetry` producer source diff is empty (`source-verification.json:1`).

## Implementation and gate mapping

| Reviewed requirement | Implementation / executable evidence |
|---|---|
| Optional bound with legacy fallback; cold HTTP unbound | `packages/contracts/src/fold.ts:79`, `:149`, `:162`; `packages/contracts/src/client.test.ts:695`, `:841` |
| Rebind at every connect and immediately on accepted live-to-non-live | `packages/contracts/src/client.ts:516`, `:526`; loss matrix at `packages/contracts/src/client.test.ts:594`; inherited legacy-connect regression at `:922` |
| Lower generation accepted only when unbound; bound equal/lower still discarded | `packages/contracts/src/fold.ts:444`; `packages/contracts/src/client.test.ts:616`, `:841`, `:904` |
| Pre-hello known/unknown/payload-invalid frames cannot contaminate retained state | `packages/contracts/src/fold.ts:322`, `:350`; `packages/contracts/src/client.test.ts:648` |
| Old links fenced before fold, including late hello/snapshot/delta/unknown/unreadable/open/drop | Existing receive fence at `packages/contracts/src/client.ts:348`; `packages/contracts/src/client.test.ts:594`, `:672` |
| HTTP generation 900000 then socket 1; connecting/waiting/stopped/idle; both request orders and all answer phases | `packages/contracts/src/client.test.ts:695`, `:723` |
| Actual HTTP unauthorized command-refusal, not only raw rejected | Loopback POST receives HTTP 401 and its decoded body drives the normal answered-dispatch path, `packages/contracts/src/client.test.ts:751` |
| Ordinary HTTP refusal/network failure does not demote healthy fold or resend | `packages/contracts/src/client.test.ts:795` |
| Absent / retained / synchronized is derived from board+loop+fold only | `packages/contracts/src/client.ts:294`, `:312`; predicate, empty/partial/mismatch/gap/recovery assertions at `packages/contracts/src/client.test.ts:814` |
| Invalid/replayed snapshots cannot clear recovery pending | `packages/contracts/src/client.test.ts:886` |
| Three-phase glance stale marker | `packages/contracts/src/client.ts:334`; live snapshot absent, immediate retained present, new snapshot absent at `packages/contracts/src/client.test.ts:616` |
| Zero resync sentinel; hubs never assign it; mismatch closes without recovery delivery | Public docs `packages/contracts/src/fold.ts:166`; actual hub close regression at `packages/contracts/src/client.test.ts:860` |
| Legacy helpers/events/count/hello and old-shaped values compile | `packages/contracts/src/client.test.ts:841`, `:922`; installed declaration fixture in `packed-recovery.mjs:97` |
| Internal rebind/binding helpers not root exports; closed public status union | `packages/contracts/src/index.ts:233`; runtime/compile negatives at `packages/contracts/src/client.test.ts:876`; installed declaration fixture in `packed-recovery.mjs:97` |
| Source clocks and unknown outcomes remain unchanged; no automatic effect resend | Retention/cold-source checks at `packages/contracts/src/client.test.ts:575`, `:695`, `:795`, `:904` |
| Exact non-inference/authorization documentation | Required text verbatim in `packages/contracts/src/client.ts:303`; automated text comparison in `source-verification.json:1`; public README `packages/contracts/README.md:117` |

Unusable envelopes still follow the existing refusal path; no unreadable-envelope semantics were
redesigned. Neither status grants display, persistence or command permission. Revocation wins over
retention, and late HTTP answers restore no permission. This is documented and structurally outside
the query, not a claim that these tests implement backend authorization. Source clocks are not receipt
clocks; admitted is not running; completeness and unknown outcomes remain separate dimensions.
Sources: `query-documentation.md:5`, `packages/contracts/src/client.ts:303`, `:408`, `:467`.

## Exact local commands and results

Commands ran from the owned workspace. For pnpm gates, npm user/global configuration was explicitly
redirected to empty task-owned files, offline mode enabled, and TMPDIR placed in an executable
scratch directory outside Git. No registry lookup or installation fallback was needed. Durable
receipts contain result counts and SHA-256 digests of raw local logs; raw logs stay outside Git.

| Command | Result |
|---|---|
| `pnpm --filter @rickylabs/harness-contracts test` | PASS, **213 tests**, 213 pass, 0 fail/cancelled/skipped/todo |
| `pnpm run typecheck` | PASS, exit 0 |
| `pnpm run build` | PASS, exit 0; built-in publish gate reports 78 files, no tests; tutorial checker explicitly declares 3 existing cases untested |
| `pnpm run test` before coordinator amendment | **FAIL, exit 1** at installed gate; all **2,909 package tests** passed, 0 fail/cancelled/skipped/todo across 12 package suites |
| `pnpm run test` after coordinator amendment | **PASS, exit 0**; **2,909/2,909** package tests, no fail/cancelled/skipped/todo; installed root/server checks, **108 + 2** synthetic fixtures passed |
| `pnpm run check:publish` | PASS, exit 0; 0.4.0, protocol 1, 78 files, no tests |
| `node .llm/runs/connection-recovery--265/packed-recovery.mjs` | PASS, actual offline pack/install, installed root/server runtime and declarations, synthetic recovery, export negatives and per-file equality/digests |
| `node .llm/runs/connection-recovery--265/installed-candidate-check.mjs` | PASS **supplemental only**; 108 run-observation fixtures and 2 governance fixtures, actual synthetic child timeout/termination/reaping, source-built producer unchanged |
| `git diff --check` | PASS, no whitespace errors |

Authoritative per-package counts, exit codes and log digests: `final-gates.json:1` and
`amended-gates.json:1`;
final targeted result and product source hashes: `source-verification.json:1`.

The root-test failure is specifically the existing assertions at
execution-base `scripts/check-installed-contracts.mjs:74` and `:90`. The script labels its current stage
“offline pack” before asserting metadata.version equals 0.3.0; this is not an npm pack failure.
`installed-candidate-check.mjs:17` retains the exact five substitutions for the temporary executable:
two version literals, root relocation, fixture import relocation and compiler resolution relocation.
All original fixture logic executes unchanged. The original script hash is retained alongside the
adapted executable hash in `installed-candidate-receipt.json:1`. The coordinator subsequently addressed this mismatch in the source gate; the worker reran the
unmodified command against that edit and it passed (`amended-gates.json:1`). The supplemental
script is historical executable evidence against the execution-base gate, not the maintained gate;
its exact old input is retrievable at the execution base named above. Coordinator-authored
`coordinator-gates.json:1` independently records its own local checks; this worker claims only its
own executions.

## Actually packed candidate

Tarball: `rickylabs-harness-contracts-0.4.0.tgz`, protocol 1, **78 files**.
SHA-256: `2fea5d3d8775be73b83c5f618ae7e0c260ae31a816f8ae4a55afda222af33ccb`.
Both independent local pack invocations produced that digest (`packed-recovery-receipt.json:7`,
`installed-candidate-receipt.json:1`). This is **local pack proof only**, not registry publication,
provenance, consuming-version adoption or downstream compatibility.

`packed-recovery.mjs:1` retains the exact executable probe source, including runtime and declaration
consumer source. Its receipt contains their hashes plus every installed file's SHA-256. The probe
compares every installed file to the corresponding source/built candidate byte-for-byte. Tests,
fixtures and build caches are absent; root and server runtime/types exist; portable JS/TS imports
and dependency-free manifest are checked. The supplemental script's original-source hash and exact
transformations make its temporary executable reconstructible in the same workspace. Scratch installs
were removed by the probes' cleanup; no tarball was published or added to Git.

One first local probe attempt failed because the portability regex was mistakenly applied to README
release instructions containing `require(...)`. The probe was corrected to inspect JS/TS code for
Node imports, retaining all-file path scans. The corrected executable was rerun successfully. The
final recovery probe uses actual hub-generated frames for dropped delta/gap/resync; no recovered
state is inferred from a successful import alone (`packed-recovery.mjs:1`).

## Self-review and remaining unknowns

Reviewed the full product diff and all current-run evidence. No wire shape, connection/server/events
implementation, other package source, workflow, generated tracked file, deployment, release tag or
lock churn is included. The separate coordinator-authored gate edit is the sole amended surface.
No prior plan/review content changed. The initially untracked matrix artifact
is retained as supplied. No other agents, GitHub writes, push, merge, release, credentials/auth/env-file
inspection, operational telemetry, live provider or private-consumer inspection occurred. The tests'
HTTP traffic and producer inputs are synthetic. Scope/unchanged hashes: `source-verification.json:1`.

Independent final implementation review, exact-head CI and coordinator publication review are
**not performed by this worker**. Node 24 execution, real-source/finite-capacity acceptance,
backend authorization/revocation implementation, downstream OpenAPI/generated-client adaptation,
private-consumer compatibility, publication and consumer adoption remain unverified or outside scope.
The original root-test failure remains as history; the maintained root test passed locally.
None of the unperformed checks above is reported as PASS.
