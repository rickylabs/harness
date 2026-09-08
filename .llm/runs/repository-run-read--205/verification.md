# Repository run read — implementation verification

Implementation and synthetic gates PASS. Candidate contracts 0.3.0 / protocol 1 is locally
committed with this report; independent implementation evaluation, authorized private real-source
acceptance and release remain coordinator work. No real source was read by this implementation run.
The exact machine gate receipts are in `verification-gates.json`; package totals are in
`verification-tests.json`. These are synthetic receipts, not authorization or live acceptance.

## Implemented boundary

- Portable `RepositoryRunObservation` and `readRepositoryRunObservation` root exports, strict
  bounded owned decoder: `packages/contracts/src/repository-run-observation.ts:1-150`.
- Selected Codex descriptor, file bounds, identity/scope/evidence validation, original-binding
  race refusals: `packages/telemetry/src/repository-run-observation.ts:1-272`.
- Actual CLI command and fixed diagnostics: `packages/telemetry/src/cli.ts:466-479`.
- Exact offline package install, root/server declaration compilation, actual binary fixtures
  and deterministic CLI-main race harness: `scripts/check-installed-contracts.mjs:58-225`.
- Executable synthetic matrix with exact required fixture manifest comparison:
  `packages/telemetry/test-fixtures/run-observation/matrix.mjs:1-248` and adjacent `manifest.json`.
  Missing fixture files, missing manifest entries or skipped checkpoint actions fail.
  The JSON contract fixture is also pinned by exact path+SHA-256 in
  `scripts/check-snapshots.mjs:84`; `scripts/check-snapshots.test.mjs:80` tests missing/changed
  repository-run fixtures. All nine snapshot-guard tests pass in the full build.
- Backend enrollment, namespace/store uniqueness, atomic current-binding fencing,
  authorization/revocation and retention obligations: `packages/contracts/README.md:391-407`.

Source and worktree roots remain separate. Linked worktrees with external Git common directories
are tested. Native identities are namespaced store tuples. Coverage concerns only one selected
source. First/last envelope times, per-field identity/accounting/execution times, local validation
completion and collection completion remain distinct. Unknown payload kinds supply no state;
malformed tails and unknown envelopes withhold the entire run. Existing RunView, fold, hub and
RemoteSnapshot implementations were not changed.

## Commands and actual results

All final verification commands below exited 0. Build preceded test/consumer execution. The
`/var/tmp` setting is required on this host for executable fixtures outside any Git repository.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; isolated worktree node_modules, unchanged lockfile. Initial missing-dist bin warnings resolved by builds. |
| `pnpm -r run build` | PASS; initial compiled prerequisites, repeated after source edits. |
| `node scripts/cli-reference.mjs --write` | PASS; regenerated only telemetry CLI reference. |
| `TMPDIR=/var/tmp pnpm run build` | PASS; includes repository checks, package builds, publishability and generated docs. |
| `TMPDIR=/var/tmp pnpm test` | PASS; 2,883 tests across 12 implemented packages, plus installed gate. |
| `TMPDIR=/var/tmp pnpm run typecheck` | PASS; all workspace projects. |
| `TMPDIR=/var/tmp pnpm run check:publish` | PASS; contracts0.3.0/protocol1, 78 packed files, no tests. |
| `TMPDIR=/var/tmp pnpm run check:installed` | PASS; exact offline tarball, 108 required run fixtures, existing governance gate. |
| `pnpm --filter @rickylabs/harness-contracts test` | PASS; 187 tests. |
| `TMPDIR=/var/tmp pnpm --filter @rickylabs/telemetry test` | PASS; 433 tests. |
| `git diff --exit-code 5766675 e924b34 -- packages scripts package.json pnpm-lock.yaml` | PASS; historical product equality prerequisite. |
| `git diff --exit-code -- pnpm-lock.yaml deno.lock packages/contracts/src/runs.ts packages/contracts/src/fold.ts packages/contracts/src/server.ts packages/contracts/src/snapshot.ts` | PASS; protected surfaces unchanged. |
| `git diff --check` | PASS. |
| Staged public artifact scan (path inventory plus staged blob scan) | PASS; 30 files; operator paths, launch snapshots, node_modules/dist and temporary fixtures excluded. |

The installed root and server runtime exports work; both consumer declaration imports compile
with `types:[]`, no Node types and no skipped library checking. Tarball scan excludes tests,
fixtures, build metadata, actual worktree/scratch paths, synthetic source canaries, Node imports
and runtime dependencies. CLI success/refusal output is checked for synthetic private prose and
operator/source paths. Source canaries exist only in synthetic test code. The package consumer
is installed with `npm install --offline --ignore-scripts --no-audit --no-fund <tarball>` into
an isolated temporary directory with empty npm configs and no network fallback.

Final installed package SHA-256:
`fbe8f97c699d8011a1fdc4f6a92217e8184f46d23a34c6f7ca5950d2579be786`.
The gate receipt identifies `rickylabs-harness-contracts-0.3.0.tgz`; the gate cleans up that
candidate tarball after verification. This is not a published artifact receipt.

## Failures encountered and resolved

1. Initial `pnpm run check:installed`, its repeat, and direct
   `node scripts/check-installed-contracts.mjs` failed at the existing sleeping-probe startup
   gate. A minimal synthetic executable reproduced `EACCES` in the default temporary location.
   No missing probe was accepted. An executable TMPDIR allowed the original gate to verify
   actual startup, timeout, termination and reaping.
2. A full `pnpm test` using a temporary directory inside this worktree failed an existing forge
   negative control: its nominally non-Git temp directory inherited the containing repository,
   so labels-check returned 0 where the test expected 2. The full suite was rerun with
   `TMPDIR=/var/tmp`, outside Git and with executable fixture support, and passed. No unrelated
   forge code/test was changed. Interrupted synthetic test leftovers were removed.
3. A cleanup command using `rm -rf` was rejected by automatic command review. Cleanup was
   completed with a path-bounded script after inspecting and asserting the generated fixture
   directory names. No permission override was requested.

4. After staging the synthetic JSON fixture, the full build correctly failed check:snapshots
   because its observedAt key was not yet in the exact synthetic fixture inventory. The fix adds
   only its path+SHA-256 and negative guard tests; the staged full build now passes.
5. The native-envelope extension's first package run failed the exact fixture-manifest equality
   check because it still listed the earlier 73 cases. The explicit reviewed extension adds 35
   named cases; final manifest, tests and installed gate agree on 108. No missing case was passed.

## Reviewed-plan clarifications

`drift.md` records the bounded RepoRef runtime-validation gap (the existing RepoRef type supplies
only string fields), the in-process CLI race harness, and native nested-setting/accounting
snapshot details. These do not move backend ownership or introduce a new provider/transport.
The earlier Stage-G PASS is implementation authority, not an implementation-evaluation PASS.
During the final staged audit, coordinator-added native-envelope-amendment.md and
native-envelope-plan-eval.md PASS were found and applied with R2-R4. Public copies omit real
source event counts. The implementer did not perform the coordinator's real-source read.
Final gates were rerun against the staged implementation after this amendment.

## Coordinator real-source handoff

Run only after the coordinator's separate authorization, using an absolute private descriptor:

    node packages/telemetry/dist/cli.js run-observation --source <absolute-descriptor-path>

Descriptor exact shape (illustrative paths, no real/operator values):

    {
      "schema": 1,
      "binding": {
        "namespace": "enrollment-authority",
        "id": "repository-association",
        "revision": "revision-1",
        "sourceScopeId": "native-store-1",
        "repo": { "owner": "example", "name": "repository" }
      },
      "source": {
        "kind": "codex",
        "root": "/absolute/native-store",
        "file": "/absolute/native-store/selected.jsonl",
        "nativeId": "selected-native-session-id"
      },
      "worktree": "/absolute/repository-worktree",
      "gitCommonDirectory": "/absolute/repository-common-git-directory"
    }

All paths are absolute local paths; source.root and worktree are distinct concepts. The issuer
allocates all binding identifiers and the matching selected native ID. Use never-reused revisions
for enrollment mapping changes. Native cwd must prove the configured worktree; Git common-directory
identity must match configured enrollment. Decode stdout with the exact candidate root decoder.
Exit0 is read; exit3 is a valid binding plus typed coverage-only refusal; exit1 is no document with
fixed descriptor/collection diagnostic; invalid flags exit2 before source effects.

Supported native input additionally includes exactly the reviewed `world_state` full environment
map (`payload.full === true`, object `payload.state.environments.environments`, every environment
record's absolute cwd checked within worktree) and `token_usage_record` dual-ID corroboration
(thread_id and session_id must match the selected session_meta/native ID). Partial world-state
updates remain invalid-evidence; supplemental numeric blocks are ignored and not validated or
cross-compared. They cannot supply accounting, leaf timestamps or ancestry. Only outer timestamps
join the evidence interval. The producer README gives the complete supported/unsupported forms.
Retry the coordinator's unchanged real source only under its separate authorization; preserve any
initial refusal, and never filter native input to force success.

Keep any real receipt outside every repository. Backend current-binding fencing and protected
delivery checks remain required. The implementation assumes trusted local storage, detects observed
before/after changes, and makes no hostile-ABA, atomic-filesystem, liveness, census, auth integration,
instant offline revocation or downstream API/client compatibility claim. No agents/evaluators,
workflow changes, sibling changes, board writes, push, PR, merge, tag or publication were performed.
Operator launch matrix/allowance files are intentionally excluded from the commit.
