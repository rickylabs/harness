# routing-schema--272 — verification

What was executed, with the stage named. Every command below ran in this worktree on 2026-09-14.

**This file is the generator's own account of its own work.** By ARCHITECTURE.md §7 that satisfies
the letter of I2 and not its purpose, so nothing here is a sign-off. The independent exact-head
implementation evaluation is a separate session and has not run.

## The gate that matters, named

`pnpm run build` is a twelve-stage `&&` chain and the actual compile is stage 7. A failure in
stages 1 to 6 means the compile never ran, so an aggregate failure would carry no information about
whether the code compiles. Both were therefore run separately as well as together.

| Stage | Command | Result |
| --- | --- | --- |
| 6 | `pnpm run check:compiled-policy` | exit 0 — `310 sources checked; mutation self-test passed` |
| 7 | `pnpm -r run build` (the compile, `tsc -b` per package) | exit 0, every package `Done` |
| 1–12 | `pnpm run build` | exit 0, all twelve stages green |

The compile executed and passed. `check:compiled-policy` needed **no new allowlist entry**: the new
sources assign no string literal to a property or variable named `model`, `effort`, `tier`, `lane`,
`family`, `profile`, `preset` or `harness`. The gate's own mutation self-test ran on this invocation,
so an empty pass is excluded.

## Tests

| Command | Result |
| --- | --- |
| `pnpm --filter @rickylabs/routing run test` | 419 pass, 0 fail, 48 suites (baseline 205 pass) |
| `pnpm --filter @rickylabs/dsh-app run test` | 336 pass, 0 fail, 50 suites |
| `pnpm -r run test` | 3,336 pass, 0 fail across 12 packages |
| `pnpm run check:snapshots` | exit 0 over all tracked data files, including both new fixtures |

## One gate cannot run here, and is recorded as unproven

`pnpm test` is `pnpm -r run test && pnpm run check:installed`. The recursive suite passes. The
second leg, `scripts/check-installed-contracts.mjs`, exits non-zero with
`check:installed failed at sleeping probe startup (requires executable TMPDIR)`. That is an
environment precondition this sandbox does not satisfy, not a result about this change: the script
contains zero references to routing and exercises the published contracts tarball. It is
**unproven here**, not green, and CI is where it can run.

## The absence claim, with the instrument aimed at the same input set

The claim: no fleet model, tier, role, coordinator-scope, lane, family, effort or capability
identifier appears as a string literal in any non-test source of `packages/routing`.

1. The input set was enumerated once to a file:
   `ls packages/routing/src/*.ts | grep -v test > /tmp/routing-runtime-sources.txt` — ten files:
   `admit.ts configuration.ts document.ts family.ts fleet.ts index.ts load.ts probe.ts resolve.ts schema.ts`.
2. The control ran over **that same file**. Four strings that must be present were searched:
   `native` → `schema.ts`; `openrouter` → `family.ts resolve.ts admit.ts schema.ts`;
   `unknown-key` → `schema.ts fleet.ts`; `worklog` → `fleet.ts`. The instrument finds what is there.
3. The real query ran over the same file, for all 58 identifiers the fixture declares. Zero hits.

The same claim is also a test rather than only a shell receipt: `fleet.test.ts` builds the forbidden
list from the loaded fixture, asserts the list is larger than 40 entries and that at least 8 sources
were scanned — so a fixture that stopped declaring names, or a scan that found no files, fails
loudly instead of passing vacuously.

`worklog` is present in `fleet.ts` as `OVERRIDE_EVIDENCE`, and `native`/`openrouter` in `schema.ts`
as `TRANSPORTS`. Those are structural vocabularies a mechanism must interpret, classified as such in
the plan's boundary table (S-4) and outside the acceptance line, which names model, tier, effort and
family identifiers. Provider names are deliberately **not** on the forbidden list: a provider named
`openrouter` collides by nature with a transport and a router vocabulary member that predate this
step, and carving those out of the list would have hidden a real leak rather than found one.

## Mutation testing

Twenty deliberate defects, each applied to product source, with the routing and `dsh-app` suites run
against it and the file restored byte-for-byte afterwards. Three mutants were rejected by the
compiler on the first attempt and were rewritten into forms a reviewer could plausibly have written
before being counted; both zero-kill results were treated as findings and fixed.

| Mutant | Behaviour broken | routing | dsh-app |
| --- | --- | --- | --- |
| M1 | `effort-unsupported` invariant removed | 3 | 0 |
| M2 | `feasibleLaunches` ignores a declared effort refusal | 1 | 0 |
| M3 | relay approval judged across launches instead of on the launch | 1 | 0 |
| M3b | `feasibleLaunches` drops the per-launch approval clause | 2 | 0 |
| M4 | independence is family inequality plus capability, with no feasible launch | 1 | 0 |
| M5 | a nonnumeric round cap is coerced to `0` | 3 | 0 |
| M6 | a lane may point at an explicitly empty cell | 1 | 0 |
| M7 | a provider record may carry the seam | 2 | 0 |
| M8 | `effortSupport` optional, absence refuses nothing | 1 | 0 |
| M9 | unknown keys are ignored instead of refused | 19 | 0 |
| M10 | an unknown key is reported at its parent path | 12 | 0 |
| M11 | the `missing-key` → `wrong-type` cascade restored | 1 | 0 |
| M12 | `laneRouting` accepts a fleet document by cast | 2 | **2** |
| M13 | an llm-seam launch may name a harness | 2 | 0 |
| M14 | a repeated candidate in one cell is deduplicated | 2 | 0 |
| M15 | the version gate accepts any safe integer | 4 | 0 |
| M16 | `capability-unsatisfied` invariant removed | 3 | 0 |
| M17 | a placement may name a subagents-only launch id | 2 | 0 |
| M18 | an effort a `known` launch does not name counts as supported | 3 | 0 |

Every mutant kills at least one test. M12 is the only one that reaches `dsh-app`, which is the right
shape: the consumer boundary is the one behaviour both packages depend on.

### Two zero-kill findings, and what they were

**M3 killed nothing on the first run.** The F3 rule that all three feasibility clauses hold on the
*same* launch was uncovered, and the fault was the SETUP, not the assertion: every existing row
separated the launches by a *restriction*, so clause c1 did the work and clause c2 was never the
deciding clause. The fixture had no model whose restriction-satisfying launches split on relay
approval alone. Two cases were added — one invariant row where a candidate's only approved launch
declares its cell effort unsupported while an unapproved relay beside it leaves it unknown, and one
direct `feasibleLaunches` assertion — and M3 and M3b now kill 1 and 2.

**M4 killed nothing on the first run** (after being rewritten from a compiler-rejected form). The
evaluator's own counter-example — a candidate that is different-family and capable but has no
feasible launch — was untested at order 5. The existing row asserted only
`relay-evaluator-unapproved` on the evaluator's own cell, which `candidateProblem` produces
independently of `feasibleEvaluator`. A test was added asserting that **both** problems appear: the
evaluator is refused in its own cell *and* `no-independent-evaluator` fires on every generator in
every tier whose gate cell has nobody feasible — and not in the one tier whose gate seats an
approved relay. M4 now kills 1.

### Three mutants the compiler rejected, and their rewrites

A mutant `tsc` refuses is not evidence the tests cover the behaviour; it only shows that the exact
edit leaves an unused binding. Each was rewritten to a plausible reviewer edit and re-run.

| First form | Why rejected | Rewritten as |
| --- | --- | --- |
| `feasibleEvaluator` returns `true` | `TS6133: 'evaluatorRole' is declared but its value is never read` | returns `capableOf(configuration, evaluator.model, evaluatorRole)` — family plus capability, no launch feasibility, which is exactly the reviewed defect |
| `add("unknown-key", path)` inside the indexed `forEach` | `TS6133: 'index' is declared but its value is never read` | the whole loop reverted to `for (const key of Object.keys(o))`, the shape at head |
| the llm-seam refusal block deleted | `TS6133: 'SUBAGENTS_ONLY_KEYS' is declared but its value is never read` | `harness` dropped from `SUBAGENTS_ONLY_KEYS` — a one-word deletion that compiles |

## Fixture provenance, checked rather than asserted

    sha256 44807db43ef19c14ac92e08fd5bf8bce89a5d38c7a19aba75db9d37ef4c70ac9  test-fixtures/matrix-full.8ba53bc.json
    sha256 4974084eeab9f85da03fac68adbd3a96e4d67ba4628f5d74e9826aeec6561c47  test-fixtures/fleet-shaped.v2.json

The first digest equals the fresh `deno task agentic:matrix -- --json` output at NetScript
`155dbbe90b35b8ab24fa7c52d4947f3d5e8f38ac`, and `cmp` against this run's retained `matrix-full.json`
(NetScript `8ba53bc5`) and `matrix-full-resume.json` (NetScript `8eaa8c54`) exits 0 for both. Three
source revisions, identical bytes.

The second fixture is compared to the first by a data-driven test rather than trusted: tier names,
order and descriptions; every cell per role, including the two explicitly empty cells and the one
exact repeat; the three loop policies per tier value-for-value and `typeof`-for-`typeof`;
coordinators by scope; provider precedence; and the referenced model-key set. Two counts are pinned
from the export's own shape — 40 cells and 76 candidates — so a fixture that silently dropped a cell
fails rather than passes. A one-byte change to any exported value in the fixture fails that test.

## What is not claimed

- **No PASS for the plan.** The second bounded plan evaluation on #272 never ran. The plan is
  reviewed and repaired, not independently re-verified.
- **No implementation evaluation.** A generator does not certify itself (I2). The exact-head
  evaluation is a separate session from a different vendor family.
- **No live dispatch, capability, entitlement or availability fact.** The fixture's single `known`
  effort declaration is a synthetic shape. Declared evidence in a document is a declaration with a
  stated reason, never live availability.
- **No fleet-parity claim.** No version-2 document ships; the packaged default is still the
  version-1 transcription and the bundle row still selects it. The fixture's families, launch
  identifiers, capabilities and effort evidence are synthetic, labelled in its provenance, and are
  export gaps E-1 to E-14 owned by #274 and #275.
- **`check:installed` is unproven here**, per the section above. An unrunnable gate is not a green
  one.

[observed — commands and exit codes above in this worktree; topic: executed gates, suites and mutation kills; executed 2026-09-14]
[observed — `deno task agentic:matrix -- --json`, NetScript source 155dbbe90b35b8ab24fa7c52d4947f3d5e8f38ac; topic: fresh export and its digest; executed 2026-09-14]
[source: `ARCHITECTURE.md` §7 ("An empty result is not a pass", I2); topic: why this file is not a sign-off; consulted 2026-09-14]
