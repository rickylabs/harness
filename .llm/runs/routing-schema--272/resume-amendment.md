# Resume amendment — schema review on current main

Resume the original routing-schema--272 plan and native author lineage; do not restart it. The existing branch was fast-forwarded from8fd096d to9b120d2 while preserving all original untracked planning artifacts. Source comparison shows no changes in packages/routing, packages/dsh-app or packages/llm-local, nor check-compiled-policy. The snapshot publication gate gained exact path/digest fixtures for independently shipped contracts; its normal schema-fixture restrictions remain. Contracts source is now0.4.0 after merged recovery PR282; published baseline remains0.3.0 pending owner release283. This schema task does not modify or publish contracts.

Fresh full CLI and architecture plan-evaluator output are attached. Original matrix files remain unchanged historical evidence. Live route capability is separate from logical selection; fresh native preflight precedes any evaluator session. A route-specific physical failure is not a plan verdict. The architecture plan-evaluation fallback, if printed and usable, is distinct from the complex evaluator row that has no alternate model.

## Coordinator review questions

These are findings for independent plan evaluation, not silent amendments to the locked design:

1. D-10 attaches exactly one seam to a provider, while its rationale says one provider can be reached through both the autonomous CLI and LLM interfaces. Can the proposed schema represent both lawful launches under the same account/provider identity without duplicating provider names or reintroducing special cases? The owner requires providers/subscriptions distinct from dial mechanisms.
2. Candidate efforts refer only to a document-wide list. Can this schema preserve per-model and per-physical-launch supported efforts, including unknown capability, so273/274 cannot treat a configured max cell as proof that a transport accepts it? Anonymized actual max rejection and capacity refusal are recorded on273/274; do not add a conversion or infer unsupported capability. Decide the minimal schema ownership boundary versus explicit later dependency.
3. Confirm all independence feasibility checks use compatible, restriction-satisfying evaluator candidates, not simply any different-family model or unrelated native launch. Actual generator selection still belongs to273.
4. Preserve intended-product documentation; version details belong in operational schema guidance. Current concept06 wording has changed since the plan's line references.

No product mutation before independent plan PASS. No paid retry of a known unsupported effort, account/credential changes, live dispatch, new provider integration, publication or private consumer detail.

[source: git source comparison8fd096d..9b120d2; topic: unchanged schema consumer baseline and updated snapshot gate; executed2026-09-08]
[source: matrix-full-resume.json and matrix-plan-eval.json at NetScript8eaa8c54; topic: fresh authority; executed2026-09-08]
[source: issue273 comment5591323350 and274 comment5591325380; topic: exact effort capability versus preflight availability; consulted2026-09-08]
