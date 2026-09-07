# Route identity -- E3.5 — research

## Summary

Issue #195 should be implemented as a small prerequisite: a pure four-field route comparison in
`@rickylabs/subagents`, optional typed route evidence on `DispatchResult`, and Codex
`thread/start` request/response plus pre-turn orchestration behind an injected protocol port.
The orchestration may return `refused` only for a fully observed mismatch before `turn/start`;
missing or malformed identity and every uncertain post-send outcome are `unknown`. No mismatch
bypass is permitted. This achieves the issue's callable and testable pre-turn safety intent, but
does not prove production enforcement because the attach-only transport tracked by #53 is not
shipped and `provider-codex` remains a stub (`packages/provider-codex/README.md:6`).

## Question and method

The question is whether a bounded implementation can prove that requested provider, model,
effort, and cwd equal the server-applied values before useful input is sent, without inventing a
live Codex provider. Discovery covered the repository contract, issue #195 and its #53 dependency,
the accepted E3 hardening sequence, exact prior-art sources at pinned commit
`8ba53bc50ca02aab29e99ba5362728839b8f1713`, official Codex app-server documentation retrieved
2026-09-07, and credential-free TypeScript schemas generated offline by Codex CLI 0.153.4. No live
connection, credential, auth file, environment secret, or private telemetry was read.

## Repository findings

1. `DispatchRequest` carries model and effort but no cwd, and model/effort are optional only so the
   shared `/swarm` reader can represent the wire grammar; validation rejects their absence
   (`packages/subagents/src/dispatch.ts:87`). Adding cwd to this type would alter the one shared
   Orchid grammar whose quirks are deliberately preserved (`packages/subagents/src/dispatch.ts:1`).
   The canonical worktree must therefore enter through provider composition/configuration, outside
   the shared request grammar.

2. `DispatchResult` currently has only verdict, run, and detail (`packages/subagents/src/provider.ts:88`).
   `unknown` is first-class and only `refused` is safe to retry (`packages/subagents/src/provider.ts:22`,
   `packages/subagents/src/provider.ts:248`). Optional typed route evidence can extend existing
   providers compatibly. An absent evidence member on a legacy result means **unverified**, never
   matched.

3. `provider-codex` exports only `PACKAGE_NAME` and explicitly speaks no JSON-RPC today
   (`packages/provider-codex/src/index.ts:1`, `packages/provider-codex/README.md:6`). The concept
   document also says it remains a stub and no provider is composed into the profile
   (`docs/concepts/02-the-two-seams.md:118`). A full `SubagentProvider`, daemon adapter, or profile
   registration in #195 would manufacture an integration that #53 has not established.

4. The seam is `ctx.subagents`, for autonomous vendor CLIs, and must remain separate from token-
   metered `ctx.llm` (`packages/subagents/src/provider.ts:48`, `docs/concepts/02-the-two-seams.md:28`).
   The implementation belongs in `subagents` and `provider-codex`, not coordinator routing or the
   LLM seam.

5. The telemetry decorator returns the `DispatchResult` intact, but its durable dispatch event
   records only provider, verdict, optional outcome/external id, and clipped detail
   (`packages/dsh-app/src/instrument.ts:223`, `packages/dsh-app/src/instrument.ts:350`). Therefore
   typed evidence will be callable by the immediate consumer, but durable structured persistence
   remains an integration gate for the #53 driver; #195 must not claim otherwise.

6. The accepted sequence already places route identity before #53 and says a mismatch is safely
   refused only before useful submission, while uncertain post-send failure remains unknown
   (`.llm/runs/m1-dsh-coordinator--orchestration/e3-hardening-plan.md:8`). It also explicitly keeps
   the Codex stub inert until a reviewed implementation plan defines its surface
   (`.llm/runs/m1-dsh-coordinator--orchestration/e3-hardening-plan.md:32`).

## Official protocol and generated-schema findings

The official app-server page says requests contain method, params, and id; responses echo the id
with either result or error. It requires initialize/initialized before thread/start, then
turn/start, and documents that CLI-generated schemas match the exact CLI version that emitted them
([Codex app-server: message schema and lifecycle](https://learn.chatgpt.com/docs/app-server)). This
makes response-id correlation and ordering part of the gate, not test decoration.

An offline command generated credential-free TypeScript schema with Codex CLI 0.153.4. The compact,
hashed evidence record preserves tool provenance and the relevant request/response declarations
(`.llm/runs/route-identity--e35/protocol-schema.md:5`,
`.llm/runs/route-identity--e35/protocol-schema.md:9`). The response fields are top-level and
`reasoningEffort` is nullable. A parser must read these raw response fields, not the nested thread's
provider or the request echoed from caller memory. Official examples are illustrative and omit some
generated response fields, so the versioned schema is the shape authority for this slice. The
official page itself instructs clients to generate a version-specific schema
([Codex app-server: schema generation](https://learn.chatgpt.com/docs/app-server#message-schema)).

## Prior-art findings

1. The pinned client builds `thread/start` with model and cwd and puts
   `model_reasoning_effort` into thread config before the response is observed. Its comment records
   that a turn-only override exposed a stale daemon default
   ([pinned app-server client, lines 31–44](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/codex/app-server-message.ts#L31-L44)).

2. Its parser correlates the exact request id and reads `result.model`,
   `result.modelProvider`, `result.reasoningEffort`, and `result.cwd` before constructing identity
   ([pinned parser, lines 63–81](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/codex/app-server-message.ts#L63-L81)).

3. The old client sends `turn/start` immediately after any parseable thread identity; it does not
   compare route identity first
   ([pinned send loop, lines 151–166](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/codex/app-server-message.ts#L151-L166)).
   Its launcher compares only provider/model/effort after the child exits, omits cwd, and therefore
   cannot prove a mismatch was refused before work
   ([pinned launcher, lines 489–525](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/codex/launch-codex-slice.ts#L489-L525)).

4. The current successor comparator still omits cwd and labels incomplete evidence `pending`; its
   enforcement allows every status when the mismatch option is true
   ([pinned successor, lines 4–37](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/runtime/launch-route-identity.ts#L4-L37),
   [lines 59–92](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/runtime/launch-route-identity.ts#L59-L92)).
   It is useful structural prior art, but its alias normalization, three-field comparison, `pending`
   vocabulary, and bypass must not be ported.

5. The pinned client spawns `codex app-server` itself
   ([pinned client, lines 114–128](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/codex/app-server-message.ts#L114-L128)).
   Issue #53 instead requires attach-only transport, so #195 can inject a protocol port but cannot
   implement that port ([issue #53 accepted source record](https://github.com/rickylabs/harness/issues/53#issuecomment-5562304188)).

## Contract synthesis

The pure contract needs exactly four fields: provider, model, effort, cwd. Requested identity must
be copied/frozen synchronously before the first await so caller mutation cannot rewrite the fact
being checked. Each requested and observed value carries a source label. The provider value is the
server's model-provider configuration id, not `RunRef.provider`; comparison is exact, with no case
folding, aliases, trimming into agreement, path normalization, or fallback defaults. Empty/blank,
null, absent, wrong-type, unreadable, error, or wrongly correlated observations are unknown.

The result vocabulary is:

| Status | Evidence | Dispatch meaning | Retry |
|---|---|---|---|
| `known` | all four valid and exactly equal | may proceed to `turn/start`; accepted only after its acknowledgement | no |
| `mismatch` | all four observed valid; one or more differ | `refused` before useful input; reason names every field, values, and sources | yes |
| `unknown` | any field or correlation is unavailable/invalid | no useful input; return `unknown` | never |

This keeps `refused` aligned with the shipped retry rule (`packages/subagents/src/provider.ts:248`).
An exception or error after `turn/start` was sent is also `unknown`, even if the helper believes the
server rejected it, because the useful send crossed the boundary. No post-send outcome becomes
`refused`.

The injected port must allocate or accept a unique request id per call rather than share fixed
global ids, correlate the raw response exactly, and expose no generic per-turn model/effort/cwd
override. After a known match it sends the task against the verified thread id with input only.
Initialization is part of the port's #53 transport contract; #195's orchestrator consumes an
initialized request/response port and does not spawn or attach a daemon. This boundary follows the
official handshake order while keeping transport ownership with #53
([Codex app-server lifecycle](https://learn.chatgpt.com/docs/app-server#lifecycle-overview)).

## Directive contradiction and precedence

The original #195 acceptance asks for an explicit mismatch opt-out
([issue #195](https://github.com/rickylabs/harness/issues/195)). The later steering directive says
mismatch **must** refuse. This run interprets that unconditional requirement as superseding the
older opt-out checkbox. It is a changed directive, not an unresolved technical ambiguity: the
latest owner steering governs this run. The plan records the superseded choice and implements no
bypass. Unknown can never be opted into permission either.

## Scope assessment against issue intent

The recommended slice covers the typed evidence, exact four-field comparison, thread-level effort,
pre-turn ordering, and negative matrix in executable unit tests. It improves the repository from
“no Codex protocol code” to a callable safety primitive that #53 must use. It cannot demonstrate a
real daemon reporting the values, reconnection, production composition, or durable structured
route persistence. Those are honest blockers, not reasons to invent a fake provider:

- **Integration gate IG-1 (#53):** prove and implement supported attach-only transport and the
  initialize handshake without spawning or repairing a daemon.
- **Integration gate IG-2 (#53 live driver):** bind the configured canonical cwd and provider id,
  call the pre-turn primitive for every dispatch, and persist structured evidence durably.
- **Integration gate IG-3:** run a credential-safe live conformance check only after explicit
  authorization; until then production enforcement is unverified.

Issue #195 can be reported as the shipped prerequisite/API contract after its own implementation
gate, but must not be described as deployed route enforcement. If closure semantics require a live
provider, #195 remains open behind #53; the code scope should still stay bounded.
