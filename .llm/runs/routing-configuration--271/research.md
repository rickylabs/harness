# routing-configuration--271 — research

Stage B/C artifact for issue #271 (step 1 of E11, #270). Bounded architecture planning only:
no product code, no board mutation, no dispatch. Written against baseline commit
`4c813fe10218e471f5d78a2dc45bd805ec260749` on branch `feat/271-routing-configuration`.

## Summary

Step 1 replaces two compiled files with a loader. Today `@rickylabs/routing` is the single
routing authority and it is entirely compiled: 14 model pins with families, 23 lanes carrying 40
route steps, 4 tiers, 4 lane constraints, an effort ladder, an approved-relay-evaluator list, one
credential profile name, three preset names, and a fallback-depth policy number, all as TypeScript
literals in `packages/routing/src/models.ts` and `packages/routing/src/policy.ts`. Every resolver,
admission and family function reads that module state directly, so nothing today can be asked a
question about a different matrix.

The production consumer surface is small and exact. Two workspace packages import `routing` at
runtime: `@rickylabs/llm-local` (`capability.ts` builds a model-by-backend placement table from
routing's pinned ids) and `@rickylabs/dsh-app` (the dry-run driver calls `admitDispatch`; the
`ctx.llm` adapter reads llm-local's placements). The published `@rickylabs/harness-contracts@0.1.0`
carries no routing vocabulary: a dispatch names a `lane: string` and a launch identity is five
nullable strings. It is untouched by step 1.

Seven contradictions between the compiled table and the fresh matrix CLI evidence are
load-bearing and are surfaced here rather than resolved. Four come from the architecture tier
alone: the effort vocabulary (the CLI prints
`provider_default`, which the compiled ladder cannot express), the family vocabulary (the fleet
seats a `meta` family that the compiled union lacks), the model identifier namespace (the CLI keys
models `fable_5_1`, `astra`, `luna`; the table pins launch ids `fable-5`, `gpt-6-astra`,
`gpt-5.6-luna`), and the matrix shape itself (five tiers by eight roles against four tiers by
implement/review plus 23 named lanes). The full export, which the coordinator added to this run
directory while the research was in progress, adds three more: a transport priority list whose
names Harness cannot spell, policy fields that hold a number in one tier and a word in another,
and one cell that lists the same candidate twice. Step 1 must load a document that transcribes
today's shape as data and must say, in the document and in the docs, that this is not fleet
parity.

The largest design question step 1 cannot dodge is `llm-local`: its placement table is keyed by
routing's compiled ids, so removing the ids from TypeScript forces that table to become data too,
or forces a second compiled model table. That is filed as an owner fork in `plan.md`, not decided
here.

Baseline gates run. The routing, llm-local, subagents and dsh-app suites were executed in this
worktree and pass (136, 85, 227 and 312 tests respectively); CI runs the same three commands
(`.github/workflows/ci.yml:55-63`).

## Question and method

Question: what exactly must change, and in which files, for `@rickylabs/routing` to load one
strictly validated, versioned, digest-recorded document instead of a compiled table, without a
hidden compiled fallback, without pretending fleet parity, and without breaking the two production
consumers or the published contract.

Method, three legs held to the citation bar in `AGENTS.md`:

- Repo leg: every file under `packages/routing/src`, the two consumers, the subagents contract the
  routing package builds on, the coordinator's family-opaque independence module, the forge target
  table, the scripts that gate data files, the CI workflows, the profile composition in `dsh-app`,
  and the docs that name the compiled matrix. Read in full, cited by path and line.
- Document leg: issues #270, #271, #272, #273, #274, #275, #148, #181 and the superseded #269, all
  read via `gh issue view` on 2026-09-07; `doctrine/WORKFLOW.md`, `doctrine/PRINCIPLES.md`,
  `AGENTS.md`, `packages/README.md`, `docs/concepts/02-the-two-seams.md`,
  `docs/concepts/06-the-three-layers.md`, and the prior runs `route-identity--e35` and
  `dry-run-driver--e6c` for artifact conventions.
- External leg: the fresh route evidence the coordinator retained in this run directory:
  `matrix-architecture.json` (tier mode, architecture tier) at the start of the run, and
  `matrix-full.json` (full mode) added by the coordinator while the repository leg was in
  progress; `supervisor.md`, also coordinator-written, names the coordinator as the maintainer of
  supervisor and evidence files. The matrix CLI was not executed in this worktree and NetScript
  source was not read; the two JSON files are the observations, and anything they do not print
  is cited to issue text or marked unknown.

Not read, by instruction: `.env` files, vendor auth files, netscript-agentic credential files. No
host operation was performed. Build output was written to gitignored `dist/` and `*.tsbuildinfo`
paths only (`.gitignore:5-6`).

## Authority and boundary

Ratified decisions inherited from #30 and restated in `AGENTS.md:77-96`: plugin-only over published
dsh; Node + pnpm with netscript as a service behind an adapter, never a build dependency; GitHub is
board truth; this repository is the dsh layer only and `contracts` is a published package.

The owner boundary for E11, quoted from #270: compiled architecture is "resolver, structural
schema/validation, evaluator independence and certifies discipline, evaluation loops, capability
detection"; configuration is "model identifiers and family bindings, efforts, tiers, roles' route
cells, lanes' tier/role mappings, subscriptions/accounts, provider precedence, CLI version
requirements and policy parameters". Then: "No production model, tier, effort, route, subscription
or CLI-version literals in TypeScript. At most ship a default data document, replaced wholesale
rather than deep-merged."

#271's five acceptance boxes, verbatim in spirit:

1. Load one explicit versioned document; record its source identity and digest; shipped defaults
   are data documents only.
2. Remove the production literals listed above, "including hidden compatibility defaults";
   structural architecture and schema remain code.
3. Baseline validation rejects unreadable, malformed, missing-required or unknown input rather than
   falling back to the compiled table; preserve unsupported/unknown distinctions; the full fleet
   schema is step 2.
4. Prove two disjoint project documents replace one another without retained routes, models or
   policy values.
5. Make the dependency for #148 and #181 concrete; do not call them unblocked until their required
   lane semantics are expressible and verified.

Plus the execution rules: one loader/replacement PR, no hand-added Muse stopgap, fresh matrix CLI
query before each dispatch, independent plan evaluation before mutation, humans merge, never apply
the dispatch-trigger label.

[owner — configuration-driven routing directive; topic: architecture/configuration boundary and
five-step DAG; received 2026-09-07; https://github.com/rickylabs/harness/issues/270]
[owner — step 1 brief; topic: loader/replacement boundary and acceptance; received 2026-09-07;
https://github.com/rickylabs/harness/issues/271]

## Repository findings

### R-1 — The compiled authority, as it stands

`packages/routing` is about 2,500 lines of non-test TypeScript in seven modules
(`packages/routing/README.md:10-17`). Two of them are the data:

- `packages/routing/src/models.ts` pins every model id and its family. `MODEL_IDS` (7 native ids,
  lines 52-68), `LOCAL_MODEL_IDS` (2, lines 81-86), `OPENROUTER_MODEL_IDS` (4, lines 89-94),
  `OPENCODE_MODEL_IDS` (1, lines 104-106), the relay-evaluator approval list
  `OPEN_EVALUATOR_MODEL_IDS` (lines 120-123), and the total `FAMILY_BY_MODEL` map of 14 entries
  (lines 137-152). The header states the ownership rule this run is dissolving: "`routing` is the
  single owner of model ids (#58). They are pinned here and nowhere else" (lines 4-6).
- `packages/routing/src/policy.ts` is the matrix: `LANES` (23 names, lines 49-73), `ROUTE_POLICY`
  (23 entries, 40 steps, lines 174-596), `TIERS` and `TIER_LANES` (lines 615-623),
  `DEEP_RESEARCH_LANES`, `DEEP_RESEARCH_HARNESSES` and `LANE_CONSTRAINTS` (lines 647-669), plus
  the profile and preset names `CLAUDE_OPENROUTER`, `DESIGN_PRESET`, `PLAN_EVALUATOR_PRESET`,
  `IMPL_EVALUATOR_PRESET` (lines 163-166).

The other five modules read that module state directly rather than taking it as an argument:

- `resolve.ts` imports `ROUTE_POLICY`, `TIER_LANES`, `LANE_CONSTRAINTS`, `LANES`, `lanePolicy`
  (lines 23-31); `checkPolicy()` takes no arguments and walks the live table (lines 309-425);
  `DEFAULT_MAX_FALLBACK_DEPTH = 2` is a policy parameter (line 193); `tierPlan` resolves every
  review lane against the literal family `"openai"` (line 265).
- `admit.ts` flattens the table at module load into `ALL_STEPS` (lines 133-135) and derives
  `LONGEST_NAME` at module load from `pinnedModels()`, `LANES`, `EFFORTS`, `relayProfiles()`,
  `ROUTERS`, `HARNESSES` (lines 250-257). Every query function (`routedModels`, `routableModels`,
  `transportsFor`, `relayProfiles`, `laneModels`, `declaredEfforts`) reads `ALL_STEPS` or
  `lanePolicy` (lines 155-241).
- `family.ts` reads `familyOf` and `isApprovedOpenEvaluator` (line 26) inside `checkEvaluator`
  (lines 104-138).
- `probe.ts` reads nothing from the table. Its only constants are the availability vocabulary, a
  freshness default of ten minutes (line 208) and the codex metadata-warning marker (line 217).
- `index.ts` re-exports every constant above as public API (lines 40-80).

Git provenance: the table was ported in one commit (`86ce934`, "port the delegation matrix as
data") and edited once since to seat Astra (`4712441`, PR #180), which touched `models.ts`,
`policy.ts`, `resolve.ts`, `index.ts`, the README and two test files. That is the shape of a
table edit today: a TypeScript diff with a doc-comment justification.

### R-2 — Literal inventory

Every production TypeScript literal in the six classes #271 names, with a classification. "Data"
means it moves into the document; "structural" means it stays in code as schema vocabulary or
resolver semantics; "out of scope" means it is not a routing literal and is reported to the
coordinator rather than changed here. Tests and `*.test.ts` fixtures are excluded from this table
and inventoried in R-4.

| # | Path and lines | What | Class | Note |
|---|---|---|---|---|
| L1 | `packages/routing/src/models.ts:34` | `MODEL_FAMILIES` = anthropic, openai, google, open | data | The fleet seats a `meta` family (#181: "Muse is meta, distinct from both generator families"); the compiled union cannot say it. |
| L2 | `packages/routing/src/models.ts:44` | `TRANSPORTS` = native, openrouter | structural | Transport kind decides metering and relay rules the resolver keys on (`resolve.ts:342,369`, `admit.ts:397`); it is the seam topology, not a fleet fact. Reviewable, see `plan.md` D-4. |
| L3 | `packages/routing/src/models.ts:48` | `EFFORTS` ordered ladder low..max | data | The CLI prints `provider_default` (`matrix-architecture.json`, documentation second candidate), which is not on the ladder. The order is used by the escalation invariant (`resolve.ts:374`) and admission (`admit.ts:347-349,511`). |
| L4 | `packages/routing/src/models.ts:52-68` | `MODEL_IDS` (7) | data | Lines 58-60 also carry Codex CLI version facts (0.144.3 refuses, 0.153.4 accepts) as prose. |
| L5 | `packages/routing/src/models.ts:81-86` | `LOCAL_MODEL_IDS` (2) | data | Consumed by `llm-local` for placements (R-3). |
| L6 | `packages/routing/src/models.ts:89-94` | `OPENROUTER_MODEL_IDS` (4) | data | Consumed by `llm-local` for placements (R-3). |
| L7 | `packages/routing/src/models.ts:104-106` | `OPENCODE_MODEL_IDS` (1) | data | Pinned unprefixed on purpose; the reason is a wire-format fact (`subagents/src/dispatch.ts:619-620`) and stays as schema doc. |
| L8 | `packages/routing/src/models.ts:120-123` | `OPEN_EVALUATOR_MODEL_IDS` | data | An approval list is policy: which open models may certify over the relay. |
| L9 | `packages/routing/src/models.ts:137-152` | `FAMILY_BY_MODEL` (14 bindings) | data | "family bindings" are configuration by the #270 boundary. |
| L10 | `packages/routing/src/policy.ts:34-45` | `PURPOSES` (10) | data, with one structural keyword | The set is lane classification data. The one value the resolver interprets, `evaluation` (`resolve.ts:333`), is a schema keyword that binds the certifies invariant. |
| L11 | `packages/routing/src/policy.ts:49-73` | `LANES` (23) | data | |
| L12 | `packages/routing/src/policy.ts:83-105` | `FALLBACK_TRIGGERS` (6) | structural | Trigger names are the coordinator's failure taxonomy that `resolveFallback` matches on (`resolve.ts:215`); the fleet has no such vocabulary (its conditions are free text, `policy.ts:10-16`) and the CLI export does not print one, so parity cannot compare it. Lines 101-102 carry CLI version prose that must go. Reviewable, see `plan.md` D-4. |
| L13 | `packages/routing/src/policy.ts:109-110` | `SUBSCRIPTION_STATES` = included, outside_plan | structural keyword | The resolver interprets `outside_plan` as needing explicit paid approval (`resolve.ts:219-222`). The value on each step is data; the keyword is schema. Step 4 owns account and subscription modelling and may replace it. |
| L14 | `packages/routing/src/policy.ts:163-166` | profile `claude-openrouter`, three preset ids | data | Credential profile and preset names are route literals. |
| L15 | `packages/routing/src/policy.ts:174-596` | `ROUTE_POLICY`, 23 lanes, 40 steps | data | Each step: harness, transport, model, effort, optional router/profile/preset, `when`, `certifies`, `subscription`, `effortEscalations`, `note`. |
| L16 | `packages/routing/src/policy.ts:615-623` | `TIERS` (4) and `TIER_LANES` | data | The fleet has five tiers and eight roles (#270). Step 2 owns that shape; step 1 carries the four-by-two shape as data. |
| L17 | `packages/routing/src/policy.ts:647-669` | `DEEP_RESEARCH_LANES`, `DEEP_RESEARCH_HARNESSES`, `LANE_CONSTRAINTS` | data | Constraint kinds (transports, harnesses, families, models, why) are schema; the four entries are policy. Line 663 and 667 name "GLM 5.2" in prose. |
| L18 | `packages/routing/src/resolve.ts:193` | `DEFAULT_MAX_FALLBACK_DEPTH = 2` | data | "policy parameters" are configuration by #270. |
| L19 | `packages/routing/src/resolve.ts:265` | `resolveRoute(lanes.review, "openai")` | data-derived | A family literal inside the resolver; this is the static reviewer-family divergence #181 names. Step 1 must derive it; step 3 owns generator-relative selection. |
| L20 | `packages/routing/src/admit.ts:145-148` | `INTERACTIVE_TWIN` codex-run to codex, opencode-run to opencode | structural | A fact about the executor's harness vocabulary (`subagents/src/dispatch.ts:57-70`), not about a route. |
| L21 | `packages/routing/src/admit.ts:278-299` | `KEY_SHAPES`, `ASSIGNMENT_SHAPE` | structural | Credential-shape refusal; security, not policy. |
| L22 | `packages/routing/src/admit.ts:399,405` | router `"openrouter"` as the relay's router | structural coupling | Ties transport `openrouter` to router `openrouter`; stays with L2. |
| L23 | `packages/routing/src/family.ts:31` | `SEAMS` = subagents, llm | structural | The two-seam architecture (#30; `docs/concepts/02-the-two-seams.md:22-27`). |
| L24 | `packages/routing/src/probe.ts:208,217` | `DEFAULT_FRESHNESS = "10m"`, `FALLBACK_METADATA_MARKER` | out of scope | Neither is a model, tier, effort, route, subscription or CLI-version literal. The marker is a vendor output string that step 4 detection will own. |
| L25 | `packages/subagents/src/dispatch.ts:63-70,80,83` | `HARNESSES`, `DEFAULT_HARNESS = "claude"`, `ROUTERS` | structural, out of scope | The executor's wire vocabulary, transliterated from divybot's `buildAgentCmd` (`dispatch.ts:8-16,73-80`). `ROUTERS` names provider prefixes; step 4 ("provider precedence") should decide whether router identity becomes data. Reported, not changed. |
| L26 | `packages/forge/src/targets/model.ts:99,142-154` | `DEFAULT_TARGET_AGENT = "claude"`, `accountOf` pooling opencode onto the codex account | out of scope | A deliberate transliteration of an external dispatcher's account mapping (`model.ts:131-141`). It is an account literal in TypeScript and belongs to step 4's account/subscription surface, not to routing. Reported. |
| L27 | `packages/telemetry/src/backfill/claude.ts:200` | `provider: model === null ? null : "anthropic"` | out of scope | Infers a provider from the driving CLI; over the relay this is the family-off-harness error the routing README describes (`packages/routing/README.md:24-31`). Not a routing literal; reported for E9. |
| L28 | `packages/dsh-app/dump-config.golden.yml:64-68` | dsh-base row `agent-default-model` deepseek-v4-flash | out of scope | Generated upstream composition output, not ours. |
| L29 | `packages/dsh-app/src/dry-run-test-fixtures.ts:18,21-22` | lane `complex_implementation`, model `gpt-6-astra`, effort `medium` | test support | Not `.test.ts`, so it compiles into `dist/`, but it is imported only by two test files and the crash-test child (`dry-run.test.ts:7`, `dry-run-crash.test.ts:9`, `dry-run-child.ts:4`) and is not exported from `dsh-app/src/index.ts:193-194`. Under step 1 it becomes fixture-document data. |

Counts, for the acceptance map: 14 model bindings, 23 lanes, 40 steps, 4 tiers, 4 constraints, 1
profile, 3 presets, 2 approved relay evaluators, 1 depth parameter, 1 resolver family literal.

No production TypeScript outside `packages/routing` spells a model id, a lane name, a tier name or
an effort rung: a repository-wide grep for the pinned ids, the 23 lane names and the rungs `xhigh`
and `max` over non-test sources returns only the fixture file in L29 and a telemetry capacity
parser matching the string `max` for a memory limit (`packages/telemetry/src/governance/capacity.ts:13`),
which is unrelated. CLI version numbers appear only in doc comments (L4, L12) and in the routing
README (`packages/routing/README.md:115-116`).

### R-3 — Production consumer inventory

Workspace dependency edges on `@rickylabs/routing`: `dsh-app` (`packages/dsh-app/package.json:63`)
and `llm-local` (`packages/llm-local/package.json:27`). `check:graph` enforces that each is
mirrored as a project reference (`scripts/check-project-graph.mjs:79-131`).

| # | Consumer | Import | What it uses | Effect of step 1 |
|---|---|---|---|---|
| C1 | `packages/llm-local/src/capability.ts:44` | `LOCAL_MODEL_IDS`, `OPENROUTER_MODEL_IDS`, `isPinnedModel` | `PLACEMENTS` keys 6 models to 3 backends with verdicts and reasons (lines 101-231); `checkCapability` requires every placed model to be pinned (321-326) and every local and relay pin to be placed (352-359). | The constants cease to exist. The placement table is itself a model-keyed table and cannot keep compiled ids without becoming a second compiled model table. Owner fork OF-1 in `plan.md`. |
| C2 | `packages/llm-local/src/health.ts:56` | `type Observation` | Type only, in `toObservation`. | Unchanged; the type stays exported. |
| C3 | `packages/dsh-app/src/dry-run-internal.ts:4,75-76` | `admitDispatch`, `describeAdmission` | Admits the plan's dispatch under `value.lane`; the refusal carries `routed.problems`. | `admitDispatch` needs a configuration. The intent key's `inputRevision` digest (lines 85-88) does not include which matrix admitted the dispatch; under a replaceable document it must, or two documents alias one key. |
| C4 | `packages/dsh-app/src/dry-run.ts:4,41` | `type AdmissionProblem` | The `dispatch-inadmissible` refusal shape. | Unchanged type. `DryRunPlan` must carry the loaded configuration (see `plan.md` D-9). |
| C5 | `packages/dsh-app/src/llm/adapter.ts:55-62,223-234,278-282` | via `@rickylabs/llm-local`: `PLACEMENTS`, `placementOf` | `listModels` lists the placements for a backend; `generate` refuses a model the placement table refuses. | Follows C1: the adapter must be constructed with placement data, and `plugins/llm.ts:103-112` must obtain it. |
| C6 | `packages/dsh-app/src/plugins/llm.ts:36,120` | `BACKENDS` | Registers the adapter on the three backends. | Gains an injected dependency on whatever row loads the document. |
| C7 | `packages/contracts` | none | `DispatchCommand.lane: string` (`routes.ts:73-83`); `LaunchIdentity` five nullable strings (`runs.ts:65-71`). | Untouched. The published 0.1 contract has no routing vocabulary to preserve beyond `lane` being a string, which step 1 keeps. |
| C8 | `packages/coordinator/src/independence.ts:50-58` | none | Family is "an opaque token ... compared for equality and never parsed". | Untouched; it is already the shape step 3 needs. |
| C9 | `packages/forge`, `packages/board`, `packages/telemetry`, `provider-*` | none at runtime | Comments in `provider-claude/src/provider.ts:32`, `provider-opencode/src/model.ts:9-21` and `provider-opencode/README.md:111` name `LOCAL_MODEL_IDS` and routing's ownership of pins. | Wording only. |

Composition today (`packages/dsh-app/src/bundle.ts:75-121`, rendered to `cordis.patch.yml:24-54`):
five rows, none of which loads routing. The independence policy row is the precedent for a
deployment-level choice that fails loudly on a bad value: `resolvePolicy` throws `RangeError` at
boot for an unknown name (`packages/dsh-app/src/plugins/coordinator.ts:92-106`;
`packages/dsh-app/README.md:230-233`). The composed entry list is golden-tested byte for byte
(`packages/dsh-app/dump-config.golden.yml:1-18`; `golden.ts:2-32`) and re-blessed only through
`pnpm run golden:bless -- "<why>"` (`package.json:18`).

### R-4 — Test inventory

Baseline counts, executed in this worktree on 2026-09-07 with `pnpm --filter <pkg> run test`:
subagents 227, routing 136, llm-local 85, dsh-app 312, all passing.

| File | Lines | Depends on the compiled table how |
|---|---|---|
| `packages/routing/src/models.test.ts` | 72 | Every case reads `MODEL_IDS`, `OPENROUTER_MODEL_IDS`, `OPENCODE_MODEL_IDS`, `OPEN_EVALUATOR_MODEL_IDS`; asserts the approval list has exactly two members (line 61). Rewritten entirely. |
| `packages/routing/src/family.test.ts` | 173 | Run identities built from `MODEL_IDS` and relay ids (lines 7-46); `checkEvaluator` called without a configuration. Re-targeted at fixture documents. |
| `packages/routing/src/resolve.test.ts` | 405 | `checkPolicy()` no-arg (line 53); iterates `LANES`, `ROUTE_POLICY`, `TIERS`, `TIER_LANES`; asserts the tier order literally (line 264); the Astra row (383-405). Re-targeted; the literal-order assertion moves to the shipped-default suite. |
| `packages/routing/src/admit.test.ts` | 415 | Totality over `ROUTE_POLICY` (43-57); `EFFORTS` and `LANES` as expected lists (173, 224); local seats as unrouted (97-104). Re-targeted. |
| `packages/routing/src/probe.test.ts` | 455 | No table dependency (imports only `probe.js`; its model is a local string, line 25). Unchanged. |
| `packages/llm-local/src/capability.test.ts` | 116 | Imports the three id groups from routing (line 4); asserts totality and specific placements. Follows OF-1. |
| `packages/llm-local/src/health.test.ts` | — | Imports `availabilityOf`, `mayDispatch` (line 4), which keep their signatures. Unchanged. |
| `packages/dsh-app/src/llm/adapter.test.ts` | — | Imports `LOCAL_MODEL_IDS`, `OPENROUTER_MODEL_IDS` (line 20) for eleven assertions (86-289). Re-targeted at fixture placements. |
| `packages/dsh-app/src/dry-run.test.ts`, `dry-run-crash.test.ts`, `dry-run-child.ts` | — | Consume `fixture()` from L29; `dry-run.test.ts:51` expects `dispatch-inadmissible` when the lane is `normal_implementation` for an Astra dispatch, and line 84 varies the model to `gpt-5.6-sol` at `high`. Fixture gains a document; expectations hold under it. |
| `packages/dsh-app/src/plugins.test.ts`, `bundle.test.ts`, `golden.test.ts` | — | Assert the row list (`plugins.test.ts:207-211`) and the byte-exact composition. A new row changes all three. |

### R-5 — Gates that can run

- CI (`.github/workflows/ci.yml:55-63`) runs `pnpm run typecheck`, `pnpm run build`, `pnpm test`
  on every pull request and on `main`. `build` chains `check:graph`, `check:lifecycle`,
  `check:links`, `check:forms`, `check:snapshots`, the package builds, `check:publish`,
  `check:label-registry`, `check:docs`, `check:skill`, `check:tutorial` (`package.json:23`).
- `check:snapshots` reads every tracked `.json`, `.yml`, `.yaml` outside `node_modules`, `dist`
  and the lockfile, refuses a file whose name matches `allowance` or `quota`, and refuses any
  time-sliding key such as `observedAt`, `resetsAt`, `creditBalance`
  (`scripts/check-snapshots.mjs:41-78,110-131`). A tracked routing document is inside its scope.
- `check:links` excludes `.llm/runs/` (`scripts/check-links.mjs:20,57`), so run artifacts are not
  link-checked; `deno fmt` and `deno lint` also exclude them (`deno.json`).
- `golden.test.ts` executes `dsh --profile rickylabs --dump-config` against a throwaway home and
  compares byte for byte; it composes without booting (`packages/dsh-app/src/golden.ts:2-22`).
- Node 26.8.1 and pnpm 11.25.0 are installed here; `engines.node` is `>=24` (`package.json:9-11`).

### R-6 — House precedents the loader should follow

- Reading a file as `unknown` and checking every field, with absent and wrong-typed treated
  differently and the whole issue list returned rather than the first: `packages/forge/src/targets/config.ts:12-23,48-80`.
- Refusing a document that is not an object at all, requiring an envelope, and dropping bad
  entries by index with capped notes: `packages/coordinator/src/roster.ts:1-15,87-152`. The roster
  is lenient per entry because "a coordinator that refuses the whole file over one malformed line
  has turned a typo into an outage" (lines 8-9). Step 1's document is the opposite case: #271
  requires refusal, and #270 forbids "a permissive, silently ignoring loader".
- A short, canonical, sha256-based digest already exists: `digest()` in
  `packages/coordinator/src/canonical.ts:81-83` produces `sha256:<16 hex>` over canonical JSON.
  `routing` does not depend on `coordinator` and must not (the edge would run the wrong way for
  `dsh-app`'s graph), so the loader needs its own byte digest; the format can match.
- A deployment value that must fail at boot rather than fall back: `resolvePolicy`
  (`packages/dsh-app/src/plugins/coordinator.ts:99-106`).
- Table invariants as a problem list, not exceptions, shared by `checkPolicy`, `checkCapability`
  and `checkTargets` (`packages/forge/src/targets/model.ts:221-232`).

### R-7 — Repository facts that constrain the design

- `rootDir: src` and `outDir: dist` per package (`packages/routing/tsconfig.json:3-6`); the base
  config does not set `resolveJsonModule` (`tsconfig.base.json`, checked by grep across every
  tsconfig). A JSON document therefore cannot be `import`ed by the TypeScript build and must be
  read at runtime by path. This is also the property that keeps a shipped default from being
  compiled in.
- `routing` is `private: true` with `files: ["dist"]` (`packages/routing/package.json:6,17-19`).
  It is never published, so a data file outside `dist/` is reachable through the workspace link.
- `check:snapshots` scans any tracked JSON (R-5), so the shipped document must carry no
  time-sliding key and no `allowance`/`quota` in its name.
- `LONGEST_NAME` in `admit.ts:250-257` is computed at module load from table vocabulary; under a
  per-call configuration it must be computed per configuration.
- The two-seams doctrine keeps `routing` (which model, which family) and `llm-local` (where a
  model can physically run) as separate axes and separate packages
  (`docs/concepts/02-the-two-seams.md:94-99`; `packages/llm-local/src/capability.ts:24-30`).

## Document leg — what each issue asks of step 1

- #270 (epic): the boundary above; "Do not use the step boundary to introduce a permissive,
  silently ignoring loader"; "Downstream routing is only usable when its exact required semantics
  pass, not when an empty loader exists"; "Empty cells and policy values such as none and
  unspecified_by_owner must remain explicit rather than filled or coerced" (a step 2 shape fact
  that step 1's validator must not preclude).
- #272 (step 2): builds "the strict versioned schema for the actual fleet shape, not the legacy
  four-by-two table"; rejects unknown keys, dangling references and unsupported schema versions.
  Step 1's `schemaVersion: 1` is therefore expected to be superseded, and the loader's version
  gate must distinguish "unsupported version" from "malformed".
- #273 (step 3): removes "hardcoded per-lane certifies assignments and legacy static chains";
  selects the first evaluator whose family differs from the actual generator, after fallback.
  Step 1 must not implement this, and must not leave `tierPlan`'s `"openai"` in place either.
- #274 (step 4): detection and account/subscription configuration; "precedence wires into the
  resolver through data". Step 1 leaves the door open (no schema field may assume a single
  account) and does nothing else.
- #275 (step 5): the parity gate loads "its configuration instance through the production
  loader" and compares "every exported tier/role candidate, order, effort, empty cell, loop
  policy, coordinator scope and provider precedence". The loader's public entry point is a step 5
  dependency; the document's model key namespace is where parity will bite (C-3 below).
- #148: "Blocked by configuration-loader step #271 ... with the required schema/resolver semantics
  in #272/#273"; "no site dispatch until its exact configured lanes are expressible and validated".
  The lanes it needs are Muse Spark 1.3 at `max` for planning and plan evaluation in separate
  sessions, authored through the documentation lane.
- #181: "Now depends on loader #271 ... and the family-relative resolver #273 (after schema
  #272)". The defect it names is `review_codex_complex` fixed to `certifies: openai`
  (`policy.ts:563-578`) with the complex tier pointing at it statically (`policy.ts:621`,
  `resolve.ts:265`).
- #269 (closed, superseded): the compiled-table adoption of Muse; explicitly not launch authority.

[observed — https://github.com/rickylabs/harness/issues/272 through /275, /148, /181, /269;
topic: sibling steps and downstream dependents; retrieved 2026-09-07 via gh]

## External leg — fresh matrix CLI evidence

Two files, both `agentic:matrix --json` output at NetScript source
`8ba53bc50ca02aab29e99ba5362728839b8f1713` per the issue headers and `supervisor.md`.

`matrix-architecture.json` (`mode: "tier"`, one tier): the architecture tier exactly as it also
appears inside the full file below. `matrix-full.json` (`mode: "full"`), read in this run:

- Top level: `schemaVersion: 1`, `mode`, `tiers`, `coordinators`, `transportPriority`. Nothing
  else: no families, no launch ids, no per-model transport, no hard rules, no capabilities.
- Five tiers in order: `simple`, `straightforward`, `feature`, `complex`, `architecture`, each
  with a `description`.
- Eight roles as keys on every tier: `implementation`, `ui_ux`, `plan`, `plan_evaluation`,
  `implementation_evaluation`, `vision_evaluation`, `documentation`, `deep_research`. Each is an
  ordered array of `{ model, effort }`. Counted: 76 populated candidate entries; two cells are
  empty arrays, `simple.plan` and `simple.plan_evaluation`. This matches #270's count and its
  statement that empty cells stay explicit.
- Seventeen model keys: `astra`, `deepseek_v4_flash`, `deepseek_v4_flash_vision`,
  `deepseek_v4_pro`, `fable_5_1`, `gemini_3_8_flash`, `glm_5_3`, `glm_5_3_flash`, `grok_4_6`,
  `kimi_k3`, `luna`, `minimax_m3`, `muse_spark_1_3`, `opus_5`, `qwen_3_8_flash_next`,
  `qwen_3_8_max`, `sol`.
- Six effort values: `low`, `medium`, `high`, `xhigh`, `max`, `provider_default`.
- Three policy objects per tier with a varying key set: `maxRounds`, `reSteerSameSession`,
  `notifyOwnerAfter`, `escalateToOwnerAt`, `repairInFlightAt`. `maxRounds` is a number in four
  tiers and the strings `"none"` and `"unspecified_by_owner"` in `simple`; `repairInFlightAt` is
  a number in `feature` and `complex` and the string `"immediate"` in `straightforward`.
- `coordinators`: four scopes, `small_project`, `project`, `framework`, `milestone`, each an
  ordered candidate list; `milestone` begins `astra` at `medium`, then `fable_5_1` at `medium`,
  then `opus_5` at `xhigh`, as #270 states.
- `transportPriority`: `claude`, `codex`, `agy`, `github_copilot`, `opencode_go`, `ollama`,
  `openrouter`, in that order.
- One cell lists the same candidate twice: `complex.implementation_evaluation` is
  `muse_spark_1_3` at `max` followed by `muse_spark_1_3` at `max`.
- The simple implementation route is `luna` at `max`, as #270 says.

This run's own route, from the architecture tier (identical in both files): planning
`fable_5_1` at `xhigh` (this session) with `muse_spark_1_3` at `max` behind it; plan evaluation
`muse_spark_1_3` at `max`, then `grok_4_6` at `xhigh`; implementation `astra` at `xhigh`, then
`fable_5_1` at `xhigh`; implementation evaluation `grok_4_6` at `xhigh`, then `muse_spark_1_3`
at `max`; documentation `fable_5_1` at `high`, then `qwen_3_8_max` at `provider_default`. Plan
loop: one round, escalate to the owner at two, re-steer the same session.

[observed — deno task agentic:matrix --json output retained by the coordinator as
matrix-architecture.json and matrix-full.json, NetScript source
8ba53bc50ca02aab29e99ba5362728839b8f1713; topic: tiers, roles, candidates, efforts, empty
cells, loop policy values, coordinator scopes and transport priority; executed 2026-09-07 by
the coordinator, read here 2026-09-07]

## Contradictions surfaced, not resolved

- C-1 Effort vocabulary. The compiled ladder is `low, medium, high, xhigh, max`
  (`models.ts:48`); the CLI prints `provider_default`. The ladder's order is load-bearing for the
  escalation invariant and for admission's `unknown-effort`. A document must be able to declare
  both an ordered ladder and non-ordinal members, and an escalation between non-ordinal efforts
  must be refused as incomparable rather than compared by index.
- C-2 Family vocabulary. `MODEL_FAMILIES` has four members (`models.ts:34`); the fleet's Muse is
  `meta` (#181). `checkEvaluator` already compares families by string equality
  (`family.ts:125`), so the set can become data without changing the rule; `Certifies` is typed
  as `ModelFamily | "any" | "none"` (`policy.ts:133`) and must become string-with-keywords.
- C-3 Model identifier namespace. The CLI keys models as `fable_5_1`, `astra`, `luna`, `kimi_k3`;
  the table pins the ids the wire carries, `fable-5`, `gpt-6-astra`, `gpt-5.6-luna`,
  `moonshotai/kimi-k3` (`models.ts:52-106`). Some differ in version too: `x-ai/grok-4.5` against
  `grok_4_6`, `qwen/qwen3.8-flash` against `qwen_3_8_max`, `gemini-3.6-flash-high` against
  `gemini_3_8_flash`. `DispatchRequest.model` and `RunIdentity.model` carry wire ids
  (`subagents/src/dispatch.ts:94-95`; `family.ts:41-54`), and admission compares them verbatim.
  Step 5's parity compares CLI keys. The document must eventually carry both; which is the key is
  a schema question for step 2, recorded in `plan.md` as a spike with a step 1 default.
- C-4 Matrix shape. Four tiers by implement/review over 23 named lanes (`policy.ts:49-73,615-623`)
  against five tiers by eight roles, 76 ordered candidates and two explicitly empty cells
  (`matrix-full.json`). The compiled table also pins models the fleet no longer routes (`sonnet-5`,
  `z-ai/glm-5.2`, `x-ai/grok-4.5`, `gemini-3.6-flash-high` have no key in the seventeen) and lacks
  eight the fleet does route (`muse_spark_1_3`, `minimax_m3`, `deepseek_v4_*`, `glm_5_3`,
  `qwen_3_8_max`, `opus_5` under a different spelling). Step 2 owns the fleet shape. Step 1's
  document carries today's shape as data and says so; the shipped default is a transcription of
  the compiled table, not a fleet instance, and step 5's diff against the CLI will be large by
  construction until step 2 lands.
- C-5 Reviewer family. `tierPlan` resolves against `"openai"` (`resolve.ts:262-272`), and the
  README states the tier lanes "resolve a review lane against `openai` on the grounds that every
  implementation tier is Codex-authored" (`packages/routing/README.md:99-101`). The fleet resolves
  against the generator actually selected (#181, #273). Step 1 must remove the literal without
  implementing generator-relative fallback selection.
- C-6 `max` on implementation. The routing README and #269 say "never add a max-effort
  implementation ... route" (#269 scope), while the CLI prints a simple implementation route of
  `luna` at `max` and #270 says supported routes follow the tool. The compiled `fast_iteration`
  already seats `gpt-5.6-luna` at `max` (`policy.ts:222`). No step 1 action; recorded so step 2's
  schema does not encode the prose prohibition.
- C-7 Trigger union closure. `docs/concepts/06-the-three-layers.md:33-36` states "The trigger
  union is closed at six members; adding a seventh is a deliberate edit". That statement is
  consistent with keeping triggers structural (L12) and inconsistent with making them document
  data. The classification in `plan.md` D-4 keeps the doc true; the reviewer should attack it.
- C-8 Transport vocabulary. The full export's `transportPriority` names `claude`, `codex`, `agy`,
  `github_copilot`, `opencode_go`, `ollama`, `openrouter`. Harness splits that axis in two:
  `TRANSPORTS` is `native` or `openrouter` (`models.ts:44`) and `HARNESSES` is `claude`, `codex`,
  `codex-run`, `opencode`, `opencode-run`, `agy` (`subagents/src/dispatch.ts:63-70`). Neither can
  say `github_copilot` or `ollama`, and `opencode_go` is not `opencode`. #270 names "provider
  precedence" as configuration and #274 wires it "into the resolver through data". Step 1's
  structural `TRANSPORTS` is the relay-rule kind, not this list; the list itself is step 2 and
  step 4 data, and `HARNESSES` is the executor's vocabulary that E3 owns. `plan.md` D-4 is
  revised to say so.
- C-9 Duplicate candidate. `complex.implementation_evaluation` lists `muse_spark_1_3` at `max`
  twice. A validator that refuses duplicate candidates within a cell would refuse the fleet's own
  export; one that silently collapses them would hide a fact the parity gate must report. The
  coordinator's clarification settles it (`coordinator-disposition.md:31`): duplicate model
  definitions, lane identities and placement pairs are invalid, while repeated ordered route
  candidates are an authoritative shape that later schema and parity steps must neither
  deduplicate nor reject. No step 1 action beyond keeping those two kinds of duplicate apart in
  the version 1 rules: version 1 has no cells.
- C-10 Policy value types. `maxRounds` holds a number in four tiers and `"none"` or
  `"unspecified_by_owner"` in `simple`; `repairInFlightAt` holds a number or `"immediate"`. Step
  1's only policy parameter, `maxFallbackDepth`, is Harness-local and integer; the schema
  version 1 does not model fleet loop policy at all, so nothing here coerces those words. Step
  2's schema must preserve them as words (#270, #272).

## Downstream dependency, made concrete

#148 needs a lane that seats Muse Spark 1.3 at `max` for planning and for plan evaluation, in
separate sessions, and a documentation authoring lane, with the fleet's candidate order preserved.
Expressing that requires: a `meta` family (C-2), a model key the CLI knows (C-3), a tier/role cell
shape with ordered candidates (C-4, step 2), and evaluator selection against the actual generator
(step 3). Step 1 supplies none of those semantics. It supplies the loader they will be loaded
through. After step 1, #148 is still blocked, on #272 and #273.

#181 needs the complex review lane to resolve an evaluator against whichever generator family
actually ran, with Muse `max` as the fleet's implementation evaluator and `fable_5_1` `medium` as
the complex implementation fallback. Step 1 removes the resolver's `"openai"` literal by deriving
the author family from the loaded implementation primary, which makes the divergence a data fact
rather than a code fact. It does not select an evaluator after fallback and does not add Muse.
After step 1, #181 is still blocked, on #272 and #273, and must close only with the correcting
merge commit.

## Unknowns reported to the coordinator

- U-1 Whether `llm-local`'s placement table joins the routing document in step 1, moves to its own
  document, or waits for #274. Filed as OF-1 in `plan.md`; resolved by the coordinator as A
  (`coordinator-disposition.md:7`): one document, routing validates shape and references
  without depending on `llm-local`, `llm-local` validates values, an unsupported backend refuses
  at composition. The placement-adjacent production callers are `health.ts`, `endpoint.ts` and
  `backends.ts` inside `llm-local` and `resolveEndpoint` at `packages/dsh-app/src/llm/adapter.ts:271`;
  no production code outside those calls `checkHealth`, `toObservation` or `readinessRequest`.
- U-2 Whether the `dsh-app` profile row may default to the shipped document path or must require
  an explicit path. Filed as OF-2; resolved by the coordinator as A with an explicit portable
  setting permitted in the shipped profile (`coordinator-disposition.md:9`). A bundle row carries
  only `id`, `name` and `why` today (`packages/dsh-app/src/bundle.ts:32-39`) and `renderPatch`
  emits only `id` and `name` (`bundle.ts:173-174`), so the setting needs a rendered `config`;
  routing's `exports` map publishes only `.` and `./package.json` and its `files` list only
  `dist` (`packages/routing/package.json:10-19`), so the document needs both entries to resolve
  from the packed layout.
- U-3 Resolved during the run: the coordinator added `matrix-full.json`, and the external leg
  above is read from it. What remains unknown is everything the export does not print: model
  families, launch ids per transport, per-model transports, capabilities and hard rules. Step 5
  must audit that coverage; step 2 must re-query fresh rather than reuse this file.
- U-4 The document's model key namespace for step 5 parity (C-3). Step 1 keys models by wire id;
  step 2 must add the CLI key or decide the mapping. The full export makes the mapping partly
  legible (`qwen_3_8_flash_next` is the model `doctrine/WORKFLOW.md:76` spells
  `qwen/qwen3.8-flash`; `glm_5_3_flash` is `z-ai/glm-5.3-flash`; `opus_5` is `opus-5`; `sol` is
  `gpt-5.6-sol`) and partly not (four compiled pins have no fleet key). Recorded as spike S-2 in
  `plan.md`.
- U-6 `HARNESSES` cannot express `github_copilot`, `ollama` or `opencode_go` (C-8). That is an
  E3 `subagents` question and a step 4 provider-precedence question, not a step 1 one; reported
  so nobody reads step 1's structural transport kinds as a claim about the fleet's list.
- U-5 Whether the owner reads "subscription literals" to include the `included`/`outside_plan`
  keyword vocabulary (L13). Step 1 treats it as a schema keyword; the reviewer should say if that
  reading is wrong.

## Implementation continuation findings (2026-09-07)

The coordinator requested two loader repairs against implementation head `b15cad62`. The fresh
`matrix-implementation-followup.json:11` retains Astra at `xhigh`; no fallback or agent dispatch.
Historical planning findings above retain their original baseline.

- F-1 Source metadata was outside the runtime validation boundary. The coordinator reported one
  accessor invocation and an accepted result; a new regression reproduced that exact count. Before
  repair, the expanded routing suite had 202 passes and three source-identifier failures. Validate
  the primitive type first, then the 4,096-byte UTF-8 bound and nonblank content, before inspection
  or freezing. Fixed codes at `source.id` suffice; no value belongs in a refusal. Sources:
  `packages/routing/src/load.ts:66`, `packages/routing/src/load.test.ts:128`; topic: untyped source
  boundary; inspected and executed 2026-09-07; original observation attributed to coordinator.
- F-2 The coordinator reported a no-writer FIFO hanging until its owned child was killed at two
  seconds. Both source and emitted loader at `b15cad62` already use `O_NONBLOCK` and descriptor
  `stat`. The new isolated tests pass against that baseline for a FIFO, its symlink, and replacement
  of an ordinary file at open. The supplied receipt does not identify the probed revision, so the
  reason for the discrepancy is unknown. Preserve the original report and retain the existing
  safeguard. In scratch copies, removing nonblocking mode fails both deadline tests; adding a
  pre-stat before that blocking open still fails the replacement case. Both mutant test processes
  finish, and the child deadlines kill/reap blocked readers. Sources:
  `packages/routing/src/load.ts:90`, `packages/routing/src/load.test.ts:66` and `:183`; topic: regular
  file admission, replacement race and bounded test execution; inspected/executed 2026-09-07.
- F-3 The scope list called the compiled loader/resolvers the routing authority. The requested
  correction distinguishes mechanisms that load/resolve the explicit document from its authoritative
  routing data. Source: `docs/concepts/06-the-three-layers.md:227`; topic: configured authority;
  inspected/corrected 2026-09-07 under the coordinator's continuation directive.
