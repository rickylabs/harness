# implementation-eval-r2 — connection-recovery--265 (bounded evidence follow-up)

**Verdict: PASS at `fe32adb013da03bb7a03c97b819599b12cd60675`. No defects. Prior PASS at `a72f820` carries by verified source equality.**

This is a narrow follow-up, not a re-review. Product behavior was fully evaluated in the prior PASS; that verdict transfers because every load-bearing source is byte-identical between the two heads. What this round reviews is the coordinator's publication-scan correction and the now-tracked route evidence.

[source: git rev-parse HEAD and diff a72f820..fe32adb; topic: reviewed head and change surface; date: 2026-09-08]

## Source equality (carries prior behavior review)

All six product files plus the maintained gate script are hash-identical at both heads, verified via `git show` SHA-256 comparison:

- `packages/contracts/src/fold.ts`, `src/client.ts`, `src/index.ts`, `src/client.test.ts`, `README.md`, `package.json`, `scripts/check-installed-contracts.mjs` — each IDENTICAL.
- The `a72f820..fe32adb` diff touches only seven run-artifact files; `packages/` and `scripts/` show an empty diff.

[source: git show SHA-256 equality per file; topic: byte-identical product and gate; date: 2026-09-08]

## Correction under review — portable probe scratch paths

The publication scan found hardcoded operator-home scratch prefixes in the two run probe sources that prior scope scans missed. Both now build scratch directories from `node:os tmpdir()` plus a task prefix:

[source: .llm/runs/connection-recovery--265/packed-recovery.mjs:7, :13; topic: portable scratch; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/installed-candidate-check.mjs:13, :18; topic: portable scratch; date: 2026-09-08]

Verified this round:

- No hardcoded operator-home, root-home, or other machine-specific path literal remains in either probe source, the gate script, or the new run files; no secret-shaped content in the delivery diff.
- `packed-recovery-receipt.json` retains tarball digest `2fea5d3d…ccb` (unchanged candidate identity) and now records the corrected probe-source hash, which matches the actual corrected file byte-for-byte — consistent with a genuine post-edit rerun, as claimed.
- The historical supplemental header now explicitly names the pre-maintenance source `a749aca`, states it rejects the maintained gate, and directs current users to `pnpm run check:installed`. Its original receipt file is unchanged and therefore remains correctly historical.
- The `coordinator-final.md` caveat is accurate: receipt hashes of the supplemental run describe the executed pre-correction version, not the portability edit; current supported verification is the maintained root command.

[source: .llm/runs/connection-recovery--265/packed-recovery-receipt.json:7-9; topic: unchanged tarball, updated probe hash; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/installed-candidate-check.mjs:1-6; topic: historical caveat; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/coordinator-final.md:15-19; topic: correction scope; date: 2026-09-08]

## Route evidence — gap closed

- `matrix-impl-eval-r2.json` (this dispatch's fresh CLI output) is byte-identical to the tracked `matrix-impl-eval-launch.json`: implementation_evaluation role, feature tier, first route `muse_spark_1_3`/`xhigh`, fallback `opus_5`/`xhigh`.
- The native route receipt records the exact query, selected `muse_spark_1_3`/`xhigh`/`meta`, observed `openrouter` `meta/muse-spark-1.3-contributor` `xhigh` with `identityMatched: true`, and generator `gpt-6-astra`/`openai`/`low`.
- Same-session and different-family requirements hold: the observed route matches this evaluator session's model family, and the generator family differs from the evaluator family, consistent with the independence lineage in the run's supervisor and plan-eval records. No cryptographic vendor attestation is claimed.

[source: .llm/runs/connection-recovery--265/matrix-impl-eval-r2.json:1-26; topic: fresh route output; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/implementation-route-receipt.json:1-24; topic: route and native metadata; date: 2026-09-08]
[source: .llm/runs/connection-recovery--265/coordinator-final.md:5; topic: route-evidence disposition; date: 2026-09-08]

## Preservation and hygiene

- Original `implementation-eval.md` is preserved verbatim (working-tree SHA matches the `fe32adb` committed blob).
- No `0.4.0` tag exists; no registry push, downstream upgrade, or adoption is claimed. CI run `34261783654` at `a72f820` is coordinator-queried evidence cited in `coordinator-final.md`, not re-queried here; no new publication is inferred.

## What this bounded review did and did not execute

Did: head/diff inspection, per-file hash equality for all product and gate sources, probe-source portability and secret/path scans, receipt-hash cross-checks (probe hash matches file; tarball digest unchanged; supplemental receipt untouched), route-file comparison and independence confirmation, eval-verbatim check, tag absence check.

Did not: repeat the product test suite, typecheck, pack/install probes, or CI queries — correctly omitted per the brief absent a new finding, and none arose. Prior behavior gates stand on the carried PASS plus the unchanged sources.
