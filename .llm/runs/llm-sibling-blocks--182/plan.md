# Plan — llm-sibling-blocks--182

## Summary

Change the one block-flattening rule from empty concatenation to one LF between sibling text blocks,
then prove it for user, assistant, and text blocks within tool-result content at the serialized request boundary.
Keep the PR to `request.ts`, its focused test file, and these run artifacts. No dependency, API,
transport, stream, routing, board, or documentation change belongs in this repair.

**State: locked for independent review; product mutation remains blocked.** Doctrine requires a
separate session to attack the plan and a `PASS` plan evaluation before implementation
([`doctrine/WORKFLOW.md:71-90`](../../../doctrine/WORKFLOW.md)).

## Decisions

### D1 — Use one literal LF between collected sibling text blocks

Replace `parts.join("")` with `parts.join("\n")` in `flattenText`. Issue #182 establishes the missing
separator as the defect ([issue #182](https://github.com/rickylabs/harness/issues/182)); LF is the
smallest visible boundary which preserves each block's exact text. Issue #192 selects that
recommendation and names user, assistant, and tool-result-content coverage
([issue #192](https://github.com/rickylabs/harness/issues/192)).

Rejected alternative: preserve empty concatenation to match installed upstream. Both upstream
conversion implementations use it, but issue #182 identifies that behavior as the defect; copying it
would leave adjacent blocks indistinguishable.

### D2 — Keep collection and refusal behavior byte-for-byte stable

Do not trim text, filter empty text blocks, insert leading/trailing newlines, turn reasoning into
text, or alter image detection. Change only the delimiter passed to the existing join. The current
loop is already the single authority for which blocks participate
([`packages/dsh-app/src/llm/request.ts:119-132`](../../../packages/dsh-app/src/llm/request.ts)).

Rejected alternative: normalize whitespace or special-case empty blocks. That changes caller text
and introduces a second rule beyond finding 9.

### D3 — Test the public wire result through `buildRequest`

Add focused cases in `request.test.ts` which construct complete `Message` values, call
`buildRequest`, and assert the emitted `messages` content. This matches the current test boundary
([`packages/dsh-app/src/llm/request.test.ts:40-70`](../../../packages/dsh-app/src/llm/request.test.ts))
and avoids exporting a private helper for tests.

Rejected alternative: export and unit-test `flattenText` directly. That expands the package surface
and can pass while a call site still serializes the wrong value.

## Owner forks

None. Selecting a concrete separator is a routine implementation decision inside issue #182's
explicit missing-separator defect. LF preserves a visible boundary without normalizing either
block; an independent plan evaluator can reject that recommendation before product mutation.

## Spikes

None. The implementation path, dependency version, upstream comparison, exact outputs, and runnable
test commands are established in [`research.md`](research.md).

## Implementation manifest

1. In `packages/dsh-app/src/llm/request.ts`, update the `flattenText` doc comment to state that
   surviving sibling text blocks are LF-separated, then change only `parts.join("")` to
   `parts.join("\n")`.
2. In `packages/dsh-app/src/llm/request.test.ts`, add wire-level regression coverage within
   `translating a conversation`:
   - a user message containing `"first"` and `"second"` text blocks emits `"first\nsecond"`;
   - an assistant message containing two text blocks emits `"first\nsecond"`;
   - a tool result containing two text blocks within its content emits one correlated tool message with
     `"first\nsecond"`.
3. In one of those focused cases, put a reasoning block between the two text blocks and assert the
   same single LF result. This proves omitted non-text content adds no phantom separator. Add one
   edge case with an empty middle text block and require exactly `"first\n\nsecond"`; this proves the
   implementation retains block boundaries instead of silently filtering caller content.
4. Run `pnpm --filter @rickylabs/dsh-app test`, `pnpm test`, and `pnpm run build`. The focused test
   proves the rule, the workspace suite catches cross-package assumptions, and the repository build
   executes its required graph, lifecycle, link, form, snapshot, publish, docs, and skill checks
   ([`package.json:12-28`](../../../package.json)). Record exact command results in the
   implementation run/PR evidence.
5. Request the repository's required opposite-family implementation evaluation against the exact PR
   head. Do not merge unless that evaluation passes and CI remains green.

## Dependency DAG

```text
independent plan review + plan evaluation PASS
                    |
                    v
       one-line delimiter change
                    |
                    v
       focused wire regression cases
                    |
                    v
  dsh-app test -> workspace test -> build
                    |
                    v
 opposite-family implementation evaluation
                    |
                    v
             merge eligibility
```

## Acceptance gates

1. The diff changes product behavior only in `flattenText` and tests only in `request.test.ts`.
2. Serialized user and assistant sibling text is exactly `"first\nsecond"`.
3. Serialized sibling text within tool-result content is exactly `"first\nsecond"`, with the original
   `tool_call_id`; existing failed-tool prefix behavior remains green.
4. Interleaved reasoning creates no extra LF, while an empty middle text block retains two
   boundaries as exactly `"first\n\nsecond"`.
5. Reasoning-only turns, assistant call-only turns, and ordinary/nested image refusals remain green
   under the existing suite ([`packages/dsh-app/src/llm/request.test.ts:183-266`](../../../packages/dsh-app/src/llm/request.test.ts),
   [`packages/dsh-app/src/llm/request.test.ts:327-360`](../../../packages/dsh-app/src/llm/request.test.ts)).
6. `pnpm --filter @rickylabs/dsh-app test` exits 0.
7. `pnpm test` exits 0.
8. `pnpm run build` exits 0.
9. Opposite-family implementation evaluation returns `PASS` for the exact PR head.

## Risk register

| Risk | Likelihood | Impact | Gate |
| --- | --- | --- | --- |
| A delimiter is added around omitted reasoning/tool-call blocks rather than between surviving text siblings. | Medium | Medium | Interleaved reasoning regression asserts exactly one LF. |
| Text blocks within tool-result content retain separator-free concatenation through a second path. | Medium | High | Dedicated tool-result wire assertion exercises `toolMessages` and `flattenText` together. |
| The repair trims or duplicates caller newlines. | Low | Medium | Review requires a one-line join change; exact-output assertions reject normalization. |
| Empty text blocks create surprising blank lines. | Low | Low | Locked semantics retain each text-block boundary; the explicit `first\n\nsecond` assertion documents it. |
| Scope expands into upstream packages or another conversion concern. | Low | High | Diff-surface gate permits only the local helper, focused tests, and run evidence. |
| A focused package pass hides workspace fallout. | Low | Medium | Full `pnpm test` follows the package test. |
| Repository structural checks fail outside the package test surface. | Low | Medium | `pnpm run build` executes the repository check chain. |

## Review amendment — required empty-sibling behavior

The independent review found one extra wire consequence of D1: `["", ""]` becomes `"\n"`.
That multi-empty-block user/assistant message is now emitted rather than skipped, and a
conversation containing it is no longer empty-conversation. This is accepted as the explicit
boundary-preservation rule, not claimed as unchanged behavior. A zero-block or single-empty
text message still flattens to empty. Add a mandatory wire assertion for the multi-empty user
message (`"\n"`) alongside the empty-middle case (`"first\n\nsecond"`). Acceptance gate 4
includes both; the tool-result sibling regression must use isError true and assert
`"[tool error] first\nsecond"` with its original tool_call_id.
