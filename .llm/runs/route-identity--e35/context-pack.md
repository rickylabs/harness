# Route identity -- E3.5 — context pack

## Resume here

The #195 implementation is committed and independently reviewed PASS at
`febfef79f62114323c2f81dd830e7325b77ce7d2`. It adds a pure four-field route gate, optional typed
DispatchResult evidence, and a callable Codex pre-turn protocol helper. Focused tests, workspace
typecheck and CI passed. Route code stayed identical through rebase onto main including #239;
the updated-base build also passed. The root README finding was corrected in `b1aaeb94c1accfd202247513eae0c2dbc9b1d86f`.
The final receipt head requires a last exact-head attestation and CI before merge. Consult PR #238
and issue #195 for terminal receipts; this context pack records the pre-merge handoff.

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

`provider-codex` ships the protocol prerequisite only (`packages/provider-codex/README.md:5`). #53 owns attach-only transport,
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
- Implementer: Sol medium; implementation reviewer: GLM 5.3 Flash provider default via opencode-go.
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

1. Obtain final-head attestation and CI after the receipt/documentation commit.
2. Merge PR #238, mark #195/#238 shipped, check board zero anomalies, retain actual merge SHA on the PR.
3. Keep #53 transport/composition/vocabulary/version/durability/live gates explicitly unverified.

## Independent review and terminal evidence

Implementation review is PASS at `febfef79f62114323c2f81dd830e7325b77ce7d2`; see `implementation-review.md` and `implementation-eval.md`. Root README correction is committed as `b1aaeb94c1accfd202247513eae0c2dbc9b1d86f`; the updated-base build passed. No route code changed after the review. The final exact-head attestation, CI and merge/closeout receipts belong to the live [PR #238](https://github.com/rickylabs/harness/pull/238) and [issue #195](https://github.com/rickylabs/harness/issues/195), which are the terminal source of truth. This file captures the pre-merge handoff, not an unverified claim that a merge already occurred. #53 and #237 remain outside this leaf's completion claim.
