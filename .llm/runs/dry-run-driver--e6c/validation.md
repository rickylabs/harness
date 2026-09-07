# dry-run-driver--e6c — validation

The coordinator ran all required gates on clean head eae32595d3ab81239461ff08b27038d43933a716, after rebasing the implementation onto main 7eef21d without conflict. The head and worktree remained unchanged throughout. Independent implementation evaluation of this head is PASS; see implementation-eval.md.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run typecheck` | 0 | Workspace typecheck and its graph/lifecycle prerequisites |
| `pnpm run build` | 0 | Compile plus all ten repository checks |
| `pnpm -r run test` | 0 | 2,667 tests passed across 12 packages; zero failures, skipped, cancelled or todo |

| Package | Tests passed | Failures |
| --- | --- | --- |
| contracts | 121 | 0 |
| subagents | 227 | 0 |
| board | 272 | 0 |
| telemetry | 382 | 0 |
| provider-codex | 44 | 0 |
| provider-claude | 107 | 0 |
| routing | 136 | 0 |
| provider-opencode | 151 | 0 |
| coordinator | 317 | 0 |
| llm-local | 85 | 0 |
| forge | 513 | 0 |
| dsh-app | 312 | 0 |

The new focused set is 63 tests, including two owned coordinator children killed with SIGKILL. The full workspace run above executes those tests again. No real provider is used by the new driver or its fixtures. The tutorial check re-ran four marked blocks and matched them; three existing blocks explicitly remain untested. A green build does not convert those three declarations into execution evidence.

[observed - harness packages/dsh-app/src/dry-run-crash.test.ts:12 and packages/coordinator/src/dispatch-admission.test.ts:1 and packages/dsh-app/src/dry-run.test.ts:1; topic: executable acceptance evidence; retrieved 2026-09-07]

Publication review inspected the changed text paths and found no credential/home-path/private-consumer/binary content. The contracts port, journal constructors, recovery reducer, providers, lockfile, manifests and generated files are unchanged. The issue-brief transcription had trailing whitespace on empty gh metadata fields; final evidence cleanup strips that whitespace only. The temporary summary parser initially expected TAP `#` summaries while this Node runner emitted `ℹ`; it was corrected and the complete twelve-package totals were re-read from the existing log. No zero-test count was treated as a test result.

## Final-head verification protocol

This evidence commit necessarily follows the candidate checks above. The coordinator will run the same three gates from the final clean head, resume the same evaluator for the evidence-only diff, then put that exact head, real results and CI URL in the PR review comment. No additional commit is needed to report that external receipt. Until that comment exists, final-head gates and CI are not claimed by this file.

## Evidence limits

The driver establishes the shared durable format and local process-crash behavior for synthetic effects. It does not establish live provider delivery or route attestation, citation existence or approval, power-loss behavior, production volume semantics, hub lifecycle or the step F restart acceptance proof. Issue 62 gates live C; its later decision creates the separate live-half item. Issue 191 E/F and existing F1/F2 retain the remaining integration scope. Protected issues 62,148,181,237,244 were not changed.

[observed - GitHub https://github.com/rickylabs/harness/issues/253 and https://github.com/rickylabs/harness/issues/191; topic: acceptance scope and retained integration gates; retrieved 2026-09-07]
