# Independent plan review

Evaluator: opencode-go/glm-5.3, session ses_f5db10994ffekehhFtau5VELom, provider-default effort. Initial 100-second invocation timed out (exit 124); resumed same session, exit 0.

**PASS AFTER NARROW FIXES**

**Sound on the substance.** All four issue-316 acceptance criteria are covered: distinct exit vocabulary with structured reason/remedy (plan.md:5-6); no-unearned-verdict via noexec-not-inferred-from-every-failure, enumeration-inconclusive, attempted≠executed, incomplete-sets-not-all-green (plan.md:5-7); mutation-verify with red-test proof and both executable/noexec TMPDIR runs (plan.md:8), which also satisfies "an inconclusive result must not be green" from the owner's measurement comment. Missing-script stays configuration FAIL per the owner clarification (plan.md:6,10). Each research finding maps to a plan clause 1:1 (research.md:6-9 → plan.md:5-7). The DAG's independent implementation review satisfies I2, and the mutation surface matches supervisor.md — no charter or architecture conflict.

**Narrow fixes before implementation:**

1. **Gate 1's control set omits the hygiene guard.** The plan enumerates refusal/Windows/executable-probe controls (plan.md:5) but not the output boundary the owner's measurement comment declares load-bearing ("never reflect npm, compiler or probe output, paths, arbitrary errors… any fix has to keep it"; enforced at scripts/check-installed-contracts.mjs:245-246). Carrying the owned scratch location (as the issue asks) deliberately crosses the baseline green test "the record carries no path" (baseline-tests.txt:15). The plan should name that control explicitly — record carries owned scratch location, closed reason vocabulary, observed code/signal only; no arbitrary child output or unowned paths — and narrow the existing no-path test rather than drop it, as gate 2 does for its retained tests (plan.md:6).

2. **The compile-boundary exit-2 partition is implied, not specified.** "Actual compiler exit 2 is FAIL, not the gate protocol" (plan.md:7) intentionally reverses the baseline green test "a stage that exits 2 of its own accord is inconclusive" (baseline-tests.txt:29). State the partition: exit 2 from the *named compile stage* → FAIL; exit 2 from any other stage → inconclusive with reason unrecorded; known signal translations preserved (baseline-tests.txt:31-35). Without this, an implementer may flip the existing test wholesale and lose the non-compile ambiguity handling.

Minor, no action: the owner's "gate 2 first" sequencing is moot in this continuation — 325 already merged the base gates; this run only closes the three residual holes.

Disposition: both narrow fixes accepted and recorded in plan-eval.md before code mutation.
