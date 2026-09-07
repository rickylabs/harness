# Plan — board-dsh-adapter--204

## Summary

Extend the existing dsh-app board plugin with a typed, whole-value session projection and a refresh
method. Each refresh recomputes GitHub-authoritative board state, attaches supplied run evidence
through the existing telemetry functions, publishes the safe four-level tree as `harnessBoard`, and
mirrors task leaves into dsh's published `todos` projection. Test the actual Cordis composition and
execute a deterministic no-agent smoke. Keep `@rickylabs/board` pure and do not add `agent-team`, a
dsh fork, a cockpit, credentials, or live host work.

**State: locked for independent review; product mutation remains blocked.** A separate session must
attack this plan and Stage G must return `PASS` before implementation
([`doctrine/WORKFLOW.md:71-90`](../../../doctrine/WORKFLOW.md)).

## Decisions

### D1 — Put the adapter in the existing dsh-app board plugin

Add the projection definition and refresh orchestration to
`packages/dsh-app/src/plugins/board.ts`. Keep GitHub normalization/projection in
`@rickylabs/board` and run attribution/public filtering in `@rickylabs/telemetry`. The current plugin
is already the composition point for the configured board projector
([`packages/dsh-app/src/plugins/board.ts:1-19`](../../../packages/dsh-app/src/plugins/board.ts)); the
domain package is explicitly pure and has no dsh dependency
([`packages/board/src/index.ts:1-11`](../../../packages/board/src/index.ts),
[`packages/board/package.json:20-30`](../../../packages/board/package.json)).

Rejected alternative: add dsh to `@rickylabs/board`. That would couple the reusable/CI projection to
a runtime session and invert the established boundary.

### D2 — Publish one rich key and the standard todo leaf view

Augment the public dsh type maps with a `harness/board-write` event and `harnessBoard` projection key.
Register a state-version-1 definition whose `init` is `null`, whose `apply` replaces state only for
that event, and whose wire view is identity. Every refresh also appends the published `todo/write`
event. Todo's shape cannot carry hierarchy or runs, while its public type contract does provide the
portable task list that #204 explicitly requires
([`node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/types.d.ts:10-45`](../../../node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/types.d.ts)).

Append `todo/write` first and `harness/board-write` second. Treat the rich event as the refresh commit
marker and return a `snapshot(session, ["todos", "harnessBoard"])` only after both are committed.
This follows the upstream whole-value rule and consistent-cut read API
([`node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts:13-15`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts),
[`node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts:177-185`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts)).

Rejected alternative: encode the whole tree into todo content. It loses typed nesting/run attachment
and would satisfy the package name while failing #204's actual hierarchy acceptance.

Before the first append, preflight the upstream capability with
`"todos" in ctx.sessionProjections.snapshot(session, ["todos"]).values`. A registered todo unit is
present with value `null` before its first write, while an unloaded unit is absent. Missing capability
throws before mutation; its test records `session.seq` before refresh and requires it to remain exact.

### D3 — Make refresh caller-fed and one-way

Extend `BoardService` with `refresh(session, input)`. Input contains `SourceIssue[]`, the existing
project options, `RunRecord[]`, telemetry notes, and a boolean completeness claim. The method calls
the existing pure chain `project → normaliseItems → buildSnapshot → buildTree → publicTree`, creates
todos from non-epic issue tasks, appends both whole values, verifies both keys are present in the
returned dsh snapshot, and returns that snapshot. The public tree's `complete` is true only when the
telemetry input claims completeness and the board fetch supplied completeness with no capped item
kind; omitted board completeness remains unknown/false, as `ProjectOptions` already specifies
([`packages/board/src/project.ts:30-45`](../../../packages/board/src/project.ts)).

`refresh` is synchronous end-to-end: its type returns the snapshot directly, it contains no Promise
and no `await`, and the pure assembly, two synchronous `Session.append` calls, and final snapshot all
run on one JavaScript call stack. Concurrent callers therefore cannot interleave two refresh pairs.
Do not call `refresh` from `sessionProjections.onChanged`; Session rejects an append re-entered while
the current publication boundary remains open
([`node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:199-230`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts)).

No refresh method accepts projected edits, no method writes GitHub, and no dsh event is translated
back into a `gh` command. GitHub access remains restricted to the read-only `GhReadArgs` union
([`packages/board/src/github.ts:100-126`](../../../packages/board/src/github.ts)). A local
`todo_write` can alter the session-local todo view, but the next refresh deterministically replaces
it from the next GitHub issue snapshot; it cannot alter board truth.

Rejected alternative: make the plugin fetch GitHub and scan local stores itself. That would hide
network/filesystem permissions inside composition, make the no-agent test credential-dependent, and
duplicate the caller-owned data/clock convention already documented on `BoardService`
([`packages/dsh-app/src/plugins/board.ts:9-19`](../../../packages/dsh-app/src/plugins/board.ts)).

### D4 — Reuse board status authority for todo status

Map `bucketOf(task)` as follows: `shipped → completed`, `inFlight → in_progress`, all other exhaustive
buckets → `pending`. Set content to `#<issue number> <title>`, sort in existing projected order, and
exclude epic issues and pull requests from todos. Derive this list directly from
`BoardSnapshot.items`, whose entries are `BoardItem`s accepted by `bucketOf`, before adapting the
snapshot into telemetry's `BoardItemRef` list. The rich projection preserves exact phase,
blocked/unknown distinctions, pulls, anomalies, and runs. `bucketOf` is the existing exhaustive
status authority ([`packages/board/src/hierarchy.ts:108-164`](../../../packages/board/src/hierarchy.ts)).

Rejected alternative: create a second phase-name mapping in dsh-app. It would drift from custom
lifecycle semantics and duplicate domain policy.

### D5 — Carry only the telemetry public tree

Use `publicTree(buildTree(...), complete)` as input to an explicit `toBoardProjection` output adapter.
Define `BoardProjection` from `z.output<typeof boardProjectionSchema>` rather than asserting
`ZodType<PublicTree>` compatibility. The adapter rebuilds the allowlisted wire object and uses
conditional spreads for optional `BoardItemRef` keys, preserving this repository's
`exactOptionalPropertyTypes` distinction. Validate the resulting complete wire/state shape with the
strict Zod schema. The behavioral schema gate must accept a real adapted `publicTree(...)` value and
reject that same value with an unknown key injected at the root and at a nested node. Do not append `RunRecord.origin`, raw transcript content,
cwd, prompts, environment values, or credentials. `publicRun` is an explicit allowlist that omits
origin ([`packages/telemetry/src/public.ts:39-73`](../../../packages/telemetry/src/public.ts));
`publicTree` preserves nested runs while rebuilding outward fields explicitly
([`packages/telemetry/src/public.ts:147-223`](../../../packages/telemetry/src/public.ts)).

Rejected alternative: use `z.unknown()`, force `ZodType<PublicTree>` through a cast, or append raw
activity data. The first two make the published projection contract unchecked; the third can leak
machine-local paths and expands the wire surface without review.

### D6 — Depend only on public package roots/type exports at the installed release line

Add direct dsh-app dependencies on `@deepseek-ai/dsh-session`,
`@deepseek-ai/dsh-session-projection`, `@deepseek-ai/dsh-tool-todo`, `@deepseek-ai/dsh-tools`, and
`zod`, all matching the installed release lines. Exact imports are: Session values/types from
`@deepseek-ai/dsh-session`; registry values/types plus projection-map augmentation from
`@deepseek-ai/dsh-session-projection` and its published `/types`; `TodoItem`, todo augmentations, and
the plugin from the `@deepseek-ai/dsh-tool-todo` root; `ToolRuntime` from
`@deepseek-ai/dsh-tools`; and Zod from `zod`. There is no tool-todo `/types` export. Never import
`src/*`, vendor code, or `agent-team`. The upstream manifests publish these exact entrypoints
([`node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/package.json:13-26`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/package.json)).

The integration and smoke load tool-todo with the required explicit config
`{ allowParallelInProgress: true }`; the upstream schema supplies no default
([`node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/index.d.ts:13-31`](../../../node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/index.d.ts)).

### D7 — Preserve the bare projector with optional session-projection attachment

Always provide `ctx.harnessBoard`, preserving the existing bare-Context `project()` service. Use
`ctx.inject(["sessionProjections"], projectionCtx => ...)` to register the rich projection only while
the upstream registry is present, and bind registration cleanup to that optional injection fiber.
`refresh` checks the captured registry and fails before mutation when absent. Upstream explicitly
documents optional registration through `ctx.inject`
([`node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts:117-132`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts)).

Rejected alternative: declare unconditional `inject = ["sessionProjections"]`. Cordis would withhold
the whole board service on a bare Context and break the pure projector's current availability
([`packages/dsh-app/src/plugins.test.ts:116-125`](../../../packages/dsh-app/src/plugins.test.ts)).

Rejected alternative: rely on packages transitively present under `@deepseek-ai/dsh`. Explicit
imports deserve explicit manifest edges and reproducible pnpm resolution.

## Owner forks

None. Issue #204 explicitly locates the adapter at dsh-app, preserves GitHub authority, requires the
two published dsh surfaces plus refresh/run tests, and says the proposed #68 amendment is not a waiver
([issue #204](https://github.com/rickylabs/harness/issues/204)). Todo's three-state mapping and the
method signature are routine adapter decisions, independently reviewable before mutation.

## Spikes

None. The installed public calls, current composition point, pure source functions, safe outbound
tree, and executable test construction are all verified in [`research.md`](research.md).

## Implementation manifest

1. Update `packages/dsh-app/package.json` with the five direct published dependencies in D6 and run
   `pnpm install --lockfile-only` (or ordinary `pnpm install` if required by pnpm) so the lockfile
   records only the dependency-edge change. Do not upgrade dsh.
2. In `packages/dsh-app/src/plugins/board.ts`:
   - import public `Session`, projection, todo types, Zod, and existing board/telemetry primitives;
   - augment `SessionEventMap`, `SessionProjectionStateMap`, and `SessionProjectionMap` with
     `harness/board-write` and `harnessBoard`;
   - define/export strict projection schemas, schema-derived `BoardProjection`,
     `BoardRefreshInput`, and deterministic output/todo adapters; derive todos from
     `BoardSnapshot.items` and conditionally spread optional fields;
   - keep the board service unconditional, use optional `ctx.inject(["sessionProjections"], ...)` to
     register the state-version-1 fold, and provide a synchronous `refresh` which executes D3;
   - before either append, fail explicitly if the registry or composed `todos` key is absent, or if
     `normaliseItems` returns `ok: false`; include normalization notes in the error and leave
     `session.seq` unchanged.
3. Extend `packages/dsh-app/src/plugins.test.ts` with an actual composed integration:
   - create a real Cordis `Context`, `SessionStore`, `SessionProjectionRegistry`, and `ToolRuntime`;
   - load the published `@deepseek-ai/dsh-tool-todo` plugin with
     `{ allowParallelInProgress: true }` and the actual harness board plugin;
   - create a live session with `ctx.sessions.create()`;
   - refresh with a milestone, epic issue, two tasks, and a parent/child run pair attributed to one
     task; assert `snapshot(...).values.harnessBoard` has milestone → epic → task → run/child nesting
     and `values.todos` has the expected dsh todo items;
   - change the synthetic GitHub title/status and refresh again; assert both projections replace the
     old values;
   - append a local `todo/write` edit, prove it never calls the injected GitHub runner/write path,
     refresh, and assert GitHub-derived values win again;
   - assert missing registry, missing todos, and failed normalization each throw before the first
     append and preserve the exact pre-call `session.seq`; assert two back-to-back refresh calls
     cannot cross-pair their todo/rich outputs because `refresh` is synchronous;
   - behaviorally assert the strict schema accepts an adapted real public tree and rejects unknown
     root and nested keys;
   - dispose fibers and assert the harness projection key/service disappear, preserving reload safety.
4. Add an executable `packages/dsh-app/src/board-smoke.ts` (or equally direct package script target)
   and `smoke:board-projection` script whose command is
   `tsc -b && node dist/board-smoke.js`. It runs the same public composition with synthetic values,
   performs two refreshes, asserts todo plus four-level run attachment, prints one non-sensitive
   success line, and exits nonzero on mismatch. It must accept/read no credentials, environment,
   home path, network, transcript, or agent.
5. Document the exact smoke command and what it proves in `packages/dsh-app/README.md`. Regenerate the
   bundle patch only if implementation changes its row; otherwise the current `harness-board` row
   remains the adapter entry and the committed golden still proves base `session-projection` and
   `tool-todo` composition.
6. Execute, in order:
   - `pnpm --filter @rickylabs/dsh-app test`;
   - `pnpm --filter @rickylabs/dsh-app run smoke:board-projection`;
   - `pnpm test`;
   - `pnpm run build`.
7. Request independent exact-head implementation evaluation. It must recheck every original #68
   criterion and the full #204 acceptance; do not close #68 on the implementation author's result.

## Dependency DAG

```text
independent plan review + Stage G PASS
                  |
                  v
 direct published deps + typed event/projection schema
                  |
                  v
 refresh chain + todo mapping + Cordis registration
                  |
                  v
 composed integration test + no-agent smoke + README
                  |
                  v
 focused test/smoke -> workspace test -> repository build
                  |
                  v
 independent exact-head #204 + original #68 evaluation
                  |
                  v
             merge eligibility
```

## Acceptance gates

1. The rich dsh snapshot contains an explicit milestone → epic → task → run hierarchy, including a
   child run, through the registered `harnessBoard` session-projection key.
2. The same composed snapshot contains task leaves through the published `todos` key with exact
   `TodoItem` shapes and D4 status mapping.
3. The integration boots real public dsh services/plugins on a Cordis Context and uses a live
   `ctx.sessions.create()` Session; a pure renderer assertion alone does not satisfy the gate.
4. A second refresh after changed GitHub-shaped inputs replaces title/status in both projections.
5. A local todo event cannot invoke or mutate GitHub, and the following authoritative refresh
   replaces the local edit.
6. Projected run data passes through `publicTree`; no `origin`, cwd, prompt, transcript text,
   credential, environment, or home path appears in the event or snapshot.
7. Unloading the plugin removes its registered projection and service cleanly.
8. Missing registry, missing `todos`, or failed normalization leaves the exact Session sequence
   unchanged; refresh is synchronous and contains no await/interleaving point.
9. The strict schema accepts the explicit adapter output and rejects unknown root/nested fields;
   optional output keys compile under `exactOptionalPropertyTypes` without a cast.
10. The bare-Context `project()` service remains available while projection registration attaches
    and detaches with the optional upstream service.
11. `pnpm --filter @rickylabs/dsh-app test` exits 0.
12. `pnpm --filter @rickylabs/dsh-app run smoke:board-projection` exits 0 with no agent, credential,
   filesystem store, network, or model.
13. `pnpm test` and `pnpm run build` exit 0.
14. Independent exact-head implementation evaluation returns `PASS` for all #204 acceptance and
    rechecks, without waiving, all original #68 acceptance
    ([issue #68 independent receipt](https://github.com/rickylabs/harness/issues/68#issuecomment-5562409700)).

## Risk register

| Risk | Likelihood | Impact | Gate |
| --- | --- | --- | --- |
| Adapter registers its rich key but never reaches the upstream todo projection. | Medium | High | Real tool-todo composition; assert both keys in one returned snapshot. |
| Todo and rich events expose a transient two-event cut to change-feed listeners. | Medium | Medium | Fixed todo-first/rich-commit order; synchronous no-await refresh prevents caller interleaving; refresh returns only the final consistent snapshot. |
| Refresh uses stale/local projected data as authority. | Low | High | API accepts source issues/runs only; two-refresh and local-edit-repair assertions. |
| Run attribution is nominal or flattened. | Medium | High | Parent/child synthetic run fixture asserted at milestone → epic → task → run nesting. |
| Raw telemetry publishes a local path or prompt-derived data. | Low | High | `publicTree` only; inspect captured session events and recursively reject forbidden keys/fixture sentinels. |
| Todo status mapping invents domain semantics. | Medium | Medium | Exhaustive `bucketOf` mapping and cases for shipped, in-flight, blocked, and unknown. |
| Todo plugin is missing in a deployment and refresh publishes half a view before failing. | Low | High | Preflight key presence before writes; exact unchanged-seq assertion. |
| Strict Zod typing conflicts with exact optional properties or silently accepts future fields. | Medium | High | Schema-derived output DTO, explicit conditional-spread adapter, accept-real/reject-extra behavioral tests. |
| Unconditional injection removes the pure board service from a bare Context. | Medium | High | Optional `ctx.inject`; retain the existing bare activation/disposal test. |
| A malformed board-to-telemetry adaptation produces a partial run join. | Low | High | Treat `normaliseItems.ok === false` as pre-write invariant failure and assert unchanged seq. |
| Late registration/reload loses or duplicates state. | Low | Medium | Seed/late-materialization and disposal/reload test against public registry behavior. |
| Direct subpackage imports accidentally use private upstream files or float versions. | Low | High | Manifest/lock review, public-entry-only import scan, full build. |
| Focused tests pass while profile composition or another package breaks. | Low | High | Workspace test, repository build, golden composition test, independent exact-head evaluation. |
