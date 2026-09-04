# Context pack — pr-91-adversarial-review--review-claude

## Outcome

**Complete with verdict `FAIL_FIX`.** PR #91 cannot pass adversarial review at head
[`6f348ba`](https://github.com/rickylabs/harness/commit/6f348ba17cf761176633e9f7859c40670c6cfd18).

Three fixes are required:

1. Add an executable graph-consistency gate so deleting a required TypeScript project reference
   makes `pnpm -r build` fail.
2. Remove the ordered `PLUGIN_PACKAGES` public value from the empty `dsh-app` stub; E2 owns that
   composition contract.
3. Change the root clean delegation to an unambiguous pnpm 11 invocation such as
   `pnpm -r run clean`.

All other requested checks passed: the workspace contains exactly the 14 packages from
[#31](https://github.com/rickylabs/harness/issues/31), all package configs extend the base without
redeclaring its options, a clean typecheck/build succeeds, the diff contains no forbidden evidence
or credential signatures, and pnpm 11.25.0 accepts the `allowBuilds` policy.

The complete command record and citations are in
[`adversarial-review.md`](adversarial-review.md).
The matching review was published on PR #91 as
[`pullrequestreview-5117957956`](https://github.com/rickylabs/harness/pull/91#pullrequestreview-5117957956).
