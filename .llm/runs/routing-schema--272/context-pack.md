# Context — routing-schema--272

Resume file. Read this first; it is written for a reader with no history.

## Where the run is

E11 step 2 (#272): the strict, complete, fleet-expressive routing schema (version 2) over the
shipped step-1 loader, with no cell resolution (that is #273), no detection (#274) and no parity
gate (#275). Stage: plan repaired after one independent evaluation round; awaiting the
coordinator's decision on owner escalation for a second Stage G pass. No product code exists for
this step; nothing may mutate the product before an independent PASS.

Head `1d5df95` on `feat/272-routing-schema` (findings and route evidence committed by the coordinator over
`9b120d2`); the locked plan is preserved at `324a3de`. The schema consumer paths
(`packages/routing`, `packages/dsh-app`, `packages/llm-local`, `scripts/check-compiled-policy.mjs`)
are byte-identical to the plan's baseline `8fd096d` (verified 2026-09-08). Contracts source is
0.4.0 with 0.3.0 published; this step touches no contract.

## What to read, in order

1. `supervisor.md`: scope, mutation surface, author seat (Fable 5.1 at `xhigh`, session
   `e2ca9e1a-1a8f-452c-8d98-9e433c973bd6`).
2. `plan.md` (locked, 2026-09-07) and `research.md`: the two-version loader with a typed
   fail-closed consumer boundary, the version-2 design pack, manifest and tests, the export gaps.
3. `resume-amendment.md`: the coordinator's four questions and the resumed baseline.
4. `plan-eval.md`: the independent verdict, FAIL_FIX F1 to F4, and the list of what is sound.
5. `plan-amendment.md`: A-1, the repair. Where it and `plan.md` differ, A-1 governs; superseded
   sections are named in its disposition table.
6. `drift.md` D-010 to D-018 and `worklog.md` for how each finding was disposed and what was
   executed.

## The design in one paragraph, as amended

One loader accepts `schemaVersion` 1 or 2, no migration, no shape sniffing, no defaults. Version 1
is the shipped legacy transcription and stays the profile's selection. Version 2 holds the CLI's
tiers, role cells (ordered, empties and repeats preserved), loop policies with their words,
coordinator scopes and provider precedence verbatim, plus declared data the CLI does not print:
families, capabilities, provider identities, roles (what certifies, evaluates, requires,
restricts, who selects), lanes to tier/role, tier authorization, override evidence, placements,
and per-model launches. Each launch names its provider, its seam, its wire id, transport and
seam-appropriate harness fields, and carries required effort evidence (`unknown`, or `known` with
disjoint supported/unsupported lists and a reason); nothing converts efforts or infers support
from silence. Static invariants use one predicate over a single launch that must satisfy a role's
restrictions, relay approval and effort non-refusal together; independence counts only such
feasible different-family evaluators. Consumers reach a typed configuration only through
`laneRouting` or `fleetRouting`, each refusing the other version with a fixed code; the dry-run
driver refuses a version-2 document before any store read. No fleet document ships; the
fleet-shaped fixture copies exported fields verbatim and labels every other value synthetic.

## Authority and evidence

Fresh CLI files: `matrix-full-resume.json`, `matrix-plan-repair.json` (the repair session's
`architecture.plan` selection, Fable 5.1 at `xhigh`) and `matrix-plan-eval*.json` (NetScript `8eaa8c54`);
the full export is byte-identical to the original `matrix-full.json` (`8ba53bc`). Loop policy
for architecture plan evaluation: `maxRounds 1`, `escalateToOwnerAt 2`, `reSteerSameSession true`.
The evaluation ran on the fallback row (`grok_4_6` at `xhigh` via OpenRouter; session id in
`plan-eval-routing.md`). Old evaluator prose in `plan.md` is not launch authority.

## What is not established

No PASS. No implementation receipt exists; the coordinator's `baseline-verification.md` records
the unchanged routing suite passing at `1d5df95` (205 tests), which is baseline evidence only and
passes neither the schema nor the plan. No live-dispatch, capability or availability fact:
fixture evidence is synthetic and `unknown` means unknown. The complex evaluator gap (`muse/max`
twice with a retained `max` rejection report) is owned by #273 and #274; version 2 can state it,
not resolve it.

## Next

Coordinator: decide the owner escalation for a second Stage G pass under the fresh policy, on the
preserved evaluator session if permitted; on PASS, implementation follows `plan.md` as amended by
A-1 (manifest delta and mutation surface in `plan-amendment.md`). Any further findings go to
`drift.md` D-019 onward. The author seat did not and will not dispatch a reviewer.
