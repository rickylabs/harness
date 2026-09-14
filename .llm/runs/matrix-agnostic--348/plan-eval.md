# Matrix agnostic — independent plan evaluation

**Verdict: PASS.**

Each round-1 finding is resolved by the amendment, and none of the resolutions substitutes preference for safety.

**Must-fix items**

1. **Router syntax.** Amendment 1 names a concrete pattern, a length bound, and paired negative controls for space, slash, uppercase and metacharacters. Ownership is cleanly split: the document registers, the wire keeps its encoding guards. Resolved.

2. **Custom triggers.** Amendment 2 makes the trigger type a string matched only against the validated chain's declared `when` values, with undeclared inputs returning no-route. The claim that no coordinator or dsh-app caller of `resolveFallback` exists makes the package-level admission test the actual integration boundary rather than a shortcut. Resolved, on the stated condition that the repo search claim holds; the implementation review should spot-check it.

3. **Alias scope.** Amendment 3 adopts the recommended split: canonical names inside the document, aliases only in caller queries, with rejection of alias chains and canonical-name collisions and a separately preserved alias map in the catalog. Diagnostic index integrity follows directly. Resolved.

4. **Fallback-only coverage.** Amendment 4 takes the alternative I offered rather than the one I preferred, and the reasoning is sound. Coverage is a declared certifying seat, not launch permission. The runtime still gates on trigger, turn boundary, depth and paid approval, and a test proves a covered paid fallback stays unlaunchable without approval. This preserves existing fallback coverage semantics and baseline route choices instead of redesigning the matrix. The `any` handling is also correct: rejecting a tier whose only coverage is same-family `any`, while skipping that seat at resolution for that author, is tighter than a global rejection would be without over-refusing valid documents. Resolved.

**Should-fix items**

- Plan/plan_evaluation asymmetry is stated explicitly and is the safe direction.
- Implementation-purpose lanes must be a tier's implementation binding regardless of other uses, which closes the orphan-lane bypass.
- Legacy `tierPlan.review` keeps the explicit legacy binding while both coverage pairs are checked. Stated.
- New fixed field names enter the structural set; arbitrary roles stay indexed. Stated.
- Same-family skip in both primary and fallback resolution is covered by amendment 4's "skip that seat when resolving for that author" together with the validation-time tier rejection.

**Residual notes for the implementation review, not blockers**

- Verify the no-caller claim for `resolveFallback` before treating the package test as end to end.
- Confirm the length bound on router IDs matches whatever bound model IDs already use, so the two vocabularies do not drift.
- Live availability remains INCONCLUSIVE, correctly marked.
