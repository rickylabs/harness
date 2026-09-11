# routing-schema--272 — plan

Stage E artifact for issue #272, step 2 of E11 (#270). Locked for independent plan evaluation;
any later change is recorded in `drift.md`, not edited here. No product mutation has occurred.
Baseline `8fd096df76f48a80df8ee94a1ee881cc709cefa0`, branch `feat/272-routing-schema`.

## Summary

Add schema version 2, the fleet shape, to the shipped loader without touching what version 1
means. One loader accepts `schemaVersion` 1 or 2 and nothing else; there is no migration, no
shape sniffing, no default and no partial acceptance. The loaded value becomes a discriminated
union, `RoutingDocument`, and every routing function that exists today keeps its version-1
parameter type, so a version-2 document cannot reach a lane resolver by construction. Two new
narrowing functions, `laneRouting` and `fleetRouting`, are the only way from a `RoutingDocument`
to a typed configuration, and each returns a coded `unsupported-by-consumer` refusal instead of
the other version. The one production consumer that resolves lanes, the dry-run driver, refuses
a version-2 document with a fixed `routing-unsupported` refusal before any store read; the one
consumer that reads placements, the llm plugin, works on both versions because the placement
section is byte-compatible across them. Nothing resolves a fleet cell in this step: that is #273.

Version 2 holds exactly the CLI's shape where the CLI prints one, and declared data where it does
not: tiers in order with eight cells of ordered `{model, effort}` candidates (empties and repeats
preserved), three loop policies per tier whose fields keep the words `none`,
`unspecified_by_owner` and `immediate` as words, coordinator scopes, provider precedence, and, for
the fields the CLI never prints, families, capabilities, per-provider launch ids, role
declarations (which roles certify, what they evaluate, what they require, what restricts them,
which are owner-selected), lane-to-tier/role mappings, privileged-tier authorization, owner
override evidence and placements. Every reference is validated; every unknown key, duplicate,
dangling reference, bad value or unsupported version is a loud refusal with a fixed code and a
structural path; the two diagnostic weaknesses found in the shipped loader are fixed for both
versions. Eight static invariant codes carry the version-1 rules into fleet form, including the one
that matters most: every generating candidate in a tier has a different-family evaluator in the
cell that evaluates it.

The shipped default stays the version-1 transcription; no fleet document is shipped, because the
CLI does not export families, launch ids or capabilities and this step may not invent them. The
fleet-shaped document is a tracked test fixture that copies every exported field verbatim from
the fresh CLI JSON, labels every non-exported field as synthetic, and is compared to a verbatim
copy of the CLI JSON by a data-driven test so it cannot drift. No owner fork is open: every
choice below is answered by E11 text or is an engineering choice with a stated alternative.

Expected footprint: 4 routing sources modified, 2 created, 1 test file created and 2 modified,
2 tracked fixtures; 2 `dsh-app` sources and 3 tests modified; 4 documents. Roughly 90 new test
cases, about 60 of them rows in two data-driven mutation tables. No bundle row, golden, contract,
dependency or script change.

## Acceptance map

| #272 box | Delivered by | Proven by |
|---|---|---|
| 1. Tier-by-role cells with ordered default/fallback candidates and explicit empty cells; model/family/capability references validated without compiled identifiers or efforts | D-4, D-5, D-6, D-9; schema `tiers[].cells`, `models`, `capabilities`; manifest M-2 | T-F1, T-F2 (cells equal the CLI file, order and repeats), T-F4 (empties and repeats), T-F5 rows for candidate model/effort/capability references, T-F12 (no fleet name in runtime source), `check:compiled-policy` |
| 2. Certifies, per-tier loops, coordinators by scope, provider precedence, lane-to-tier/role mapping | D-7, D-8, D-10, D-11, D-12; schema `roles`, `tiers[].loops`, `coordinators`, `providers`/`providerPrecedence`, `lanes` | T-F2 (loops, coordinators, precedence equal the CLI file), T-F3, T-F5, T-F6 |
| 3. Deep-research restrictions; owner-selected UI/UX with incidental UI in implementation; privileged-tier authorization by owner or milestone coordinator; owner overrides with worklog evidence and non-waivable independence | D-13, D-14, D-15, D-16; schema `roles[].restrictions`, `roles[].selection`, `tiers[].authorization`, `policy.ownerOverride` | T-F5 rows for each field, T-F6 `constraint-violated`, T-F14 (no waiver field exists and any attempt is `unknown-key`) |
| 4. Nonnumeric policy states preserved and validated, not replaced by caps | D-8; `LOOP_ROUND_STATES`, `LOOP_REPAIR_STATES` | T-F3 (words survive as words, types compared against the CLI file; wrong words and wrong-typed numbers refused) |
| 5. Unknown keys, duplicate or dangling references, invalid values and unsupported versions rejected loudly with useful safe diagnostics | D-2, D-3, D-17; loader contract | T-F5, T-F8, T-F9, T-F10, T-L canary cases at v2 |
| 6. Tests over fleet-shaped and tailored documents plus adversarial malformed input; no model/tier/effort constant reintroduced | D-18, D-19; fixtures F-1, F-2, in-memory tailored document | T-F1 to T-F14, T-C1 to T-C4; T-F12 and the AST gate |

## The architectural answer: two versions, one loader, a typed boundary

The brief's key question is how full fleet validation integrates with the shipped version-1
loader and its consumers while cell resolution waits for #273, with neither a silent fallback nor
a gap between "the loader accepted it" and "a consumer misread it". The answer has four parts.

### Version compatibility and migration

- The loader supports exactly the set `SCHEMA_VERSIONS = [1, 2]`. `schemaVersion` must be one of
  them as a JSON integer; anything else, including absence, a string, or a fleet-shaped document
  claiming version 1, is refused: the wrong integer as `unsupported-schema-version` with `seen`
  and `supported: [1, 2]`, the wrong shape under a supported integer as `invalid` (research
  PROBE-3). The version is read from the integer only; nothing infers it from shape.
- There is no migration function and no upgrade path inside the loader. A version-1 document
  cannot be mechanically raised to version 2: its lane chains do not determine cells, and inventing
  cells would be the silent filling #270 forbids. A project moves to version 2 by writing a
  version-2 document.
- Version-1 documents produce exactly the outcomes they produce today: the same frozen
  configuration, the same digest, the same refusal kinds and codes. Two diagnostic paths change
  (D-3); nothing else. The shipped default remains the version-1 transcription and the bundle row
  keeps selecting it (D-18).
- Retiring version 1 is not this step's decision. #273 moves lane resolution onto cells and is the
  step that can say when version 1 stops being loadable (research U-2). Until then both load.
- `schemaVersion` is routing's number. The CLI's own `schemaVersion: 1` is a different number
  space; #275 maps between them and the schema carries no CLI `mode` (research C-1).

### Load outcomes

The five refusal kinds are unchanged: `unreadable`, `malformed`, `unsupported-schema-version`,
`invalid`, `invariant`. Version 2 adds no kind. It adds no `InvalidCode` either: the eleven codes
at head cover every version-2 structural rule. It adds two `PolicyCode` members for the two
invariants that have no version-1 name (`no-independent-evaluator`, `capability-unsatisfied`) and
reuses six (`lane-unrouted`, `constraint-violated`, `relay-evaluator-unapproved`,
`opencode-without-router`, `router-outside-opencode`, `relay-without-profile`). A successful load
returns `loaded.configuration: RoutingDocument` and `loaded.source.schemaVersion: 1 | 2`.

### Feature validation

Validation is whole-document and version-specific after the shared, shape-independent stages:
bounds, plain-data walk, duplicate JSON keys, version gate. Version 2 validates every section
structurally (keys, types, patterns, emptiness, duplicates, references) and then runs
`checkFleetPolicy`, the static invariants. All problems are collected; nothing is filled, dropped
or coerced. The words `none`, `unspecified_by_owner` and `immediate` survive as the strings the
document carried, and a number survives as a number.

### The exact fail-closed consumer boundary

| Consumer at head | Reads | After this step | If it received the other version |
|---|---|---|---|
| Every routing function that takes a configuration (`resolveRoute`, `resolveFallback`, `resolveEffort`, `tierPlan`, `toDispatch`, `laneChain`, `selfCertifies`, `unreviewedSteps`, `checkPolicy`, `admitDispatch` and its queries, `checkEvaluator`, `familyOfRun`, every `configuration.ts` accessor) | `RoutingConfiguration` (version 1) | Signature unchanged; the parameter type is version 1 only | Cannot be called: `RoutingDocument` is not assignable to `RoutingConfiguration`. There is no runtime path because no caller can obtain a version-1 type from a version-2 document except through `laneRouting`, which refuses. |
| `laneRouting(document)` (new) | union | Returns `{ ok: true, configuration }` for version 1, else `{ ok: false, refusal: { kind: "unsupported-by-consumer", schemaVersion: 2, requires: "lane-chains" } }` | n/a: this is the boundary |
| `fleetRouting(document)` (new) | union | The mirror for version 2, `requires: "fleet-cells"`; its only callers in this step are tests and, later, #273 and #275 | n/a |
| `placementsOf(document)` (new) | union | Returns the placement section of either version; the section's type is identical | n/a |
| `dsh-app` dry-run driver (`dry-run-internal.ts:68-89`) | parses, then `admitDispatch(configuration, ...)` | Parses, then `laneRouting`; on refusal returns `DriveRefusal { kind: "routing-unsupported", schemaVersion, requires }` with `appended: 0`, before the store is read | Fixed refusal, no intent, no delivery (T-C1) |
| `dsh-app` llm plugin (`plugins/llm.ts:111`) | `routing.configuration.placements` | `placementsOf(routing.configuration)` | Works on both; an unsupported backend still refuses composition as today (T-C2, T-C3) |
| `dsh-app` routing plugin (`plugins/routing.ts:24-26`) | loads any document; provides `RoutingService` | Unchanged in code; provides either version; `source.schemaVersion` says which | Boots with a version-2 document (D-20); nothing downstream can resolve a lane from it |
| `llm-local` capability (`capability.ts:64-93`) | `PlacementConfiguration` | Unchanged | n/a: shape-identical across versions |

The property the boundary guarantees: the only functions that accept `RoutingDocument` are the
three narrowers, the loader's own return path and `describe*` renderers. A future consumer that
wants a fleet cell must call `fleetRouting` and receive a `FleetRoutingConfiguration`; a consumer
that wants a lane chain must call `laneRouting`. Neither narrower copies, defaults or converts.

## Boundary: what stays code, what becomes document (version 2)

| Stays in TypeScript (structural) | Becomes document data |
|---|---|
| The schema itself: keys, required-ness, patterns, reference rules, both version gates | Families, capabilities, providers and their seam, provider precedence order |
| `TRANSPORTS`, `SUBSCRIPTION_STATES`, `CERTIFIES_KEYWORDS`, `SEAMS` (unchanged); `HARNESSES`, `ROUTERS` (owned by `subagents`) | Model keys, family bindings, capabilities, relay approvals, per-provider launch ids with harness/transport/router/profile/preset/subscription |
| `LOOP_ROUND_STATES = ["none", "unspecified_by_owner"]`, `LOOP_REPAIR_STATES = ["immediate"]`: the words a loop enforcer must interpret | Which tier has which loop policy and every numeric or word value in it |
| `AUTHORITY_KEYWORDS = ["owner"]`: the one authority that is not a coordinator scope | Which tiers require authorization and by which authorities; which coordinator scopes exist and their candidates |
| `OVERRIDE_EVIDENCE = ["worklog"]`: the evidence kinds an owner override may cite | Which evidence kinds a document requires for an override (a non-empty subset) |
| The seven static invariants and their codes | Roles, what each certifies, evaluates, requires, restricts and whether it is owner-selected; tiers, cells, candidates, order, empties, repeats; lanes and their tier/role |
| `FALLBACK_TRIGGERS` (unchanged, version 1 only; not attached to cells, D-9) | Placements |

Reviewable calls: the three keyword vocabularies above are classified structural because a
mechanism must interpret each member and the CLI prints no vocabulary for them, exactly as the
step-1 plan classified triggers and subscription keywords (`routing-configuration--271/plan.md:166-186`).
If the evaluator reads them as route literals, the contained change is the same as before: each
becomes a declared list validated like `efforts`, and the code sites key on schema keywords.

## Decisions

### D-1 — One loader, two versions, a discriminated union

`validateRoutingConfiguration(value)` keeps its name and becomes a dispatcher: shared stages first
(plain-data walk, root object, version gate against `SCHEMA_VERSIONS`), then `validateLaneConfiguration`
for 1 or `validateFleetConfiguration` for 2. `ValidationOutcome.configuration` and
`LoadedRoutingConfiguration.configuration` become `RoutingDocument = RoutingConfiguration | FleetRoutingConfiguration`,
discriminated by `schemaVersion: 1 | 2`. `parseRoutingDocument` and `loadRoutingConfiguration`
are otherwise unchanged; the digest, bounds, duplicate-key scan and freeze already do not care
about shape (research R-1).

Rationale: #272 box 5 requires "unsupported schema versions" to be a distinct loud refusal, which
step 1 built for exactly this; a second loader function would be a second place for bounds and
canaries to diverge. Rejected: a separate `parseFleetDocument`; two entry points invite a caller to
pick the one that accepts its file. Rejected: `schemaVersion: "2.0"` or semantic strings; the gate
compares a JSON integer today and the CLI prints an integer.

### D-2 — Version 2 adds no refusal kind and no invalid code

The five kinds and eleven `InvalidCode` members at head are sufficient (research R-1, and the
mutation inventory T-F5 shows each version-2 rule mapping onto one). `PolicyCode` gains exactly
`no-independent-evaluator` and `capability-unsatisfied`. `describeLoadRefusal` renders the
supported list as `supported 1, 2` and is otherwise untouched.

Rationale: consumers already switch on the five kinds (`dry-run.ts:41`); keeping the vocabulary
closed keeps their handling total. Rejected: a `fleet-invalid` kind; it would say nothing a path
does not.

### D-3 — Two diagnostic fixes, applied to both versions

1. An unknown key is reported at `fieldPath(parent, key, index)`, so a schema-owned name prints as
   the name and any other key prints as its index among the object's own keys: `unknown-key at $[14]`,
   `unknown-key at tiers[0][5]`. No key value is ever printed.
2. A required key that is absent is reported once as `missing-key`; the per-field checks skip an
   absent required value instead of adding `wrong-type` at the same path.

Rationale: #272 box 5 says "useful"; research R-5 and PROBE-1 show 133 problems of which more than
half are anonymous or duplicated. The index convention is the one `fieldPath` already applies to
dynamic keys (`schema.ts:131-133`). Cost: two version-1 assertions change paths
(`load.test.ts:216-217`) and problem counts shrink; kinds, codes, success outcomes and digests are
untouched. Rejected: printing keys that match an identifier pattern; a credential-shaped key can
match one. Rejected: leaving version 1 as is and fixing only version 2; the helpers are shared and
two behaviours for one code would be a trap for #275's comparisons.

### D-4 — Cells are exactly the CLI's candidate shape, keyed by role, ordered, empty-able, repeatable

`tiers[i].cells` is an object whose keys are exactly the declared roles (every role present,
none extra) and whose values are arrays of `{ model, effort }` with exactly those two keys. An
empty array is a legal cell. Two identical candidates in one cell are legal and preserved. Order is
data: index 0 is the default, later indices are fallbacks in order.

Rationale: #272 box 1 verbatim, #270 "must remain explicit rather than filled or coerced", the
coordinator's clarification on repeats (`routing-configuration--271/coordinator-disposition.md:50`),
and #275's comparison of "candidate, order, effort, empty cell". Rejected: a per-candidate
`certifies`, `when` or escalation field; the CLI prints none, and #275 must compare cells without
normalisation. Rejected: an array of `{ role, candidates }`; the CLI keys cells by role and the
object form gives every missing or extra role a precise path.

### D-5 — Models are keyed by the cell's key; launches carry wire ids

`models: Record<key, { family, capabilities?, approvedRelayEvaluator?: true, launches: Launch[] }>`
where `key` is what cells and coordinators reference (`fable_5_1`, `astra`) and each `Launch` is
`{ provider, id, transport, harness?, router?, profile?, preset?, subscription? }` with `id` the
string a dispatch or a generate call carries for that provider. `launches` is non-empty.

Rationale: step 1's spike S-2 (`routing-configuration--271/plan.md:775-778`): the document must
carry both namespaces, and cells are compared by CLI key while admission and placements compare
wire ids (research R-2 C6, C-10). Rejected: keying models by wire id and giving cells a lookup;
cells would then not equal the CLI's cells byte for byte. Rejected: one `id` per model; a model
reaches the fleet through several providers with different ids (`fable-5` natively, a relay id over
OpenRouter).

### D-6 — Families and capabilities are declared lists; references are validated, values are not invented

`families: string[]` (non-empty; `any`/`none` reserved), `capabilities: string[]` (may be empty),
`models[k].family` in families, `models[k].capabilities` a duplicate-free subset of capabilities,
`roles[r].requires` likewise. The invariant `capability-unsatisfied` refuses a candidate whose model
lacks a capability its role requires.

Rationale: #272 box 1 ("validate model/family/capability references"), #270's boundary (families
are configuration), research R-8 (independence is family equality). The CLI exports neither
(research E-1, E-4); the fixture's values are synthetic and labelled (D-19). Rejected: a compiled
capability vocabulary; `vision` and `deep_research` would be route literals in code.

### D-7 — Roles are declared data with structural keywords for what a mechanism must interpret

`roles: Record<name, Role>` with `Role = { certifies?: "any" | "none", evaluates?: string[],
requires?: string[], restrictions?: Restrictions, selection?: { by: string[], otherwise: string } }`.
A role with `certifies` is an evaluation role: `any` is a gate that must name what it `evaluates`
(non-empty), `none` is supplementary evidence (`evaluates` optional). `evaluates` entries are
declared non-evaluation roles other than itself. Loop policies may be declared only for
non-evaluation roles. Role names match `^[a-z][a-z0-9_]*$`.

Rationale: the eight role names are configuration by #270's boundary ("roles' route cells") and a
tailored project may declare two roles; but which roles certify and which they certify is a rule a
resolver interprets, so the two certifies keywords stay the structural pair version 1 already has
(`schema.ts:14`, `family.ts:121-131`). Rejected: a compiled `ROLES` tuple; it is a route constant
in TypeScript by any reading of #271 box 2. Rejected: inferring evaluation roles from the suffix
`_evaluation`; a name is not a rule.

### D-8 — Loop policies keep the CLI's fields and preserve its words

`tiers[i].loops: Record<roleName, LoopPolicy>` where `LoopPolicy = { maxRounds: integer ≥ 0 | "none" | "unspecified_by_owner",
reSteerSameSession: boolean, notifyOwnerAfter?: integer ≥ 0, escalateToOwnerAt?: integer ≥ 0,
repairInFlightAt?: integer ≥ 0 | "immediate" }`, no other key. Keys of `loops` reference declared
non-evaluation roles; a tier need not declare a policy for every role; a policy may exist for a
role whose cell in that tier is empty (research C-5). No cross-field rule (research C-4).

Rationale: #272 box 4 verbatim; the fifteen policies in the fresh export use exactly these five
keys with these types (research external leg). The word states are a closed structural vocabulary
because an enforcer must give each a meaning, and the values per tier are data. Rejected: mapping
`none` to `0` or `Infinity`; that is the invented cap the box forbids. Rejected: requiring
thresholds to be at least 1 or at most the cap; the export itself has `maxRounds: 1` with
`escalateToOwnerAt: 2`, and `maxRounds: 0`.

### D-9 — Fallback triggers and effort escalations are not attached to cells

Version 2 has no `when` and no `effortEscalations`. `FALLBACK_TRIGGERS` remains the version-1
vocabulary. How #273 decides which trigger advances a cell index, and whether it reuses the six
triggers, is #273's design; the schema must not fix it.

Rationale: research R-4 ("no fleet analogue"); attaching triggers would make cells differ from the
CLI's and pre-empt the resolver. Cost if #273 wants per-candidate triggers: an additive optional
field in a later version, not a change to what exists.

### D-10 — Providers are declared with a seam; precedence is a permutation of them

`providers: Record<name, { seam: "subagents" | "llm" }>` (non-empty), `providerPrecedence: string[]`
containing every declared provider exactly once (a missing provider is `dangling-reference` at
`providerPrecedence`, an undeclared one at its index, a repeat is `duplicate`). A launch's
`harness` is required when its provider's seam is `subagents` and forbidden when it is `llm`.
A provider with no launch referencing it is legal: `github_copilot` is in the fresh precedence
list and no harness can spell it (research C-8).

Rationale: #272 box 2 ("provider precedence") and #270's boundary; #274 wires precedence into the
resolver and adds accounts. The seam is the one structural fact about a provider the two-seams
doctrine requires (`AGENTS.md`, "two seams"). Rejected: a provider record with harness, transport
and router; OpenRouter is reached both as a relay through the Claude CLI (subagents seam) and as an
llm backend, so those belong on the launch. Rejected: allowing precedence to be a subset; a
declared provider absent from precedence would be unreachable by silence.

### D-11 — Coordinators are scopes with ordered candidates

`coordinators: Record<scope, Candidate[]>`; scope names `^[a-z][a-z0-9_]*$` and not `owner`
(`reserved-name`); candidates validated as in cells; empty lists and an empty object are legal
(explicit). Scopes are what `authorization.by` and `selection.by` may reference besides `owner`.

Rationale: #272 box 2 ("coordinator matrix by scope"); the export has four scopes with ordered
candidates; #148 and this run's supervisor name the milestone coordinator as an authority, which
makes scopes the natural reference set for authorization (D-15).

### D-12 — Lanes map to a tier and a role, and must land on a non-empty cell

`lanes: [{ lane, tier, role, note? }]`, non-empty, lane names unique and `^[a-z][a-z0-9_]*$`,
`tier` and `role` declared. Invariant `lane-unrouted` refuses a lane whose cell in its tier is
empty.

Rationale: #270 "Lanes remain the dispatch surface and resolve through tier and role"; #272 box 2.
Lanes are not a CLI concept (research E-13), so their names in a fleet document are
project-declared. A lane pointing at an explicitly empty cell promises a dispatch surface with no
route; refusing it at load is the version-2 form of `lane-unrouted`. Rejected: allowing empty
targets and letting #273 throw; "usable only when its exact required semantics pass" (#270).

### D-13 — Deep-research restrictions are role-level and checked against launches

`roles[r].restrictions?: { transports?, harnesses?, providers?, families?, models?: string[] }`, each
validated against its vocabulary. Invariant `constraint-violated` refuses a candidate in that role
whose model has no launch satisfying every listed restriction (and whose family or key is excluded
where those lists are present). The fixture declares `deep_research` with `transports: ["native"]`
and `harnesses: ["agy", "codex", "codex-run"]`, transcribing the version-1 rule it replaces
(`routing.v1.json:705-715`).

Rationale: #272 box 3; research R-4. Checked as feasibility ("at least one lawful launch") because
the resolver, not the schema, picks the launch. Rejected: per-tier restrictions; the version-1 rule
is per lane and lane maps to role.

### D-14 — Owner-selected specialisation is a role property with a declared fallback role

`roles[r].selection?: { by: string[], otherwise: string }`: `by` a non-empty, duplicate-free list
of `owner` or declared scopes; `otherwise` a declared non-evaluation role that is not itself
owner-selected and not `r`. The fixture declares `ui_ux: { selection: { by: ["owner"], otherwise: "implementation" } }`.

Rationale: #272 box 3 says "owner-selected UI/UX specialisation while incidental UI stays
implementation"; `otherwise` states in data where incidental work goes. Rejected: a boolean
`ownerSelected`; it would leave "stays implementation" implicit in code.

### D-15 — Privileged-tier authorization names authorities; rationale is structural

`tiers[i].authorization?: { by: string[] }` with the same `by` rule as D-14. A tier with an
`authorization` section is a privileged tier: a dispatch into it requires an authorization by one
of the named authorities and a non-empty rationale. The rationale requirement is a rule (#148:
"Record the scope and non-empty rationale") and lives in code as documentation for #273 to
enforce; there is no field to switch it off.

Rationale: #272 box 3 ("configured privileged-tier authorization by owner or milestone
coordinator"): which tiers and by whom are configuration; that rationale is required is not a
choice. Rejected: `rationaleRequired: true` as a literal-only field; a field that can hold one
value is a rule wearing a key.

### D-16 — Owner overrides: evidence is declared, independence has no waiver field

`policy.ownerOverride: { evidence: string[] }`, required, non-empty, duplicate-free, members of
`OVERRIDE_EVIDENCE = ["worklog"]`. An empty list is refused (`empty`), so "override without
evidence" is unsayable. There is no field anywhere in version 2 that mentions independence, and a
document that adds one (`waivesIndependence`, `independence`, anything) is refused as
`unknown-key`; T-F14 asserts it.

Rationale: #270 "Owner overrides require a worklog entry and never waive evaluator independence";
#272 box 3. Representing non-waivability as the absence of a waiver plus a test is stronger than a
literal-only boolean. Rejected: a structural-only rule with no document section; the document
then could not say which evidence kinds it requires, and #274/#275 gain nothing to compare.

### D-17 — Static invariants for version 2

`checkFleetPolicy(configuration)` returns `PolicyProblem[]` with these codes, structural locations
in `lane` and candidate or launch index in `index`:

| Code | Refuses | Location |
|---|---|---|
| `lane-unrouted` | a lane whose target cell is empty | `lanes[i]` |
| `no-independent-evaluator` | in tier T, a candidate c of a generation role G such that some evaluation role E with `certifies: any` and G in `evaluates` has no candidate in T's E cell whose family differs from c's | `tiers[t].cells[g]`, index of c |
| `capability-unsatisfied` | a candidate whose model lacks a capability its role requires; coordinator candidates have no role and are not checked | `tiers[t].cells[r]`, index |
| `constraint-violated` | a candidate whose model has no launch satisfying its role's restrictions | `tiers[t].cells[r]`, index |
| `relay-evaluator-unapproved` | a candidate in a role with `certifies` other than `none` whose model has no native launch and no `approvedRelayEvaluator` | `tiers[t].cells[r]`, index |
| `opencode-without-router`, `router-outside-opencode` | a launch on an opencode harness without a router, or a router elsewhere | `models[m].launches`, index |
| `relay-without-profile` | a subagents-seam launch over `openrouter` transport that is not opencode and names no profile | `models[m].launches`, index |

The independence check is static feasibility over the tier's own cells: it does not model
cross-tier fallback, generator fallback order or the actual selected generator, all of which are
#273 ("Select the first evaluator whose family differs from the actual selected generator,
including after generator fallback. Throw when none exists"). It is the cell form of
`unreviewedSteps` (`resolve.ts:34-50`, test `resolve.test.ts:356`), which already refuses a fallback
implementation step nobody certifies.

Rationale: a document that promises an evaluator it cannot supply should fail at load, as version 1
does today. Research C-7 records that the real fleet's family bindings may make a tier
unsatisfiable; that refusal would be the correct loud outcome and is spike S-1, not something the
invariant should soften. Rejected: warnings; the loader has no warning channel and #270 forbids
usable-by-accident routing.

### D-18 — The shipped default stays version 1; no fleet document is shipped

`packages/routing/config/routing.v1.json`, the bundle row (`bundle.ts:121-127`), the golden and
the patch are untouched. The routing README states that version 2 exists, that no packaged
version-2 document exists, and why.

Rationale: a fleet instance needs families, launch ids and capabilities the CLI does not print
(research E-1 to E-4); the only source for them is NetScript source, and "do not hand-transcribe
policy from TypeScript" is this run's instruction and #270's. The fleet instance is #275's
deliverable, loaded "through the production loader". Rejected: shipping the fixture as a second
packaged document; it would be selectable by a profile line and its synthetic families would then
be production data.

### D-19 — Two tracked fixtures under `packages/routing/test-fixtures/`

- F-1 `matrix-full.8ba53bc.json`: the fresh CLI export, byte-identical to this run's
  `matrix-full.json` (research external leg digest). Read by tests as evidence, never loaded as a
  routing document.
- F-2 `fleet-shaped.v2.json`: `schemaVersion: 2`, `name: "fixture-fleet-shaped-8ba53bc"`, whose
  `provenance.description` says which fields are copied verbatim from F-1 and that families,
  capabilities, providers' seams, launch ids, role declarations, restrictions, selection,
  authorization, lanes and placements are synthetic test values that are not fleet authority.
  Every exported field equals F-1 (T-F2). Synthetic values are chosen so every invariant passes
  and so the fixture exercises every optional field at least once.

The directory is outside `config/` and `dist/`, so it is neither exported nor packed
(`package.json:10-20`); tests read it through `new URL("../test-fixtures/...", import.meta.url)`.
Tailored and malformed documents remain in-memory literals in `*.test.ts`, as step 1 decided
(`routing-configuration--271/plan.md:280-286`).

Rationale: research R-6 and C-11: a 76-candidate fixture as a TypeScript literal in a non-test
file trips the AST gate and cannot be diffed against the CLI file; tracked JSON passes
`check:snapshots` (research R-7) and lets T-F2 prove the fixture equals the evidence. Rejected:
reading the run directory's `matrix-full.json` from tests; run artifacts are not package inputs.
Rejected: generating F-2 from F-1 at test time; a generator that fills families and launches is
the transformation #275 must own, and it would hide the synthetic values.

### D-20 — The routing plugin boots either version; lane consumers refuse version 2 explicitly

`harness-routing` keeps loading whatever document the profile names and providing it. With a
version-2 document, `harness-llm` registers adapters from `placementsOf` and every lane consumer
refuses with `unsupported-by-consumer`. `source.schemaVersion` is the record of which version
booted.

Rationale: the placement seam is version-agnostic and useful to #274/#275 development; refusing
boot would make the whole profile pending for a document the loader accepts, and refusing at the
consumer is where the missing semantics actually are. Rejected: refusing boot until #273; nothing
today dispatches through `ctx.harnessRouting`, so the refusal would protect nothing and block the
llm seam.

### D-21 — No resolution over cells in this step

Version 2 exports pure accessors only: `roleOf`, `cellOf(configuration, tier, role)`, `loopOf`,
`coordinatorCandidates`, `launchesOf`, `providerPrecedenceOf`. Each returns data or `null`; none
picks a candidate, a launch, an evaluator or an effort. #273 owns `resolve*` over cells.

Rationale: the brief and #273's boxes. A test asserts that no function named `resolve*`, `admit*`
or `tierPlan` accepts a `FleetRoutingConfiguration` (type-level, via a compile-time
`@ts-expect-error` block in `fleet.test.ts`).

## Owner forks

None open. The following were examined and found answered by E11 text or to be engineering
choices with a contained cost; each is recorded so the evaluator can disagree without an owner
round trip.

| Candidate question | Answered by | Where it is decided |
|---|---|---|
| Should the shipped default become a fleet document? | #270 "do not ... hand-transcribe from source"; #275 owns the fleet instance | D-18 |
| Should a version-2 document boot the profile before #273? | #270 "usable only when its exact required semantics pass"; refusal at the consumer satisfies it | D-20 |
| Are roles, scopes and providers data or code? | #271 box 2 and #270's boundary | D-7, D-10, D-11 |
| Does the schema encode "max must not be used for implementation"? | #270 "supported routes follow the tool"; research C-6 | not encoded |
| Does privilege attach to tiers or to candidates? | #148 "the privileged tier"; #272 "privileged-tier authority" | D-15 (tier level; an additive candidate field is possible later) |
| Is family granularity for open models one family or several? | Not a schema question; a #275 data question and export gap | S-1 |

## Schema, version 2 (design pack, draft; nothing here has been written to the product)

Excerpt of the fleet-shaped fixture F-2. Cells, loops, coordinators and precedence are the fresh
CLI values; every other value is synthetic and labelled as such in the fixture's provenance.

    {
      "schemaVersion": 2,
      "name": "fixture-fleet-shaped-8ba53bc",
      "provenance": { "description": "Test fixture. tiers/cells/loops/coordinators/providerPrecedence copied verbatim from agentic:matrix --json at NetScript 8ba53bc (2026-09-07). families, capabilities, providers' seams, launches, roles, restrictions, selection, authorization, lanes and placements are synthetic test values, not fleet authority, and are export gaps for #275." },
      "families": ["anthropic", "openai", "google", "meta", "open"],
      "efforts": { "ordered": ["low", "medium", "high", "xhigh", "max"], "unordered": ["provider_default"] },
      "capabilities": ["vision", "deep_research"],
      "providers": {
        "claude": { "seam": "subagents" }, "codex": { "seam": "subagents" }, "agy": { "seam": "subagents" },
        "github_copilot": { "seam": "subagents" }, "opencode_go": { "seam": "subagents" },
        "ollama": { "seam": "llm" }, "openrouter": { "seam": "llm" }
      },
      "providerPrecedence": ["claude", "codex", "agy", "github_copilot", "opencode_go", "ollama", "openrouter"],
      "profiles": ["relay-profile"],
      "presets": [],
      "models": {
        "fable_5_1": { "family": "anthropic", "capabilities": ["vision"],
          "launches": [{ "provider": "claude", "id": "synthetic-fable", "harness": "claude", "transport": "native" }] },
        "muse_spark_1_3": { "family": "meta",
          "launches": [{ "provider": "opencode_go", "id": "synthetic/muse", "harness": "opencode", "transport": "openrouter", "router": "openrouter" }] },
        "gemini_3_8_flash": { "family": "google", "capabilities": ["vision", "deep_research"],
          "launches": [{ "provider": "agy", "id": "synthetic-gemini", "harness": "agy", "transport": "native" }] }
      },
      "roles": {
        "implementation": {},
        "ui_ux": { "selection": { "by": ["owner"], "otherwise": "implementation" } },
        "plan": {},
        "plan_evaluation": { "certifies": "any", "evaluates": ["plan"] },
        "implementation_evaluation": { "certifies": "any", "evaluates": ["implementation", "ui_ux"] },
        "vision_evaluation": { "certifies": "none", "evaluates": ["ui_ux"], "requires": ["vision"] },
        "documentation": {},
        "deep_research": { "requires": ["deep_research"], "restrictions": { "transports": ["native"], "harnesses": ["agy", "codex", "codex-run"] } }
      },
      "tiers": [
        { "tier": "simple", "description": "Automation, simple fixes, and chores; low temperature and low complexity.",
          "cells": { "implementation": [{ "model": "luna", "effort": "max" }, { "model": "qwen_3_8_flash_next", "effort": "provider_default" }],
                     "ui_ux": [ ... ], "plan": [], "plan_evaluation": [], "implementation_evaluation": [ ... ],
                     "vision_evaluation": [ ... ], "documentation": [ ... ], "deep_research": [ ... ] },
          "loops": { "plan": { "maxRounds": "none", "reSteerSameSession": true },
                     "implementation": { "maxRounds": "unspecified_by_owner", "reSteerSameSession": true },
                     "documentation": { "maxRounds": 2, "reSteerSameSession": true } } },
        { "tier": "architecture", "description": "...",
          "cells": { ... "implementation_evaluation": [{ "model": "grok_4_6", "effort": "xhigh" }, { "model": "muse_spark_1_3", "effort": "max" }], ... },
          "loops": { "plan": { "maxRounds": 1, "escalateToOwnerAt": 2, "reSteerSameSession": true }, ... },
          "authorization": { "by": ["owner", "milestone"] } }
      ],
      "coordinators": {
        "small_project": [{ "model": "luna", "effort": "max" }, { "model": "opus_5", "effort": "low" }],
        "milestone": [{ "model": "astra", "effort": "medium" }, { "model": "fable_5_1", "effort": "medium" }, { "model": "opus_5", "effort": "xhigh" }]
      },
      "lanes": [
        { "lane": "complex_implementation", "tier": "complex", "role": "implementation" },
        { "lane": "architecture_plan", "tier": "architecture", "role": "plan" }
      ],
      "policy": { "maxFallbackDepth": 2, "ownerOverride": { "evidence": ["worklog"] } },
      "placements": { "backends": ["lm-studio"], "entries": [{ "model": "synthetic-local", "backend": "lm-studio", "verdict": "runs", "why": "synthetic evidence" }] }
    }

Types (`src/fleet.ts`):

    type LoopRoundState = "none" | "unspecified_by_owner";     // LOOP_ROUND_STATES
    type LoopRepairState = "immediate";                         // LOOP_REPAIR_STATES
    interface LoopPolicy { maxRounds: number | LoopRoundState; reSteerSameSession: boolean;
      notifyOwnerAfter?: number; escalateToOwnerAt?: number; repairInFlightAt?: number | LoopRepairState }
    interface Candidate { model: string; effort: string }
    interface Launch { provider: string; id: string; transport: Transport; harness?: Harness; router?: Router;
      profile?: string; preset?: string; subscription?: SubscriptionState }
    interface FleetModel { family: string; capabilities?: readonly string[]; approvedRelayEvaluator?: true; launches: readonly Launch[] }
    interface Restrictions { transports?; harnesses?; providers?; families?; models? }   // all readonly string[]
    interface Role { certifies?: "any" | "none"; evaluates?: readonly string[]; requires?: readonly string[];
      restrictions?: Restrictions; selection?: { by: readonly string[]; otherwise: string } }
    interface FleetTier { tier: string; description?: string; cells: Readonly<Record<string, readonly Candidate[]>>;
      loops?: Readonly<Record<string, LoopPolicy>>; authorization?: { by: readonly string[] } }
    interface FleetRoutingConfiguration { schemaVersion: 2; name; provenance?; families; efforts; capabilities;
      providers: Readonly<Record<string, { seam: Seam }>>; providerPrecedence; profiles; presets;
      models: Readonly<Record<string, FleetModel>>; roles: Readonly<Record<string, Role>>; tiers: readonly FleetTier[];
      coordinators: Readonly<Record<string, readonly Candidate[]>>; lanes: readonly { lane; tier; role; note? }[];
      policy: { maxFallbackDepth: number; ownerOverride: { evidence: readonly string[] } }; placements: PlacementConfiguration }
    type RoutingDocument = RoutingConfiguration | FleetRoutingConfiguration;             // src/document.ts
    type ConsumerRefusal = { kind: "unsupported-by-consumer"; schemaVersion: 1 | 2; requires: "lane-chains" | "fleet-cells" };

Validation rules, all `invalid` problems with fixed codes and structural paths, after the shared
bounds, plain-data walk, duplicate-key scan and version gate:

- Root: the allowed key set is exactly `schemaVersion`, `name`, `provenance` (optional),
  `families`, `efforts`, `capabilities`, `providers`, `providerPrecedence`, `profiles`, `presets`,
  `models`, `roles`, `tiers`, `coordinators`, `lanes`, `policy`, `placements`. Every non-optional
  key is required; unknown keys anywhere are `unknown-key` at the D-3 path.
- `name`: `^[a-z0-9][a-z0-9-]*$`. `provenance.description`: non-empty string.
- `families`: non-empty, duplicate-free, none equal to `any` or `none` (`reserved-name`).
  `efforts`: as version 1. `capabilities`, `profiles`, `presets`: duplicate-free string lists,
  may be empty.
- `providers`: non-empty object; names `^[a-z][a-z0-9_]*$`; each `{ seam }` with `seam` in
  `SEAMS`. `providerPrecedence`: duplicate-free, every entry declared, every declared provider
  present (D-10).
- `models`: non-empty; keys `^[a-z0-9][a-z0-9_.-]{0,63}$`; `family` declared; `capabilities` a
  duplicate-free subset; `approvedRelayEvaluator` only `true`; `launches` non-empty. Each launch:
  `provider` declared; `id` non-empty, at most 256 characters, no whitespace or control characters
  (`out-of-range`); `transport` in `TRANSPORTS`; `harness` required for a subagents-seam provider
  (`missing-key`) and forbidden for an llm-seam provider (`unknown-key`), in `HARNESSES` when
  present; `router` in `ROUTERS`; `profile` and `preset` declared; `subscription` in
  `SUBSCRIPTION_STATES`. The pair `(provider, id)` is unique across the document (`duplicate` at
  the second launch).
- `roles`: non-empty object; names `^[a-z][a-z0-9_]*$`; `certifies` in `CERTIFIES_KEYWORDS`
  (a family here is `dangling-reference`); `evaluates` present only with `certifies`
  (`unknown-key` otherwise), required non-empty when `certifies` is `any` (`missing-key`/`empty`),
  duplicate-free, each entry a declared role that is not itself and has no `certifies`
  (`out-of-range`); `requires` a duplicate-free subset of `capabilities`; `restrictions` lists
  validated against `TRANSPORTS`, `HARNESSES`, providers, families, model keys; `selection.by`
  non-empty, duplicate-free, each `owner` or a declared scope; `selection.otherwise` a declared
  role that is not itself, has no `certifies` and no `selection` (`out-of-range`).
- `tiers`: non-empty array; `tier` unique, `^[a-z][a-z0-9_]*$`; `description` string when present;
  `cells` an object whose keys are exactly the declared roles: a missing role is `missing-key` at
  `tiers[i].cells[k]` with `k` the role's index in `roles`, an extra key `unknown-key`; each cell an
  array (empty allowed) of objects with exactly `model` (declared key) and `effort` (declared);
  `loops` keys declared non-evaluation roles, each a `LoopPolicy` with exactly the five keys
  allowed, `maxRounds` and `reSteerSameSession` required, integers safe and at least 0
  (`out-of-range`), word states from their vocabulary (`out-of-range` for any other string),
  `reSteerSameSession` a boolean (`wrong-type`); `authorization.by` as `selection.by`.
- `coordinators`: object (may be empty); scope names `^[a-z][a-z0-9_]*$` and not `owner`
  (`reserved-name`); each value an array (may be empty) of candidates validated as in cells.
- `lanes`: non-empty; `lane` unique, `^[a-z][a-z0-9_]*$`; `tier` and `role` declared; `note` a
  string when present.
- `policy`: exactly `maxFallbackDepth` (safe integer at least 0) and `ownerOverride` with exactly
  `evidence`, a non-empty, duplicate-free list from `OVERRIDE_EVIDENCE`.
- `placements`: the version-1 rules unchanged (`schema.ts:305-330`), except that `entries[].model`
  must equal some launch `id` in the document (`dangling-reference`), so the section stays in
  wire-id space (C-10).
- Then `checkFleetPolicy` (D-17); any problem is the `invariant` refusal.

Diagnostics conventions: paths use schema-owned names for schema-owned keys and indices for
dynamic keys (`tiers[3].cells[4][1].model`, `models[7].launches[1].provider`, `roles[5].evaluates[0]`,
`coordinators[2][0].effort`, `providerPrecedence[3]`); `STRUCTURAL_FIELDS` gains the version-2
names (`capabilities`, `providers`, `seam`, `providerPrecedence`, `launches`, `provider`, `id`,
`roles`, `evaluates`, `requires`, `restrictions`, `selection`, `by`, `otherwise`, `cells`, `loops`,
`maxRounds`, `reSteerSameSession`, `notifyOwnerAfter`, `escalateToOwnerAt`, `repairInFlightAt`,
`authorization`, `coordinators`, `ownerOverride`, `evidence`). No value, key name outside that set,
OS text or parser text is ever rendered.

## CLI-to-schema mapping and export gaps, for #275

| CLI JSON | Version-2 field | Comparison #275 can make |
|---|---|---|
| `tiers[i].tier`, array order | `tiers[i].tier`, array order | exact |
| `tiers[i].description` | `tiers[i].description` | exact |
| `tiers[i].<role>` | `tiers[i].cells[<role>]` | exact array equality, per role, order and repeats included |
| `tiers[i].planPolicy` / `implementationPolicy` / `documentationPolicy` | `tiers[i].loops.plan` / `.implementation` / `.documentation` | exact object equality; the key mapping is the one explicit normalisation and is stated, not hidden |
| `coordinators` | `coordinators` | exact |
| `transportPriority` | `providerPrecedence` | exact array equality |
| `schemaVersion`, `mode` | none | not configuration |
| absent: families, launch ids, providers' seams, capabilities, role semantics, effort order, restrictions, selection, authorization, override evidence, relay approvals, subscriptions, CLI versions, lanes | the fields research E-1 to E-13 name | not comparable until the CLI exports them; #275 must fail incomplete coverage rather than treat a fixture's synthetic values as authority |

## Loader contract, as it will read after this step

    SCHEMA_VERSIONS = [1, 2] as const
    parseRoutingDocument(text, sourceId): LoadOutcome                 // unchanged behaviour, wider result type
    loadRoutingConfiguration({ path }): Promise<LoadOutcome>          // unchanged
    validateRoutingConfiguration(value: unknown): ValidationOutcome    // dispatches on schemaVersion
    validateLaneConfiguration(value): ValidationOutcome                // version 1, the current body
    validateFleetConfiguration(value): ValidationOutcome               // version 2
    checkPolicy(configuration: RoutingConfiguration): PolicyProblem[]  // unchanged
    checkFleetPolicy(configuration: FleetRoutingConfiguration): PolicyProblem[]
    laneRouting(document: RoutingDocument): { ok: true; configuration: RoutingConfiguration } | { ok: false; refusal: ConsumerRefusal }
    fleetRouting(document: RoutingDocument): { ok: true; configuration: FleetRoutingConfiguration } | { ok: false; refusal: ConsumerRefusal }
    placementsOf(document: RoutingDocument): PlacementConfiguration
    describeConsumerRefusal(refusal): string                            // codes only
    LoadRefusal.unsupported-schema-version.supported: readonly [1, 2]
    LoadedRoutingConfiguration = { configuration: RoutingDocument; source: { id, digest, bytes, schemaVersion: 1 | 2, name } }

The narrowers return the same frozen object the loader produced; they never clone, default or
convert. `describeLoadRefusal` and `describeConsumerRefusal` render fixed codes and structural
paths only.

## Exact implementation mutation manifest

`packages/routing`:

- M-1 modify `src/schema.ts`: extract the field-check helpers (`obj`, `str`, `arr`, `strings`,
  `ref`, `records`, problem collection) into an exported `validator()` factory shared by both
  versions, with the D-3 index path for unknown keys and no cascade after `missing-key`; rename the
  version-1 body to `validateLaneConfiguration` (exported); replace `SCHEMA_VERSION` with
  `SCHEMA_VERSIONS`; extend `STRUCTURAL_FIELDS`; keep every version-1 type and its name. The
  version gate moves to `src/document.ts`.
- M-2 create `src/fleet.ts`: version-2 types, `LOOP_ROUND_STATES`, `LOOP_REPAIR_STATES`,
  `AUTHORITY_KEYWORDS`, `OVERRIDE_EVIDENCE`, `validateFleetConfiguration`, `checkFleetPolicy`, and
  the pure accessors of D-21.
- M-3 create `src/document.ts`: `RoutingDocument`, `validateRoutingConfiguration` (shared stages
  plus dispatch), `ConsumerRefusal`, `laneRouting`, `fleetRouting`, `placementsOf`,
  `describeConsumerRefusal`.
- M-4 modify `src/load.ts`: import the dispatcher from `document.ts`; widen `supported` to
  `readonly [1, 2]`, `configuration` to `RoutingDocument`, `source.schemaVersion` to `1 | 2`;
  render the supported list.
- M-5 modify `src/resolve.ts`: `PolicyCode` gains `no-independent-evaluator` and
  `capability-unsatisfied`. No other change.
- M-6 modify `src/index.ts`: `export * from "./fleet.js"` and `"./document.js"`.
- M-7 create `test-fixtures/matrix-full.8ba53bc.json` (F-1, byte copy of the fresh export) and
  `test-fixtures/fleet-shaped.v2.json` (F-2).
- M-8 create `src/fleet.test.ts` (T-F1 to T-F14); modify `src/load.test.ts` (T-F9, T-F10, the two
  path assertions at `:216-217`, version-2 canary and bounds rows) and `src/schema.test.ts:71-80`
  (T-F12 extends the forbidden list with F-2's model keys, tier, role, scope, provider and lane names).
- M-9 modify `README.md`: a "Schema version 2" section (fields, invariants, consumer boundary,
  no packaged fleet document, mapping table pointer), the refusal table's supported list, and the
  fixture directory's purpose.
- M-10 `package.json`: no change. `files` and `exports` do not cover `test-fixtures/`, which is the
  point (D-19).

`packages/dsh-app`:

- M-11 modify `src/dry-run.ts` (`DriveRefusal` gains
  `{ kind: "routing-unsupported"; schemaVersion: 1 | 2; requires: "lane-chains" | "fleet-cells" }`)
  and `src/dry-run-internal.ts:68-89` (after `parseRoutingDocument`, call `laneRouting`; refuse
  with `appended: 0` before the store read; admit with the narrowed configuration; the digest at
  `:101` unchanged).
- M-12 modify `src/plugins/llm.ts:111`: `placementsOf(routing.configuration)`.
- M-13 `src/plugins/routing.ts`: no code change; doc comment notes both versions load and that
  `source.schemaVersion` records which. Verified by compile and T-C2.
- M-14 modify `src/dry-run.test.ts` (T-C1), `src/plugins.test.ts` (T-C2; `:330` narrows through
  `laneRouting` before reading `lanes`), `src/llm/adapter.test.ts` (T-C3).
- M-15 modify `README.md`: the dry-run refusal list gains `routing-unsupported`; the configuration
  section states that a version-2 document boots, is not dispatchable until #273, and that the
  bundle still selects the version-1 transcription.

Documentation:

- M-16 `docs/concepts/06-the-three-layers.md:29-33`: one sentence after "Version 1 holds lane
  chains ...": version 2 holds tier-by-role cells, loop policies, coordinator scopes and provider
  precedence, and no resolver reads them until #273. `packages/README.md:20`: "(versions 1 and 2)".

Repository scripts: none. `scripts/check-compiled-policy.mjs` needs no allowlist entry: the new
sources assign no string literal to a scanned identifier (vocabularies are array constants;
validators pass key names as list members). If the gate disagrees at implementation time, the
entry names the exact file and identifier with a structural reason, never a route value.

Nothing else. No change to `contracts`, `coordinator`, `forge`, `board`, `telemetry`, `subagents`,
`llm-local`, `provider-*`, `deploy/`, `.github/`, `doctrine/`, the bundle rows, the patch, the
golden, dependencies or the lockfile.

## Test design

Every test names its fixture: A is the shipped version-1 document (unchanged), B is the version-1
in-memory document (unchanged), F is fixture F-2 read from disk, X is the verbatim CLI file F-1, T
is a tailored in-memory version-2 document sharing no name with F (two families `alpha`/`beta`,
one provider `local` with seam `llm` and one `cli` with seam `subagents`, two models, two roles
`make` and `check` where `check` certifies `any` and evaluates `make`, one tier `only`, one lane,
`coordinators: {}`, empty capabilities, one placement). Mutations are applied to a fresh copy per
case.

Fleet schema (`fleet.test.ts`):

- T-F1 F loads: `ok`, `schemaVersion 2`, `name` as in D-19, `bytes` equals the file length,
  `digest` equals an independently computed SHA-256, frozen at every depth; `checkFleetPolicy(F)`
  is empty; `fleetRouting(F)` is `ok`; `laneRouting(F)` is
  `{ kind: "unsupported-by-consumer", schemaVersion: 2, requires: "lane-chains" }`;
  `placementsOf(F)` deep-equals `F.placements`.
- T-F2 F equals X on every exported dimension, computed from X and never from literals: tier names
  and order; for every role key of every X tier, `cellOf(F, tier, role)` deep-equals the X array;
  `loopOf(F, tier, "plan"|"implementation"|"documentation")` deep-equals X's `planPolicy` /
  `implementationPolicy` / `documentationPolicy`, including `typeof` of every field;
  `coordinatorCandidates(F)` deep-equals X's `coordinators`; `providerPrecedenceOf(F)` equals X's
  `transportPriority`; the set of model keys referenced by F's cells and coordinators equals the set
  referenced by X. A one-byte change to any exported value in F fails this test.
- T-F3 word states: iterating X's fifteen policies, every string-valued field is the same string in
  F after load (`none`, `unspecified_by_owner`, `immediate`), never a number; mutation rows:
  `maxRounds: "3"`, `maxRounds: "unlimited"`, `repairInFlightAt: "none"`, `notifyOwnerAfter: "immediate"`,
  `maxRounds: -1`, `maxRounds: 1.5`, `maxRounds: 2**53` each `out-of-range` at the field path;
  `reSteerSameSession: "true"` `wrong-type`; an unknown policy key `unknown-key`; a loop for an
  evaluation role `dangling-reference`; a loop for a role whose cell is empty is accepted (C-5); a
  threshold above the cap is accepted (C-4).
- T-F4 empties and repeats: `cellOf(F, "simple", "plan")` is `[]` and frozen;
  `cellOf(F, "complex", "implementation_evaluation")` has the length X has and its two entries are
  deep-equal; T with every cell empty except `make` and `check` loads; a lane onto an empty cell is
  `lane-unrouted` (T-F6).
- T-F5 structural mutation inventory, a table `[name, mutate, code, path]` with at least one row
  per rule in the design pack: unknown key at root (`$[k]`), in a tier, a cell candidate, a launch,
  a loop, a role, `selection`, `authorization`, `policy`, `ownerOverride`, a provider; every
  required key missing, at root and per record; wrong types (cells not an object, a cell not an
  array, a candidate not an object, providers not an object, `seam` not a string, `description` not
  a string); empties (families, providers, models, launches, roles, tiers, lanes, `efforts.ordered`,
  `selection.by`, `authorization.by`, `evidence`, blank model key, blank effort); duplicates (tier,
  lane, `providerPrecedence` entry, `evaluates`, `requires`, `capabilities`, `by`, `(provider, id)`
  launch pair, placement pair, effort across lists); dangling references (candidate model, candidate
  effort, coordinator candidate, `family`, model `capabilities`, launch `provider`/`profile`/`preset`,
  `evaluates`, `requires`, every `restrictions` list, `selection.by` scope, `selection.otherwise`,
  `authorization.by` scope, `loops` key, lane `tier`/`role`, `providerPrecedence` entry undeclared,
  declared provider absent from precedence, placement model not a launch id, placement backend,
  placement totality, `certifies` naming a family); reserved names (family `any`/`none`, scope
  `owner`); out of range (`name`, model key, role/tier/lane/scope/provider name patterns, launch
  `id` with whitespace or 257 characters, `maxFallbackDepth` negative, `evaluates` self-reference,
  `evaluates` naming an evaluation role, `otherwise` naming itself, an evaluation role or an
  owner-selected role, `harness` on an llm-seam launch as `unknown-key`, `harness` absent on a
  subagents-seam launch as `missing-key`, `approvedRelayEvaluator: false` as `wrong-type`).
  Completeness assertion: every `InvalidCode` other than `depth-exceeded`, `size-exceeded` and
  `not-plain-data` (covered by T-F8) appears at least once in the table's expected codes, and every
  row changes the outcome from `ok` to the expected refusal (a row that does not is a dead row and
  fails).
- T-F6 invariant inventory, a table `[name, mutate, code, location, index]`: `lane-unrouted` (lane
  onto `simple.plan`); `no-independent-evaluator` (every `plan_evaluation` candidate of a tier
  rebound to the family of a `plan` candidate; and a tier whose `plan` cell is non-empty while its
  `plan_evaluation` cell is empty); `capability-unsatisfied` (a `vision_evaluation` candidate whose
  model lacks `vision`); `constraint-violated` (a `deep_research` candidate whose model launches
  only over `openrouter`); `relay-evaluator-unapproved` (an evaluation candidate whose model has
  only relay launches and no approval; and the same model with a native launch accepted; and the
  same relay-only model with `approvedRelayEvaluator: true` accepted); `opencode-without-router`,
  `router-outside-opencode`, `relay-without-profile` (subagents seam), and an llm-seam `openrouter`
  launch without a profile accepted; a `certifies: none` role whose candidates share a family with
  every generator accepted (supplementary evidence is not a gate). Completeness: both new
  `PolicyCode` members and the six reused ones appear.
- T-F7 tailored document T: loads clean; every F name is unknown to T (`roleOf`, `cellOf`,
  `launchesOf`, providers, lanes, scopes return `null` or absent) and every T name unknown to F;
  loading F then T then F yields byte-identical `JSON.stringify(cellOf(...))` answers each time;
  mutating a clone of F changes no answer about the held F; T's `placementsOf` and F's are disjoint.
- T-F8 hostile input at version 2: canaries (a relay-key-shaped string, a bearer token, a
  private-key block, the source id) placed in a launch `id`, a provider name, a role name, a tier
  `description`, a lane `note`, an unknown key and a malformed tail, each asserted absent from every
  refusal, every `describeLoadRefusal` and `describeConsumerRefusal` output, together with the
  words `SyntaxError`, `ENOENT`, `EISDIR`; a role named `__proto__` is `reserved-name`; a cell with
  4,097 candidates is `size-exceeded` before any structural problem; one level over `MAX_DEPTH`
  inside `cells` is `depth-exceeded`; a getter-bearing version-2 value is `not-plain-data` with
  zero invocations.
- T-F9 version gate: `schemaVersion` 3, `"2"`, `-2`, `1.5`, absent are `unsupported-schema-version`
  with the right `seen` and `supported: [1, 2]`; `2.0` in JSON text is accepted as 2 (JSON numbers
  have no fractional identity; recorded, not a defect); version-1 keys under `schemaVersion: 2` are
  `invalid` with `missing-key` for every version-2 root key and index-path `unknown-key` for every
  version-1 one; fleet keys under `schemaVersion: 1` are `invalid` (PROBE-3); `describeLoadRefusal`
  prints `supported 1, 2`.
- T-F10 version 1 unchanged: A's digest, `bytes`, `name` and configuration equal the values the
  existing T-L1 asserts; the whole existing routing suite passes with exactly two path assertions
  updated (`load.test.ts:216` becomes `$[14]`, `:217` becomes `lanes[0].chain[0][2]`) and no count
  assertion changed; a version-1 document with a missing root key yields one problem per missing
  key and no `wrong-type` twin.
- T-F11 narrowers: `laneRouting(A)` returns the identical frozen object (`===`); `laneRouting(F)`
  refuses `requires: "lane-chains"`; `fleetRouting(A)` refuses `requires: "fleet-cells"`;
  `fleetRouting(F)` is identical (`===`); `placementsOf(A) === A.placements`; `describeConsumerRefusal`
  contains no document value.
- T-F12 literal scan: `schema.test.ts:71-80` extended so the forbidden list also contains F's model
  keys, tier names, role names, scope names, provider names and lane names; no non-test runtime
  source under `packages/routing/src` contains any of them after comment stripping.
- T-F13 no resolution over cells: a `@ts-expect-error` block proves `resolveRoute`, `resolveFallback`,
  `tierPlan`, `admitDispatch` and `checkEvaluator` do not accept `FleetRoutingConfiguration`; and a
  runtime assertion that `Object.keys(fleetModule)` contains no name starting with `resolve`,
  `admit` or `select`.
- T-F14 non-waivable independence: adding `waivesIndependence: true`, `independence: "waived"` or
  `certifies: "self"` anywhere in `policy`, `ownerOverride`, a role or a tier is refused
  (`unknown-key` or `dangling-reference`) and no accepted document has any key containing the
  substring `waive`; `evidence: []` is `empty`; `evidence: ["verbal"]` is `dangling-reference`.

Consumers (`dsh-app`):

- T-C1 dry-run: a plan whose `routing.text` is F's text refuses
  `{ kind: "routing-unsupported", schemaVersion: 2, requires: "lane-chains" }` with `appended: 0`,
  zero store reads (a handle whose `read` records calls), no intent, no delivery; a plan whose text
  is F with one invariant broken refuses `routing-unusable` first; the existing key-derivation and
  forged-digest cases pass unchanged.
- T-C2 plugins: `harness-routing` with a temp path holding F boots; `ctx.harnessRouting.source.schemaVersion`
  is 2; `harness-llm` registers adapters on the three backends; `laneRouting(ctx.harnessRouting.configuration)`
  refuses; F with an unsupported placement backend makes `harness-llm` refuse composition as today;
  F with an invariant broken throws `RangeError` whose message is codes and paths only; the
  version-1 boot cases pass unchanged with `:330` narrowed.
- T-C3 adapter: `createAdapter` over a `RoutingService` holding F lists exactly F's `runs`
  placements, computed from F.
- T-C4 bundle and golden: `bundle.test.ts:145-147` still sees the version-1 specifier; the golden
  suite passes without a re-bless.

## Runnable commands and gates

    pnpm run typecheck
    pnpm run build            # check:snapshots covers the two new fixtures; check:compiled-policy scans the new sources
    pnpm test
    pnpm --filter @rickylabs/routing run test
    pnpm --filter @rickylabs/dsh-app run test
    pnpm --filter @rickylabs/llm-local run test   # expected unchanged; run to prove it
    pnpm run check:compiled-policy
    pnpm run check:snapshots

All run in this worktree today (routing's suite was executed for this plan, research "Actual
checks") and in CI (`.github/workflows/ci.yml:53-63`). No golden re-bless, no patch render. The
gate that cannot run here is the independent exact-head implementation evaluation, a separate
session by doctrine (`doctrine/WORKFLOW.md`, Stage F and the post-Stage-H default).

## Dependency DAG

Inside this step: M-1 and M-3 first (shared helpers, dispatcher, union; version 1 still green under
its widened types), then M-7 (fixtures, reviewable against the CLI file before any validator
exists) and M-2 (the fleet validator and invariants, T-F1 to T-F8 green), then M-4 to M-6 and M-8
(loader types, codes, exports, remaining tests), then M-11 to M-14 (`dsh-app` compiles and
narrows), then M-9, M-15, M-16.

Across the epic: #272 unblocks #273 (the resolver over cells consumes `fleetRouting`, `cellOf`,
`launchesOf`, `providerPrecedenceOf`, the role declarations and the loop policies, and decides when
lane consumers stop calling `laneRouting`); #274 adds account, subscription and client-version
data and decides its own version number (research U-1); #275 consumes `parseRoutingDocument`,
`fleetRouting`, the mapping table above and the export-gap list, and must obtain families, launch
ids and capabilities from an authoritative export rather than from fixture F-2. #148 and #181
remain blocked on #273 exactly as their issues say.

## Spikes and integration gates

- S-1 Family bindings of the fleet instance (research C-7, E-1). Not a schema question: version 2
  validates whatever families a document declares and refuses a tier no evaluator can certify. The
  parity step must obtain the bindings from CLI export support or the owner and load the instance;
  if `no-independent-evaluator` fires on a real tier, that is a finding for the owner, not a rule to
  relax. Owner: #275.
- S-2 Launch ids and providers per model (research E-2, E-3). Fixture values are synthetic and
  labelled; the schema field shapes are fixed here. Owner: #274 for detection, #275 for parity.
- S-3 The D-3 path convention. The evaluator should attack whether an index is "useful" enough;
  the alternative, printing keys matching an identifier pattern, is rejected for the credential
  reason. Owner: evaluator; implementer if changed.
- S-4 `AUTHORITY_KEYWORDS`, `LOOP_*_STATES`, `OVERRIDE_EVIDENCE` classified structural (boundary
  table). Reviewable; the contained alternative is stated there.
- G-1 `check:snapshots` over the two fixtures runs in `build`; the fixture field names are checked
  against the forbidden list in research R-7 and none matches. If a future key matched, the fixture
  would fail loudly rather than be skipped.
- G-2 T-F13's type-level assertion depends on `tsc` reporting an unused `@ts-expect-error`; that is
  standard TypeScript behaviour and the test file is compiled by `tsc -b` before `node --test`
  (`packages/routing/package.json`, `test` script).

## Risk register

| ID | Risk | Likelihood | Impact | Gate |
|---|---|---|---|---|
| R-1 | Fixture F-2 drifts from the CLI evidence over edits | medium | high: tests would pass against a shape the fleet no longer prints | T-F2 compares F-2 to F-1 dimension by dimension; #275 re-queries fresh and never trusts F-1 |
| R-2 | Someone reads F-2 as the fleet instance | medium | medium: synthetic families treated as authority | Name and provenance text (D-19); outside `config/`; not exported or packed; README; T-C4 shows the bundle still selects version 1 |
| R-3 | A consumer bypasses the narrowers with a cast | low | high: the exact gap the brief forbids | Types are the gate; T-C1/T-C2 pin the refusals; PR review checks every `as` touching `RoutingDocument` |
| R-4 | The D-3 path change surprises a reader of old receipts | low | low | README documents both conventions; only two assertions change |
| R-5 | The static independence invariant refuses the real fleet instance | medium | medium: #275 cannot load the fleet until bindings are settled | S-1; this is the intended loud outcome |
| R-6 | The `planPolicy` to `loops.plan` key mapping is read as hidden normalisation | low | medium for #275 | Mapping table states it as the one explicit normalisation; T-F2 encodes it |
| R-7 | Providers that no harness can spell are declared and unlaunchable | certain | low now; #273 must refuse a launch on them explicitly | D-10 records it; #273's plan inherits the note |
| R-8 | `2.0` accepted as version 2 is read as laxity | low | low | T-F9 records it; JSON numbers have no fractional identity |
| R-9 | Scope creep into #273 through "helpful" accessors | medium | medium | D-21 and T-F13; accessors return data, never choices |
| R-10 | `check:compiled-policy` flags a version-2 vocabulary constant | low | low | Exact allowlist entry with structural reason, never a route value (manifest, scripts) |
| R-11 | Version-1 and version-2 helpers diverge later | medium over time | medium | One `validator()` factory (M-1); both validators are tested through the same loader |

## Evaluation route and loop policy for this run

From `matrix-plan.json` (fresh, 2026-09-07, identical to the architecture tier of `matrix-full.json`):
plan by `fable_5_1` at `xhigh` (this session), fallback `muse_spark_1_3` at `max`; plan evaluation
by `muse_spark_1_3` at `max`, fallback `grok_4_6` at `xhigh`; implementation by `astra` at `xhigh`,
fallback `fable_5_1` at `xhigh`; implementation evaluation by `grok_4_6` at `xhigh`, fallback
`muse_spark_1_3` at `max`; documentation by `fable_5_1` at `high`, fallback `qwen_3_8_max` at
`provider_default`. Plan loop: `maxRounds` 1, `escalateToOwnerAt` 2, re-steer the same session.
Implementation loop: `maxRounds` 3, `notifyOwnerAfter` 2, same session. No downgrade: if a listed
candidate cannot run, the coordinator re-queries the CLI rather than choosing a sibling.

## Explicitly out of scope

Any resolution over cells (candidate, launch, effort or evaluator selection, fallback across a
cell or across tiers, generator-relative independence after fallback, loop enforcement, override
mechanics, authorization checks at dispatch): #273. Detection, accounts, subscriptions, client
versions, and the versioning of those sections: #274. The parity gate, the fleet instance
document, its families and launch ids, and CLI export support: #275. Retiring version 1. Growing
`HARNESSES` or `ROUTERS`. Any new provider integration. Any change to the published contract, its
protocol version, the bundle rows, the patch or the golden. Any CLI surface for printing a loaded
document.
