# Validation

Live cost projection PASS; deployed issue-to-native integration remains outside this slice.
No live native identity, source location or amount appears in these receipts.

Baseline: e118ff9dcf1631ed7a3c7e0e3daefd793b67ea0a, an isolated owned worktree freshly fetched from main.
Shared checkout and stale dist were not used. Before publication the branch fast-forwarded to
ab4daf93f68793d54ab5b3e4e6003ced207b90c4; only BOARD.md changed upstream, no tested runtime source.

## Executed evidence

`pnpm --filter @rickylabs/telemetry test` — exit 0; 563 tests passed, 0 failed.
`pnpm --filter @rickylabs/harness-contracts test` — exit 0; 232 tests passed, 0 failed.
Actual output summaries: [package-tests.json](package-tests.json).

`node scripts/check-agent-cost-mutations.mjs` — exit 0. 36 mutations killed, 36 restored controls passed.
[Actual commands, exits and red assertion output](mutations.jsonl). The script mutates compiled behavior
one guard at a time, restores the exact bytes in finally, and reruns all cost controls. Syntax failures
and missing-module errors are not accepted as mutation evidence. Initial calendar and quota-future tests
were strengthened when a second guard masked the mutation; the final recorded run kills both.

`node .llm/runs/agent-cost--bindings/live-proof.mjs` — exit 0. The native home was supplied through private
environment configuration. [Redacted output](live-proof.json) proves real nonzero token components match
the native run, real reported currency resolves where present, and missing currency remains null with
measurement_missing. A real native child also has available tokens and headroom, and its parent is in
the bounded read. The command does not create an assignment or touch a receipt.

Limit 10 is per native source; 24 native records were read. Native scan completeness remains false.
No claim of exhaustive ancestry or deployed per-issue product acceptance follows from this component
proof. The missing Orchid root binding remains assigned separately by the coordinator.

The three real rows remain separate: account-window headroom with its date and reset validity,
reported USD only where supplied, and overlapping token components without a total. Actual amounts
and native identifiers are checked privately and withheld from published evidence.

## Review

Independent plan review: PASS after addressing Qwen findings. The owner-requested Kimi attempt did
not establish a complete identified review and was INCONCLUSIVE; the matrix fallback Qwen reviewed
the revised plan. [Plan review](plan-review.md). Implementation review: PASS from independent Zhipu-family `z-ai/glm-5.3-flash`, exit 0, in 178.9 seconds. [Implementation review](implementation-review.md). Every attempt is separately recorded under `attempts/`; incomplete attempts remain INCONCLUSIVE.

`pnpm run build` — exit 0, all 13 stages green. [Actual output excerpt](build.json).
Publication leak scan PASS; staged diff whitespace check exit 0.
