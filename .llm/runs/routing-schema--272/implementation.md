# routing-schema--272 — implementation

Stage F artifact for issue #272, step 2 of E11 (#270). Built to `plan.md` as repaired by
`plan-amendment.md` (A-1.1 to A-1.4). Baseline `c5e3f88` on `main`, which contains the merged plan
chain `1c386ef` (#284). Branch `feat/272-routing-schema-impl`.

**No PASS is claimed for the plan.** The second bounded plan evaluation on #272 never ran: the
plan carries one independent `FAIL_FIX` verdict and the author's F1–F4 repair, so it is reviewed
and repaired but not independently re-verified. This implementation was built against the repaired
plan and makes no claim about a verdict it did not receive. It also makes no claim of an
independent implementation evaluation, which is a separate session by doctrine.

## Matrix authority

`deno task agentic:matrix -- --json` executed fresh in the sibling NetScript checkout at source
revision `155dbbe90b35b8ab24fa7c52d4947f3d5e8f38ac`.

    sha256 44807db43ef19c14ac92e08fd5bf8bce89a5d38c7a19aba75db9d37ef4c70ac9

That is byte-identical (`cmp`, exit 0) to this run's retained `matrix-full.json` (NetScript
`8ba53bc50ca02aab29e99ba5362728839b8f1713`) and to `matrix-full-resume.json` (NetScript
`8eaa8c54`). Three independent source revisions print the same bytes; the fixture cites all three
in its own provenance. No matrix data was copied into a product path: the schema validates a
document and embeds no fleet.

## What was built, against each of the six acceptance lines

### 1. Tier-by-role cells, ordered candidates, explicit empty cells, validated references

`tiers[i].cells` is an object keyed by exactly the declared roles: a missing role is `missing-key`
at `tiers[i].cells[k]` with `k` the role's index in `roles`, and an extra key is `unknown-key` at
its own index. Each cell is an array of `{ model, effort }` with exactly those two keys. An empty
array is legal; index 0 is the default and later indices are fallbacks in order; two identical
candidates are preserved verbatim.

`families`, `capabilities`, `models` and `efforts` are declared lists, and every candidate `model`
and `effort`, every `models[k].family`, every `models[k].capabilities` member and every
`roles[r].requires` member is validated against them. No model, tier, effort or family identifier
is a TypeScript constant anywhere: the fixture's 17 model keys, 5 tier names, 8 role names, 4
coordinator scopes, 9 lane names, 7 family names, 6 effort values and 2 capability names are all
absent from every non-test source under `packages/routing/src`, asserted data-driven from the
fixture, and `scripts/check-compiled-policy.mjs` passes with no new allowlist entry.

### 2. Certifies, per-tier loops, coordinators, provider precedence, lane mapping

`roles` declares `certifies` (`any` is a gate that must name what it `evaluates`; `none` is
supplementary evidence and never a gate), `evaluates`, `requires`, `restrictions` and `selection`.
`tiers[i].loops` is keyed by declared generation roles; each policy holds exactly `maxRounds`,
`reSteerSameSession`, `notifyOwnerAfter`, `escalateToOwnerAt` and `repairInFlightAt`.
`coordinators` is a scope-keyed record of ordered candidates. `providerPrecedence` is a permutation
of the declared provider identities — every one exactly once, so none is unreachable by silence.
`lanes` maps each lane to a declared tier and role, and `lane-unrouted` refuses a lane whose target
cell is empty.

### 3. Deep research, UI/UX selection, privileged-tier authorization, owner overrides

`roles[r].restrictions` carries `seams`, `transports`, `harnesses`, `providers`, `families` and
`models`, each validated against its vocabulary; the fixture declares `deep_research` as
`seams: ["subagents"], transports: ["native"]` plus a harness list, and `constraint-violated`
refuses a candidate with no launch satisfying them. `roles[r].selection` is `{ by, otherwise }`:
`by` is `owner` or a declared coordinator scope, and `otherwise` is the declared generation role
incidental work falls back to — the fixture states UI/UX as owner-selected with implementation as
the fallback, so "incidental UI stays implementation" is in data rather than implicit in code.
`tiers[i].authorization.by` makes a tier privileged and names its authorities; there is no field
that can switch the rationale requirement off. `policy.ownerOverride.evidence` is required and
nonempty, so "override without evidence" is unsayable, and **no field anywhere in version 2
mentions independence** — a document that adds one is `unknown-key`, asserted.

### 4. The CLI's nonnumeric policy states, preserved

`LOOP_ROUND_STATES = ["none", "unspecified_by_owner"]` and `LOOP_REPAIR_STATES = ["immediate"]` are
the words an enforcer must interpret; the values per tier are data. A word survives as the string
the document carried and a number as a number, asserted by iterating the CLI export's fifteen
policy objects and comparing value **and** `typeof` field by field. Nothing maps a word onto 0 or
∞. No cross-field rule relates a threshold to a cap, because the export itself carries `maxRounds`
1 with `escalateToOwnerAt` 2, and `maxRounds` 0. A policy for a role whose cell in that tier is
empty is accepted, because the export has one.

### 5. Loud refusal with useful, safe diagnostics

Unknown keys, duplicates, dangling references, invalid values and unsupported versions are all
refusals with a fixed code and a structural path; nothing is filled, dropped or coerced. Two
diagnostic weaknesses in the shipped loader are fixed for **both** versions, in shared helpers:

- An unknown key is reported at `fieldPath(parent, key, index)`, so a schema-owned name prints as
  the name and any other key prints as its index among the object's own keys. A document key is
  never rendered, because a credential-shaped key matches any identifier pattern.
- A required key that is absent is reported once; every helper skips a value whose own path was
  already reported `missing-key`, or whose container could not be read, so an incomplete document
  no longer roughly doubles its problem list with `wrong-type` twins.

Version 2 adds no refusal kind and no `InvalidCode`. `PolicyCode` gains exactly three members.
`describeLoadRefusal` renders `supported 1, 2`. The canary suite asserts that no relay-key-shaped
string, bearer token, private-key block, source id, `SyntaxError`, `ENOENT` or `EISDIR` reaches any
refusal, `describeLoadRefusal` or `describeConsumerRefusal` output, with the canary placed in a
launch id, a provider name, a role name, a tier description, a lane note, an unknown key, an
effort-evidence reason and a malformed tail.

### 6. Tests over fleet-shaped, tailored and adversarial documents

419 tests in `@rickylabs/routing`, up from 205 at baseline. Two tracked fixtures under
`packages/routing/test-fixtures/`, which is neither exported nor packed: the verbatim CLI export,
and a version-2 document whose exported dimensions are copied from it and whose non-exported fields
are synthetic and labelled in its own provenance. A tailored in-memory version-2 document shares no
name with the fixture, and wholesale replacement is proven in both directions. The adversarial
inventory is 116 structural mutation rows, 14 invariant rows and 12 loop-policy rows, with a dead-row
check that every structural row changes the outcome and completeness checks over both code sets.

## Mutation surface, complete

`packages/routing/src/{schema,load,resolve,index}.ts` modified; `packages/routing/src/{fleet,document}.ts`
created; `packages/routing/src/{load,schema,admit,resolve,family}.test.ts` modified and
`fleet.test.ts` created; `packages/routing/test-fixtures/{matrix-full.8ba53bc,fleet-shaped.v2}.json`
created; `packages/routing/README.md` modified. `packages/dsh-app/src/{dry-run,dry-run-internal}.ts`
and `src/plugins/llm.ts` modified; `src/{dry-run,plugins}.test.ts` modified;
`packages/dsh-app/README.md` modified.

Nothing else. No change to `contracts`, `coordinator`, `forge`, `board`, `telemetry`, `subagents`,
`llm-local`, `provider-*`, `deploy/`, `.github/`, `doctrine/`, `docs/`, the bundle rows, the patch,
the golden, any repository script, any dependency or the lockfile.

## Divergences from the plan and the amendment, each recorded

- **D-101. Three more test files were modified than the manifest named.** `admit.test.ts`,
  `resolve.test.ts` and `family.test.ts` each derive their fixture straight from the loader, whose
  return type is now the union. Each narrows once through `laneRouting`. That is not scope creep:
  it is the boundary working. Those three files stopped compiling the moment the union landed,
  which is the property R-3 of the plan's evaluation asked for, and narrowing them is the minimum
  change that records it.
- **D-102. An unknown key that happens to be a schema-owned name prints as the name, not as an
  index.** `fieldPath` already renders schema-owned names, and `harness` on an llm-seam launch is
  a schema-owned name in a place the schema forbids. The amendment's prose said `[k]` for that
  case. The name is safe by construction — that is what `STRUCTURAL_FIELDS` is for — and it is
  strictly more useful. Recorded rather than worked around.
- **D-103. `records()` owns emptiness.** The plan had the callers add `empty` for `providers`,
  `models` and `roles`. A wrong-typed or absent container would then have reported both
  `wrong-type` and `empty` for one defect, which is the cascade box 5 asks to remove. Emptiness is
  now reported by the helper and only when an object was actually read.
- **D-104. `coordinatorCandidates` returns the whole record and `coordinatorsFor` one scope.** The
  plan named a single accessor for both jobs. Two functions with one job each; neither chooses.
- **D-105. The restore leg of one invariant test is two steps, not one.** Restoring only the relay
  approval does not restore that document, because the role restriction alone strands other gate
  candidates in other tiers. The test asserts both facts rather than the weaker one.

## Spikes, unchanged

S-1 (the fleet instance's family bindings) and S-2 (launch identifiers and providers per model)
remain open and belong to #274 and #275. The fixture's values for both are synthetic and labelled;
research addendum E-14 stands — per-launch effort support is not exported by the CLI, and the one
`known` entry in the fixture is a synthetic shape, not measured capability. S-3 (the index path
convention) was implemented as specified and is recorded above at D-102. S-4 (the structural
classification of `LOOP_*_STATES`, `AUTHORITY_KEYWORDS`, `OVERRIDE_EVIDENCE` and
`EFFORT_SUPPORT_STATES`) was implemented as specified; each is a word a mechanism must interpret
and the CLI prints no vocabulary for any of them.

## Out of scope, untouched

No resolution over cells: no candidate, launch, effort or evaluator selection, no fallback across a
cell or a tier, no generator-relative independence after fallback, no loop enforcement, no override
mechanics and no authorization check at dispatch. All of that is #273. Detection, accounts,
subscriptions and client versions are #274. The parity gate, the fleet instance and CLI export
support are #275. Version 1 is not retired. `HARNESSES` and `ROUTERS` are unchanged. No new
provider integration. No published contract, protocol version, bundle row, patch or golden change.

[observed — `deno task agentic:matrix -- --json`, NetScript source 155dbbe90b35b8ab24fa7c52d4947f3d5e8f38ac; topic: fresh fleet authority and byte-identity with the retained export; executed 2026-09-14]
[source: `.llm/runs/routing-schema--272/{plan,plan-eval,plan-amendment,research}.md`; topic: the specification and its one FAIL_FIX repair; consulted 2026-09-14]
[source: `ARCHITECTURE.md` v1 sections 3, 7 and 10; topic: locked charter, invariants I1 to I4 and E11's promotion; consulted 2026-09-14]
[observed — https://github.com/rickylabs/harness/issues/272; topic: the six acceptance lines; retrieved 2026-09-14 via gh]
