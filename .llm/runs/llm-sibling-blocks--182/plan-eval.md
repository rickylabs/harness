## Verdict: FAIL_FIX

One required narrow fix. The direction (D1/D2/D3), scope, and gates are otherwise sound and runnable; nothing needs rescoping.

### Verification performed

- `flattenText` at `packages/dsh-app/src/llm/request.ts:120-132` is as described (`parts.join("")`, image → `null`, reasoning dropped); it is the **only** definition in `packages/**` — the single-change claim for user, assistant, and nested tool-result paths holds (`toolMessages` at `request.ts:135-148`, `translateMessages` at `request.ts:172-201`).
- Cited test regions are accurate: `translating a conversation` (`request.test.ts:164-265`) has no sibling-text case; image refusals for ordinary and nested content exist (`request.test.ts:327-350`).
- Gates are runnable as written: package name is `@rickylabs/dsh-app`, its `test` is `tsc -b && node --test "dist/**/*.test.js"`, root `test`/`build` exist (`package.json:12-25`). `buildRequest` is exported and tests already assert the parsed body, so no helper export is needed — D3 is correct.
- Doctrine citations resolve (`WORKFLOW.md` stages A, F, G).
- No golden/snapshot fixture depends on flattened request text (`golden.ts`/`golden.test.ts` do not touch `buildRequest`), so `check:snapshots` fallout is not a hidden risk. The build gate is adequate rather than load-bearing.

### Findings

**1 — Required. The new separator changes the emptiness decisions the plan claims it preserves.**
`translateMessages` skips on `text === ""` (`request.ts:188` assistant, `request.ts:197` other roles), and `empty-conversation` is refused when nothing survives (`request.ts:276-283`). Under `join("\n")`, content `[{text:""},{text:""}]` flattens to `"\n"`, not `""`. A message that is skipped today is emitted tomorrow as a whitespace-only wire turn, and a conversation composed only of such messages stops being refused and gets sent.

This contradicts research.md's table row `[] → "" — "Existing empty-message/tool-call decisions still see empty text"`, which is true only for the zero-block case, and it is untested by any gate. It is also a real wire-output change on a path finding 9 does not name.

Bounded fix (no rescope, still one-line product change):
- Add the row `["", ""] → "\n"` to the exact-semantics table and state the consequence explicitly: a multi-empty-block message is no longer skipped.
- Add one assertion to manifest item 3 covering it — either the accepted behavior (message emitted with `"\n"`) or, if the owner prefers strict preservation, that becomes a second rule and belongs in a different PR, not this one.
- Extend acceptance gate 4 to name this case alongside `"first\n\nsecond"`.

**2 — Recommended, not blocking.** Gate 3 asserts the failed-tool prefix "remains green" but the prefix-plus-siblings composition (`"[tool error] first\nsecond"`, `request.ts:144`) is never exercised. Making the tool-result case in manifest item 2 an `isError: true` result costs nothing and covers both the correlation and the prefix in one case.

### Not findings (checked and dismissed)

- **Upstream divergence.** Both installed `0.1.2-rc.1` adapters concatenate; the plan states plainly that LF is a local correction under issue #182 finding 9, not a conformance claim. Correctly framed, and the consequence (dsh-app serializes differently from the vendor adapters for the same history) is recorded in research.md rather than hidden.
- **Owner forks: none.** Choosing LF inside an explicit missing-separator defect is a routine implementation decision; the alternative was named and rejected on the record.
- **Diff-surface gate.** `flattenText` plus its focused tests is the correct and minimal surface.
