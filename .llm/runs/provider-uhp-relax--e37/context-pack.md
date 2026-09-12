# Context pack — `provider-uhp-relax--e37`

The single file that resumes this run cold. Written for a reader with no history.

## What this run is

Two decided changes to `provider-uhp` in `@rickylabs/subagents`, both owner decisions of 2026-09-12
recorded on [#286](https://github.com/rickylabs/harness/issues/286). Implementation and proof only — no
design, and nothing here re-opens either decision.

1. **A UHP route whose `model` agreed is `accepted`**, even though `provider`, `effort` and `cwd` are
   unreported. Owner risk ruling: UHP and DeepSeek both guarantee the model and effort they are given, so
   non-observability of those three is an observability gap and not a safety problem. A contradiction still
   refuses, still checked first. `model` unreported — or a response that cannot be correlated — is still
   `unknown`.
2. **Drift refuses only the harness being dispatched to.** `listing-unreadable` still blocks everything.
   Unrelated drift stays visible as a distinct non-blocking signal. The manifest-wide check stays available
   for reconciliation and audit.

## Where the work is

| File | What changed |
|---|---|
| `packages/subagents/src/uhp-gate.ts` | `UhpRouteNegatives.unattested`, `UhpRouteAttestation` (internal), new `uhpRouteVerdict` order, new details |
| `packages/subagents/src/uhp-harnesses.ts` | `selectHarnessDrift`, `describeUnrelatedHarnessDrift`; `detectHarnessDrift` unchanged |
| `packages/subagents/src/uhp-provider.ts` | refuses on `selected.blocking`; emits `UHP_UNRELATED_DRIFT`; reports the gate's own detail |
| `packages/subagents/src/uhp-mock.ts` | `UhpReply.stream`, to reach the stream path from a non-streaming client (see `drift.md` D1) |
| `*.test.ts` for the three modules | the assertions and the transcribed defects |

Artifacts: `supervisor.md` (baseline and surface), `worklog.md` (what changed and why),
`verification.md` (gates, the two findings, the mutation table), `drift.md`, `mutations.mjs` +
`mutations.json` (runnable campaign).

## The three things most likely to be got wrong next

1. **The contradiction branch must stay first.** It is a separately ratified ruling and it is where the
   codex-ladder trap lives: checking absence first made that ladder's refusal branch unreachable over this
   transport. `R3` and `R4` in the campaign exist to catch a regression.
2. **`accepted` is not `verified`.** `isRouteVerified` is still `false` over UHP, so F2 still bars
   certifying evaluator use. Two questions, two answers; they used to be one verdict.
3. **The unrelated-drift signal is half the decision, not polish.** A narrowing that made it silent trades
   one failure for absence reported as normality. It is emitted on the dispatch result *and* to the
   diagnostic sink, because the sink is optional.

## Still open, still not answered here

- Whether `DispatchVerdict` should gain a distinct *identified but unattested* state. The gate grades that
  distinction internally (`UhpRouteAttestation`, not exported from `index.ts`) and says which it found in the
  `detail`. The enum is unchanged.
- What a non-certifying lane may do with an accepted-but-unattested route.
- The manifest is still unreconciled (`reconciledAt: null`, placeholder ids), so every dispatch through the
  checked-in file still refuses. #294 owns reconciliation against a reachable deployment.
- S10's reading that the three fields are unreportable is owner-certified and not independently
  re-derived (PR #292, `status:impl-eval`). The readers stay.

## Reproducing the gates

    pnpm run build
    TMPDIR=/path/to/exec-capable-dir-outside-the-repo pnpm run test
    node .llm/runs/provider-uhp-relax--e37/mutations.mjs

The `TMPDIR` note is not optional on this host and is explained in `verification.md` §0.
