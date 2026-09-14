# Matrix agnostic — independent implementation evaluation

PASS

Summary: complete sources close prior truncation gaps. Owner JSON, alias, coverage, router-wire, catalog, fixture controls all match locked plan + amendment. No live availability claim.

Checks, all source-cited:

- JSON-owned policy `packages/routing/src/schema.ts`: optional `triggers`/`routers`/`laneAliases`/`label`/`description`, omission defaults to code vocab, explicit lists replace, purposes open with `evaluation` required, v1 extension, `STRUCTURAL_FIELDS` includes new fixed names with custom roles indexed, router IDs nonempty ≤4096 `^[a-z0-9][a-z0-9_.-]*$`, alias collision/dangling/chain/syntax refused, tier refs validated canonical, dual `implementation` must agree, `review` divergence allowed.
- Aliases caller-only `packages/routing/src/configuration.ts` + `schema.ts` + `resolve.ts` + `admit.ts`: `canonicalLane` in `lanePolicy`/`laneChain`/`laneConstraint`/`tierRoleLane`/admission, document-internal alias refused, catalog preserves map separately, diagnostics structural `lanes[i]`/`tiers[i]` only.
- Coverage vs launch `packages/routing/src/resolve.ts` + `family.ts`: `unreviewedSteps` requires registered opposite-family certifier, `any` never overrides, `certifiesMatches` skips same-family incl. fallbacks, full chains incl. fallbacks checked, orphan implementation rejected, both `review`+`implementation_evaluation` checked, `plan` without evaluator accepted / evaluator without `plan` refused, `tierPlan.review` preserves legacy, `none` schedulable never covering, paid/turn/depth still required — `packages/routing/src/agnostic.test.ts` paid-fallback `approval-required` vs `ok` proves coverage≠permission.
- Router wire `packages/subagents/src/dispatch.ts` + `packages/dsh-app/src/dry-run-internal.ts` + `admit.ts`: `Router=string`, `ROUTERS` suggestions only, `unknown-router` warning removed, `toDispatchRequest`/`renderSwarm`/`parseSwarm` round-trip preserves custom, `HARNESSES`/encoding/credential guards retained, `admit` exact pairing via `routableModels` before `opencode` relay bypass, dry-run custom admit/reject gate passes.
- Catalog `packages/routing/src/catalog.ts`: JSON-serializable frozen projection, harnesses/transports from code, routers/efforts/triggers/purposes/families/roles/lanes/tiers/aliases/models from validated doc, per-model route combos preserved, `availability:unproven`, labels bounded nonempty, search text lowercased, unrouted included.
- Fixtures/isolation `packages/routing/test-fixtures/owner-matrix.json` + `compatibility.json` + `agnostic.test.ts` + `.llm/runs/matrix-agnostic--348/verification.md`: synthetic custom matrix + frozen legacy fixture, 31 mutation cases valid→refused→valid + 8 resolution/export + shipped invariant/substitution =40 tests, 19 guard mutants fail/restored pass, 1026 required suites pass with baseline correction and dev failures disclosed, live/cockpit INCONCLUSIVE, all timeouts/bounds closed mechanisms preserved.


Requested: feature implementation evaluator, Muse Spark 1.3 contributor through OpenCode Go, xhigh, freshly queried from the fleet matrix. Same separate evaluator session resumed after attachment truncation. Exit 0. CLI verdict output does not independently attest backend model/effort application: observed effort remains unproven. Private session references and telemetry omitted.
