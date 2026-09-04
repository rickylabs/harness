# Context pack — pr-98-adversarial-review--review-claude

## Outcome

**Complete with verdict `FAIL_FIX`.** PR #98 cannot pass adversarial review at head
[`0a6dfe7`](https://github.com/rickylabs/harness/commit/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256).

Required fixes:

1. Make `init --dry-run` prevent every file and GitHub mutation.
2. Make epic slug truncation collision-resistant and reject/report any remaining collision.
3. Make the status validator represent a missing status and compare the `status:` prefix without
   case sensitivity.
4. Make labels-file parse issues fail plan/check/apply/init before transport.
5. Validate colors as six hex digits before planning or transport.

Passing evidence: no attempted input produced a delete; the stateful CLI fixture applied 28 labels
once and zero on the second run; a deliberately removed label made `labels check` exit 1; skill
install produced `created` then `unchanged` and preserved a foreign file; no-transport exited 3 with
remediation; the credential canary reached neither argv, output, nor disk; all nine live E1–E9 titles
mapped to `e1`–`e9`; lane ties were deterministic; and the clean graph, typecheck, build, diff check,
and 57 forge tests passed.

The complete commands, fixture inputs, results, and immutable citations are in
[`adversarial-review.md`](adversarial-review.md).
The same evidence was published on PR #98 as
[`issuecomment-5547700080`](https://github.com/rickylabs/harness/pull/98#issuecomment-5547700080),
and the durable artifacts are proposed by review PR [#102](https://github.com/rickylabs/harness/pull/102).
