# Installed-package gate amendment

The existing installed-package gate must verify the candidate selected by the source manifest. Its two literal 0.3.0 assertions reject the reviewed 0.4.0 candidate before installed-consumer checks can execute. The original failing run remains recorded in the implementation evidence.

Extend this run's mutation surface narrowly to scripts/check-installed-contracts.mjs: read and validate the source manifest version, then require pack metadata and installed package version to equal it. Keep protocol1, all governance/run-observation fixtures, privacy scans, offline install, runtime/declaration checks and child cleanup unchanged. This is release-gate maintenance required by the approved candidate pack/install gate, not a new protocol rule. Independent implementation evaluation includes this amendment.

The implementation session retains ownership of contracts code and its evidence. The coordinator owns this separate gate edit. No registry publication or tag push is included.

[source: scripts/check-installed-contracts.mjs; topic: hard-coded version rejection and retained installed checks; date: 2026-09-08]
[source: plan-eval.md criterion6 and baseline-amendment.md; topic: required local candidate verification; date: 2026-09-08]

Executed the checked-in `pnpm run check:installed` and full `pnpm run test` after the correction: both exit0. All108 run-observation fixtures and both governance fixtures pass against0.4.0. Log digests and command results are in coordinator-gates.json. The earlier worker FAIL remains a historical result of the pre-correction script.

Coordinator commit ownership decision: leave scripts/check-installed-contracts.mjs, coordinator-gate-amendment.md and coordinator-gates.json unstaged for a separate coordinator commit. Commit the contracts implementation and worker-owned run evidence now; no user answer is required. The coordinator will commit its three files before independent review.
