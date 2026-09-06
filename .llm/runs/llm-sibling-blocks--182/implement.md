# Implementation — llm-sibling-blocks--182

## Summary

Issue [#192](https://github.com/rickylabs/harness/issues/192) is implemented locally on
`fix/192-llm-sibling-blocks`. `flattenText` now inserts one LF between every collected sibling text
block. Serialized-wire regressions prove the rule for user turns, assistant turns with omitted
reasoning, empty siblings, and failed tool-result content with its original correlation id. All
local gates pass. Commit, push, PR mutation, implementation evaluation, and merge remain with the
supervising session.

## Change

- [`packages/dsh-app/src/llm/request.ts:119-132`](../../../packages/dsh-app/src/llm/request.ts)
  changes the single flattening expression from `parts.join("")` to `parts.join("\n")` and documents
  the LF-separated result. Collection, image refusal, reasoning omission, and call-site behavior are
  untouched.
- [`packages/dsh-app/src/llm/request.test.ts:183-235`](../../../packages/dsh-app/src/llm/request.test.ts)
  asserts exact serialized user/assistant wire messages, including `"first\nsecond"`, an interleaved
  reasoning block, `"first\n\nsecond"`, and the accepted `"\n"` multi-empty consequence.
- [`packages/dsh-app/src/llm/request.test.ts:323-342`](../../../packages/dsh-app/src/llm/request.test.ts)
  asserts `"[tool error] first\nsecond"` and the unchanged `call_siblings` tool id in one exact wire
  message.

The product diff is two files: 77 insertions and 2 deletions. Seventy-five insertions are regression
tests; production behavior changes at the one join expression plus its comment.

## Regression-first evidence

With the new assertions present and the production join still `join("")`, the focused command
`pnpm --filter @rickylabs/dsh-app test` exited 1:

- 251 tests total; 247 passed and 4 failed.
- The user and assistant cases observed `"firstsecond"` instead of `"first\nsecond"`.
- The empty-sibling case observed only `"firstsecond"`; the multi-empty message was skipped instead
  of producing `"\n"`.
- The failed tool result observed `"[tool error] firstsecond"` instead of the LF-separated content.

Those four failures are exactly the new assertions. The existing 247 tests remained green.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm --filter @rickylabs/dsh-app test` | PASS — 251 tests, 251 passed, 0 failed; 45 suites. |
| `pnpm test` | PASS — all 15 participating workspace project test scripts completed. |
| `pnpm run build` | PASS — 15 package builds and graph, lifecycle, links, forms, snapshots, publish, docs, and generated-skill checks completed; link check reported 0 broken. |
| `git diff --check -- packages/dsh-app/src/llm/request.ts packages/dsh-app/src/llm/request.test.ts` | PASS — no whitespace errors. |

No credentials, live model, daemon, board mutation, generated artifact, dependency, or sibling
repository was involved.

## Remaining gate

The locked plan requires an opposite-family implementation evaluation on the exact committed PR
head before merge ([`plan.md`](plan.md)). This session has not committed or pushed, so there is no
immutable head to evaluate yet.
