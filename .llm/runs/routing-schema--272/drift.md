# routing-schema--272 — drift

## Summary

No product code, test, default configuration, board state, issue, label, commit, push, host or
sibling checkout was mutated in this run. The four files the brief authorises (`research.md`,
`plan.md`, `drift.md`, `worklog.md`) are the only writes; `supervisor.md` and the two matrix files
are coordinator-owned and were read, not edited. Nine observations below record where the brief,
the doctrine, the prior run's conventions and the evidence pulled in different directions and how
each was disposed. Nothing was resolved silently and no owner fork was opened.

## Register

| ID | Observation | Disposition |
|---|---|---|
| D-001 | The brief authorises four artifacts. `doctrine/WORKFLOW.md` also lists `context-pack.md` and Stage D design packs under `architecture/`. | Followed the brief. The design pack is a section of `plan.md` marked draft with a no-mutation notice; `context-pack.md` is left to the coordinator, as in the prior run (`routing-configuration--271/drift.md` D-001). Source: `doctrine/WORKFLOW.md`, Stages D and E; brief. |
| D-002 | Proving that gates run (Principle 6) required `pnpm install --frozen-lockfile`, a routing build, the routing suite and three parser probes over the built package. The brief forbids product mutation and host actions. | Executed. Every write went to `node_modules/`, `dist/` and `*.tsbuildinfo`, all gitignored (`.gitignore:2,5-6`); `git status --short` afterwards shows only this run directory. No source, fixture, lockfile or configuration changed. Results are in `research.md`, "Actual checks executed". |
| D-003 | `supervisor.md` changed on disk mid-run (the coordinator added the observed native model identity and session id). | Read as the current state; not edited. The planner's session identity matches the added line. Source: `supervisor.md:5`. |
| D-004 | The fresh matrix files are byte-identical to the copies the prior run retained (`cmp`). The brief says fresh CLI matrices are the authority and to re-query rather than reuse. | Cited this run's own files and recorded the identity as a fact, with both digests, so a later reader knows the fresh query returned the same bytes at the same NetScript source. No claim is made beyond that. Source: `research.md`, external leg. |
| D-005 | The shipped loader's diagnostics are safe but imprecise (anonymous unknown keys, missing-key cascades), and fixing them changes two version-1 assertion paths. The brief's acceptance says "useful safe diagnostics"; the prior run's evaluator required diagnostics to carry no location or value. | Planned as a bounded, reviewable decision applied to both versions (`plan.md` D-3, spike S-3), preserving kinds, codes, success outcomes and digests, and keeping the no-value rule. The alternative of fixing only version 2 is stated and rejected. Source: `research.md` R-5, PROBE-1. |
| D-006 | The prior run fixed fixtures as in-memory literals with the shipped default as the only tracked JSON (271 D-11). A fleet-shaped fixture with 76 candidates as a TypeScript literal in a non-test file trips the AST gate and cannot be diffed against the CLI file. | Planned two tracked JSON fixtures outside `config/` and `dist/`, neither exported nor packed, with a data-driven test that the fleet fixture equals the verbatim CLI copy on every exported dimension (`plan.md` D-19, T-F2). Tailored and malformed documents stay in-memory literals as before. Source: `research.md` R-6, C-11. |
| D-007 | The CLI does not export families, launch ids, capabilities, role semantics or any hard rule, and the brief forbids inventing authoritative values or hand-transcribing NetScript source. The fixture still needs values in those fields to load. | The fixture's non-exported values are synthetic, labelled in its `provenance.description`, and named as export gaps E-1 to E-13 for #275 in `research.md`. No fleet document is shipped (`plan.md` D-18). Source: `research.md`, "Export coverage". |
| D-008 | The brief says a genuinely unanswered owner choice must be isolated. Six candidate questions were examined; each is answered by E11 text or is an engineering choice with a contained cost. | No owner fork opened. The candidates and the text that answers each are tabled in `plan.md`, "Owner forks", so the evaluator can disagree without an owner round trip. The one data question that is genuinely open (family granularity of the fleet's open-weight models) is a #275 export gap and is recorded as spike S-1, not as a schema fork. |
| D-009 | Two facts in the fresh export contradict rules a schema might be tempted to add: a loop threshold above its cap (`architecture.planPolicy`: `maxRounds 1`, `escalateToOwnerAt 2`) and a loop policy for an empty cell (`simple.plan`). | Recorded as research C-4 and C-5; `plan.md` D-8 forbids cross-field loop rules and allows a policy for an empty cell, with test rows that assert both are accepted. Source: `matrix-full.json`, tiers `architecture` and `simple`. |

## Plan-lock status

`plan.md` is locked for independent evaluation by `muse_spark_1_3` at `max` (fallback `grok_4_6`
at `xhigh`) per the architecture tier's plan-evaluation cell in `matrix-plan.json`. Plan loop
policy from the same cell: one round, escalate to the owner at two, re-steer the same session.
Findings from that evaluation are to be appended here as D-010 onward, not edited into `plan.md`.
The planner did not dispatch, and will not dispatch, an evaluator.

## D-010 — independent plan verdict received: FAIL_FIX, four bounded findings (2026-09-08)

The fresh architecture `plan_evaluation` cell (`matrix-plan-eval.json`, NetScript `8eaa8c54`)
selects `muse_spark_1_3/max` then `grok_4_6/xhigh`. The primary's native preflight refused before
a session existed; the declared fallback, `grok_4_6` at `xhigh` (xAI, independent of the Anthropic
author and the OpenAI coordinator questions), evaluated `324a3de` through OpenRouter and returned
FAIL_FIX with findings F1 to F4 and no new owner fork (`plan-eval.md`, `plan-eval-routing.md`).
Disposition: repaired in the original author session by `plan-amendment.md` A-1; `plan.md`,
`research.md` and the verdict are not edited (Stage E lock). No PASS is claimed. Source:
`plan-eval.md`; topic: verdict and findings; consulted 2026-09-08.

| ID | Observation | Disposition |
|---|---|---|
| D-011 | F1: D-10 bound one seam to a provider while its own rationale says OpenRouter is reached on both seams; the owner requires providers and subscriptions distinct from dial mechanisms (#270; #272 comment 5591550877). | Amendment A-1.1: providers become identities with no seam; `seam` is a required field of every launch; uniqueness key `(provider, seam, id)`; subagents-only fields refused on llm launches; placements reference llm-seam ids; restrictions may name seams; F-2 shows one provider and id on both seams. D-10's rejected alternative (harness on the provider) stays rejected. |
| D-012 | F2: no per-launch effort capability; a validated cell effort could be read by #273/#274 as demonstrated support. Owner and observed evidence: a retained OpenRouter rejection of `max` versus a native capacity refusal; no conversion; "declared or unknown" (#270; #273 comment 5591323350; #274 comment 5591325380). | Amendment A-1.2: required `effortSupport` per launch, `unknown` or `known` with disjoint `supported`/`unsupported` subsets and a required `why`; eleven contradiction diagnostics; new invariant `effort-unsupported` firing only when every role-feasible launch declares the effort unsupported; no implicit all-supported, no conversion, no unsupported-from-silence; F-2 launches `unknown` except one labelled synthetic `known` example; research addenda E-14 and C-12. Role scoping of the invariant is flagged as an engineering choice the evaluator may reverse. |
| D-013 | F3: `no-independent-evaluator` counted any different-family cell member, so an unrelated native launch or an unapproved relay launch could satisfy independence. | Amendment A-1.3: one predicate over a single launch that must satisfy restrictions, relay approval and effort non-refusal simultaneously, plus the role's capability requirements; every candidate invariant restated in a precedence order yielding one code; five worked examples as T-F6 rows, including the evaluator's counter-example. Selection stays #273. |
| D-014 | F4: M-16 edited `docs/concepts/06-the-three-layers.md` with version mechanics against pre-#281 line numbers; the current paragraph already describes the intended product. | Amendment A-1.4: M-16 deleted; concept 06 and `packages/README.md` untouched; version guidance in the routing README (M-9), consumer refusal in the dsh-app README (M-15). |
| D-015 | The branch was fast-forwarded from `8fd096d` to `9b120d2` after the plan was locked; #281 changed concept 06 elsewhere, the snapshot gate gained a contracts-only exact-digest inventory, and contracts source moved to 0.4.0. | Verified rather than trusted: `git diff --stat 8fd096d..HEAD` over `packages/routing`, `packages/dsh-app`, `packages/llm-local` and `scripts/check-compiled-policy.mjs` is empty; the fresh `matrix-full-resume.json` is byte-identical to the original export. The routing fixtures stay outside the new inventory and under the ordinary key rule; no gate or contract change. Recorded in `plan-amendment.md`, "Baseline and evidence updates". Source: executed `git diff` and `cmp`, 2026-09-08. |
| D-016 | The fresh loop policy is one round with owner escalation at two; the evaluation consumed the round. `plan.md`'s "Evaluation route" section names the same cells from the older export and is not launch authority. | The repair is complete regardless; no reviewer was launched and no PASS inferred. A second Stage G pass is an owner escalation the coordinator owns. Source: `matrix-plan-eval-fallback.json`, `plan-eval-routing.md`; consulted 2026-09-08. |
| D-017 | The evaluator's F2 wording ("every launch of that model") and A-1.2's `effort-unsupported` (every role-feasible launch) differ in scope; the evaluator's F2 also suggested the invariant as optional. | Chosen role-scoped and required, following the v1 precedent that `constraint-violated` is role-scoped and the placement rule that evidence carries a `why`; both stated as reversible in A-1.2 and listed under "Owner forks" as engineering choices, not owner questions. |

Findings from any further evaluation are to be appended as D-018 onward.

## D-018 — coordinator precision corrections before escalation (2026-09-08)

The repair referred to its feature-branch head as main and described an empty supported list as
no supported capability, despite the explicit rule that unlisted efforts remain unknown. Corrected
the branch name and wording without changing the proposed validator or predicate. Also corrected
the worklog's blanket no-CLI/no-network statement: its own evidence includes read-only shell and
GitHub API operations. No second review or PASS is inferred.

[source — git branch/head, plan-amendment.md A-1.2 and author worklog; topic: receipt accuracy and
unknown-by-silence semantics; inspected2026-09-08]
