# Independent plan review — round 1

**Verdict: FAIL_FIX.** The plan is directionally sound and charter-compliant, but four points are underspecified in ways that lead to materially different implementations, and one is a safety gap.

**Must fix before implementation**

1. **Router strings need a syntactic bound, not just admission.** Item 6 makes `routers` owner-supplied and item 1 validates references against that list, but nothing states the character class a router string must satisfy. A router becomes part of an executor CLI argument, so the schema must enforce the same bounded pattern used for model IDs (something like lowercase alphanumerics, dot, dash, underscore, no whitespace or separators). "Retain encoding safety" is not a spec; name the pattern and add a negative control for a router containing a space, slash, or shell metacharacter.

2. **Custom triggers must be admitted end to end.** Item 1 lets a document replace the trigger vocabulary, but `resolveFallback` takes a typed `FallbackTrigger` and callers in coordinator and dsh-app presumably validate against the frozen constant. Either the trigger type becomes `string` validated against the loaded document at the coordinator boundary, or custom triggers are dead data. State which packages change and add a test that a document-only trigger reaches a fallback step through the coordinator path.

3. **Alias scope is unstated.** Item 1 adds `laneAliases` and item 3 relies on them, but the plan does not say whether aliases are honored inside the document itself (tier rows, `constraints` keys, `deepResearchLanes`) or only in caller queries. Recommend: document-internal references must use canonical lane names; aliases resolve only in `lanePolicy` and the exported tier-role queries. Otherwise `checkPolicy` diagnostics that locate lanes by name will report index -1, and the catalog will diverge from the validated document (the exact risk item 5 names).

4. **Coverage by fallback-only or paid-only reviewers.** Item 4 counts any registered opposite-family certifier. Under current `unreviewedSteps`, a reviewer reachable only through a trigger, or only as an `outside_plan` step, satisfies coverage while dispatch can still find no launchable evaluator. Decide and state: either coverage requires an opposite-family certifier among the review lane's primaries, or fallback-only coverage is accepted and documented as such with a paired test. The former matches the charter's intent better.

**Should fix (ambiguities that will otherwise be resolved by the implementer)**

- Item 2 says a `plan` role is validated "whenever a plan evaluator is bound". Say explicitly whether a `plan` lane bound without `plan_evaluation` is accepted, and whether item 4's "reject unbound implementation lanes" applies to plan lanes whose purpose is `implementation`.
- When both `review` and `implementation_evaluation` are present and differ, state which lane the legacy `tierPlan.review` field returns.
- New keys (`triggers`, `routers`, `laneAliases`, `label`, and the four canonical role names) must be added to the structural field set, or their diagnostic paths degrade to indices. Arbitrary role names correctly stay indexed.
- Item 4's skip of same-family certifiers must be applied in both `resolveRoute` primary selection and `resolveFallback`, and `selfCertifies` must treat a same-family `any` step as a policy problem at validation, not only at resolution. The plan implies this; make it a listed test.

**Confirmed adequate**

- Purposes are already open at the baseline; preserving with a test is correct.
- Frozen fixture isolation plus live invariant-only tests, with substitution of renamed models, correctly prevents tests from owning policy.
- The catalog's explicit unproven-availability marker, no network, and no UI respect the charter boundary.
- Keeping harness vocabulary closed while opening routers is the right split, since harnesses map to executor code paths.
