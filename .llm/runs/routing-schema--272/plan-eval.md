# routing-schema--272 — plan evaluation (Stage G)

**Verdict: FAIL_FIX**

Reviewed head: `324a3de185ab0c71e5e109ecf443e17fd783fe42` (`docs: resume fleet schema plan for independent evaluation`). Product, tests, other run artifacts, GitHub, siblings and services were not mutated. This file is the only write.

Launch authority for this evaluation is `.llm/runs/routing-schema--272/matrix-plan-eval.json` (architecture `plan_evaluation`: `muse_spark_1_3`/`max` then `grok_4_6`/`xhigh`; `maxRounds` 1, `escalateToOwnerAt` 2, `reSteerSameSession` true). Stale evaluator prose in `plan.md` is not launch authority. Author lineage is Fable 5.1 / Anthropic (`supervisor.md`). This session is the different-family fallback row. No sibling-model guess and no effort conversion.

The locked plan (`plan.md`, research, drift) and the four coordinator questions (`resume-amendment.md`) are distinct. The questions are not silent amendments. No owner fork is opened: the owner already decided the missing rules.

## Summary

The two-version loader, typed consumer boundary, CLI cell/loop/coordinator/precedence mapping, strict unknown-key refusal, wholesale replacement, opaque families, synthetic-fixture labelling and “no cell resolution in this step” split are the right #272 shape. The plan still cannot represent two owner-hard facts, so it must not PASS:

1. One provider / subscription identity on both seams (dial ≠ provider).
2. Exact per-launch effort capability, including unknown, so a cell `max` is not proof a transport accepts `max`.

Independence feasibility currently counts any different-family cell member, including restriction-infeasible or unrelated-native-launch models. Concept `06` must not take schema-version mechanics.

No package, client, or dispatch PASS is inferred from this plan, from the 2026-09-07 routing suite, or from fixture F-2.

## What is sound (carries forward)

- One loader, `schemaVersion` 1|2 only, no migration, no shape sniffing (`plan.md` D-1, D-2, T-F9). Matches PROBE-2/3 (`research.md` external leg).
- Discriminated `RoutingDocument` plus `laneRouting` / `fleetRouting` / `placementsOf`; version-1 function signatures stay version 1; dry-run refuses version 2 before the store (`plan.md` consumer table; current `packages/dsh-app/src/dry-run-internal.ts:68-89` still calls `admitDispatch` on the loaded configuration; `plugins/llm.ts:111` still reads `.placements`; `plugins/routing.ts:24-26` still provides whatever the loader accepts). This is the fail-closed boundary #272 needs before #273.
- Cells are `{model, effort}` arrays keyed by declared roles; empties and repeats preserved; order is data (D-4, T-F2, T-F4). Matches `matrix-full.json` / `matrix-full-resume.json` shape.
- Loop words `none` / `unspecified_by_owner` / `immediate` stay words; no cross-field cap rule; policy on an empty cell is legal (D-8, C-4, C-5, T-F3).
- Coordinators by scope; `providerPrecedence` as a permutation of declared providers; lanes map to tier/role with `lane-unrouted` on empty targets (D-11, D-12).
- Hard rules that *are* representable: certifies keywords, role restrictions, UI/UX `selection`, privileged-tier `authorization`, required worklog evidence, no independence-waiver field (D-7, D-13–D-16, T-F14).
- Families opaque; independence is family equality, not seam (`research.md` R-8; `packages/routing/src/family.ts:8-21,104-137`; `packages/coordinator/src/independence.ts:49-53`).
- No compiled model/tier/effort/route tables; AST scan T-F12; default stays version 1; no packaged fleet document (D-18, D-19). F-2 synthetic fields are labelled not-authority.
- No `resolve*` over cells (D-21, T-F13). #273 resolver, #274 detection, #275 export/parity remain separate (`plan.md` out of scope; #270 DAG).
- Strict validation: unknown keys, duplicates, dangling refs, unsupported versions; D-3 diagnostic index paths; no silent discard.
- Routing / dsh-app / llm-local / `check-compiled-policy` are unchanged `8fd096d..324a3de` except `docs/concepts/06-the-three-layers.md` (resume-amendment comparison holds).

## Coordinator questions

Kept separate from the locked design. Answers below. Old plan text is evidence of the gap, not the ruling.

### Q1 — one provider on both seams

**Answer: no. D-10 cannot.**

D-10 (`plan.md:265-279`) types `providers: Record<name, { seam: "subagents" | "llm" }>` and requires/forbids `harness` from that single seam. The same decision’s rationale says OpenRouter is reached as Claude-CLI relay (`subagents`) and as an llm backend, so harness/transport belong on the launch — then it still binds the remaining dial (`seam`) to the provider. Fixture F-2 encodes `"openrouter": { "seam": "llm" }` (`plan.md:467-471`).

That cannot name both lawful launches under one provider identity without a second provider name or a special case. Owner rule: providers/subscriptions are distinct from dials (`resume-amendment.md` Q1; #270 “Subscription/account identity is distinct from the CLI transport”; #272 comment 5591550877 “cover both seams without conflating subscriptions and transports”). Run identity already puts seam on the run, not the vendor (`family.ts:41-54`). Do not keep single-seam providers to preserve that record shape.

### Q2 — per-launch effort capability, including unknown

**Answer: no. Cells plus a document-wide effort list cannot.**

D-4 candidates are `{ model, effort }` with `effort` in document `efforts` (D-5/D-6; fixture ladder `plan.md:465`). `Launch` has no effort-capability field (`plan.md:525-526`). `models[].capabilities` is a declared feature list (vision / deep_research), not physical effort support.

A loaded `muse_spark_1_3`/`max` cell would be a validated request only. Nothing in version 2 can say the physical launch supports `max`, rejects `max`, or is unknown. #273/#274 would be able to treat the configured cell as demonstrated support. Owner/coordinator evidence forbids that: anonymized native capacity refusal vs OpenRouter `reasoning_effort max` rejection, no max→xhigh conversion (`resume-amendment.md` Q2; #273 comment 5591323350; #274 comment 5591325380; #272 comment 5591550877; #270 “declared or unknown”).

Minimal #272 ownership: a required per-launch field whose lawful values include `unknown`. #274 detects into that field; #273 reads it and must not treat cell effort as an executable route. Absence must not mean “all document efforts” (plan U-1: version 2 sections required so absence is not a default). Do not invent unsupported from silence and do not convert efforts.

### Q3 — independence feasibility vs any different-family row

**Answer: the planned check is too weak.**

D-17 `no-independent-evaluator` (`plan.md:360,367-372`) asks only whether some `certifies: any` evaluation cell contains a different-family model. T-F6 mutates families or empties the cell. It does not require that evaluator candidate to satisfy the evaluation role’s restrictions, `requires`, or relay-approval on a *restriction-satisfying* launch.

Counter-example the schema would accept as independent: evaluation role restricted to `openrouter`; model has an unrelated `native` launch plus an unapproved relay launch. `constraint-violated` does not fire (a launch matches the restriction). `relay-evaluator-unapproved` does not fire (a native launch exists). Independence passes on family alone. That is an unrelated native launch, not a feasible evaluator.

Actual generator selection stays #273 (`plan.md` D-21; #273). Static load feasibility must still count only compatible, restriction-satisfying evaluator candidates.

### Q4 — concept 06 vs operational schema guidance

**Answer: M-16 is the wrong surface.**

M-16 (`plan.md:682-687`) inserts version-2 field mechanics into `docs/concepts/06-the-three-layers.md:29-33`. Those line numbers are the pre-#281 text. Current `06:29-37` at this head already states the intended product: wholly replaced document; version 1 as lane chains; shipped document a compatibility transcription, not fleet parity (`cfb559e` / #281). Version details belong in `packages/routing/README.md` (already M-9). Do not restyle 06 into a schema changelog.

## Findings (bounded)

| ID | Defect | Correction |
|---|---|---|
| F1 | Seam on provider (D-10) | Move `seam` to each `Launch`. Providers are names only until #274 adds accounts. Same provider may have subagents and llm launches. Harness required iff `launch.seam === "subagents"`, forbidden iff `llm`. Precedence stays a permutation of provider names once. Update D-10, types, validation, T-F5 harness rows, F-2. No duplicate provider names. |
| F2 | No per-launch effort capability | Required on each launch, e.g. `{ status: "unknown" }` or `{ status: "known", supported: string[], unsupported?: string[] }`. `supported`/`unsupported` are disjoint subsets of document efforts. An effort in neither list is unknown, never inferred unsupported. Cell `{model,effort}` does not prove support and need not be ⊆ `supported`. Optional invariant: refuse only when *every* launch of that model declares the cell effort `unsupported`. F-2 launches are `unknown` unless a tailored test needs `known`; label synthetic. #273/#274 consume the field; neither converts max→xhigh. |
| F3 | Independence uses any other family | `no-independent-evaluator` counts an evaluation-cell candidate only if family differs **and** the role’s `requires` hold **and** at least one launch satisfies that role’s restrictions **and** relay approval is judged on those launches, not an unrelated native launch. A candidate whose restriction-satisfying launches all declare the cell effort `unsupported` does not count. `unknown` is not support and is not load-time infeasibility. `certifies: none` stays non-gate. Extend T-F6. Selection remains #273. |
| F4 | M-16 edits concept 06 | Delete the concept-06 sentence. Keep version-2 guidance in the routing README (M-9). Drop the `packages/README.md` “(versions 1 and 2)” tweak or replace it with a pointer, no version mechanics. |

Do not implement these here. Do not open owner forks for them.

## Explicitly not inferred

- No current `@rickylabs/routing` / `dsh-app` / client compatibility PASS.
- No actual dispatch, preflight, or provider-support PASS. Fixture F-2 and `matrix-full*.json` are not fleet-authoritative family, launch-id, seam, or effort-capability mappings (`plan.md` D-19; `research.md` E-1–E-13).
- Historical routing 205 tests at `8fd096d` are not implementation proof at this head (`context-pack.md`).
- #273 / #274 / #275 work is not started by a schema PASS.

## Re-review

Fix F1–F4 in the original author session; record drift as D-010 onward; do not rewrite `plan.md` in place (`doctrine/WORKFLOW.md` Stage E). Stage G re-run checks only those four dispositions plus unchanged consumer-boundary / CLI-mapping / strict-validation claims. Loop: one round, then owner (`matrix-plan-eval.json`).

[source: `324a3de185ab0c71e5e109ecf443e17fd783fe42`; topic: reviewed head; inspected 2026-09-08]
[source: `.llm/runs/routing-schema--272/{plan,research,drift,supervisor,resume-amendment,context-pack,matrix-plan-eval}.json|.md`; topic: locked plan vs resume questions vs launch authority; consulted 2026-09-08]
[source: `packages/routing/src/family.ts:8-54,104-137`, `packages/dsh-app/src/dry-run-internal.ts:68-89`, `plugins/llm.ts:111`, `plugins/routing.ts:24-26`, `docs/concepts/02-the-two-seams.md`, `docs/concepts/06-the-three-layers.md:29-37`; topic: current seam identity, consumers, intended-product docs; inspected 2026-09-08]
[owner — https://github.com/rickylabs/harness/issues/270; topic: dial vs subscription, declared-or-unknown, five-step DAG; consulted 2026-09-08]
[owner — https://github.com/rickylabs/harness/issues/272#issuecomment-5591550877; topic: both seams and physical capability vs configured effort; consulted 2026-09-08]
[observed — https://github.com/rickylabs/harness/issues/273#issuecomment-5591323350 and /274#issuecomment-5591325380; topic: max rejection vs capacity refusal, no conversion; consulted 2026-09-08]
[source: `doctrine/WORKFLOW.md` Stages F–G and evaluation routing; topic: verdict vocabulary and matrix authority; consulted 2026-09-08]
