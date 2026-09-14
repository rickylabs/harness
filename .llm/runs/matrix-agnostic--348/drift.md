# Matrix agnostic — drift

D1: The brief described purposes as closed; code at baseline schema.ts:255 proves they already are open. Preserve and test this behavior.
D2: Router round-trip in subagents drops non-enumerated routers. Extend the mutation surface to that necessary dependency and its tests, rather than export configurable routers that cannot execute.

D3: dsh-app dry-run input also applies the static router list (`packages/dsh-app/src/dry-run-internal.ts:86`). Remove that redundant allowlist while retaining typed shape checks and routing admission. Product mutation surface includes this file and its existing tests.

D4: OpenCode relay admission also assumed the provider ID was literally openrouter. The configured router/model pairing now owns that check; Claude profile-based relay semantics remain unchanged. Paired custom relay-provider controls added.

D5: Preserve the existing branch name and PR rather than matching the new run slug, as the brief explicitly requires. The initial implementation reviewer refused truncated file-attachment evidence. Resumed the same evaluator with complete source passed directly as prompt arguments; PASS.
