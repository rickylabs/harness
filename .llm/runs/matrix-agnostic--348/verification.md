# Matrix agnostic — verification

Current full required suites: routing 247, coordinator 332, telemetry 447 = **1026 pass, 0 fail**, exit 0. Workspace typecheck exit 0. Compiled-policy guard exit 0. Subagents 436, llm-local 95 and dsh-app 333 also pass.

Baseline: routing 207 + coordinator 332 + telemetry 447 = 986 pass. Earlier prose quoted the stale PR count 845; the captured test log corrects it.
Development failures: first routing compile failed on a readonly tuple mismatch. Next routing run was 244 pass / 1 fail due to fixture initialization order. Both fixed and verified in the current full run. No check is reported green from empty output.

Mutation checks and independent implementation review completed; see the results below and implementation-eval.md. Live provider availability/cockpit rendering INCONCLUSIVE: no provider dispatch or cockpit UI is part of this package export.

Guard-removal mutation results: 19/19 mutants rejected with nonzero test exits; each restored run passed all 40 tests. No timeout, signal termination or surviving mutant. One earlier survivor exposed a masked test and was fixed before the successful run. Raw per-mutant result counts follow:

- {"control":{"exit":0,"tests":40,"failures":0}}
- {"name":"router syntax","broken":{"exit":1,"tests":40,"failures":4},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"model display fields","broken":{"exit":1,"tests":40,"failures":3},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"trigger registration","broken":{"exit":1,"tests":40,"failures":2},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"alias collision","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"alias target","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"alias syntax","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"role syntax","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"role reference","broken":{"exit":1,"tests":40,"failures":2},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"implementation required","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"evaluator required","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"ambiguous implementation","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"opposite-family coverage","broken":{"exit":1,"tests":40,"failures":3},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"author-relative any resolution","broken":{"exit":1,"tests":40,"failures":2},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"implementation role purpose","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"evaluation role purpose","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"plan requires generator","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"formal evaluator coverage","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"plan evaluator coverage","broken":{"exit":1,"tests":40,"failures":2},"restored":{"exit":0,"tests":40,"failures":0}}
- {"name":"orphan implementation","broken":{"exit":1,"tests":40,"failures":1},"restored":{"exit":0,"tests":40,"failures":0}}

Full live-policy substitution: all model/family/effort/router/trigger IDs changed, five consumer suites passed, exact original document bytes restored in finally. Results: 

- packages/coordinator test: ℹ tests 332
- packages/coordinator test: ℹ pass 332
- packages/coordinator test: ℹ fail 0
- packages/routing test: ℹ tests 247
- packages/routing test: ℹ pass 247
- packages/routing test: ℹ fail 0
- packages/llm-local test: ℹ tests 95
- packages/llm-local test: ℹ pass 95
- packages/llm-local test: ℹ fail 0
- packages/telemetry test: ℹ tests 447
- packages/telemetry test: ℹ pass 447
- packages/telemetry test: ℹ fail 0
- packages/dsh-app test: ℹ tests 333
- packages/dsh-app test: ℹ pass 333
- packages/dsh-app test: ℹ fail 0

Link check: 67 files, 379 relative links, 0 broken. External links not checked. Compiled-policy guard: 309 sources checked, mutation self-test passed.

Final pre-commit run: routing 247, coordinator 332, telemetry 447, subagents 436, llm-local 95, dsh-app 333 = **1890 pass / 0 fail**, exit 0. The required subset is **1026 pass / 0 fail**. Independent plan and implementation verdicts: PASS.
