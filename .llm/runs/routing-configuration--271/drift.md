# routing-configuration--271 — drift

## Summary

No product code, board state, issue, label, commit or host was mutated in this run. The three
files under this run directory are the only writes. Fourteen observations below record where the
brief, the doctrine and the evidence pulled in different directions and how each was disposed:
by a decision in `plan.md`, by an owner fork, or by a note to the coordinator. Nothing was
resolved silently. Two coordinator-owned files, `supervisor.md` and `matrix-full.json`, appeared
in the run directory while the research was in progress; the planner did not write or edit them,
and revised `research.md` and `plan.md` to read from the second before handing the plan to
evaluation (D-012). A third, `coordinator-disposition.md`, is a normative amendment that resolves
both owner forks and adds binding corrections; it is applied throughout `plan.md` and logged as
D-014.

## Register

| ID | Observation | Disposition |
|---|---|---|
| D-001 | The brief authorises `research.md`, `plan.md` and `drift.md` only. `doctrine/WORKFLOW.md` lists `context-pack.md`, `worklog.md` and `supervisor.md` as continuous artifacts and Stage A as producing `supervisor.md`. | Followed the brief. The coordinator wrote `supervisor.md` during the run and states there that it maintains supervisor and evidence files (`supervisor.md:11`); the planner did not touch it. `context-pack.md` and `worklog.md` remain for the coordinator. The run identity, baseline SHA and evaluation route are also stated in `research.md` and `plan.md`. Source: `doctrine/WORKFLOW.md`, "Continuous artifacts"; brief. |
| D-002 | The brief forbids product changes and host operations. Proving that the baseline gates run (Principle 6) required executing `pnpm --filter <pkg> run test` for four packages, which writes build output. | Executed. Output went only to `dist/` and `*.tsbuildinfo`, both gitignored (`.gitignore:5-6`); `git status` shows the run directory as the only untracked path. Counts recorded in `research.md` R-4. No source file changed. |
| D-003 | At the start of the run the route evidence was the architecture tier alone, and the matrix CLI was not executed in this worktree (no NetScript, no host operation). | Superseded by D-012: the coordinator added the full export mid-run. The CLI was still not executed here; both JSON files are coordinator-retained observations. |
| D-004 | The brief asks to distinguish "structural transport/effort parsing architecture" from forbidden policy literals. The plan classifies transport kinds as structural but the effort vocabulary and its order as data, because the CLI prints `provider_default`, which the compiled ladder cannot express. | Decisions D-4 and D-5, with the alternative stated and the three code sites named so an evaluator can reverse the call cheaply. Source: `matrix-architecture.json` documentation candidate two; `packages/routing/src/models.ts:48`. |
| D-005 | The consumer inventory found that `llm-local`'s placement table is keyed by routing's compiled ids (`packages/llm-local/src/capability.ts:44,101-231`). Removing the ids therefore forces a change outside `packages/routing`, which the brief did not name but the acceptance implies. | Not decided. Raised as owner fork OF-1 with a recommendation and the cost of each option; the manifest carries both A and B variants. |
| D-006 | `tierPlan` resolves every review lane against the literal `"openai"` (`packages/routing/src/resolve.ts:265`). Removing it touches the same function step 3 (#273) rewrites, and it is the divergence #181 names. | Decision D-8: derive the author family from the loaded implementation primary, nothing more. The plan states in three places that this is not #181's fix and that #181 stays open on #272 and #273. |
| D-007 | The CLI keys models `fable_5_1`, `astra`, `luna`; the table and the wire carry `fable-5`, `gpt-6-astra`, `gpt-5.6-luna`. Step 5 compares CLI keys; step 1 must keep admitting wire ids. | Decision D-7 keys version 1 by wire id and records the namespace as spike S-2 for step 2's schema. The shipped document's provenance is required to state the gap. Source: `research.md` C-3. |
| D-008 | The brief says models, efforts and evaluator choices come only from the fresh matrix CLI with no downgrade. This planning session is `fable_5_1` at `xhigh`, the first plan candidate for the architecture tier; the evaluation route in `plan.md` copies the tier's cells verbatim. | Conformant. No cell was substituted. Source: `matrix-architecture.json`. |
| D-009 | Literals in the six named classes exist outside `packages/routing` that are not routing policy: the executor's harness and router vocabularies and default harness in `subagents` (`dispatch.ts:63-83`), divybot's account pooling in `forge` (`targets/model.ts:99,142-154`), and a provider inferred from the driving CLI in `telemetry` (`backfill/claude.ts:200`). | Reported to the coordinator in `research.md` L25 to L27 and excluded from #271's manifest, with the step or epic that should own each. Planning them into step 1 would widen "one loader/replacement PR" into three epics. |
| D-010 | Public artifact hygiene: the brief forbids operator paths and private repository internals. A prior run's context pack records an absolute worktree path. | This run names the worktree by branch only, cites NetScript exclusively through issue text (its source was not read), and records no credential, quota, host or account fact. |
| D-011 | The doctrine's Stage E asks for owner forks whenever the answer depends on what the owner wants. Two questions qualify (OF-1 placements, OF-2 explicit path). A third candidate, whether the `included`/`outside_plan` keyword pair counts as a "subscription literal", is a reading of the owner's words rather than a preference. | Treated as a reviewable classification (plan boundary table, `research.md` U-5) rather than a fork, so the evaluator can object without an owner round-trip. If the evaluator reads it as a literal, the contained change is described in the boundary table. |

| D-012 | `matrix-full.json` (full mode, five tiers, 76 candidates) appeared in the run directory after the repository leg and the first draft of all three artifacts were written. Reading it changed what could be observed rather than reported. | Revised before hand-off, since no evaluator had yet read the plan: `research.md` external leg rewritten from the file; contradictions C-8 (transport priority names Harness cannot spell), C-9 (a duplicated candidate in `complex.implementation_evaluation`) and C-10 (policy fields holding numbers or words) added; U-3 resolved and U-6 added; `plan.md` D-4 rationale corrected (the export does print a transport list, which is provider precedence, not `TRANSPORTS`), D-7 and S-2 strengthened with the seventeen keys and the four orphaned pins, S-3 rewritten, R-11 added, scope list extended. No decision changed direction. Source: `matrix-full.json`; `supervisor.md:11`. |
| D-013 | The fresh full export lists `muse_spark_1_3` at `max` twice in one cell. The brief says supported routes follow the tool and the CLI is the parity authority. | Not corrected, not deduplicated, not filed anywhere. Recorded as research C-9 and inside plan S-3. The coordinator then clarified (`coordinator-disposition.md:31`) that repeated ordered candidates are an authoritative shape later steps must neither deduplicate nor reject, while duplicate model definitions, lane identities and placement pairs stay invalid; research C-9, plan S-3 and the schema's duplicate rules now say exactly that. Source: `matrix-full.json`, tier `complex`, role `implementation_evaluation`. |

| D-014 | `coordinator-disposition.md` arrived after the first plan draft and states it takes precedence over the draft wherever they differ. It resolves OF-1 as A and OF-2 as A, and adds corrections on diagnostics, input bounds, immutability, a pure parse entry point, dry-run identity, durable-record fencing, packed-asset resolution and the reach of the compiled-policy regression. | Applied in place before evaluation, with a table at the top of `plan.md` mapping every amendment line to the decision, manifest item and test that now carries it: OF-1 and OF-2 marked resolved with their answers; D-2, D-3, D-9, D-10, D-13 revised; D-14 to D-18 added; the schema's `placements` section, the loader contract, manifest items M-2, M-13, M-14, M-16b, M-18, M-20, M-24, the consumer table, tests T-L1b, T-L1c, T-L8 to T-L10, T-D3, T-W5, T-R1 (redesigned as an AST gate with a self-test), T-C1 to T-C4, T-C6, T-C7, risk R-6, spike S-4 and gate G-2 updated or added. No amendment was declined; two mechanisms the disposition left open were chosen and named as such (D-14's rendering of a row config, D-18's script placement) with the fallback the disposition itself names. Source: `coordinator-disposition.md:5-25`. |
| D-015 | The disposition asks that the dry-run never trust a caller-supplied digest and that no filesystem read occur inside the drive. The first draft carried a pre-loaded object with its digest in the plan. | Corrected in D-9 and D-17: the plan carries document text plus a label; the driver parses in memory and computes the digest. The earlier design is recorded here as rejected. Source: `coordinator-disposition.md:15`. |

## Plan-lock status

`plan.md`, as amended per D-014, is locked for independent evaluation by `muse_spark_1_3` at
`max` (fallback `grok_4_6` at `xhigh`) per the architecture tier's plan-evaluation cell.
Findings from that evaluation are to be appended here as D-016 onward, not edited into
`plan.md`.

## D-016 — first independent plan verdict and bounded repairs

Muse Spark1.3 max independently reviewed daf974d and returned FAIL_FIX. The scope and architecture held; four contradictions required repair. Removed the stray default-document accessor export from the manifest; made unreadable-path tests require fixed safe diagnostics; required createService's missing-document RangeError regardless of schema support; clarified optional root keys, the AST gate description, same-family certifies:any refusal, and the test-only fixture allowance. Changes are recorded here and in git history rather than erasing the original reviewed plan. No product mutation.

The architecture matrix calls for escalation at a second plan-review round. The coordinator has surfaced and recorded that escalation, and uses the owner's standing direction to keep progressing autonomously for this bounded same-session repair. No model/effort substitution, no independence waiver, and no PASS inferred.

## D-017 — new-key redispatch is guarded by the consumer

Same-session review at2a4a09f verified all four earlier fixes, then returned FAIL_FIX for the state-store test. A changed input revision is a distinct key and existing per-key fencing does not prevent that new intent. Replaced S4/T-C7/R6 with an explicit consumer obligation: serialized handle operations, state read before intent, pending/unknown operation refusal across revisions and attempts, no automatic operator reauthorization, and real FileStateStore plus memory/concurrency tests. The store contract stays unchanged. Second verdict retained in plan-eval-round2.md. No product mutation. Continued bounded repair is surfaced to the owner under the standing autonomous direction; no gate waiver or model downgrade.

## D-018 — implementation inventory corrections (2026-09-07)

The bounded implementation follows the final S-4/T-C7 obligation; no owner fork or route change.
Three source-derived inventory corrections were needed within the single PR:

- `packages/dsh-app/src/profile.test.ts` also asserts the complete row list. Add the selected routing
  row; its first post-change execution failed on exactly that missing expectation. This supplements
  M-21 rather than changing a behavioral expectation unrelated to the manifest.
- No repository command previously invoked `renderPatch` to write the patch, despite its generated
  header referring to build. Add `bundle:render` to the existing dsh-app manifest, calling that
  renderer. Render the patch and use the existing `golden:bless` script; do not hand-edit either.
- The D-18 AST scan found additional assignments with structural meanings: the board projection's
  synthetic smoke identity, the forge label color named `lane`, the teardown empty-harness sentinel,
  and subagents' requested/observed diagnostic paths. Their exact files and identifiers are documented
  in the script allowlist with owning issues; no excluded package's runtime behavior was changed.

`requirePlacements` is a small composition helper in the already authorized capability module: it
checks mechanism problems, then clones/freezes the typed placement array before the adapter can
expose it. Model/backend references and explicit totality remain with routing. No dependency added.

The packed-asset regression executes both `npm pack --dry-run` and a real scratch tarball extraction,
then resolves the exported document from an isolated consumer. This strengthens T-L1c's dry-run-only
inventory check to satisfy the disposition's actual packed-layout requirement.

[source: packages/dsh-app/src/profile.test.ts, topic: plannedRowIds; inspected 2026-09-07]
[source: packages/dsh-app/src/bundle.ts and package.json, topic: renderer and script inventory; inspected 2026-09-07]
[source: scripts/check-compiled-policy.mjs allowlist, topic: structural assignments versus routing policy; inspected 2026-09-07]

## D-019 — full-build row projections (2026-09-07)

The first clean full build passed compilation, CLI reference generation checks and the unchanged
contract publishing gate, then found two tutorial output blocks reflecting the old five-row bundle.
The full test sweep also found the independent `OUR_ROWS` list in `golden.test.ts`. Extend M-21/M-23
with these two files: update that list to include the required row; regenerate only the tutorial's
install transcript from the real profile CLI in scratch and the appended-row excerpt from the
script-generated golden. Preserve its `verify: exact` and `verify: contains` checks and update the
two adjacent plugin counts. The resulting output delta is the new routing row and its selection.
No expectation is waived, no generated file is hand-edited, and no live profile is installed.

[source: packages/dsh-app/src/golden.test.ts, topic: independent bundle ordering assertion; inspected 2026-09-07]
[source: scripts/check-tutorial.mjs and docs/tutorials/01-from-clone-to-board.md, topic: executable transcript and excerpt checks; executed 2026-09-07]

## D-020 — document-derived consumer diagnostics (2026-09-07)

Making names and placement explanations external data exposed two previously trusted diagnostic
inputs. Admission now withholds credential-shaped configured names from messages and expected
choices; the placement refusal uses its validated mechanism/reason code and refers to document
evidence instead of copying arbitrary model/why text. The loader still preserves data unchanged
and keeps its own diagnostics code/path-only. A regression supplies a valid document whose model
id is credential-shaped and verifies admission cannot print it. This implements the existing
credential diagnostic constraint rather than expanding routing semantics.

[source: packages/routing/src/admit.ts and packages/dsh-app/src/llm/adapter.ts, topic: document-derived diagnostic inputs; inspected 2026-09-07]

The AST gate also checks direct assignments and conditional/nullish default expressions, with a
self-test for a late `route.model` assignment. This found presentation-only fallback strings in
contracts, coordinator, forge and telemetry. Exact literal exceptions in the allowlist distinguish
those missing-value display strings from new model/effort selections; those packages are unchanged.
