HEAD confirmed: `daf974d` (`docs(routing): plan whole-document configuration loader (#271)`), branch `feat/271-routing-configuration`. Read-only evaluation of combined plan (`plan.md` + normative `coordinator-disposition.md`), `supervisor.md`, `research.md`, `drift.md`, `worklog.md`, issues 270/271/272/273/148/181, doctrine `AGENTS.md`/`WORKFLOW.md`, cited source, `matrix-full.json`/`matrix-architecture.json`. Author family ignored; evaluator is different-family per matrix plan-evaluation cell. No code, board, git, or dispatch mutation. No `.env`/auth opened.

Verdict: **FAIL_FIX** — sound scope and architecture; four bounded contradictions to fix, then re-run Stage G. Not a rescope: wholesale replacement, data boundary, step DAG, and 272/273 ownership are correct.

What passes (attacked, holds):

- Wholesale replacement, no compiled fallback: `plan.md:89-106` D-1 config-first, no `bind`/`set`; `plan.md:624-625` one PR compile-break; T-W1–W5 `plan.md:681-690` disjoint A/B proof; frozen/WeakMap/no-global `plan.md:342-351`.
- Exact-byte identity, pure parse, no forged digest: `plan.md:147-164` D-3, `plan.md:355-359` D-17, `plan.md:250-256` D-9 text+label in plan, computed digest in key, no FS read in drive; T-D1–D3 `plan.md:674-677`, T-C2 `plan.md:724-729`.
- Strict safe parse + immutability: five kinds/codes/paths `plan.md:108-141`, bounds/walk/clone/freeze/reserved `plan.md:342-351`, T-L2–L10 `plan.md:645-672`, T-L8 credential-shaped exfiltration check.
- Loud baseline, fleet/evaluator deferred: unsupported-version distinct `plan.md:119-121`; D-8 minimal `plan.md:225-236`; S-2/S-3 `plan.md:771-783`; out-of-scope `plan.md:823-828`; 148/181 stay blocked `plan.md:761-763`, `research.md:447-462`.
- Consumer split safe: OF-1 A routing shape-only vs llm-local values `plan.md:299-311,332-338`; dep direction preserved (`llm-local→routing`, `research.md:R-7`); unsupported backend = composition refusal T-C6 `plan.md:716-718`; health/endpoint/backends + `adapter.ts:271` inventoried M-16b `plan.md:574-576`; contracts untouched `plan.md:610-611,621`.
- Independence preserved: D-6 string equality `plan.md:202-208`; existing `family.ts:104-138` order (same-family checked before `any`) retained; T-R4 `plan.md:706-707`.
- Node/pnpm, no NetScript build dep: `node:crypto` M-2 `plan.md:539-541`, root `typescript` D-18 `plan.md:363-376`, runtime-by-path `research.md:R-7`; packed-layout T-L1b/c `plan.md:640-644`.
- Evidence honest: `matrix-full.json` verified keys `schemaVersion/mode/tiers/coordinators/transportPriority`, 5 tiers, empty `simple.plan`/`plan_evaluation`, duplicate `complex.implementation_evaluation` preserved per `coordinator-disposition.md:31`; no parity claimed S-3/D-10; CLI never executed here, honestly stated `research.md:65-71`, `drift.md:D-003/D-012`.

Fixes required (bounded):

1. `DEFAULT_ROUTING_DOCUMENT_URL` contradicts no-fallback-accessor rule. `plan.md:559-560` M-10 adds the export; `plan.md:271-274` D-10 says no accessor when unconfigured; `coordinator-disposition.md:9` forbids hiding selection in a fallback accessor. Fix: delete the export, or define it solely as the explicit specifier constant, never consulted implicitly; add test that absent/empty `document` throws `routing-document-not-configured` even with the constant present.
2. T-L2 leaks source path into diagnostics. `plan.md:645` "Message names the path as given" contradicts D-2 `plan.md:114-116,525-529` and `coordinator-disposition.md:13` (location in provenance, not error strings; `describeLoadRefusal` never quotes source id/OS/parse text). Fix: T-L2 must assert refusal/`describeLoadRefusal` carry only fixed codes+paths; path appears only in caller-side provenance.
3. S-1 weakens the explicit-path gate. `plan.md:767-770` "either satisfies D-9" lets schemastery-only validation pass. Fix: require `RangeError(routing-document-not-configured)` backstop in `createService` regardless of schemastery expressiveness.
4. Minor inconsistencies, fix in place: root keys "exactly … provenance optional" `plan.md:469-470` — state allowed-set with optional member explicitly; R-3 `plan.md:798` "grep gate" — stale, is AST gate per D-18/T-R1; T-R4 `plan.md:706-707` — add explicit same-family-via-`certifies:any` fails-closed case; clarify D-18 allowlist entry for `dry-run-test-fixtures.ts` `plan.md:367-371` vs fixture-becomes-data M-20 `plan.md:588-592`.

Re-review needs only the four items above; no owner gate remains per disposition (OF-1/OF-2 resolved A within owner authority).

[source: `coordinator-disposition.md`, `plan.md`, `research.md`, `drift.md`, `supervisor.md`, `worklog.md` in `.llm/runs/routing-configuration--271`; topic: E11 step-1 combined-plan evaluation; consulted 2026-09-07]
[source: issues 270/271/272/273/148/181 via gh; `packages/routing/src/resolve.ts:265`, `admit.ts:250-257`, `family.ts:104-138`, `index.ts:40-80`, `dsh-app/src/dry-run-internal.ts:85-88`, `routing/package.json:10-19`; topic: cited implementation baseline; inspected 2026-09-07]
