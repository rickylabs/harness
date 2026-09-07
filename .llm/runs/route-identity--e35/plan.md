# Route identity -- E3.5 — locked implementation plan

## Summary

Implement a transport-free, four-field route gate and a Codex pre-turn protocol orchestrator. The
gate compares exact server-applied provider/model/effort/cwd values with a frozen request and
returns `known`, `mismatch`, or `unknown`. The orchestrator sends `turn/start` only after `known`;
it maps a mismatch to `refused`, incomplete or malformed evidence to `unknown`, and every failure
after the useful send to `unknown`. Extend `DispatchResult` with optional typed evidence so existing
providers remain source-compatible and absence is explicitly unverified. Do not implement,
register, spawn, or attach a live provider.

This plan is locked for independent evaluation. Product mutation remains prohibited until the
Stage-G verdict is `PASS` (`doctrine/WORKFLOW.md:80`).

## Acceptance map

| Issue intent | This slice | Evidence/gate |
|---|---|---|
| `DispatchResult` carries observed provider/model/effort/cwd | Yes, as optional typed evidence; legacy absence means unverified | subagents type and compatibility tests; current shape at `packages/subagents/src/provider.ts:94` |
| mismatch refuses and names field/both values | Yes, before `turn/start`, for all mismatching fields and both source labels | pure comparator plus pre-turn tests |
| effort applied at `thread/start` | Yes, in `config.model_reasoning_effort`; no arbitrary route overrides on turn | generated schema evidence at `.llm/runs/route-identity--e35/protocol-schema.md:9`; pinned rationale URL in research |
| explicit mismatch opt-out | Superseded; no bypass | OF-1 resolution below; issue text at https://github.com/rickylabs/harness/issues/195 |
| unobservable route is unknown | Yes; missing/null/blank/wrong-type/unreadable/error/wrong-id all unknown | negative matrix below |
| production provider enforcement | No | IG-1/IG-2 depend on #53; stub evidence at `packages/provider-codex/README.md:6` |

## Decisions

### D-1 — Four-field evidence lives in `subagents`

Add `RouteField`, `RouteValueEvidence`, `RouteIdentityEvidence`, and a pure comparison result to a
new `route.ts`; export them publicly and add `DispatchResult.route?: RouteIdentityEvidence`.
Requested and observed records each retain a source label per field. Optionality preserves existing
providers, while documentation and tests state that absence is unverified. Rejected alternative:
hide route evidence in `detail`; the current contract says detail is prose and the telemetry wrapper
clips it (`packages/subagents/src/provider.ts:94`, `packages/dsh-app/src/instrument.ts:223`).

### D-2 — Exact comparison; no normalization into agreement

The comparator requires nonblank strings and exact equality for provider, model, effort, and cwd.
Provider means the requested server `modelProvider` config id, not the provider registry id. The
caller must supply an already canonical cwd; neither path normalization nor aliases belong in the
comparison. Rejected alternative: port the successor's provider alias/case normalization, which
could manufacture agreement and omits cwd (research prior-art finding 4).

### D-3 — Closed three-state result

Return `known` only when all four fields are valid and equal, `mismatch` only when all four are valid
and at least one differs, and `unknown` for any missing, null, blank, wrong-type, unreadable, error,
or uncorrelated observation. Rejected alternative: `pending`, because this is a completed pre-turn
decision and the shipped dispatch vocabulary already makes unknown retry behavior load-bearing
(`packages/subagents/src/provider.ts:248`).

### D-4 — Freeze requested identity before I/O

Copy each requested value and source into an immutable local record synchronously before awaiting
the port. Rejected alternative: retain a caller-owned object and compare after an await, which lets
mutation change what the record says was requested.

### D-5 — Version-shaped Codex helper behind an injected port

Add minimal JSON-RPC types, request builders, strict thread/start response parser, and an injected
`CodexProtocolPort` whose request method supplies a unique id and returns the raw correlated
response. The helper checks exact id, rejects `error`, and reads the four top-level response fields.
It puts `model`, `modelProvider`, `cwd`, and `config.model_reasoning_effort` in `thread/start`.
Rejected alternative: fixed global ids, which race across concurrent calls, or request echoes,
which are not observation. Official responses echo request ids and version-specific generated
schemas are authoritative ([official message schema](https://learn.chatgpt.com/docs/app-server#message-schema)).

### D-6 — The useful turn crosses the port only after a known match

Add a pre-turn function accepting the initialized injected port, frozen route configuration, and
text input. It requests a thread, evaluates raw response identity, and sends `turn/start` with only
the verified thread id and input when status is `known`. It exposes no per-turn model, effort, or
cwd override. A mismatch returns `refused`; any pre-turn uncertainty returns `unknown`; an exception,
error response, wrong id, or malformed reply after `turn/start` returns `unknown`. Rejected
alternative: the prior launcher's end-of-process check, which happens after useful work
([pinned launcher lines 489–525](https://github.com/rickylabs/netscript/blob/8ba53bc50ca02aab29e99ba5362728839b8f1713/.llm/tools/agentic/codex/launch-codex-slice.ts#L489-L525)).

### D-7 — #195 does not implement transport or `SubagentProvider`

The port is an interface/fake seam only. No child process, socket, daemon, auth, ownership,
reconnection, app composition, or provider registry entry is added. Rejected alternative: a fake
full provider whose transport cannot satisfy #53's attach-only requirement. The current package is
explicitly inert (`packages/provider-codex/src/index.ts:4`), and the accepted sequence makes #53 the
transport gate (`.llm/runs/m1-dsh-coordinator--orchestration/e3-hardening-plan.md:32`).

### D-8 — No `/swarm` grammar change

Canonical cwd and model-provider config are provider composition inputs. `DispatchRequest` remains
unchanged, so Orchid parsing/rendering behavior and the current matrix pin are unaffected. Rejected
alternative: add cwd/provider keys to the shared payload, which would silently fork the executor's
grammar (`packages/subagents/src/dispatch.ts:1`).

## Owner forks

### OF-1 — Mismatch exception (resolved by changed directive)

- **Question:** may an operator continue after a route mismatch?
- **Options:** A, retain the original issue's opt-out; B, refuse every mismatch with no bypass.
- **Recommendation:** B, because a mismatched route is precisely the condition the gate exists to
  prevent and an opt-out would also risk permitting incomplete evidence.
- **Cost if wrong:** emergency operation requiring a deliberately mismatched route cannot use this
  helper and needs a separately reviewed workflow change.
- **Resolution:** latest owner steering says mismatch must refuse unconditionally. This run
  interprets that requirement as superseding the older acceptance checkbox at
  https://github.com/rickylabs/harness/issues/195. This plan implements B. No owner fork remains
  open.

## Exact implementation mutation manifest

Only these product paths may change after a `PASS` plan evaluation:

| Path | Mutation |
|---|---|
| `packages/subagents/src/route.ts` | New pure types, validation/comparison, and source-rich reason renderer |
| `packages/subagents/src/route.test.ts` | New four-field and malformed-input matrix |
| `packages/subagents/src/provider.ts` | Add optional typed `route` member to `DispatchResult`; document absence as unverified |
| `packages/subagents/src/provider.test.ts` | Pin legacy absence compatibility and unknown retry behavior with evidence present/absent |
| `packages/subagents/src/index.ts` | Export route values, types, and comparator |
| `packages/provider-codex/src/protocol.ts` | New minimal JSON-RPC builders/parser, injected port contract, and pre-turn orchestration |
| `packages/provider-codex/src/protocol.test.ts` | New ordering, correlation, route, and post-send outcome tests |
| `packages/provider-codex/src/index.ts` | Export the protocol prerequisite while retaining package identity |
| `packages/provider-codex/package.json` | Add workspace dependency on subagents and test script |
| `packages/provider-codex/tsconfig.json` | Add the required project reference to subagents |
| `pnpm-lock.yaml` | Record the provider-codex workspace dependency |
| `packages/provider-codex/README.md` | State that the protocol prerequisite ships while the provider/transport remains unimplemented |
| `packages/README.md` | Update package counts/table so provider-codex is a protocol-only partial implementation, not an empty stub |
| `docs/concepts/02-the-two-seams.md` | Narrowly distinguish the shipped Codex protocol prerequisite from an implemented/composed provider |

No routing table, `/swarm` grammar, dsh-app composition, telemetry, doctrine, board, or sibling-
repository edit is planned. Workspace convention requires both a workspace dependency and matching
project reference (`packages/README.md:52`). Any path outside the table is drift.

## Test design

### Pure comparison matrix

- One all-fields match returns `known`, no mismatches, and a reason that names all requested and
  observed sources.
- One case per field changes only provider, model, effort, or cwd and returns `mismatch` naming that
  field, both exact values, and both sources.
- A combined four-field mismatch reports all fields in stable provider/model/effort/cwd order.
- For every observed field, missing, `null`, empty, whitespace-only, and wrong-type values return
  `unknown`; none return `known` or `mismatch`.
- An unreadable/non-object response produces four unknown observations without throwing.
- Provider aliases/case differences, effort case differences, relative/equivalent-looking cwd, and
  trailing-space values mismatch or become unknown; they are never normalized into agreement.
- Caller mutation after invocation cannot change the frozen requested evidence.
- Optional `DispatchResult.route` absence compiles and is asserted to mean unverified; presence does
  not change `isSafeToRetry`, so unknown remains never retryable (`packages/subagents/src/provider.test.ts:81`).

### Codex protocol and ordering matrix

- `thread/start` contains the exact requested model, modelProvider, canonical cwd, and
  `config.model_reasoning_effort`; `turn/start` contains thread id/input and no route override.
- A response with the exact per-call id and four top-level fields permits exactly one turn send.
- Each of the four mismatch cases returns `refused` and records zero `turn/start` calls.
- Missing/null/blank/wrong-type route fields, non-object body, parser exception, thread/start error,
  and wrong response id return `unknown`, record zero turn calls, and fail `isSafeToRetry`.
- Sequential and concurrent invocations use distinct ids and cannot consume one another's response.
- Requested values are copied before the port's first unresolved promise; a mutation fixture cannot
  rewrite comparison evidence.
- A daemon-default effort in the response versus requested thread-config effort refuses before turn;
  a matching response proves the check observes applied thread effort rather than echoing request.
- A turn/start error response, wrong id, malformed response, port rejection, or thrown exception
  after the send returns `unknown`, never `refused`; the call log proves a useful send occurred.
- No test spawns or attaches Codex. The fake injected port holds raw response fixtures only.

### Runnable commands

Run once after implementation, then broaden only if failures justify it:

    pnpm --filter @rickylabs/subagents test
    pnpm --filter @rickylabs/provider-codex test
    pnpm typecheck
    pnpm build
    git diff --check

These gates are runnable because the workspace already defines Node 24+, pnpm 11, TypeScript, and
root build/typecheck scripts (`package.json:8`, `package.json:23`). `provider-codex` needs the planned
test script because its current manifest has no test target (`packages/provider-codex/package.json:20`).

## Dependency DAG

    plan evaluation PASS
      -> A: subagents route types + pure comparator + tests
      -> B: DispatchResult optional evidence + exports + compatibility tests (depends on A)
      -> C: provider-codex protocol builders/parser + package wiring (depends on A/B)
      -> D: pre-turn orchestration + negative ordering tests (depends on C)
      -> E: package tests, typecheck, build, diff check (depends on A-D)
      -> independent implementation review at exact HEAD (depends on E)
      -> #195 prerequisite can be reported shipped, explicitly not deployed
      -> #53 attach-only transport and initialized port (integration gate; consumes C/D)
      -> live driver composition + durable evidence binding (depends on #53)

## Integration gates and spikes

| Gate | Unverified claim | Required evidence | Owner |
|---|---|---|---|
| IG-1 / #53 | A supported attach-only initialized transport can back `CodexProtocolPort` | reviewed source/API spike and fake conformance suite; no live daemon repair | #53 |
| IG-2 / #53 driver | Every live Codex dispatch uses this pre-turn primitive with configured canonical cwd/provider id | composition test proving no alternate turn path; structured evidence persistence test | #53/live driver |
| IG-3 / authorized canary | Installed daemon returns the generated four-field shape in the target topology | explicit owner-authorized, credential-safe live conformance record | later operations gate |
| IG-4 / telemetry | Typed evidence survives beyond immediate `DispatchResult` | event schema/sink test; current wrapper clips prose only (`packages/dsh-app/src/instrument.ts:223`) | driver/telemetry follow-up |

No unverified claim above is treated as green; doctrine requires runnable gates or an explicit
unproven record (`doctrine/PRINCIPLES.md:35`).

## Risk register

| Risk | Likelihood | Impact | Gate |
|---|---:|---:|---|
| Request echo is mistaken for observation | Medium | Critical | raw response fixtures and source-label assertions |
| Wrong JSON-RPC response is correlated under concurrency | Medium | Critical | per-call id concurrency test |
| Nullable/blank/malformed field permits a turn | Medium | Critical | exhaustive negative matrix and zero-turn call log |
| Effort is applied only at turn level | Medium | High | thread/start request assertion plus daemon-default mismatch fixture |
| Caller mutates requested identity across await | Low | High | deferred-port mutation test |
| Alias/case/path normalization manufactures agreement | Medium | High | exact mismatch fixtures |
| Post-send error is mislabeled refused and retried | Medium | Critical | post-send exception/error matrix plus `isSafeToRetry` assertion |
| New cwd field changes Orchid grammar | Low | High | mutation-manifest review and dispatch conformance/build suite |
| Helper is mistaken for deployed enforcement | High | High | acceptance map, stub assertion, IG-1/IG-2, review checklist |
| Route evidence is lost after return | High until #53 | Medium | IG-4; no durability claim in #195 |
| Scope grows into daemon/provider ownership | Medium | High | exact manifest and independent review |

## Implementation review checklist

- Diff matches the manifest and contains no process/socket/auth/env/daemon code.
- Comparator has four exact fields, stable source-rich reasons, and no bypass or alias normalization.
- Request identity is frozen before I/O and request ids are unique per invocation.
- No `turn/start` occurs on mismatch or unknown; all post-send failures remain unknown.
- `DispatchResult.route` is optional and absence is documented/tested as unverified.
- Provider-codex remains uncomposed; documentation and handoff do not claim production deployment.
- Exact implementation HEAD is reviewed independently with GLM 5.3 Flash, provider default.
