# Route identity -- E3.5 — context pack

## Resume here

Stage G passed and the bounded #195 implementation is complete in the working tree for draft PR
#238. It adds a pure provider/model/effort/cwd gate in `subagents`, optional typed evidence plus
`isRouteVerified`, and Codex thread/start plus pre-turn orchestration behind an injected initialized
raw-response port. It does not implement a provider or transport. Focused tests, workspace
typecheck, and build pass. The next gate is the implementation commit followed by the coordinator's
independent exact-head GLM 5.3 Flash review and CI; no implementation-review verdict exists yet.

## Fixed contract

- Exact four-field comparison: provider config id, model, effort, canonical cwd.
- Requested identity copied before awaits; raw `thread/start` result supplies observation.
- Per-call JSON-RPC id correlation; no fixed global ids.
- `known` means all four valid/equal; `mismatch` means all four valid with differences; every
  incomplete/malformed/error/unreadable/uncorrelated observation is `unknown`.
- Mismatch is `refused` before useful input. Unknown never retries. Every failure after
  `turn/start` was sent is unknown (`packages/subagents/src/provider.ts:248`).
- Each requested and observed value's source appears in the reason.
- Effort is set in `thread/start.config.model_reasoning_effort`; turn/start cannot override checked
  route fields. Official ordering is initialize, thread/start, then turn/start
  (https://learn.chatgpt.com/docs/app-server#lifecycle-overview).
- No opt-out. Latest steering requires unconditional refusal and this run interprets it as
  superseding the older issue checkbox.
- Canonical cwd/provider binding is provider config, separate from the shared `/swarm` grammar
  (`packages/subagents/src/dispatch.ts:1`).

## Honest boundary

`provider-codex` is a stub (`packages/provider-codex/README.md:6`). #53 owns attach-only transport,
initialization, live binding, reconnection, and eventual durable evidence integration. The #195
slice makes the gate callable and unit-tested; it does not prove production deployment. Current
telemetry returns `DispatchResult` intact but persists only clipped detail, so structured durability
is also a later integration gate (`packages/dsh-app/src/instrument.ts:223`).

## Run identity and evaluation route

- Baseline: `99a32a7ce366bbc8908dad3e31072b8da7ed902d`
- Branch/worktree: `feat/route-identity--e35` at
  `/home/agent/projects/harness/.git/seat3-route195`
- Matrix pin: `8ba53bc50ca02aab29e99ba5362728839b8f1713`
- Coordinator: Astra medium; author: Sol medium; fallback: none.
- Plan evaluator: Opus 5 medium, independent.
- Intended implementer: Sol medium; implementation reviewer: GLM 5.3 Flash provider default.
- Stage G: `PASS` after binding amendments; evaluator Opus 5 medium session
  `0570aa7e-058e-4e5e-91e7-a0acf6d02745`.
- Stage H: Sol medium implementation; draft PR #238; no fallback.

## Read next

1. `.llm/runs/route-identity--e35/plan.md` — locked decisions, exact manifest, test matrix, DAG,
   risks, and integration gates.
2. `.llm/runs/route-identity--e35/research.md` — repository findings, official protocol evidence,
   schema excerpt, prior-art contradictions, and scope assessment.
3. `.llm/runs/route-identity--e35/protocol-schema.md:5` — offline, versioned, credential-free
   schema evidence and hashes.
4. `.llm/runs/m1-dsh-coordinator--orchestration/e3-hardening-plan.md:8` — accepted sequence.
5. https://github.com/rickylabs/harness/issues/195 and
   https://github.com/rickylabs/harness/issues/53 — issue intent and attach-only dependency.

## Outstanding gates

1. Commit the green manifest with the required co-author trailer and report exact HEAD.
2. Obtain independent implementation review at exact HEAD.
3. Let coordinator/CI run the full suite and PR gates.
4. Report the prerequisite as callable/tested, never as live or deployed; #53 remains the transport
   and production integration gate.
