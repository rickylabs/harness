# Implementation evaluation — repository run read (205 / E9-39)

Verdict: **PASS**

Summary: implementation commit `12f12c5` at clean HEAD `1da6468` satisfies the
governing plan (`plan.md` + `scope-amendment.md` + `identifier-repair.md`,
round-3 PASS), the native-envelope amendment (R2–R4, PASS) and R1. Portable
decoder shape, binding/source collision discipline, race/timestamp/privacy
contract, exact 108-fixture manifest, snapshot-guard inventory, and
CLI/packed-installed gates all verified independently at final HEAD. One
pre-existing doc nit (outside the changed surface) is advisory only. No
publication, backend, or downstream compatibility is claimed or granted.

## What was evaluated

- Source HEAD: `12f12c51343854b193f182340b06e4a242bfc7a5` (implementation);
  current clean HEAD `1da6468` (adds only run `.md`/matrix evidence, no product
  code — `git show --stat HEAD`).
- Product equality prerequisite holds: `git diff --exit-code 5766675 e924b34
  -- packages scripts package.json pnpm-lock.yaml` → EQUAL (run at this eval).
- Changed surface (30 files): portable decoder
  `packages/contracts/src/repository-run-observation.ts:1-150`, reader
  `packages/telemetry/src/repository-run-observation.ts:1-272`, CLI
  `packages/telemetry/src/cli.ts:466-479`, installed gate
  `scripts/check-installed-contracts.mjs:58-225`, matrix
  `packages/telemetry/test-fixtures/run-observation/matrix.mjs:1-248` +
  `manifest.json` (108), snapshot inventory `scripts/check-snapshots.mjs:84`,
  guard tests `scripts/check-snapshots.test.mjs:62-67`, contract fixture
  `packages/contracts/test-fixtures/repository-run-observation/read.json`,
  READMEs, generated CLI reference. Protected surfaces unchanged
  (`runs.ts`, `fold.ts`, `server.ts`, `snapshot.ts`, lockfiles —
  `PROTECTED-UNCHANGED` at this eval).

## Criterion-by-criterion result

- **Exact portable decoder shape** — PASS. Root keys exactly
  `schema,protocol,binding,capturedAt,coverage,verification,run`
  (`repository-run-observation.ts:128`); strict `record()` rejects unknown
  keys, accessors, wrong prototypes (`:52-64`); binding is exactly
  `{namespace,id,revision,sourceScopeId,repo}` with R1 charset/cap on all four
  IDs plus `nativeId` (`:69,:80-86,:121`); coverage unions are exactly the
  reviewed sets incl. `binding-changed` (`:5-6,:135-147`); `verification`
  nonnull iff `read` with `verifiedAt<=capturedAt` (`:140-143`); run evidence
  bounded within first/last (`:91-93`); unknown future reasons rejected
  (`choice`, `:145-146`). No `epoch` special-casing in the decoder (my probe
  expectation that epoch `capturedAt` is invalid was wrong: it decodes `ok`
  when the interval is consistent — correctly, since epoch is only a
  descriptor-validation placeholder, never emitted).
- **Binding / source collision** — PASS. Tuple identity is structural:
  binding carries `namespace/sourceScopeId` (`:7-13`); single-identity gate
  over `session_meta` only, dual-alias equality, `turn_context`-only →
  `identity-missing` (`telemetry:134-143`); token records corroborate with
  dual-ID equality (`:145-148`); `store-collision-and-delayed-A-carrier-fence`
  fixture asserts distinct tuples and no persist-under-B (matrix `:172-190`).
- **Race / replacement** — PASS. Descriptor bytes+identity snapshotted,
  source opened-identity checked, bounded read, before/after identities,
  pre-serialization descriptor re-read + recanonicalization + repeated Git
  checks (`telemetry:48-76,:239-267`); descriptor/root/worktree/common/Git
  change → `binding-changed` under ORIGINAL snapshot binding, source-only
  change → `source-changed` (`:258-267,:269`); 13 deterministic race fixtures
  via in-process checkpoint seam, no shipped flag/env backdoor
  (matrix `:208-235`, `drift.md` D2).
- **Timestamps** — PASS. Canonical ms UTC + roundtrip + nondecreasing file
  order required of every envelope incl. supplemental ones (`telemetry:113-115,
  :180-184`); first/last are validated envelope times (`:226`); per-leaf
  `within()` containment (`contracts:93`); skew permitted without freshness
  claim (matrix skew fixture `:119-121`); no leaf refresh by supplemental
  envelopes (matrix `:135-139` asserts provider/model/effort/usage/execution
  times unchanged by world/token lines); `verifiedAt<=capturedAt` ordered
  local clocks (`contracts:140`).
- **Privacy** — PASS. Matrix `check()` rejects any canary/scratch/worktree/
  root/`remote_url`/`credential` text in the public document and on CLI
  stdout (matrix `:27-51`); gate scans installed JS/TS for `node:` imports and
  canary (`check-installed-contracts.mjs:207-213`); CLI uses only fixed
  diagnostics, never reflects input/paths/errors
  (`cli.ts:468-479`, gate `:226-229`); world/token-derived strings never
  output (R4b — reader only reads `cwd`/IDs, never emits them).
- **Malformed-tail / unknown≠failed / unavailable relationships** — PASS.
  Whole-run withhold on any malformed line incl. tail (`telemetry:123-132`,
  fixtures `malformed-tail/array-line/non-object-payload`); unknown envelope →
  `incomplete/unknown-envelope`, unknown *payload kind* neutral
  (`:130-133`, fixtures both present); relationships exactly all
  `unavailable` (`contracts:39,:119-123`); `unknown` execution stays
  null-clocked (`:113-118`); invalid descriptor → exit 1 fixed, no document;
  coverage refusal → exit 3; read → exit 0; flags → exit 2 before I/O
  (`cli.ts:466-480`, matrix `:236-243`, telemetry test `:40-49`).
- **Stale-binding receiver limits** — PASS, correctly bounded. Carrier-only
  fence model in fixtures; backend atomic-fence/authorization explicitly
  assigned to backend (`contracts/README.md:402-407`, gate limitations
  `:218`). No offline-revocation or cache policy authored. No overclaim.
- **Logs/credential/path disclosure** — PASS (see Privacy; installed gate
  asserts no operational paths in tarball bodies, `:80-83`).
- **False passing absent fixtures** — PASS. Exact manifest equality:
  `assert.deepEqual(passed, required)` (matrix `:245-247`); gate asserts
  length 108 + sentinel (`check-installed:206`); telemetry test asserts 108
  (`repository-run-observation.test.ts:37`); snapshot inventory is exact
  path+SHA-256 with missing/changed-file negative tests
  (`check-snapshots.mjs:115-126`, `check-snapshots.test.mjs:62-67`).
- **Old 0.2 installed surface compatibility** — PASS. No exports removed,
  `PROTOCOL_VERSION`/`dsh.protocol` stay 1; gate verifies root+server runtime
  exports and compiles a consumer against both declaration entry points with
  `types:[]`, `skipLibCheck:false` (`check-installed:92-125`); contracts
  README states the 0.1.0/0.2.0 additive position and withholds downstream
  claims (`packages/contracts/README.md:344-351`).

## Independently run gates (final HEAD, `TMPDIR=/var/tmp`)

| Gate | Result |
|---|---|
| `pnpm --filter @rickylabs/harness-contracts test` | PASS — 187/187 |
| `pnpm --filter @rickylabs/telemetry test` | PASS — 433/433 (incl. 108-fixture matrix) |
| `node scripts/check-snapshots.mjs` + `node --test scripts/check-snapshots.test.mjs` | PASS — 98 files clean, 8 fixtures verified, 9/9 guard tests |
| `node scripts/check-installed-contracts.mjs` | PASS — 108 run fixtures + governance gate; digest `fbe8f97c…2579be786` matches `verification-gates.json` and `coordinator-real-acceptance.md` |
| `pnpm run check:docs`, `pnpm run check:publish` | PASS — 6 CLI pages match; `contracts@0.3.0`, protocol 1, 78 files |
| `git diff --check` | clean |

Failure coverage from `verification.md` was inspected, not trusted: the
EACCES default-tmp, repo-local-tmp forge negative control, snapshot-inventory
miss, and 73→108 manifest mismatch were each resolved by rerunning the gate
correctly (executable `TMPDIR` outside repo, inventory/test additions), with
no production code loosened. My own CLI probes at this eval confirmed:
read→exit 0 with `read/null` coverage; malformed tail→exit 3
`incomplete/malformed-record`; slash-namespace descriptor→exit 1 fixed
diagnostic, empty stdout; extra flag→exit 2.

## Real-source evidence handling

`coordinator-real-acceptance.md` is a safe summary only (no paths, counts, or
prose beyond the SHA `fbe8f97c…2579be786` and the twice-read/unchanged-source
discipline). I did not read, request, or scan any private source, home
directory, or credential. Candidate digest equality with the installed gate
holds; registry publication is neither present (no tag on HEAD) nor claimed.

## Advisory nit (pre-existing, outside changed surface — not a fix gate)

`packages/telemetry/README.md:595` still says the installed gate "packs
contracts 0.2.0" while the package, gate, and new (§Selected repository run
observation) docs are 0.3.0. That line predates this slice (diff adds only
the new section) and no gate reads it; suggest a one-line correction
separately. No downstream/backend/API/native compatibility claim exists
anywhere in the slice — correctly withheld throughout.
