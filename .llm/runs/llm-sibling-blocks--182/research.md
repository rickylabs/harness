# Research — llm-sibling-blocks--182

## Summary

`flattenText` currently erases every boundary between sibling text blocks by joining their exact
strings with `""`. The same helper serves ordinary user/assistant turns and nested tool-result
content, so one change can repair all three paths. The selected rule is one literal LF (`"\n"`)
between each surviving sibling text block. No separator is added before the first or after the last;
non-text blocks do not create separators; text is not trimmed; image refusal and failed-tool marking
remain unchanged.

The installed upstream adapters are not a source for the repair delimiter: version `0.1.2-rc.1` also
uses empty-string concatenation. That agreement establishes the current conversion behavior and the
edge cases which must remain stable. One LF is this run's bounded recommendation for the
harness-specific correction: it supplies a visible boundary without trimming or rewriting either
block. Issue #192 now states that delimiter and coverage as the implementation brief
([issue #192](https://github.com/rickylabs/harness/issues/192)).

## Scope and authority

Finding 9 identifies only `dsh-app/src/llm/request.ts` sibling-block assembly, and issue #182 requires
one rule per PR ([issue #182](https://github.com/rickylabs/harness/issues/182)). This translation is
on the token-metered `ctx.llm` seam, where `dsh` owns the request loop
([`docs/concepts/02-the-two-seams.md:7-15`](../../../docs/concepts/02-the-two-seams.md)). It does not
change subscription-agent dispatch, routing, transport, streaming response assembly, or orchestration.

## Repository behavior

1. `flattenText` pushes the exact `text` value of every text block, rejects immediately on an image,
   ignores the other block types, and returns `parts.join("")`
   ([`packages/dsh-app/src/llm/request.ts:119-132`](../../../packages/dsh-app/src/llm/request.ts)).
   Therefore `[{text: "left"}, {text: "right"}]` becomes `"leftright"`, a string in which the two
   original blocks cannot be recovered.
2. `toolMessages` calls that helper on each tool result's nested `content`, then adds the fixed
   `[tool error] ` prefix only when `isError` is true
   ([`packages/dsh-app/src/llm/request.ts:134-148`](../../../packages/dsh-app/src/llm/request.ts)).
   The sibling-boundary rule therefore reaches successful and failed tool results without a second
   implementation.
3. `translateMessages` calls the same helper for ordinary messages. It separately extracts assistant
   tool calls, skips an assistant message only when both flattened text and calls are empty, and skips
   an empty non-assistant message
   ([`packages/dsh-app/src/llm/request.ts:164-201`](../../../packages/dsh-app/src/llm/request.ts)).
4. Existing tests prove roles/order, omission of reasoning-only turns, assistant tool-call retention,
   single-block tool-result correlation, and the failed-result prefix, but contain no sibling-text
   case ([`packages/dsh-app/src/llm/request.test.ts:165-268`](../../../packages/dsh-app/src/llm/request.test.ts)).
   Image refusal is already covered for both ordinary and nested tool-result content
   ([`packages/dsh-app/src/llm/request.test.ts:327-360`](../../../packages/dsh-app/src/llm/request.test.ts)).

## Installed upstream comparison

The lockfile pins `@deepseek-ai/dsh-llm` `0.1.2-rc.1` by integrity
([`pnpm-lock.yaml:1119-1122`](../../../pnpm-lock.yaml)); `dsh-app` declares that same release line
([`packages/dsh-app/package.json:65-68`](../../../packages/dsh-app/package.json)). Two installed
conversion implementations expose the relevant semantics:

- `@deepseek-ai/dsh-llm-pi-ai` flattens ordinary text blocks with `join("")` and recursively flattens
  text from tool-result content with the same empty separator
  ([`node_modules/.pnpm/@deepseek-ai+dsh-llm-pi-ai@0.1.2-rc.1_b397c52886cba37e92f62a85c71fdd04/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1073-1086`](../../../node_modules/.pnpm/@deepseek-ai+dsh-llm-pi-ai@0.1.2-rc.1_b397c52886cba37e92f62a85c71fdd04/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js)). Its text-only conversion reuses those helpers for user messages and tool results, and substitutes `"(no output)"` only when a tool result flattens empty
  ([`node_modules/.pnpm/@deepseek-ai+dsh-llm-pi-ai@0.1.2-rc.1_b397c52886cba37e92f62a85c71fdd04/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1163-1199`](../../../node_modules/.pnpm/@deepseek-ai+dsh-llm-pi-ai@0.1.2-rc.1_b397c52886cba37e92f62a85c71fdd04/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js)).
- `@deepseek-ai/dsh-llm-deepseek` likewise defines `flattenText` with `join("")`, uses it for
  assistant content, user content, and nested tool results, and preserves each result as its own
  correlated wire message
  ([`node_modules/.pnpm/@deepseek-ai+dsh-llm-deepseek@0.1.2-rc.1_857eab20287461c3ab4cac5f5e7293e7/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js:42-45`](../../../node_modules/.pnpm/@deepseek-ai+dsh-llm-deepseek@0.1.2-rc.1_857eab20287461c3ab4cac5f5e7293e7/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js),
  [`node_modules/.../dsh-llm-deepseek/lib/index.js:107-159`](../../../node_modules/.pnpm/@deepseek-ai+dsh-llm-deepseek@0.1.2-rc.1_857eab20287461c3ab4cac5f5e7293e7/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js)).

This upstream agreement rejects a claim that `dsh-app` accidentally diverged from version
`0.1.2-rc.1`; it does not rebut finding 9. The local consolidation review explicitly identifies
separator-free sibling assembly as defective ([issue #182](https://github.com/rickylabs/harness/issues/182)).
The LF recommendation is intentionally a local correction rather than a claim about upstream's
contract.

## Exact target semantics

The implementation is `parts.join("\n")` over the text strings which the existing loop already
collects. That definition fixes all boundary cases without adding normalization:

| Collected text parts | Wire text | Reason |
| --- | --- | --- |
| `[]` | `""` | Existing empty-message/tool-call decisions still see empty text. |
| `["one"]` | `"one"` | A single block is byte-for-byte unchanged. |
| `["one", "two"]` | `"one\ntwo"` | Exactly one LF marks the sibling boundary. |
| `["one", "", "two"]` | `"one\n\ntwo"` | Empty text remains a real block boundary; no trimming/filtering is introduced. |
| text `"one"`, reasoning, text `"two"` | `"one\ntwo"` | Only collected text siblings participate; reasoning contributes neither text nor a phantom delimiter. |
| text `"one\n"`, text `"two"` | `"one\n\ntwo"` | Existing caller text is preserved exactly; the translator adds its one boundary LF. |

An image still returns `null` before joining; assistant tool calls remain separately serialized;
each tool result remains its own wire message; and a failed tool result remains
`"[tool error] " + flattenedText`. Those behaviors follow from call sites outside the join
([`packages/dsh-app/src/llm/request.ts:127-159`](../../../packages/dsh-app/src/llm/request.ts)).

## Test and command evidence

The package's executable test gate is `tsc -b && node --test "dist/**/*.test.js"`
([`packages/dsh-app/package.json:44-48`](../../../packages/dsh-app/package.json)). The root can run
that package alone with `pnpm --filter @rickylabs/dsh-app test`; the full repository gate is
`pnpm test` ([`package.json:23-25`](../../../package.json)). No live model, credential, daemon, or
network request is needed because `request.test.ts` inspects the serialized JSON body through
`buildRequest` ([`packages/dsh-app/src/llm/request.test.ts:52-70`](../../../packages/dsh-app/src/llm/request.test.ts)).

## Review correction: multi-empty siblings

Exact semantics also include `["", ""]` → `"\n"`. Because translateMessages checks equality
with the empty string (`request.ts:188`, `:197`), this multi-empty message is emitted after the
fix and an otherwise empty conversation is sent. The plan accepts and tests this consequence
of preserving every block boundary. Claims about unchanged empty-message behavior apply only
to zero collected blocks or one empty block, not multiple empty siblings.
