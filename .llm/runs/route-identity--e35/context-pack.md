# Route identity -- E3.5 — context pack

## Resume here

The run has completed research and locked a bounded implementation plan for #195. The recommended
change adds a pure provider/model/effort/cwd gate in `subagents`, optional typed evidence on
`DispatchResult`, and Codex thread/start plus pre-turn orchestration behind an injected initialized
protocol port. It does not implement a provider or transport. Next action: independent Opus 5
medium plan evaluation. Product code must not change before that verdict is `PASS`
(`doctrine/WORKFLOW.md:80`).

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
- Planning mutation surface is the run-artifact files listed in `supervisor.md`; no product edits
  or commit.

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

1. Obtain independent plan-eval `PASS`; record fixes as drift rather than rewriting history.
2. Implement only the declared product manifest.
3. Run focused package tests, typecheck, build, and diff check.
4. Obtain independent implementation review at exact HEAD.
5. Report the prerequisite as callable/tested, never as live or deployed; #53 remains the transport
   and production integration gate.
