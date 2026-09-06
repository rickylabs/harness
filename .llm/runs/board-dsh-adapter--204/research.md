# Research — board-dsh-adapter--204

## Summary

Issue #204 is a bounded composition repair. The pure board already projects GitHub issues, and the
telemetry package already attaches runs to those tasks. What is missing is a dsh-app adapter that
writes the resulting whole current value into a live dsh `Session`, exposes it through
`ctx.sessionProjections`, and mirrors its task leaves through dsh's existing `todos` projection
([issue #204](https://github.com/rickylabs/harness/issues/204)). The adapter belongs in
`packages/dsh-app/src/plugins/board.ts`; moving dsh into `@rickylabs/board` would break the present
pure/read-only boundary rather than close the gap.

The installed published API is `0.1.2-rc.1`. Its public package exports are sufficient: a Cordis
plugin can augment the session event/projection maps, register a synchronous whole-value fold with
`ctx.sessionProjections.register(...)`, append typed events with `Session.append(...)`, and read a
consistent current cut with `ctx.sessionProjections.snapshot(...)`. `@deepseek-ai/dsh-tool-todo`
owns the `todo/write` event and the `todos` projection; its event carries the complete replacement
list and its fold is last-write-wins. No `agent-team`, core fork, credential, daemon, or model call is
needed.

## Scope and inherited constraints

The issue requires the public session-projection and todo surfaces, refresh behavior, run
attachment, a no-agent smoke, and later re-evaluation of every original #68 criterion
([issue #204](https://github.com/rickylabs/harness/issues/204),
[issue #68](https://github.com/rickylabs/harness/issues/68)). Repository decisions require a
plugin-only extension over published dsh, Node and pnpm, GitHub as board authority, and no cockpit in
this repository ([`AGENTS.md:89-112`](../../../AGENTS.md)). The model-calling seams are unrelated to
this projection and remain separate ([`docs/concepts/02-the-two-seams.md:7-34`](../../../docs/concepts/02-the-two-seams.md)).

This run stops at a locked plan. Independent review and a `PASS` plan evaluation precede product
mutation ([`doctrine/WORKFLOW.md:59-90`](../../../doctrine/WORKFLOW.md)).

## Repository behavior

1. `@rickylabs/board` is deliberately pure: its package root says GitHub issues enter and a board
   snapshot/hierarchy leave, with no writes or wall-clock read
   ([`packages/board/src/index.ts:1-11`](../../../packages/board/src/index.ts)). Its GitHub adapter's
   public runner can issue only `issue list`, `pr list`, and `repo view`, and `fetchItems` performs
   the two read calls ([`packages/board/src/github.ts:100-126`](../../../packages/board/src/github.ts),
   [`packages/board/src/github.ts:219-253`](../../../packages/board/src/github.ts)).
2. The board hierarchy already models milestone, epic, and task. `buildHierarchy` deterministically
   groups the projected items and keeps every item visible
   ([`packages/board/src/hierarchy.ts:203-265`](../../../packages/board/src/hierarchy.ts)). The board
   package has no dsh dependency ([`packages/board/package.json:20-30`](../../../packages/board/package.json)).
3. The run level already exists in telemetry. `buildSnapshot` attributes run records to board-item
   numbers and preserves parent/child run structure
   ([`packages/telemetry/src/snapshot.ts:144-187`](../../../packages/telemetry/src/snapshot.ts));
   `buildTree` uses the same item list so tasks with no runs remain present
   ([`packages/telemetry/src/tree.ts:176-196`](../../../packages/telemetry/src/tree.ts)).
4. Telemetry already provides the correct outbound allowlist. `publicTree` rebuilds the four-level
   hierarchy while `publicRun` omits the local `origin` path
   ([`packages/telemetry/src/public.ts:39-73`](../../../packages/telemetry/src/public.ts),
   [`packages/telemetry/src/public.ts:147-223`](../../../packages/telemetry/src/public.ts)). The dsh
   projection must carry this public tree, not raw `RunRecord`s.
5. The current dsh-app board plugin only binds board taxonomy and the pure projector on
   `ctx.harnessBoard`; it neither injects session projections nor accepts a Session
   ([`packages/dsh-app/src/plugins/board.ts:66-125`](../../../packages/dsh-app/src/plugins/board.ts)).
   Its current integration test proves only service activation/disposal
   ([`packages/dsh-app/src/plugins.test.ts:116-125`](../../../packages/dsh-app/src/plugins.test.ts)).
6. The composed profile already includes dsh's `session-projection` and `tool-todo` rows
   ([`packages/dsh-app/dump-config.golden.yml:90-91`](../../../packages/dsh-app/dump-config.golden.yml),
   [`packages/dsh-app/dump-config.golden.yml:304-306`](../../../packages/dsh-app/dump-config.golden.yml)).
   A golden row alone proves composition data, not the missing runtime adapter; the package README
   distinguishes dump composition from a booted service test
   ([`packages/dsh-app/README.md:144-174`](../../../packages/dsh-app/README.md)).

## Installed published dsh API

The lock and installed package are version `0.1.2-rc.1`; the session-projection manifest publishes
the root and `/types` exports and names dsh-session and Cordis as peers
([`node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/package.json:1-44`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/package.json)). In this brief, “stable surface” means that published root/type API, despite the installed release tag being an RC; no private `src/*` import is planned.

The concrete calls are synchronous:

- `ctx.sessionProjections.register({ key, stateSchema, init, apply, wire, stateVersion })`.
  Definitions are synchronous pure folds over plain JSON; unchanged events return the same state
  reference ([`node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts:30-80`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts)).
- `ctx.sessionProjections.snapshot(session, keys)` returns one consistent, schema-validated cut;
  late registrations/materializations replay the existing in-memory log
  ([`node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts:117-185`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+d_9914d2092f927a2bafad9985f01d7afa/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts)).
- `session.append(type, data)` appends a typed, lossless-JSON event and synchronously publishes it to
  observers for a store-owned live Session
  ([`node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:196-230`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts)).
- `ctx.sessions.create()` creates and announces such a live Session; persistence is an optional
  subscriber, so an in-memory smoke is valid
  ([`node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:305-336`](../../../node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts)).

Todo's public root entry re-exports `TodoItem` and the augmentations which own the `todo/write`
session event and `todos` projection-map entries; its manifest does not publish a `/types` subpath
([`node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/package.json:13-30`](../../../node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/package.json),
[`node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/index.d.ts:1-10`](../../../node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/index.d.ts)). The shape has only `content` and `pending | in_progress | completed`, so it cannot itself encode milestone/epic/run nesting
([`node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/types.d.ts:1-45`](../../../node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/types/types.d.ts)). Its runtime registers the `todos` unit, replaces it on `todo/write`, and resets it on `turn/start`
([`node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/index.js:63-94`](../../../node_modules/.pnpm/@deepseek-ai+dsh-tool-todo@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-agent@_0edbd0dd88434b3e110c8a86939e0da2/node_modules/@deepseek-ai/dsh-tool-todo/lib/index.js)). Therefore the full tree needs its own `harnessBoard` projection key, while the same refresh also emits the standard whole `todo/write` leaf list.

## Boundary synthesis

`BoardService.refresh(session, input)` should remain caller-fed and deterministic. `input` carries
the fetched `SourceIssue[]`, `repo`, `generatedAt`, completeness, run records, telemetry notes, and
telemetry completeness. The service performs the existing chain:

`projectBoard → normaliseItems → buildSnapshot → buildTree → publicTree`, then appends a standard
`todo/write` followed by a `harness/board-write` whole-value event. The second event is the refresh
commit marker; the method returns `ctx.sessionProjections.snapshot(session, ["todos", "harnessBoard"])`
after both appends. Before either append it requires a present `todos` key; because the registered
pre-write value is `null`, key presence distinguishes a loaded todo projection from an empty list.
The entire refresh contains no `await`: pure assembly, both synchronous appends, and the final
snapshot execute in one call stack, so two callers cannot interleave their event pairs. The method
must not run inside a projection change listener because Session rejects append re-entry while its
publication boundary is open. A later GitHub fetch and refresh replaces both values. A local `todo_write` may
temporarily change `todos`, but it has no route into GitHub and the next refresh repairs it from the
issue snapshot. The rich `harnessBoard` value is changed only by the adapter refresh event.

Todo status is a lossy convenience projection. Use the existing board bucket authority:
`shipped → completed`, `inFlight → in_progress`, and every other bucket (`queued`, `blocked`,
`invisible`, `abandoned`, `unknown`) → `pending`; the rich board value retains the exact phase,
liveness, anomalies, and run outcome. `bucketOf` is already the exhaustive classifier
([`packages/board/src/hierarchy.ts:108-164`](../../../packages/board/src/hierarchy.ts)). Todo content
is `#<number> <title>`, giving stable human-visible issue identity without inventing todo IDs. The
todo list is derived from `BoardSnapshot.items`, where `bucketOf`'s required `BoardItem` shape still
exists, before those items are normalized into telemetry's flatter `BoardItemRef` shape
([`packages/telemetry/src/model.ts:176-200`](../../../packages/telemetry/src/model.ts)).

`normaliseItems` can return `ok: false` with notes rather than throw when an envelope or entry is
malformed ([`packages/telemetry/src/items.ts:147-186`](../../../packages/telemetry/src/items.ts)). A
board snapshot produced by this same call should always normalize completely; therefore `ok: false`
is an adapter invariant failure. Refresh must throw with those notes before either append and leave
the Session sequence unchanged rather than publish a knowingly partial join.

## Prior-art boundary checks

NetScript's integration profile requires the adapter, composition root, permissions, and consumer
impact to be explicit, with host/consumer validation when the surface changes
([`../netscript/repo/.llm/harness/archetypes/ARCHETYPE-2-integration.md:35-51`](../../../../netscript/repo/.llm/harness/archetypes/ARCHETYPE-2-integration.md),
[`../netscript/repo/.llm/harness/archetypes/ARCHETYPE-2-integration.md:80-100`](../../../../netscript/repo/.llm/harness/archetypes/ARCHETYPE-2-integration.md)). Its plugin profile says plugins should wire core/sibling primitives rather than redefine them
([`../netscript/repo/.llm/harness/archetypes/ARCHETYPE-5-plugin.md:1-10`](../../../../netscript/repo/.llm/harness/archetypes/ARCHETYPE-5-plugin.md)). EIS-Chat's accepted RFC 0004 applies the same dependency direction: plugin/host composition may depend on contracts, application, adapters and framework contribution APIs, but must not own business rules
([`../eis-chat/docs/rfcs/0004-modular-netscript-workspace.md:33-60`](../../../../eis-chat/docs/rfcs/0004-modular-netscript-workspace.md)). Keeping GitHub interpretation in board/telemetry and putting only dsh event/projection wiring in dsh-app matches those boundaries.

## Executable gates available

The focused dsh-app gate builds and runs all compiled tests
([`packages/dsh-app/package.json:44-48`](../../../packages/dsh-app/package.json)). The root exposes
the full workspace test and structural build/check chain
([`package.json:12-28`](../../../package.json)). A no-agent smoke can use a real Cordis `Context`,
`SessionStore`, `SessionProjectionRegistry`, `ToolRuntime`, the published tool-todo plugin, the actual
harness-board plugin, synthetic GitHub-shaped issues, and a synthetic run record. This uses no
credential, home directory, persistence, network, agent, or model.
