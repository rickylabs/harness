# Matrix agnostic — context

PR #348 continuation on `feat/routing-complex-evaluators`, baseline `89fba01`. Implementation complete; independent implementation review PASS after a truncated packet was refused. Plan passed separate Fable review (plan-eval.md). No owner forks introduced.

Changes: open trigger/router vocabularies, role-to-lane tier maps, caller-only aliases, generic lane names, tier-local plan/implementation evaluator bindings, opposite-family coverage including orphan implementation refusal, serializable editor catalog, custom-router wire/dry-run support, fixed policy fixtures.

Verification: required suites 1026 pass (routing 247/coordinator 332/telemetry 447); related subagents 436/llm-local 95/dsh-app 333 pass; workspace typecheck, link check and compiled-policy guard pass. Nineteen guard-removal mutants fail; each exact restore passes all 40 focused tests. Replacing every live model/family/effort/router/trigger ID keeps all five consumer suites green and restores exact original bytes. See verification.md and executable run scripts.

Final six-package verification: 1890 pass / 0 fail. Independent verdict is recorded in implementation-eval.md. Public-artifact and whitespace checks passed. Deliver through a file-based commit, ordinary push and PR update. Live availability and cockpit rendering are INCONCLUSIVE and outside this export's claim.
