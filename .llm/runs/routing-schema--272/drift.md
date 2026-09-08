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
