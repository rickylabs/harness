# Worklog — published dsh board adapter

## Implementation

- Plan artifacts were committed first at `c428c0d`, after the independent plan gate passed.
- Added direct published dependencies at the already-installed `0.1.2-rc.1` release for
  `dsh-session`, `dsh-session-projection`, `dsh-tool-todo`, and `dsh-tools`; added the installed
  `zod` `4.5.4` used by the projection contract (`packages/dsh-app/package.json:66-74`). `pnpm install
  --offline --frozen-lockfile=false` updated links and the lockfile with zero downloads.
- Added a schema-derived, recursively strict `harnessBoard` DTO and whole-value
  `harness/board-write` projection. The explicit adapter copies only public telemetry fields and
  conditionally spreads optional values, preserving `exactOptionalPropertyTypes`
  (`packages/dsh-app/src/plugins/board-projection.ts:20-275`).
- Extended the always-present `ctx.harnessBoard` service with synchronous `refresh`. It preflights
  the optional registry and `todos` key, normalizes the projected `BoardSnapshot.items`, builds the
  telemetry snapshot/tree/public allowlist, validates the DTO, derives todos from the same board
  snapshot, and only then appends adjacent `todo/write` and `harness/board-write` events
  (`packages/dsh-app/src/plugins/board.ts:153-195`).
- Added composed behavioral coverage and a reusable no-agent executable smoke. The composition uses
  real published `Context`, `SessionStore`, `SessionProjectionRegistry`, `ToolRuntime`, and
  `dsh-tool-todo`. `ToolRuntime`'s published constructor requires `ctx.systemPrompt.tools`; the
  isolated smoke supplies that one in-memory method because it intentionally does not boot a full
  daemon, agent, model, or prompt assembly. All session/projection/tool/todo behavior under test is
  the real upstream implementation (`packages/dsh-app/src/board-smoke-fixture.ts:85-144`).

## Focused evidence

- `pnpm --filter @rickylabs/dsh-app run test` — PASS, 257 tests, 0 failures. This includes child-run
  attachment, exact todo mapping, two successive refreshes, local todo replacement and restoration,
  projection disposal, missing-capability sequence preservation, normalization failure notes, and
  strict root/nested rejection (`packages/dsh-app/src/board-projection.test.ts:23-90`).
- The first runtime attempt exposed two published-boundary details and both were fixed before the
  passing run: `ToolRuntime` calls `ctx.systemPrompt.tools` during construction, and Zod 4.5.4's
  chained `.strict()` eagerly inspects a recursive getter. The final schema uses `z.strictObject`
  directly, which keeps recursive child runs lazy and strict.
- `pnpm --filter @rickylabs/dsh-app run smoke:board-projection` — PASS; printed only `board
  projection smoke passed`.
- `pnpm test` — PASS across all 15 runnable workspace projects.
- `pnpm run build` — PASS, including graph, lifecycle, links, forms, snapshot, package build,
  publish, generated CLI docs, and generated skill checks.

## Handoff

- Commit the exact implementation head and hand it to an independent implementation evaluator.
  Full E6 durable-loop behavior remains outside this issue, and #68 is not waived by these author
  checks.
