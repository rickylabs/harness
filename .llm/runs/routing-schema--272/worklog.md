# routing-schema--272 — worklog

Append-only. Times are 2026-09-07 unless stated; the run is one planning session.

## Planning started

Coordinator opened the run on baseline `8fd096d` (main, including the shipped step-1 loader from
PR #277) with `supervisor.md`, `matrix-plan.json` and `matrix-full.json` in place. The fresh
`architecture.plan` cell selects Fable 5.1 at `xhigh` on native Claude Code; the planner session is
that route. Mutation surface: `research.md`, `plan.md`, `drift.md`, `worklog.md` under this run
directory only. No product, test, default-configuration, board, host or sibling mutation.

[source: `.llm/runs/routing-schema--272/supervisor.md`; topic: scope, baseline and route; consulted 2026-09-07]

## Discovery

Read in full: `AGENTS.md`, `doctrine/WORKFLOW.md`, `doctrine/PRINCIPLES.md`; every artifact of
`routing-configuration--271` (plan, research, drift, coordinator disposition and review, three
plan-evaluation rounds, implementation, implementation evaluation, verification, worklog, and its
retained role-mode matrix files); issues #270, #272, #273, #274, #275, #148, #181 via `gh issue view`
(read-only); `packages/routing/src/*.ts`, `config/routing.v1.json`, `README.md`, `package.json`; the
consumers in `packages/dsh-app/src` (`plugins/routing.ts`, `plugins/llm.ts`, `dry-run.ts`,
`dry-run-internal.ts`, `dry-run-test-fixtures.ts`, `llm/adapter.ts` placement lines, `bundle.ts` row,
`index.ts` export) and `packages/llm-local/src/capability.ts`; `scripts/check-compiled-policy.mjs`,
`scripts/check-snapshots.mjs` key list; CI workflow; `docs/concepts/06-the-three-layers.md`,
`packages/README.md`, `packages/dsh-app/README.md` routing sections; the routing and dsh-app test
files that touch routing. NetScript source was not read; no `.env` or auth file was opened.

[source: files named; topic: repository and document legs; inspected 2026-09-07]

## Checks executed

| Command or probe | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 (bin-link warnings for unbuilt CLIs only) |
| `pnpm --filter @rickylabs/routing... run build` | exit 0 |
| `pnpm --filter @rickylabs/routing run test` | 205 pass, 35 suites, 0 fail, 0 skipped |
| Script over `matrix-full.json` and `matrix-plan.json` | 5 tiers, 8 roles, 76 candidates, 2 empty cells, 1 repeated candidate, 17 model keys, 6 efforts, 15 loop policies with the recorded key/type variants, 4 scopes, 7 providers; plan file equals the full file's architecture tier |
| `sha256sum` and `cmp` of the fresh matrix files against the prior run's copies | identical bytes; digests recorded in `research.md` |
| PROBE-1: CLI JSON through `parseRoutingDocument` (built `dist`) | `invalid`, 133 problems, anonymous unknown keys and missing-key/wrong-type cascades |
| PROBE-2: `{ schemaVersion: 2 }` stub | `unsupported-schema-version`, `seen 2`, `supported [1]` |
| PROBE-3: fleet-shaped keys under `schemaVersion: 1` | `invalid`; no shape sniffing |
| `git status --short` after all checks | only `?? .llm/runs/routing-schema--272/` |

All output went to gitignored paths. The full workspace build and test sweep, the matrix CLI and
any host operation were not run (research, "Actual checks executed").

[source: this worktree at `8fd096d`; topic: executed planning evidence; executed 2026-09-07]

## Artifacts written

`research.md` (three legs, export-coverage table, eleven contradictions, three unknowns, executed
checks), `plan.md` (the two-version typed-boundary design, 21 decisions, no open owner fork, the
version-2 design pack, the CLI-to-schema mapping, the loader contract, a 16-item mutation
manifest, T-F1 to T-F14 and T-C1 to T-C4 with two data-driven mutation inventories, commands,
DAG, four spikes, two gates, eleven risks, the evaluation route), `drift.md` (nine dispositions),
this file.

## Hand-off

Plan locked for independent evaluation per the architecture tier's plan-evaluation cell
(`muse_spark_1_3` at `max`, fallback `grok_4_6` at `xhigh`; one round, escalate at two, same
session). The planner dispatched no agent and no evaluator, claimed no PASS, and mutated nothing
outside this run directory. Next: coordinator runs the independent plan evaluation; findings go to
`drift.md` D-010 onward.

## Pre-hand-off correction

A self-review before lock corrected four slips in `plan.md`: the D-3/T-F10 example index for an
unknown root key in fixture B is `$[14]` (fixture B has fourteen root keys), the reused invariant
codes number six, the summary counts eight invariant codes, and the footprint tally matches the
manifest (4 routing sources modified, 2 created; 1 test created, 2 modified; 2 fixtures; 2 dsh-app
sources and 3 tests; 4 documents). The `capability-unsatisfied` row now says coordinator candidates
are not checked. No decision changed direction; recorded here rather than in `drift.md` because the
plan was not yet handed to evaluation.
