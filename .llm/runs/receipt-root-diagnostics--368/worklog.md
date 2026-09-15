# Worklog — receipt-root-diagnostics--368

## 2026-09-15 — design checkpoint

1. **Public surface:** `readOrchidDispatches` returns the supplied `root` and nullable closed `reason` in addition to its unchanged fields.
2. **Domain vocabulary:** receipt root; healthy empty; root refusal; reasons `missing`, `not_directory`, `wrong_mode`, `relative_path`, `symlink`, `git_ancestor`.
3. **Ports:** Node `lstat`, `realpath`, `readdir`, and path predicates; no new dependency.
4. **Constants:** exported reason union replaces anonymous classification strings; existing diagnostic constants remain unchanged.
5. **Commit slices:** one product slice touches reader, reader tests, CLI fallback if required, README, and this run directory; `pnpm --filter @rickylabs/telemetry test` proves it before full gates.
6. **Deferred scope:** output envelope redesign, generic OS-error taxonomy, and receipt-binding diagnostics are excluded because #368 concerns only configured-root refusals.
7. **Contributor path:** `packages/telemetry/src/orchid-dispatch.ts` contains the result contract and validation order; its colocated test enumerates every root reason.

Fresh routing query completed at NetScript `f3324909`; implementation is `sol`/medium and implementation evaluation is `glm_5_3_flash`/provider default.

## 2026-09-15 — plan evaluation round 1

Cross-family evaluator verdict: `PASS AFTER NARROW FIXES`. The plan now explicitly bounds the public surface to the exported reader result, distinguishes the operator-supplied root from private descriptor data, pins ENOENT classification at `lstat`, and specifies the mutation procedure. No scope or owner decision changed.

## 2026-09-15 — implementation slice

Added the root/reason result contract, classified the six existing refusal guards, preserved fixed notes/degraded, added six named defects and one healthy-empty control, widened the CLI's disabled-source fallback only for type consistency, and documented the reader contract. The direct package equivalent passed 469 tests. Disabling the mode guard made the dedicated `wrong_mode` control fail; restoration passed all 12 targeted tests. Declared pnpm gates are INCONCLUSIVE because the worktree mount refuses their `tsc` shims with exit 126; exact evidence is in `verification.md`.

## 2026-09-15 — implementation evaluation

Separate GLM-family evaluator verdict: `PASS`. It reproduced both green results and the pnpm reachability failure, then independently removed the `git_ancestor` reason assignment and observed the dedicated control fail before restoring and rerunning green. No drift or debt was found.

## 2026-09-15 — handoff

Committed product and run evidence as `d734f13`, pushed `orch/divybot-368`, and opened [PR #369](https://github.com/rickylabs/harness/pull/369). The PR is ready for review with `status:ready-merge`; its body ends with the required issue closing line and carries command outputs and exit codes. Nothing independent remains to fan out.

## 2026-09-15 — base conflict repair

Rebased onto `origin/main` at `273fdea`. Skipped the inherited baseline replay, then reconciled the product conflict by retaining main's new exact-`0700` safety rule and attaching this change's `wrong_mode` reason to that exact predicate. The combined reader suite passed 13 tests; disabling the combined guard failed the reason control and upstream exact-mode control, and restoration passed 13. See `drift.md`.
