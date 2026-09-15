# Validation

Independent implementation review PASS: GLM projection/types/CLI and Kimi transport/reader, both exit 0. Native reads work; live goal notification delivery remains INCONCLUSIVE. No live values, identities or locations are published.

Baseline: 7dfefa38465ddd151a7e29360189a716ea484259, freshly fetched isolated worktree. Installed codex-cli 0.154.0 supplied the generated experimental field contract.

The first mutation pass killed 63 of 68; five controls were masked or timed out and were not counted as PASS. Strengthened independent controls killed all 68. Final coverage/EOF controls and final test counts are recorded in the completed receipts.

Read-only live evidence is in [live-proof.json](live-proof.json). The subscription observation window emits no write; no notification is INCONCLUSIVE, never a passing live-delivery claim.

`node scripts/check-codex-thread-mutations.mjs` — exit 0; 77 mutations killed, 77 restored controls passed. Exact commands and failed-test output: [mutations.jsonl](mutations.jsonl).

`pnpm --filter @rickylabs/telemetry test` — exit 0, 598 passed; contracts tests — exit 0, 232 passed. [Output](package-tests.json).

The final live probe exits 3: 420 rows survive, complete:false/rpc_error from three failed goal reads. 414 goals absent, three goals have counters but budget_unset. All parents ancestry_unavailable; all running verdicts runtime_unavailable. No notification in five seconds; no live stream PASS claimed.

Before publication, fast-forwarded to 62adf158cf25080976ecd6f07ac6888fd75ee66e; upstream changes were BOARD.md only. Tested runtime source did not change.

`pnpm run build` — exit 0; all 13 stages green on the final implementation. [Output](build.json).

The CLI limit-one probe verifies exit 3 with complete:false/scan_limit, one surviving row and default sensitive-context redaction. [Command and output](cli-live-proof.json).

[Completed independent review and dispositions](implementation-review.md). All unsuccessful attempts remain individually recorded as INCONCLUSIVE or FAIL_FIX.
