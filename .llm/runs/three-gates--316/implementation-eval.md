# Three gates — independent implementation evaluation

PASS. Separate Meta-family session `ses_f5da5c113ffeDAO0cZzRZnta5Y`; route `opencode-go/muse-spark-1.3-contributor`, requested xhigh. The CLI accepted the requested variant; applied provider effort is not independently observed. Fresh matrix receipts precede initial and resumed invocations. Reviewer was read-only and distinct from both OpenAI implementation sessions.

## implementation-review

**PASS** — Codex implementation satisfies the locked plan-eval conditions and drift amendments. Verified read-only; `check:stages` green (scoped-tests.txt: 50/50; spot re-run of stage suites: 35/35).

Findings (all confirming, `path:line`):

- Three-state protocol intact — `scripts/inconclusive.mjs:17` (`INCONCLUSIVE_EXIT=2`), `scripts/run-stages.mjs:129` (failed outranks inconclusive, never flattened to pass/fail), misconfigured aggregate → 2 (`run-stages.mjs:192-193`).
- Genuine failures preserved — native codes pass through (`run-stages.mjs:93`); 134/139 stay FAIL; undeclared missing test script stays config FAIL exit 1 per owner clarification (`scripts/check-test-scripts.mjs:66-69`, names package); invalid JSON → FAIL (`check-test-scripts.mjs:82-84`).
- Scratch location/privacy — owned `mkdtempSync` dir (`scripts/check-installed-contracts.mjs:63-65`), diagnostic carries only owned `location` + closed `execution` vocab (`inconclusive.mjs:54-60`); canary test proves no leak (`scripts/gates-regressions.test.mjs:40-55`).
- Inventory inability — missing/empty/unreadable → INCONCLUSIVE, invalid JSON → FAIL (`check-test-scripts.mjs:44-53`); covered by regressions (`gates-regressions.test.mjs:110-136`).
- Compile execution + exit 2 — only named compile stage maps 2→1, non-compile 2 stays INCONCLUSIVE, spawn/command refusal sets `executed:false` so compile reports `DID NOT RUN — INCONCLUSIVE` (`run-stages.mjs:70-93,103,123`); tests `gates-regressions.test.mjs:169-211`.
- pnpm ndjson ENOENT — structured `ELIFECYCLE`/`errno==="ENOENT"` detection with lifecycle forwarding and metadata omission, 32 MiB bound → `stage-result-unavailable` (`run-stages.mjs:153-172,71-75`); tests `:99-108,178-189`.
- Negative/mutation — `scripts/mutation-verify-gates.mjs` (landed concurrently, now present) defines 26 mutants, each with exactly-once guard (`:103`), green-baseline requirement (`:84-87`), assertion-kill requirement (`:89-93`) and broken-module rejection (`:82`). All `before` strings verified present-once in their targets; all `after` strings syntactically valid in context (including `new Error` with string second arg — ignored per spec, no throw); all `(test, suite)` pairs match real tests in scoped-tests.txt. The `check:gate-mutations` script reference (`package.json:40`) now resolves.

Non-blocking nits (not correctness): duplicated alternation in mutation guard (`mutation-verify-gates.mjs:82`); `gates.md:23` phrases inventory as "`pnpm-workspace.yaml`" while audit reads `packages/*` dirs — true only insofar as globs align.

## implementation-review-final

**PASS** — final delta recheck confirms the prior PASS stands. All findings below verified by reading source, tests, and output files directly (not the recap).

**Delta correctness (source-read):**

- Raw-127 arm removed, 126 retained (`scripts/run-stages.mjs:81`, comment `:79`) — empirically grounded: `noexec-typecheck.txt:65` shows pnpm propagating `Exit status 126` (caught by the raw arm), while 127→1 mapping is covered by the structured-ENOENT arm (`run-stages.mjs:164`). Remedy text (`:83`) still naming 126/127 stays accurate via the pnpm path.
- `runStage` early return on `run.error` (`run-stages.mjs:158`) — truncated capture never forwarded; overflow then classifies via `pid>0` (`:71-75`). Pinned by `capture-started-guard`, `capture-execution-report`, `capture-bound`, `truncated-output-boundary` mutants (`mutation-verify-gates.mjs:74-84`), each verified valid JS with assertion-kill mechanics.
- Audit discriminates by `code`+`syscall` (`check-test-scripts.mjs:45`): `SyntaxError` (no code/syscall) rethrows → FAIL; `null` JSON parses cleanly → undeclared → FAIL (regression test `:176-179` asserts both). EISDIR/unreadable (code+syscall set) → INCONCLUSIVE.
- Shebang assertions moved outside injected spawner (`gates-regressions.test.mjs:94-104`) — closes the vacuous-pass hole where an in-spawner assert throw would have been swallowed into `attempt.error`.
- Installed entrypoint wiring (`check-installed-contracts.mjs:60-65,240-252`): prereq gate → owned `mkdtemp` → preflight → `Inconclusive`-only record path with exit 2, generic FAIL otherwise, `finally cleanup`. Both installed mutants (`:17-20`) target real once-occurring strings; kill paths check out (bypass → ENOENT FAIL exit 1 vs expected 2; `if(false)` → FAIL vs expected 2).

**Evidence (read, not recapped):**

- `scoped-tests.txt`: 54/54 pass, incl. 4 new tests (`:8,12,25,26`).
- `mutations.txt`: 38 `baseline:` + 38 `mutant:` sections, closes with `38/38 killed by targeted assertions`, clean tail — script can only reach that line if every baseline was green and every mutant died by `ERR_ASSERTION` (broken-module/syntax kills are rejected at `:109`).
- `validation.json` + literal outputs: `typecheck.txt` tail "ok — 4 stage(s), all green, compile ran"; `build.txt` tail "ok — 13 stage(s), all green"; `test.txt` tail "ok — 6 stage(s), all green" with `fixtureCount:108` and zero `^not ok`; `installed-noexec.txt:18` real EACCES refusal record with owned location + exit 2; `noexec-typecheck.txt:75-78` exit 2, `stage-command-unavailable`, compile `DID NOT RUN`.

No FAIL_FIX items. Single non-blocking nit: `pnpm-error-code-boundary` mutant (`:94-95`) turning the allowlist into `true` is killed only because the reporter test's CONTROL/ENOENT record exists — sharp, but future edits adding a second ENOENT-non-lifecycle fixture would be wise; not a defect today.

## implementation-review-inventory

**PASS** — delta-only review; prior PASS for unchanged code preserved.

**Source fix** (`scripts/check-test-scripts.mjs:34-60`): `existsSync` import dropped (`:8`); entries filtered by `isDirectory()` only (`:39`); each manifest read directly with per-entry catch (`:42-46`) where solely `ENOENT` skips (`:44`) and every other fs error propagates to the code+syscall discriminator → `INCONCLUSIVE` (`:50-54`), while `SyntaxError` (no code/syscall) rethrows → FAIL. The old masking path — `existsSync` returning false on `EACCES` → package silently omitted from a green inventory — no longer exists. `ENOTDIR`/other unknowns correctly go inconclusive rather than skipped.

**Tests** (`scripts/gates-regressions.test.mjs`): new `an inaccessible package cannot disappear…` (`:195-215`) establishes a green baseline then injects deterministic `EACCES` (with `code`+`syscall`) via `--import` patch — root-proof — asserting exit 2, `workspace-unreadable`, and no canary leak; it fails on the old code (exit 0), so it is a true regression test. The `existsSync=false` patch alongside is vestigial but harmless — it reproduces the old masking condition too. Non-package dir added to the declarations test (`:186`) pins the `ENOENT`-skip so plain directories are not mistaken for packages.

**Mutants** (`scripts/mutation-verify-gates.mjs:43-46`): `workspace-inaccessible-manifest` (`→ return [];`) swallows `EACCES` → exit 0 vs expected 2, assertion kill; `workspace-nonpackage-directory` (`→ if (false)…`) lets `ENOENT` (carries `code`+`syscall`=`open`) escalate to exit 2 vs expected 0, assertion kill. Both `before` strings occur exactly once (guarded at `:130`-equivalent); both `after` strings are valid JS.

**Rerun evidence (complete, read directly):** `scoped-tests.txt` 55/55; `mutations.txt` 40 baselines + 40 mutants closing with `40/40 killed by targeted assertions` and clean stderr (script can only reach that line if every baseline was green and every kill was `ERR_ASSERTION`); `root-validation-transcript.txt` typecheck/build exit 0 all-green in the executable clone; `validated-source-sha256.json` pins the reviewed file set.

## Generator clarification

In the middle review, the phrase “null JSON … undeclared” is imprecise: accessing `.scripts` on null raises TypeError, which the code/syscall discriminator rethrows to the FAIL boundary. The reviewed result (FAIL/1) and the control are unchanged.
