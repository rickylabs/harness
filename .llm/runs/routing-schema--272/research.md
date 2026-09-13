# routing-schema--272 — research

Stage B/C artifact for issue #272 (step 2 of E11, #270). Plan and research only: no product
code, no test, no default-configuration, no board, no host and no sibling-checkout mutation.
Written against baseline `8fd096df76f48a80df8ee94a1ee881cc709cefa0` on branch
`feat/272-routing-schema`, which includes the shipped step-1 loader (PR #277, `c5994d4`).

## Summary

The shipped loader is strict, bounded and version-gated, but it knows exactly one shape: version 1,
which is the legacy table as data (23 lane chains, four implement/review tier pairs, one depth
number, placements). The fresh matrix CLI export is a different shape: five tiers by eight roles
with 76 ordered `{model, effort}` candidates, two explicitly empty cells, one cell that repeats a
candidate, three loop policies per tier whose fields hold numbers in some tiers and the words
`none`, `unspecified_by_owner` and `immediate` in others, four coordinator scopes, and a
seven-name provider precedence list. Nothing in version 1 can hold any of that; the CLI JSON fed to
the shipped parser is refused as `invalid` with 133 problems (executed, PROBE-1 below), and a
`schemaVersion: 2` stub is refused as `unsupported-schema-version` with `supported: [1]`
(PROBE-2), which is exactly the door step 1 left for step 2.

Six facts shape the design in `plan.md`:

1. The CLI export is authority for what it prints and silent on the rest. It prints tiers, roles,
   candidates, efforts, loop policies, coordinator scopes and provider precedence. It does not
   print model families, wire or launch ids, per-model providers, capabilities, effort order,
   which roles certify or which they evaluate, deep-research restrictions, UI/UX selection,
   privileged-tier authorization, owner-override rules, relay-evaluator approvals, subscriptions
   or CLI versions. Every one of those is an export gap for #275 and a schema field whose values
   this run must not invent (external leg, "Export coverage").
2. Every routing consumer at head is typed against the version-1 `RoutingConfiguration` and reads
   version-1 sections directly: the dry-run driver admits under `lanes`, the llm plugin reads
   `placements`, and one test reads `configuration.lanes[0].chain` (R-2). A version-2 document
   that reuses the key `tiers` for a different shape (R-3) would be misread by any consumer that
   is not forced to narrow. The boundary therefore has to be a type boundary plus a coded runtime
   refusal, not a version number alone.
3. The loader's refusal kinds, bounds, plain-data walk, duplicate-key scan, freeze and raw-byte
   digest are all shape-independent and reusable as they stand (R-1). Only the version gate, the
   `supported` tuple and the validator body are version-1 specific.
4. Two diagnostic weaknesses exist today and #272's "useful safe diagnostics" box reaches them:
   an unknown key is reported at its parent path without saying which key, and a missing required
   key cascades into a second `wrong-type` problem at the same path (R-5, PROBE-1).
5. The v1 rules that must survive in fleet form are enumerable: certifies discipline and
   self-certification, relay-evaluator approval, deep-research native-only restriction, lane
   constraints, reserved family names, placements totality, and the per-tier "every implementation
   candidate has a certifying seat" check (R-4). The v1 rules that have no fleet analogue are also
   enumerable: chain primaries, fallback triggers per step, declared effort escalations, and the
   escalation comparability rule.
6. Placements are consumed by wire id at generate time (`adapter.ts:284`), so a version-2 document
   must keep placement references in wire-id space or the `ctx.llm` seam changes (C-10). Version 2
   needs both a CLI-key namespace for cells and a wire-id namespace for launches, which is the S-2
   spike step 1 handed to this step.

Executed in this worktree on 2026-09-07: `pnpm install --frozen-lockfile` (exit 0),
`pnpm --filter @rickylabs/routing... run build` (exit 0), `pnpm --filter @rickylabs/routing run test`
(205 pass, 0 fail), three parser probes over the built package, and one extraction script over the
fresh CLI JSON. All output went to gitignored paths; `git status` shows only this run directory.

## Question and method

Question: what must the versioned schema look like so that one loader validates the complete
fleet shape strictly, while the shipped version-1 documents and their consumers keep working
unchanged, and so that no consumer can load a fleet document and misread it as a lane table
before #273 teaches the resolver to read cells.

Three legs, each held to the citation bar in `AGENTS.md`:

- Repo leg: `packages/routing/src/*.ts` and `config/routing.v1.json` at head; the three production
  consumers in `dsh-app` and `llm-local`; the compiled-policy and snapshot gates; CI; the docs that
  describe the matrix. Read in full, cited by path and line.
- Document leg: issues #270, #272, #273, #274, #275, #148 and #181 via `gh issue view` on
  2026-09-07; the prior run `routing-configuration--271` in full (plan, research, drift,
  disposition, evaluations, implementation, verification, worklog); `doctrine/WORKFLOW.md`,
  `doctrine/PRINCIPLES.md`, `AGENTS.md`, `supervisor.md` of this run.
- External leg: the fresh CLI files the coordinator retained in this run directory,
  `matrix-plan.json` and `matrix-full.json`, both `agentic:matrix --json` at NetScript source
  `8ba53bc50ca02aab29e99ba5362728839b8f1713`. The CLI was not executed in this worktree; NetScript
  source was not read. Facts were extracted from the two JSON files by a script (external leg
  below), not transcribed by hand.

Not read, by instruction: `.env`, vendor auth files, credential files, host services, sibling
checkouts. No board mutation, no dispatch, no push.

[source: `AGENTS.md:110-121`; topic: citation bar and no-silent-decisions constraint; consulted 2026-09-07]
[source: `.llm/runs/routing-schema--272/supervisor.md:3-9`; topic: this run's scope, baseline and mutation surface; consulted 2026-09-07]

## Authority and boundary

Ratified decisions inherited from #30 (`AGENTS.md:77-96`): plugin-only over published dsh; Node +
pnpm with netscript behind an adapter, never a build dependency; GitHub is board truth; this
repository is the dsh layer only and `contracts` is published. Nothing here touches the
published contract.

The owner boundary for E11, quoted from #270: compiled architecture is "resolver, structural
schema/validation, evaluator independence and certifies discipline, evaluation loops, capability
detection"; configuration is "model identifiers and family bindings, efforts, tiers, roles' route
cells, lanes' tier/role mappings, subscriptions/accounts, provider precedence, CLI version
requirements and policy parameters". "Empty cells and policy values such as none and
unspecified_by_owner must remain explicit rather than filled or coerced." "Do not use the step
boundary to introduce a permissive, silently ignoring loader. Downstream routing is only usable
when its exact required semantics pass, not when an empty loader exists."

#272's six boxes, in the order the issue lists them: (1) tier-by-role cells with ordered
default/fallback candidates and explicit empty cells, references validated without compiled
identifiers or efforts; (2) certifies, per-tier evaluation loops (caps, repair, notify, escalate,
same-session), coordinator matrix by scope, provider precedence, lane-to-tier/role mapping; (3)
deep-research restrictions, owner-selected UI/UX specialisation with incidental UI staying
implementation, privileged-tier authorization by owner or milestone coordinator, owner overrides
requiring worklog evidence and retaining independence; (4) the CLI's nonnumeric policy states
preserved and validated, not replaced by invented caps; (5) unknown keys, duplicate or dangling
references, invalid values and unsupported versions rejected loudly with useful safe diagnostics;
(6) tests over fleet-shaped and tailored documents plus adversarial input, with no model, tier or
effort constant reintroduced in TypeScript.

The supervisor adds: separate schema support from #273 resolution, #274 detection and #275 parity;
fit the actual CLI shape; represent missing export fields without pretending the CLI printed them;
no compiled model/tier/effort/account/route values; wholesale replacement only; no silent unknown-key
discard; no public contract or version claim from an internal schema change.

[owner — configuration-driven routing directive; topic: architecture/configuration boundary and five-step DAG; received 2026-09-07; https://github.com/rickylabs/harness/issues/270]
[owner — step 2 brief; topic: fleet-expressive schema scope and acceptance; received 2026-09-07; https://github.com/rickylabs/harness/issues/272]
[source: `.llm/runs/routing-schema--272/supervisor.md:7`; topic: separation from later steps and publication boundary; consulted 2026-09-07]

## Repository findings

### R-1 — The shipped loader, and which parts are shape-independent

`packages/routing/src/load.ts` and `src/schema.ts` at head implement step 1 as evaluated PASS at
`0832419` (`.llm/runs/routing-configuration--271/implementation-eval.md:3-5`).

Shape-independent, reusable as they stand:

- Five refusal kinds with fixed codes and structural paths only (`load.ts:11-16`); `describeLoadRefusal`
  renders codes and paths and never a document value (`load.ts:118-122`).
- Bounds before validation: 1 MiB, depth 16, 4,096 members per collection (`schema.ts:8-10`);
  token-level depth cap before `JSON.parse` (`load.ts:23-31`); duplicate JSON keys refused from the
  token stream (`load.ts:32-64`, `:80-81`); source-id primitive checks (`load.ts:66-70`).
- The plain-data walk that refuses accessors, proxies, cycles, non-plain prototypes, holes and the
  reserved keys `__proto__`, `constructor`, `prototype` before any value is read (`schema.ts:136-171`).
- Structural clone and recursive freeze of the validated value (`schema.ts:172-178`, `:332`), and
  the loaded envelope frozen too (`load.ts:84-87`).
- Raw-byte SHA-256 over the parsed text, computed by the parser and never accepted from a caller
  (`load.ts:85`); byte count and the document's own `name` in `source` (`load.ts:19`, `:86`).
- Field paths: schema-owned names print as names, dynamic keys print as indices
  (`schema.ts:122-133`). This is the convention a version-2 validator must keep for role, scope,
  provider and model keys, which are all dynamic.
- The nonblocking descriptor open and bounded read in the file loader (`load.ts:90-116`).

Version-1 specific:

- The gate `root.schemaVersion !== SCHEMA_VERSION` with `SCHEMA_VERSION = 1` and `supported: [SCHEMA_VERSION]`
  (`schema.ts:7`, `:188-190`); the refusal type says `supported: readonly [1]` (`load.ts:14`);
  `LoadedRoutingConfiguration.source.schemaVersion: 1` (`load.ts:19`); the test pins `supported: [1]`
  (`load.test.ts:204-205`). `SCHEMA_VERSION` is imported nowhere else in the workspace (grep over
  `packages/*/src` on 2026-09-07 returns only `schema.ts:7,188-189`).
- The validator body (`schema.ts:181-335`): root key set (`:231`), families and reserved names
  (`:234-235`), the effort ladder (`:236-240`), purposes with the `evaluation` keyword (`:241-242`),
  models keyed by wire id (`:245-254`), lanes with chains (`:255-281`), tiers as implement/review
  pairs (`:282-289`), constraints (`:290-297`), deep-research lanes (`:298-302`), depth (`:303-304`),
  placements with explicit totality (`:305-330`), then `checkPolicy` invariants (`:333`).
- The invariants in `resolve.ts:254-315`: `PolicyCode` is a closed 17-member union (`:254-258`),
  `PolicyProblem` carries `code`, a structural location in `lane`, and an optional `index` (`:259-263`).

[source: `packages/routing/src/load.ts`, `src/schema.ts`, `src/resolve.ts` at `8fd096d`; topic: reusable loader mechanism versus version-1 specifics; inspected 2026-09-07]

### R-2 — Every production read of a loaded configuration

Grep over `packages/*/src` excluding tests on 2026-09-07 for `harnessRouting`, `.configuration`,
`placements`, `parseRoutingDocument`, `loadRoutingConfiguration`, `LoadedRoutingConfiguration`:

| # | Site | Reads | Consequence for a second version |
|---|---|---|---|
| C1 | `packages/dsh-app/src/plugins/routing.ts:13` | `RoutingService = LoadedRoutingConfiguration`; `createService` loads any path (`:24-26`) and throws `RangeError(describeLoadRefusal(...))` on refusal | Provides whatever the loader accepts. If the loader accepts version 2, the service carries it; nothing here reads a section. |
| C2 | `packages/dsh-app/src/plugins/llm.ts:111` | `routing.configuration.placements` into `LocalLlmAdapter` | Needs `placements` on both versions, or a version-agnostic accessor. |
| C3 | `packages/dsh-app/src/dry-run-internal.ts:68-69` | `parseRoutingDocument(routing.text, routing.source)`; refuses `routing-unusable` on failure | Unchanged; loader refusals stay the first gate. |
| C4 | `packages/dsh-app/src/dry-run-internal.ts:89` | `admitDispatch(loaded.loaded.configuration, dispatch, { lane })` | `admitDispatch` walks `configuration.lanes[].chain` (`admit.ts:70-72`). A fleet document has no chains. This is the exact site of the "loader success, consumer misinterpretation" gap. |
| C5 | `packages/dsh-app/src/dry-run-internal.ts:101` | `loaded.loaded.source.digest` into `inputRevision` | Unchanged; digest is version-agnostic. |
| C6 | `packages/dsh-app/src/llm/adapter.ts:136`, `:199`, `:284` | `PlacementConfiguration` through `requirePlacements`; `placementOf(this.placements, options.model, backend)` | The `model` compared is the caller's generate-time model string, a wire id today (`options.model`). |
| C7 | `packages/llm-local/src/capability.ts:64-93` | `PlacementConfiguration` shape only: `backends`, `entries[].backend/verdict/reason/requires/model` | Unchanged if the placement section keeps its shape. |
| C8 | `packages/dsh-app/src/index.ts:196` | re-exports `RoutingService`, `RoutingConfig` types | Type flows; no published contract. |

Test-side reads that will not compile against a union type without narrowing:
`packages/dsh-app/src/plugins.test.ts:330` (`configuration.lanes[0]?.chain`), and every routing suite
that passes a fixture to a version-1 function (`load.test.ts:20-45`, `resolve.test.ts`, `admit.test.ts`,
`family.test.ts`). Those pass `RoutingConfiguration` values already and need no change if the
version-1 type keeps its name.

No other workspace package imports `@rickylabs/routing` at runtime (`packages/dsh-app/package.json`
and `packages/llm-local/package.json` are the two dependency edges; `check:graph` enforces the
mirror, `scripts/check-project-graph.mjs`). The published contract carries `lane: string` and
five nullable identity strings and no routing vocabulary (`routing-configuration--271/research.md:219`).

[source: grep over `packages/dsh-app/src`, `packages/llm-local/src` at `8fd096d`; topic: consumer surface for a second schema version; inspected 2026-09-07]

### R-3 — Where version 1 cannot hold the fleet, key by key

| CLI field (`matrix-full.json`) | Version-1 field | Gap |
|---|---|---|
| `tiers[].tier`, order of five | `tiers[].tier` (`schema.ts:110`), four names in `routing.v1.json:682-702` | Same key, different record shape: v1 pairs a tier with two lane names; the fleet pairs a tier with eight cells and three loop policies. Reusing the key `tiers` for the new shape means a v1-typed reader of a v2 document sees `implement`/`review` absent (C-9 below). |
| `tiers[].<role>` eight cells of `{model, effort}[]` | none; v1 routes live in `lanes[].chain[].route` with harness, transport, model, effort, router, profile, preset (`schema.ts:25-36`, `:53-64`) | Cells carry only a model key and an effort. Harness, transport and credential binding must come from somewhere else in v2: per-model launch records plus provider precedence. |
| candidate `model` keys, 17 | `models` keyed by wire id (`schema.ts:106`; `routing.v1.json:38-79`) | Different namespace (271 research C-3, spike S-2). v2 must hold both. |
| candidate `effort` incl. `provider_default` | `efforts.ordered` + `unordered` (`schema.ts:104`) | Already expressible (271 D-5). |
| empty cells `simple.plan`, `simple.plan_evaluation` | chains must be non-empty (`schema.ts:264`) | v2 cells must allow `[]`. |
| repeated candidate in `complex.implementation_evaluation` | no rule against identical steps; `duplicate-primary` is about certifies (`resolve.ts:285`) | v2 must accept repeats verbatim (`routing-configuration--271/coordinator-disposition.md:50`). |
| `planPolicy`, `implementationPolicy`, `documentationPolicy` | none; `policy.maxFallbackDepth` only (`schema.ts:113`) | New section; values are numbers or the three words. |
| `coordinators` by scope | none | New section. |
| `transportPriority` seven names | `TRANSPORTS` is the two-member relay kind (`schema.ts:11`); `HARNESSES` six executor names (`subagents/src/dispatch.ts:63-70`) | New section; names are providers, not transports or harnesses (271 D-4, C-8). |
| `mode`, CLI `schemaVersion: 1` | n/a | Query-shape metadata, not configuration; and the CLI's version number is its own (C-1). |

[source: `.llm/runs/routing-schema--272/matrix-full.json`; `packages/routing/src/schema.ts:25-115`; `packages/routing/config/routing.v1.json`; topic: field-by-field gap between the fleet shape and version 1; inspected 2026-09-07]

### R-4 — Version-1 rules to carry forward, and rules with no fleet analogue

Carry forward in fleet form (each is an invariant or structural rule at head):

| Rule | Where it lives today | Fleet form |
|---|---|---|
| Evaluation steps declare `certifies`; non-evaluation steps may not | `resolve.ts:277-279`; keyword `evaluation` at `schema.ts:15` | Roles declare certification; cells of a certifying role need no per-candidate field. |
| A seat may not certify its own family | `resolve.ts:28-31`, `:281` | Independence is computed per tier from families; the static check is "every generating candidate has a different-family evaluator in the paired cell". |
| Every implementation step, including fallbacks, has a certifying seat | `resolve.ts:34-50`, `:310-312`; test `resolve.test.ts:356` | Same, over cells: fallback candidates count. |
| Relay evaluators must be approved | `resolve.ts:280`; `family.ts:133-135`; `approvedRelayEvaluator: true` only (`schema.ts:253`) | Per model; static check against the model's lawful launches. |
| Deep research runs native-only on named harnesses | `schema.ts:298-302`; `routing.v1.json:705-715` (`transports: ["native"]`, `harnesses: ["agy","codex","codex-run"]`) | Role-level restriction; checked against the candidate model's launches. |
| Lane constraints on transports, harnesses, families, models | `schema.ts:75-81`, `:290-297`; `resolve.ts:298-304` | Role-level restrictions, same field shape plus providers. |
| Families cannot be `any` or `none` | `schema.ts:235` | Same; scope names cannot be the authority keyword either. |
| Opencode needs a router, nothing else may carry one; relay outside opencode needs a profile | `resolve.ts:288-291` | Per launch record. |
| Placement references, duplicate pairs, explicit totality | `schema.ts:305-330` | Unchanged shape; references move to launch ids (C-10). |
| Effort ladder with unordered members | `schema.ts:104`, `:236-240` | Unchanged. |
| Subscription keyword per route | `schema.ts:13`, `:59`; `resolve.ts:181` | Per launch record, optional. |

No fleet analogue, deliberately not carried into version 2:

- Chain primaries and `first-step-not-primary`, `duplicate-primary`, `no-primary`, `author-family-required`
  (`resolve.ts:70-77`, `:100-122`, `:282-287`, `:306`): cell order is the fallback order; there is
  no trigger-gated step.
- Fallback triggers per step (`when`, `FALLBACK_TRIGGERS`, `schema.ts:12`, `:56`): the CLI prints no
  trigger vocabulary (271 research L12). Whether #273 keys cell fallback on the same six triggers
  is #273's decision; the schema must not pre-empt it by attaching triggers to candidates.
- Declared effort escalations and `escalation-not-raising`/`escalation-not-comparable`
  (`schema.ts:46-50`, `resolve.ts:292-297`): not exported; a cell candidate is one effort.
- `tierPlan` and `tier-unresolved` (`resolve.ts:216-230`, `:308-309`): a v1 mechanism over lane pairs.
- `purposes` (`schema.ts:105`): the role declarations replace lane purposes.

[source: `packages/routing/src/resolve.ts:28-50,254-315`, `src/schema.ts:11-15,75-81,235-330`, `config/routing.v1.json:682-740`; topic: invariant inventory for carry-forward; inspected 2026-09-07]

### R-5 — Diagnostics at head: safe, not yet fully useful

PROBE-1 (external leg) fed the CLI export to the shipped parser. The 133 problems are all safe:
no key name, value, OS text or parser text appears. Two patterns reduce their usefulness:

- `unknown-key at $` three times and `unknown-key at tiers[0]` twelve times. `obj()` reports every
  unknown key at the parent path (`schema.ts:197`), so a reader cannot tell which of the three
  root keys, or which of the twelve per-tier keys, was unknown. The existing test pins this path
  (`load.test.ts:216-217`: `"$"` and `"lanes[0].chain[0]"`).
- `missing-key at name` followed by `wrong-type at name`, and the same pair for eleven other
  root keys. `obj()` records the missing key (`schema.ts:196`), and the per-field check then
  receives `undefined` and records `wrong-type` (`:201`). The problem list roughly doubles for a
  document that is merely incomplete. The test that counts problems uses three independent
  defects that do not cascade (`load.test.ts:258-261`).

Neither pattern is a safety defect. Both are within #272 box 5 ("useful safe diagnostics") and
both are properties of helpers a version-2 validator will share. `fieldPath` already has the
convention that would fix the first: a dynamic key prints as its index (`schema.ts:131-133`).

[source: PROBE-1 output over `packages/routing/dist` built from `8fd096d`; `packages/routing/src/schema.ts:193-205`; topic: diagnostic precision; executed and inspected 2026-09-07]

### R-6 — Test and fixture conventions at head

Routing suite at head: 205 tests, 35 suites, 0 failures (executed 2026-09-07). Files:
`load.test.ts` (368 lines), `schema.test.ts` (80), `resolve.test.ts` (403), `admit.test.ts` (421),
`family.test.ts` (179), `probe.test.ts` (455, table-independent).

Conventions this step inherits:

- Fixture A is the shipped document read from disk; fixture B is an in-memory literal sharing
  nothing with A; mutations are applied to a fresh `documentB()` per case (`load.test.ts:15-45`).
- Refusal cases are a table of `[name, mutate, code, path]` with one row per rule
  (`load.test.ts:215-239`), and invariants a table of `[name, mutate, code]` (`:240-256`).
- Hostile-input and canary tests assert that no canary, key, path, note or parser text reaches any
  refusal or `describeLoadRefusal` output (`load.test.ts:268-300`).
- Wholesale replacement is proven by asking every A question of B and every B question of A
  (`load.test.ts:301-354`).
- `schema.test.ts:71-80` reads fixture A and asserts that none of its model keys, lane names, tier
  names or the two CLI version strings appears in any non-test runtime source, after stripping
  comments. It is data-driven from A.
- The AST gate `scripts/check-compiled-policy.mjs` flags any string-literal initialiser of a
  property or variable named `model`, `effort`, `tier`, `lane`, `family`, `profile`, `preset` or
  `harness` in a non-test `.ts` file (`:8`, `:41-58`), with an exact-file allowlist (`:11-25`) and a
  mutation self-test on every run (`:67-77`). A fleet-shaped fixture written as a TypeScript object
  literal in a non-test file would trip it on every `model:` and `effort:`; the existing test-only
  fixture needed an allowlist entry (`:23`). A fixture in JSON, or in a `*.test.ts` module, does not.
- The dry-run fixture reads the shipped JSON text at import time (`packages/dsh-app/src/dry-run-test-fixtures.ts:2`)
  and expects `dispatch-inadmissible` for an Astra dispatch under `complex_implementation`
  (`dry-run.test.ts`, lane at `dry-run-test-fixtures.ts:20-23`). The dry-run suite proves that an
  unusable `routing` value refuses before any store read (`dry-run.test.ts:168`), and that a plan
  carrying a forged `digest` is `source-unusable` (`:163-165`).
- Plugin tests boot `harness-routing` with the package specifier and with a temp path, and assert
  frozen configuration, digest shape, and a safe `RangeError` message on malformed content
  (`plugins.test.ts:320-346`).

[source: files cited; topic: fixture, table and gate conventions; inspected and executed 2026-09-07]

### R-7 — Gates that can run here

- CI runs `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run build`, `pnpm test`
  (`.github/workflows/ci.yml:53-63`). `build` chains `check:graph`, `check:lifecycle`,
  `check:links`, `check:forms`, `check:snapshots`, `check:compiled-policy`, every package build,
  `check:publish`, `check:label-registry`, `check:docs`, `check:skill`, `check:tutorial`
  (root `package.json`, `build` script).
- `check:snapshots` refuses any tracked `.json`/`.yml` carrying a time-sliding key from the list at
  `scripts/check-snapshots.mjs:41-72` (`allowance*`, `balance*`, `credit*`, `observedAt`, `probedAt`,
  `*remaining*`, `reset*`, `spend*`, `tokens*`, `window*`) or a file name matching `allowance`/`quota`
  (`:75`, `:112`). None of the CLI policy keys (`maxRounds`, `notifyOwnerAfter`, `escalateToOwnerAt`,
  `repairInFlightAt`, `reSteerSameSession`) nor any field name in `plan.md`'s design is on that
  list; the prior run's tracked `matrix-full.json` already passes it
  (`routing-configuration--271/verification.md`, "70 tracked data files, including ... fresh
  implementation matrix").
- `check:compiled-policy` (R-6) runs in `build`; the routing package's own literal scan runs in
  `pnpm --filter @rickylabs/routing run test`.
- The routing package is private (`packages/routing/package.json:6`), publishes `./config/*.json`
  and ships `dist` and `config` (`:10-20`). A directory outside `config/` and `dist/` is neither
  exported nor packed, which is where a test-only fixture belongs.

[source: `.github/workflows/ci.yml:53-63`, root `package.json`, `scripts/check-snapshots.mjs:41-75`, `packages/routing/package.json:6-20`; topic: executable gates and package boundary; inspected 2026-09-07]

### R-8 — The independence rule is family string equality, family is opaque

`checkEvaluator` refuses same-run, unpinned models, `certifies: none` as a gate, same family even
under `certifies: any`, a seat bound to another family, and an unapproved relay evaluator, in that
order (`family.ts:104-138`). The coordinator's `Actor.family` is "an opaque token. Compared for
equality and never parsed" (`packages/coordinator/src/independence.ts:49-53`). Version 2 changes
neither; it only supplies families for models keyed by CLI key, and its static invariant asks the
same question of cells that `unreviewedSteps` asks of chains.

[source: `packages/routing/src/family.ts:104-138`, `packages/coordinator/src/independence.ts:40-60`; topic: independence semantics that version 2 must not alter; inspected 2026-09-07]

## Document leg

- #270 (epic): the boundary quoted above; "supported routes follow the tool"; "Empty cells and
  policy values such as none and unspecified_by_owner must remain explicit"; the current full JSON
  "does not export every model capability or every hard rule"; "Step 5 must report export coverage
  honestly ... do not claim full parity for fields the tool never printed or hand-transcribe them
  from source"; completion bar includes "No executable fallback to the old compiled table or
  per-field merge of matrices remains" and "A second project configuration replaces the fleet
  document completely and resolves without any residual fleet choices".
- #272 (this step): the six boxes; "not the legacy four-by-two table"; "without compiling
  identifiers or efforts"; "Reject unknown keys, duplicate or dangling references, invalid values
  and unsupported schema versions loudly with useful safe diagnostics".
- #273 (step 3, depends on #272): "Route each named lane through loaded tier and role data";
  "Resolve ordered candidates, allowed efforts, provider precedence and fallbacks from the active
  configuration only"; "Select the first evaluator whose family differs from the actual selected
  generator, including after generator fallback. Throw when none exists; never ... treat
  certifies:any as permission for self-review"; "Enforce configured evaluation loop
  caps/repair/notify/escalate behavior and owner-override worklog requirements"; proves #181.
  Everything that reads a cell to pick a route is #273's.
- #274 (step 4, depends on #271 only): "Configure account/subscription bindings, per-model/per-family
  rules, provider precedence and client-version constraints; precedence wires into the resolver
  through data"; "Provide the backend with a versioned configuration/detection contract". Step 2
  must give provider precedence a home in the document; step 4 wires it and adds accounts.
- #275 (step 5): compares "every exported tier/role candidate, order, effort, empty cell, loop
  policy, coordinator scope and provider precedence"; "Cosmetic normalization must not hide semantic
  differences"; "Audit coverage for model capabilities and hard rules not exposed by today's full
  JSON ... fail incomplete coverage rather than hand-transcribing source"; "Prove a project-tailored
  document replaces the fleet instance wholly". Step 2's mapping table and export-gap list are inputs
  to that audit.
- #148: the owner "selects Muse Spark 1.3 at max for planning and plan evaluation, in separate
  sessions. Record the scope and non-empty rationale for the privileged tier. Author the site
  through the documentation lane. Max must not be used for implementation or documentation
  writing." Blocked "until its exact configured lanes are expressible and validated".
- #181: complex implementation "seats Astra medium and Fable 5.1 medium, with Muse Spark 1.3 max
  as the implementation evaluator. Muse is meta, distinct from both generator families"; the defect
  is the static `certifies:openai` seat; close only with the correcting merge commit under #273.
- Prior run `routing-configuration--271`: spike S-2 (CLI key namespace) and S-3 (the fleet shape,
  including the rule that repeated ordered candidates are authoritative and must be neither
  deduplicated nor rejected) are assigned to #272 (`plan.md:775-787`); D-4 separates the relay-rule
  transport kind from provider precedence (`plan.md:166-186`); D-11 fixes fixtures as in-memory
  literals with the shipped default as the only tracked JSON (`plan.md:280-286`); research C-10
  records the policy word/number mix (`research.md:442-445`); the coordinator's clarification on
  duplicates (`coordinator-disposition.md:50`); the plan evaluation demanded that unreadable-path
  diagnostics never carry a location (`plan-eval-round1.md:217`), which any new refusal must honour.

[observed — https://github.com/rickylabs/harness/issues/270, /272, /273, /274, /275, /148, /181; topic: step boundaries and dependents; retrieved 2026-09-07 via gh]
[source: `.llm/runs/routing-configuration--271/{plan,research,coordinator-disposition,plan-eval-round1}.md`; topic: hand-offs to step 2; consulted 2026-09-07]

## External leg — the fresh CLI files

Both files are `agentic:matrix --json` output at NetScript source
`8ba53bc50ca02aab29e99ba5362728839b8f1713` per `supervisor.md:12`. Their digests, computed here:

    sha256 44807db43ef19c14ac92e08fd5bf8bce89a5d38c7a19aba75db9d37ef4c70ac9  matrix-full.json
    sha256 d2b07dc36398e9a986af388d7d529aaa99b16cfd0de78290f8489b49aa73006f  matrix-plan.json

`cmp` shows `matrix-full.json` byte-identical to the copy the prior run retained, and
`matrix-plan.json` byte-identical to the prior run's `matrix-architecture.json`. The fresh query
at the same source produced the same bytes; this run cites its own copies.

Facts extracted by script on 2026-09-07 (the script iterated the JSON; nothing below was typed
from memory):

- Root keys, exactly: `schemaVersion` (value `1`), `mode` (`full`), `tiers`, `coordinators`,
  `transportPriority`. No other key at any tier: every tier object holds exactly `tier`,
  `description`, the eight role keys, `planPolicy`, `implementationPolicy`, `documentationPolicy`.
- Tiers, in order: `simple`, `straightforward`, `feature`, `complex`, `architecture`.
- Roles, as keys on every tier, in printed order: `implementation`, `ui_ux`, `plan`,
  `plan_evaluation`, `implementation_evaluation`, `vision_evaluation`, `documentation`,
  `deep_research`. Every candidate object has exactly the keys `model`, `effort`.
- 76 populated candidates; two empty cells, `simple.plan` and `simple.plan_evaluation`; one cell
  with an exact repeat, `complex.implementation_evaluation` = `muse_spark_1_3/max`, `muse_spark_1_3/max`.
- 17 model keys across cells and coordinators: `astra`, `deepseek_v4_flash`,
  `deepseek_v4_flash_vision`, `deepseek_v4_pro`, `fable_5_1`, `gemini_3_8_flash`, `glm_5_3`,
  `glm_5_3_flash`, `grok_4_6`, `kimi_k3`, `luna`, `minimax_m3`, `muse_spark_1_3`, `opus_5`,
  `qwen_3_8_flash_next`, `qwen_3_8_max`, `sol`. Coordinators add no key beyond these.
- Six effort values: `low`, `medium`, `high`, `xhigh`, `max`, `provider_default`.
- Policy fields and the types they hold, over all fifteen policy objects: `maxRounds` number or
  the strings `none` (simple plan) and `unspecified_by_owner` (simple implementation);
  `repairInFlightAt` number (feature 2, complex 3) or the string `immediate` (straightforward plan);
  `notifyOwnerAfter` number only (2 or 3); `escalateToOwnerAt` number only (architecture plan, 2);
  `reSteerSameSession` boolean, `true` in all fifteen. `maxRounds` and `reSteerSameSession` appear
  in every policy; the other three appear in some. `maxRounds` is `0` in straightforward plan.
- Coordinators: `small_project` = luna/max, opus_5/low; `project` = sol/medium, opus_5/medium;
  `framework` = astra/low, opus_5/xhigh; `milestone` = astra/medium, fable_5_1/medium, opus_5/xhigh.
- `transportPriority`: `claude`, `codex`, `agy`, `github_copilot`, `opencode_go`, `ollama`, `openrouter`.
- `matrix-plan.json` is `mode: "tier"` with one tier whose object deep-equals the `architecture`
  tier of the full file (verified by string comparison of the serialised objects).
- The prior run's role-mode files show a third CLI shape: `mode: "role"`, a top-level `role`, and
  per tier `routes` plus a single `policy` (`routing-configuration--271/matrix-plan-evaluation.json`).
  Only full mode is the parity input (#275); the schema does not model query modes.

Parser probes over the built package (`node --input-type=module` importing
`packages/routing/dist/index.js`, executed 2026-09-07):

- PROBE-1: `parseRoutingDocument(<matrix-full.json text>, "matrix-full")` → `invalid` with 133
  problems: twelve `missing-key` root fields, three anonymous `unknown-key at $`, twelve anonymous
  `unknown-key at tiers[i]` per tier, `missing-key` for `implement`/`review` per tier, plus the
  cascaded `wrong-type` twins. Not `unsupported-schema-version`: the CLI's `schemaVersion: 1`
  satisfies routing's version-1 gate and then fails every structural rule.
- PROBE-2: `{ "schemaVersion": 2, "name": "x" }` → `{ kind: "unsupported-schema-version", seen: 2, supported: [1] }`.
- PROBE-3: fleet-shaped keys under `schemaVersion: 1` → `invalid` (missing v1 keys, anonymous
  unknown keys). The loader never infers a version from shape.

[observed — `.llm/runs/routing-schema--272/matrix-full.json` and `matrix-plan.json`, NetScript source 8ba53bc50ca02aab29e99ba5362728839b8f1713; topic: tiers, roles, candidates, efforts, policy value types, coordinators, precedence; extracted by script 2026-09-07]
[observed — PROBE-1 to PROBE-3 against `packages/routing/dist` built from `8fd096d`; topic: shipped loader behaviour on fleet input and a version-2 stub; executed 2026-09-07]

### Export coverage: what the CLI prints, and what it does not

Exported by the full CLI JSON, and therefore comparable by #275 and copyable verbatim into a
fixture: tier names and order; tier descriptions; role names and order; every cell's ordered
candidates including empties and repeats; candidate efforts; the three loop policies per tier
with their exact keys and values; coordinator scopes and candidates; provider precedence.

Not exported, so each is an export gap for #275 and a schema field whose fleet values this run
does not know and does not invent:

| Gap | Why the schema needs it anyway | Owner |
|---|---|---|
| E-1 model family per key | Independence is family equality (R-8); #181 says Muse is `meta` | #275 export support, owner data |
| E-2 wire/launch id per model per provider | Dispatch and admission compare wire ids (`admit.ts:283`, `family.ts:111-119`); placements are keyed by them (C-10) | #274/#275 |
| E-3 which providers can carry which model, on which harness and transport | A cell names a model; a dispatch needs a harness and transport | #274 detection, #275 |
| E-4 capabilities (vision, deep research) | `vision_evaluation` and `deep_research` roles presuppose them; "validate model/family/capability references" (#272 box 1) | #275 |
| E-5 role semantics: which roles certify, which generation roles they evaluate, which are supplementary | Certifies discipline (R-4) | project-declared; #275 must audit against NetScript's own rules |
| E-6 effort ladder order and non-ordinal members | `provider_default` is printed but not placed on a ladder | project-declared; #275 |
| E-7 deep-research restrictions (native-only, harness list) | v1 rule (R-4); "deep-research restrictions" (#272 box 3) | #275 |
| E-8 UI/UX owner-selection rule | #272 box 3 | #275 |
| E-9 privileged-tier authorization (which tiers, by whom) | #272 box 3, #148 | #275 |
| E-10 owner-override evidence rule | #272 box 3, #270 | structural plus declared evidence kinds |
| E-11 relay-evaluator approvals | v1 rule (R-4) | #275 |
| E-12 subscription/account per launch, CLI version requirements | #274 | #274 |
| E-13 lanes and their tier/role mapping | Lanes are Harness's dispatch surface (#270: "Lanes remain the dispatch surface"), not a CLI concept | project-declared; not a parity dimension |

## Contradictions and findings surfaced, not resolved

- C-1 Two version numbers named `schemaVersion`. The CLI export declares `schemaVersion: 1` for
  its own shape; routing's document declares `schemaVersion: 1` for the legacy shape. PROBE-1 shows
  the collision is harmless but confusing: a CLI file is refused as `invalid`, never as the wrong
  version. Routing's version 2 has no relation to any CLI number; #275 maps between them.
- C-2 `supported: readonly [1]` is a type in `load.ts:14` and a value pinned by tests
  (`load.test.ts:204-205`). Widening it to `[1, 2]` is an internal type change inside a private
  package that flows into `dsh-app`'s `DriveRefusal` (`dry-run.ts:41`) without touching any
  published contract.
- C-3 Diagnostic precision (R-5) versus "useful safe diagnostics" (#272 box 5). Fixing the two
  patterns changes the paths of two existing assertions and shortens problem lists; refusal kinds
  and codes do not change.
- C-4 Loop thresholds above caps. The architecture plan policy has `maxRounds: 1` and
  `escalateToOwnerAt: 2`. Any cross-field rule such as "threshold at most the cap" would refuse the
  fleet's own export. The schema must validate each field's type and range and nothing across them.
- C-5 A loop policy for an empty cell. `simple.plan` is empty while `simple.planPolicy` exists with
  `maxRounds: "none"`. The schema must allow a policy for a role whose cell in that tier is empty.
- C-6 `max` prose versus CLI. #148 says max must not be used for implementation or documentation
  writing; the CLI prints `simple.implementation = luna/max` and #270 says supported routes follow
  the tool. The schema encodes no effort prohibition per role; the owner's site selection lives in
  #148's own lane choice.
- C-7 Family granularity is unknown for the fleet's open-weight models. Version 1 binds qwen, glm,
  grok and kimi to one family `open` (`routing.v1.json:65-79`). The fleet also seats deepseek and
  minimax models. Whether those are one family or several is not exported (E-1) and decides
  whether, for example, `simple.implementation`'s second candidate `qwen_3_8_flash_next` has a
  different-family evaluator among `minimax_m3` and `deepseek_v4_flash`. This is a #275 data
  question; a static independence invariant will refuse a fleet instance whose bindings make a
  tier unsatisfiable, which is the loud failure the owner asked for rather than something the
  schema should soften.
- C-8 Providers versus harnesses. Seven provider names; six harness names (`dispatch.ts:63-70`)
  that cannot spell `github_copilot`, `ollama` or `opencode_go`; two transport kinds. A version-2
  provider is data with a seam; a launch record names a harness only where one exists. Growing
  `HARNESSES` is E3's decision, not this step's.
- C-9 The key `tiers` would hold different record shapes in version 1 and version 2 (R-3). A
  version-1 reader given a version-2 document would find `implement` undefined and, through
  `lanePolicy(configuration, undefined)`, report `tier-unresolved` or `unknown-lane`: fail-closed
  by accident, with a misleading diagnostic. The boundary must be a type and a coded refusal.
- C-10 Placement references. `placementOf` matches the caller's generate-time model string
  (`adapter.ts:284`), a wire id in every current caller and test. If version 2 keyed placements by
  CLI key, every `ctx.llm` caller and the adapter would change. Keeping placements in wire-id space
  keeps `llm-local` and the adapter untouched and makes the placement section byte-compatible
  across versions.
- C-11 Version-1 fixtures are in-memory literals by prior decision (271 D-11), while a
  fleet-shaped fixture with 76 candidates is best kept as data that can be diffed against the CLI
  file and cannot trip the AST gate (R-6). The two conventions coexist if the fleet fixture is JSON
  outside `config/`.

## Unknowns reported to the coordinator

- U-1 Whether #274 will extend version 2 with optional account sections or bump to version 3. Not
  decided here; the plan records the rule that version 2's sections are all required so that
  absence never means a default, and leaves #274 its own versioning call.
- U-2 Whether #273 will retire version-1 support once consumers read cells. The plan keeps both
  versions loadable and defers retirement.
- U-3 The fleet instance's family bindings and launch ids (E-1, E-2). The plan's fixture uses
  labelled synthetic values for those fields; the parity gate must obtain them from the owner or
  from CLI export support.

## Actual checks executed in this run

| Command or probe | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0; bin-link warnings for not-yet-built CLIs only; `node_modules` gitignored |
| `pnpm --filter @rickylabs/routing... run build` | exit 0 (routing and subagents) |
| `pnpm --filter @rickylabs/routing run test` | exit 0; 205 pass, 35 suites, 0 fail/skip |
| PROBE-1/2/3 (`node --input-type=module` over `packages/routing/dist`) | as recorded in the external leg |
| CLI JSON extraction script | as recorded in the external leg |
| `cmp` of both fresh matrix files against the prior run's copies | identical |
| `git status --short` after all of the above | only `?? .llm/runs/routing-schema--272/` |

Not executed: the full workspace build and test sweep (not needed to plan; recorded so no one
reads a routing-only receipt as a workspace receipt), the matrix CLI, any NetScript source read,
any board or host operation.

[source: this worktree at `8fd096d`; topic: executed evidence for planning; executed 2026-09-07]
