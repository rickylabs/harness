# routing-schema--272 — plan amendment A-1

Bounded plan repair for the four `FAIL_FIX` findings in `plan-eval.md` (evaluator `grok_4_6` at
`xhigh`, xAI family, session preserved in `plan-eval-routing.md`). Written in the original author
session (Fable 5.1 at `xhigh`, native Claude Code), which the fresh repair query
`matrix-plan-repair.json` (NetScript `8eaa8c54`, byte-identical to the original `matrix-plan.json`)
still selects as the `architecture.plan` seat. `plan.md`,
`research.md` and the evaluator's verdict are not edited; where this amendment and `plan.md`
differ, this amendment governs, and every superseded section is named. No product, test,
fixture, board, host or sibling mutation. Head `1d5df95` on `feat/272-routing-schema` (the coordinator's docs-only
commit recording the findings, on top of `9b120d2`); the product paths under
`packages/routing`, `packages/dsh-app`, `packages/llm-local` and `scripts/check-compiled-policy.mjs`
are byte-identical to the plan's baseline `8fd096d` (`git diff --stat 8fd096d..HEAD` over those
paths is empty, executed 2026-09-08).

## Summary

Four repairs, each fully specified below as schema, types, validation, invariants, fixture, tests
and mutation surface:

- F1. A provider is an identity, not a dial. `seam` moves from the provider record to every
  launch; a provider may carry subagents-seam and llm-seam launches under one name; the launch
  uniqueness key becomes `(provider, seam, id)`, so the same provider and wire id on two seams is
  expressible and distinct; harness, router, profile and preset are permitted only on the
  subagents seam; placements reference llm-seam launch ids; role restrictions may name seams.
- F2. Every launch carries required effort evidence: `effortSupport` is `{ status: "unknown" }` or
  `{ status: "known", supported, unsupported?, why }`. An effort in neither list is unknown. No
  field, default or helper says "all supported", converts one effort into another, or infers
  "unsupported" from silence. A cell effort is a validated request, never proof of support. Six
  contradiction diagnostics are fixed codes at fixed paths. One new invariant,
  `effort-unsupported`, refuses a candidate whose every role-feasible launch declares its effort
  unsupported; `unknown` never refuses.
- F3. Independence feasibility counts an evaluator candidate only if its family differs and the
  role's capability requirements hold and one single launch of that model satisfies, at the same
  time, the role's restrictions, relay approval on that launch, and does not declare the
  evaluator candidate's own effort unsupported. Every invariant is restated as a predicate over
  one launch, with a precedence order so a candidate yields exactly one code. Selection remains
  #273.
- F4. The concept-06 sentence and the package-index tweak are dropped. Version-2 guidance lives in
  the routing README; the dry-run refusal note lives in the dsh-app README.

Everything the evaluator marked sound is unchanged and reaffirmed at the end. No owner fork is
opened; two engineering choices the evaluator's wording left open are flagged for its attention.
No PASS is claimed. The architecture plan loop consumed its one round; a second review requires
owner escalation, which the coordinator owns.

[source: `.llm/runs/routing-schema--272/plan-eval.md`; topic: F1 to F4 and the sound list; consulted 2026-09-08]
[source: `.llm/runs/routing-schema--272/resume-amendment.md`; topic: coordinator questions and resumed baseline; consulted 2026-09-08]
[owner — https://github.com/rickylabs/harness/issues/272#issuecomment-5591550877; topic: both seams without conflating subscriptions and transports; physical capability versus configured effort; consulted 2026-09-08]
[observed — https://github.com/rickylabs/harness/issues/273#issuecomment-5591323350 and https://github.com/rickylabs/harness/issues/274#issuecomment-5591325380; topic: capacity refusal versus physical unsupported effort, no conversion, no different-effort proof; consulted 2026-09-08]

## Disposition of the findings

| Finding | Superseded plan text | Repaired by |
|---|---|---|
| F1 seam on provider | D-10 (`plan.md:265-279`), the launch rule block (`plan.md:553-562`), `Launch` and root types (`plan.md:525-532`), F-2 excerpt providers and launches (`plan.md:467-481`), boundary table rows on providers (`plan.md:125-126`), T-F5 harness rows (`plan.md:749-750`) | A-1.1 |
| F2 no per-launch effort capability | D-5 (`plan.md:198-210`) as far as `Launch` is concerned, D-6 rationale on "capabilities" (`plan.md:212-221`), the launch rule block, S-2 | A-1.2 |
| F3 independence on family alone | D-17 (`plan.md:352-372`), D-13 feasibility wording (`plan.md:303-311`), T-F6 (`plan.md:755-766`) | A-1.3 |
| F4 concept-06 edit | M-16 (`plan.md:684-687`), the `packages/README.md:20` tweak | A-1.4 |

## A-1.1 — F1: providers are identities; seam is a property of the launch

### Types (replace `Launch`, the provider record and `Restrictions` in `plan.md:525-532`)

    interface ProviderIdentity { readonly description?: string }          // no other key until #274
    type EffortSupport =                                                   // A-1.2
      | { readonly status: "unknown"; readonly why?: string }
      | { readonly status: "known"; readonly supported: readonly string[]; readonly unsupported?: readonly string[]; readonly why: string };
    interface Launch {
      readonly provider: string;            // a declared provider identity
      readonly seam: Seam;                  // "subagents" | "llm": the dial, per launch
      readonly id: string;                  // the wire id on this provider over this seam
      readonly transport: Transport;        // "native" | "openrouter"
      readonly harness?: Harness;           // subagents seam only, required there
      readonly router?: Router;             // only with an opencode harness
      readonly profile?: string;            // subagents seam only
      readonly preset?: string;             // subagents seam only
      readonly subscription?: SubscriptionState;
      readonly effortSupport: EffortSupport;  // required, A-1.2
    }
    interface Restrictions { seams?; transports?; harnesses?; providers?; families?; models? }   // all readonly string[]
    // FleetRoutingConfiguration.providers: Readonly<Record<string, ProviderIdentity>>

`SEAMS` stays the structural pair it is today (`packages/routing/src/family.ts:31`); it now
validates a launch field instead of a provider field, which is the same place `RunIdentity`
already carries the seam (`family.ts:41-54`).

### Validation rules (replace D-10's rule paragraph and the launch block at `plan.md:553-562`)

- `providers`: non-empty object; names `^[a-z][a-z0-9_]*$`; each value an object whose only
  permitted key is `description` (non-empty string when present); any other key is
  `unknown-key` at `providers[i][k]`. A name may not repeat (JSON duplicate keys are already
  refused at the token stream, `load.ts:32-64`).
- `providerPrecedence`: unchanged (D-10 second sentence): a permutation of the declared provider
  names, `duplicate` for a repeat, `dangling-reference` at the index for an undeclared name and at
  `providerPrecedence` for a declared name that is absent.
- Each launch: required keys `provider`, `seam`, `id`, `transport`, `effortSupport`; optional
  `harness`, `router`, `profile`, `preset`, `subscription`; anything else `unknown-key` at
  `models[m].launches[j][k]`. `provider` declared (`dangling-reference`); `seam` in `SEAMS`
  (`dangling-reference`); `id` non-empty, at most 256 characters, no whitespace or control
  characters (`out-of-range`); `transport` in `TRANSPORTS`; `subscription` in `SUBSCRIPTION_STATES`.
- Seam `subagents`: `harness` required (`missing-key` at `models[m].launches[j].harness`), in
  `HARNESSES`; `router` in `ROUTERS` when present; `profile` and `preset` declared when present.
- Seam `llm`: `harness`, `router`, `profile` and `preset` are each `unknown-key` at
  `models[m].launches[j][k]` when present. An llm-seam launch is addressed by backend and
  credential reference at generate time (`packages/dsh-app/src/plugins/llm.ts:56-60`), never by a
  CLI harness, router or Claude profile, so their presence is a contradiction, not an option.
- Uniqueness: the triple `(provider, seam, id)` is unique across the whole document; the second
  occurrence, in any model, is `duplicate` at `models[m].launches[j]`. The pair `(provider, id)`
  may therefore appear once per seam, which is how one provider and one wire id are expressed on
  both dials without a second provider name and without a special case. Within one model a
  provider may appear on both seams and may appear more than once on one seam with different ids.
- `roles[r].restrictions.seams`: duplicate-free subset of `SEAMS` (`dangling-reference`), joining
  `transports`, `harnesses`, `providers`, `families`, `models`.
- `placements.entries[i].model` must equal the `id` of at least one launch whose `seam` is `llm`
  (`dangling-reference` at `placements.entries[i].model`). Placements are the llm seam's
  where-a-model-runs table and are matched by the generate-time model string (`adapter.ts:284`);
  a subagents-only id there would name nothing the adapter can serve. The rest of the placement
  section is unchanged.
- Invariants at the launch (unchanged codes, seam-aware): `opencode-without-router` and
  `router-outside-opencode` for subagents-seam launches; `relay-without-profile` for a
  subagents-seam launch over `openrouter` transport whose harness is not `opencode` or
  `opencode-run` and that names no profile. An llm-seam `openrouter` launch needs no profile.

### Fixture F-2 changes

- `providers` becomes seven identities with no seam: `"claude": {}`, `"codex": {}`, `"agy": {}`,
  `"github_copilot": {}`, `"opencode_go": {}`, `"ollama": {}`, `"openrouter": {}`; the
  precedence list is unchanged (verbatim from the CLI export).
- `muse_spark_1_3` carries two launches on the same provider and id, one per seam:
  `{ "provider": "openrouter", "seam": "subagents", "id": "synthetic/muse", "harness": "claude", "transport": "openrouter", "profile": "relay-profile", "effortSupport": { "status": "unknown" } }`
  and `{ "provider": "openrouter", "seam": "llm", "id": "synthetic/muse", "transport": "openrouter", "effortSupport": { "status": "known", "supported": ["low", "medium", "high", "xhigh"], "unsupported": ["max"], "why": "synthetic fixture value, shaped like the anonymized report on #273; not verified capability" } }`.
  This is the dual-seam expressibility example and the one `known` evidence example (A-1.2).
- Every other launch is `"effortSupport": { "status": "unknown" }` and every subagents-seam launch
  states its `seam` explicitly; `deep_research.restrictions` becomes
  `{ "seams": ["subagents"], "transports": ["native"], "harnesses": ["agy", "codex", "codex-run"] }`.
- One llm-seam launch exists for the placed local model (provider `ollama`, seam `llm`,
  transport `native`, id `synthetic-local`), and the placement entry references that id.
- The provenance sentence adds: "launch seams, ids and effort evidence are synthetic; every
  `unknown` is a genuine unknown, and the single `known` entry is a synthetic shape, not fleet
  capability."

### Tests

- T-F5 rows replaced: the two harness rows (`plan.md:749-750`) become "harness absent on a
  subagents-seam launch → `missing-key`", "harness present on an llm-seam launch → `unknown-key`
  at the launch with the key index", plus "router/profile/preset on an llm-seam launch →
  `unknown-key`", "`seam` absent → `missing-key`", "`seam: \"relay\"` → `dangling-reference`",
  "provider record with an extra key → `unknown-key`", "`description` empty → `empty`",
  "`restrictions.seams: [\"cli\"]` → `dangling-reference`", "placement model equal to a
  subagents-only launch id → `dangling-reference`", "the same `(provider, seam, id)` repeated in
  one model → `duplicate` at the second launch", "the same `(provider, seam, id)` in two models →
  `duplicate` at the second model's launch", and an acceptance row: "the same `(provider, id)` on
  both seams loads".
- T-F16 (new) dual-seam provider: from F-2, `launchesOf(F, "muse_spark_1_3")` has two entries
  with equal `provider` and `id` and different `seam`; `launchesOf(F, "muse_spark_1_3", { seam: "llm" })`
  has exactly one; a tailored document T2 whose single provider `local` is used on both seams by
  one model loads clean; changing F-2's llm-seam muse launch to `seam: "subagents"` is refused
  `duplicate`; a role restricted to `seams: ["llm"]` counts only the llm launch in feasibility
  (A-1.3 worked example 4).

### Boundary table rows (replace `plan.md:125-126` right-hand cells)

Data: provider identities and their optional description; provider precedence order; per-launch
seam, transport, harness, router, profile, preset, subscription, wire id and effort evidence.
Structural: `SEAMS`, `TRANSPORTS`, `SUBSCRIPTION_STATES`, `HARNESSES`, `ROUTERS` as before.

## A-1.2 — F2: required per-launch effort evidence

### Field and vocabulary

`effortSupport` is required on every launch. `EFFORT_SUPPORT_STATES = ["unknown", "known"] as const`
is a structural keyword vocabulary in `src/fleet.ts`, the same kind of pair as
`CERTIFIES_KEYWORDS`: a mechanism must give each word a meaning, and the CLI prints neither.

### Validation rules and contradiction diagnostics

| Rule | Code and path |
|---|---|
| `effortSupport` absent | `missing-key` at `models[m].launches[j].effortSupport`; absence never means "all document efforts" |
| `status` absent | `missing-key` at `...effortSupport.status` |
| `status` not in `EFFORT_SUPPORT_STATES` (`"maybe"`, `true`, `1`) | `dangling-reference` (string) or `wrong-type` (non-string) at `...effortSupport.status` |
| `status: "unknown"` with `supported` or `unsupported` present | `unknown-key` at `...effortSupport[k]`: an unknown launch cannot also list what it supports |
| `status: "known"` without `supported` | `missing-key` at `...effortSupport.supported`; the required list must be explicit, even when empty |
| `supported` or `unsupported` not an array, or a member not a string | `wrong-type` at the field or member path |
| a member not in the document's `efforts.ordered` or `efforts.unordered` | `dangling-reference` at `...effortSupport.supported[k]` or `.unsupported[k]` |
| a member repeated within one list | `duplicate` at its index |
| an effort present in both `supported` and `unsupported` | `duplicate` at `...effortSupport.unsupported[k]`: one launch cannot both support and refuse an effort |
| `why` absent on `known` | `missing-key` at `...effortSupport.why`; declared capability that cannot say why it says so is not evidence (the placement `why` rule, `llm-local/src/capability.ts:32-33`) |
| `why` present but empty or over 4,096 characters | `empty` or `out-of-range` |
| any other key | `unknown-key` at `...effortSupport[k]` |

`supported` may be empty under `known`: no effort is then declared supported. Only entries in
`unsupported` are declared unsupported; every other effort remains unknown. If both lists are empty,
all effort support remains unknown despite the envelope status. `why` is optional under `unknown`.

### Semantics the loader fixes and later steps inherit

- For a launch L and a declared effort e: e is declared supported iff `status` is `known` and e is
  in `supported`; declared unsupported iff `status` is `known` and e is in `unsupported`; otherwise
  e is unknown on L. Unknown is a lawful, first-class state and is the only state a document may
  leave by silence.
- No implicit all-supported: there is no field, default, wildcard or helper that marks every
  effort supported. No conversion: there is no adjacency, ladder walk, downgrade or approximation
  from one effort to another anywhere in version 2; a cell's `max` is never read as `xhigh`. No
  unsupported-from-silence: a launch that does not mention an effort has not refused it.
- A cell candidate `{ model, effort }` is a validated request. It does not prove the launch
  supports that effort and it need not be a subset of any `supported` list. The document may
  legitimately say "the fleet asks for `max` here" and "this launch's `max` support is unknown"
  at once, which is the fresh export's own situation for `complex.implementation_evaluation`
  (`matrix-full-resume.json`, tier `complex`).
- Declared `known` evidence in a document is a declaration with a stated reason, not live
  availability. Schema `known` does not certify live dispatch any more than schema `unknown` does;
  live capacity, entitlement and preflight remain probe evidence (`packages/routing/src/probe.ts`,
  research R-1 of the prior run) and #274 detection. #273 must not present a configured cell as an
  executable route: it must read `effortSupport` for the launch it selects, treat `unknown` as
  not proven, treat declared unsupported as a refusal reason distinct from a capacity refusal, and
  never convert. #274 detects into observations compared against this declared field; it does not
  rewrite the document.

### Invariant `effort-unsupported` (new `PolicyCode`)

For a candidate `(m, e)` in a tier cell of role R: let `L*` be the launches of `m` that satisfy
R's restrictions and, when R has `certifies` other than `none`, relay approval on that same launch
(A-1.3 predicate, clauses c1 and c2). If `L*` is non-empty and every launch in `L*` declares `e`
unsupported, refuse with `effort-unsupported` at `tiers[t].cells[r]`, index of the candidate. For a
coordinator candidate, which has no role, `L*` is every launch of `m`; the location is
`coordinators[s]`, index. A launch with `status: "unknown"`, or `known` without `e` in
`unsupported`, keeps the candidate admissible. If `L*` is empty, `constraint-violated` or
`relay-evaluator-unapproved` fires instead (precedence in A-1.3).

Role scoping is the one place this amendment is stricter than the evaluator's phrasing ("every
launch of that model"): a `deep_research` candidate at `max` whose only native launch declares
`max` unsupported is infeasible for that role even if a relay launch supports `max`, because the
relay launch cannot serve the role. The evaluator may object; the alternative (all launches) is a
one-line change in the predicate and one test row.

### Fixture and tests

- F-2: every launch `unknown` except the single `known` muse llm-seam launch (A-1.1), labelled
  synthetic in its `why` and in the provenance. F-2 loads clean: the complex `muse/max` candidates
  keep an `unknown` subagents-seam launch, so `effort-unsupported` does not fire.
- T-F15 (new) effort evidence: after loading F, `effortEvidence(F, "muse_spark_1_3", 1, "max")`
  is `"unsupported"`, for `"xhigh"` is `"supported"`, for launch 0 and any effort is `"unknown"`;
  for every launch of every model in F, every declared effort not named in a list reports
  `"unknown"` (data-driven over F); `fleet.ts` exports no name containing `convert`, `downgrade`,
  `approximate`, `nearest` or `ladder`, and `effortEvidence` returns only the three words; the
  contradiction table above is one T-F5 row each (eleven rows); a `known` launch with empty
  `supported` loads.
- T-F6 rows: `effort-unsupported` on a cell candidate whose every restriction-satisfying launch
  declares its effort unsupported; the same document with one of those launches set to `unknown`
  accepted; a coordinator candidate whose every launch declares its effort unsupported refused at
  `coordinators[s]`; a candidate whose only unsupported declaration sits on a launch that fails the
  role's restrictions accepted (that launch is outside `L*`) unless `L*` is then empty, in which
  case `constraint-violated` fires and not `effort-unsupported`.
- Research addendum E-14: per-launch effort support is not exported by the CLI; the fixture's
  single `known` entry is synthetic; #274 detection and #275 export support own its authoritative
  values. Research addendum C-12: the CLI's cell effort and physical support are different facts,
  by owner and observed evidence cited above.

## A-1.3 — F3: independence over feasible evaluators

### The feasibility predicate (replaces D-13's and D-17's feasibility wording)

    satisfies(L, m, R) :=                                                        // clause c1
        (R.restrictions.seams      is absent or contains L.seam)
      and (R.restrictions.transports is absent or contains L.transport)
      and (R.restrictions.harnesses  is absent or (L.harness is present and contained))
      and (R.restrictions.providers  is absent or contains L.provider)
      and (R.restrictions.families   is absent or contains family(m))
      and (R.restrictions.models     is absent or contains m)
    approved(L, m, R) :=                                                         // clause c2
        R.certifies is absent or R.certifies is "none"
      or L.transport is not "openrouter"
      or models[m].approvedRelayEvaluator is true
    notRefused(L, e) := not (L.effortSupport.status is "known" and e in L.effortSupport.unsupported)   // clause c3
    feasibleLaunches(m, e, R) := { L in models[m].launches | satisfies(L, m, R) and approved(L, m, R) and notRefused(L, e) }
    capable(m, R) := R.requires is absent or every member is in models[m].capabilities
    feasibleCandidate((m, e), R) := capable(m, R) and feasibleLaunches(m, e, R) is non-empty
    feasibleEvaluator(c = (m_c, e_c), d = (m_d, e_d), E) := family(m_d) is not family(m_c) and feasibleCandidate(d, E)

All three launch clauses are evaluated on the same launch `L`; a model whose native launch
satisfies the restrictions while its relay launch carries the approval, or whose one launch
supports the effort while another satisfies the restriction, has no feasible launch. `e_d` is the
evaluator candidate's own cell effort, the effort the document asks the evaluator to run at, not
the generator's. `unknown` on clause c3 is not refusal and is not support.

### Invariants, restated (replaces the D-17 table)

Per candidate, evaluated in this order; the first failing clause produces the candidate's single
problem and the remaining clauses are not evaluated for it:

| Order | Code | Fires when | Location |
|---|---|---|---|
| 1 | `capability-unsatisfied` | not `capable(m, R)` | `tiers[t].cells[r]`, index |
| 2 | `constraint-violated` | no launch satisfies clause c1 | same |
| 3 | `relay-evaluator-unapproved` | some launch satisfies c1 but none satisfies c1 and c2 | same |
| 4 | `effort-unsupported` | some launch satisfies c1 and c2 but every such launch declares `e` unsupported | same; `coordinators[s]`, index, with c1 and c2 vacuous |
| 5 | `no-independent-evaluator` | for a candidate `c` of a generation role G that passed 1 to 4: some evaluation role E with `certifies: "any"` and G in `E.evaluates` has no `d` in the same tier's E cell with `feasibleEvaluator(c, d, E)` | `tiers[t].cells[g]`, index of `c` |
| — | `lane-unrouted` | a lane whose target cell is empty | `lanes[i]` |
| — | `opencode-without-router`, `router-outside-opencode`, `relay-without-profile` | per launch, A-1.1 | `models[m].launches`, index |

An evaluator candidate `d` that fails its own checks 1 to 4 in its own cell is reported there and
also does not count for any generator; the predicate uses the same clauses, so the two statements
cannot disagree. Roles with `certifies: "none"` are never a gate and never trigger order 5; their
candidates still get orders 1 to 4. Empty evaluation cells with a non-empty paired generation cell
still refuse every generator candidate under order 5, as before.

### Worked examples (each is a T-F6 row)

1. The evaluator's counter-example. E has `restrictions.transports: ["openrouter"]`; `d`'s model
   has a `native` launch and an unapproved `openrouter` launch. c1 admits only the relay launch;
   c2 rejects it; `feasibleLaunches` is empty; `d` does not count; `no-independent-evaluator`
   fires on the generator. The same document with `approvedRelayEvaluator: true` on `d`'s model
   passes. Under the locked plan's D-17 this document loaded clean; that is the defect.
2. Capability. E has `requires: ["vision"]`; the only different-family `d` lacks `vision`; a
   same-family candidate has it. `capable` fails for `d`; `no-independent-evaluator` fires.
3. Effort. `d = (m_d, "max")`; every launch of `m_d` that satisfies E declares `max` unsupported;
   `d` does not count. Setting one of those launches to `unknown` makes `d` count again.
4. Seam per launch. E has `restrictions.seams: ["llm"]`; `m_d` has a subagents-seam launch and an
   llm-seam launch on the same provider and id (F-2's muse). Only the llm launch satisfies c1; it
   is `known` with `max` unsupported, so `d = (muse, "max")` does not count under E, while
   `d = (muse, "xhigh")` does. With E unrestricted, the subagents-seam `unknown` launch satisfies
   all clauses and `d = (muse, "max")` counts.
5. Precedence. One candidate whose model lacks the required capability and has no
   restriction-satisfying launch yields exactly one problem, `capability-unsatisfied`; removing the
   capability defect yields exactly one problem, `constraint-violated`; and so on down the table.
   The row asserts `problems.length === 1` at each stage.

### What remains #273

Ordering candidates, choosing the launch by provider precedence, selecting the first evaluator
whose family differs from the generator actually selected including after fallback, throwing when
none exists, reading `effortSupport` for the selected launch, and refusing to present a cell as an
executable route: all #273, unchanged from D-21. The predicates above are exported as pure
functions (`feasibleLaunches`, `feasibleCandidate`, `feasibleEvaluator`) that return sets in
document order and choose nothing; T-F13 still asserts that no `resolve*`, `admit*` or `select*`
name exists in `fleet.ts`.

## A-1.4 — F4: documentation surfaces

- M-16 is deleted. `docs/concepts/06-the-three-layers.md` is not touched. Its delegation-matrix
  paragraph at this head (`06:29-37`) already states the intended product: one wholly replaced
  document, version 1 as lane chains, the shipped document a compatibility transcription, not
  fleet parity. The plan's `06:29-33` anchors were pre-#281 line numbers for the same paragraph;
  the paragraph's meaning did not change (`git diff 8fd096d..HEAD` on the file shows changes only
  in the contracts and consumer-naming sections, executed 2026-09-08).
- `packages/README.md:20` is not touched.
- Version-2 field mechanics, the consumer boundary, effort evidence semantics, dual-seam launches,
  the fixture directory and the `unsupported-by-consumer` refusal live in `packages/routing/README.md`
  (M-9, extended). The `routing-unsupported` dry-run refusal and the "boots but is not
  dispatchable until #273" note live in `packages/dsh-app/README.md` (M-15, unchanged).

## Consolidated amended design pack

Root keys are unchanged from `plan.md` (design pack). The excerpt below shows only what this
amendment changes in fixture F-2; every omitted section is as the locked plan shows it.

    "providers": { "claude": {}, "codex": {}, "agy": {}, "github_copilot": {}, "opencode_go": {}, "ollama": {}, "openrouter": {} },
    "providerPrecedence": ["claude", "codex", "agy", "github_copilot", "opencode_go", "ollama", "openrouter"],
    "models": {
      "fable_5_1": { "family": "anthropic", "capabilities": ["vision"], "launches": [
        { "provider": "claude", "seam": "subagents", "id": "synthetic-fable", "harness": "claude", "transport": "native", "effortSupport": { "status": "unknown" } } ] },
      "muse_spark_1_3": { "family": "meta", "approvedRelayEvaluator": true, "launches": [
        { "provider": "openrouter", "seam": "subagents", "id": "synthetic/muse", "harness": "claude", "transport": "openrouter", "profile": "relay-profile", "effortSupport": { "status": "unknown" } },
        { "provider": "openrouter", "seam": "llm", "id": "synthetic/muse", "transport": "openrouter",
          "effortSupport": { "status": "known", "supported": ["low", "medium", "high", "xhigh"], "unsupported": ["max"], "why": "synthetic fixture value, shaped like the anonymized report on #273; not verified capability" } } ] },
      "gemini_3_8_flash": { "family": "google", "capabilities": ["vision", "deep_research"], "launches": [
        { "provider": "agy", "seam": "subagents", "id": "synthetic-gemini", "harness": "agy", "transport": "native", "effortSupport": { "status": "unknown" } } ] },
      "qwen_3_8_flash_next": { "family": "open", "launches": [
        { "provider": "ollama", "seam": "llm", "id": "synthetic-local", "transport": "native", "effortSupport": { "status": "unknown" } } ] }
    },
    "roles": {
      "deep_research": { "requires": ["deep_research"], "restrictions": { "seams": ["subagents"], "transports": ["native"], "harnesses": ["agy", "codex", "codex-run"] } }
    },
    "placements": { "backends": ["lm-studio"], "entries": [{ "model": "synthetic-local", "backend": "lm-studio", "verdict": "runs", "why": "synthetic evidence" }] }

`muse_spark_1_3` gains `approvedRelayEvaluator: true` in the fixture because its only launches
are relay launches and it sits in evaluation cells; without the approval the amended
`relay-evaluator-unapproved` would fire on those candidates. That is a synthetic fixture choice,
labelled, not a fleet fact (research E-11).

`PolicyCode` gains exactly three members: `no-independent-evaluator`, `capability-unsatisfied`,
`effort-unsupported`. `InvalidCode` gains none. The five refusal kinds are unchanged. The loader
contract in `plan.md` is unchanged except that `checkFleetPolicy` implements the amended table and
`fleet.ts` additionally exports `effortEvidence(configuration, model, launchIndex, effort)`,
`launchesOf(configuration, model, filter?)`, `feasibleLaunches`, `feasibleCandidate` and
`feasibleEvaluator`, all pure. `STRUCTURAL_FIELDS` additionally gains `seam`, `effortSupport`,
`status`, `supported`, `unsupported`, `seams`, `description` (already present for provenance).

Boundary table delta: add the structural row `EFFORT_SUPPORT_STATES = ["unknown", "known"]`, the
two words an enforcer must interpret; the data column gains per-launch effort evidence.

## Amended mutation manifest (delta only; all other items as locked)

- M-2 `src/fleet.ts`: types per A-1.1 and A-1.2; `EFFORT_SUPPORT_STATES`; validator rules per
  A-1.1 and A-1.2 including the eleven contradiction diagnostics; `checkFleetPolicy` per the
  A-1.3 table with the precedence order; pure accessors and predicates per A-1.3.
- M-5 `src/resolve.ts`: `PolicyCode` gains three members, not two.
- M-7 `test-fixtures/fleet-shaped.v2.json`: reshaped per A-1.1 and A-1.2; `test-fixtures/matrix-full.8ba53bc.json`
  unchanged (the fresh `matrix-full-resume.json` at NetScript `8eaa8c54` is byte-identical to the
  original export, `cmp` executed 2026-09-08, so the fixture name may cite either source; the
  provenance names both).
- M-8 tests: T-F5 rows per A-1.1 and A-1.2; T-F6 replaced per A-1.3; T-F15 and T-F16 added;
  completeness assertions count three new `PolicyCode` members; T-F2, T-F7, T-F12, T-F13 as locked.
- M-9 `packages/routing/README.md`: sections for provider identities and per-launch seam, effort
  evidence semantics (unknown, no conversion, no silence-as-unsupported), the feasibility
  predicate in prose, and the fixture labelling.
- M-16: deleted. No change to `docs/concepts/06-the-three-layers.md` or `packages/README.md`.
- Everything else (M-1, M-3, M-4, M-6, M-10 to M-15) exactly as locked; the `dsh-app` boundary,
  narrowers, dry-run refusal and llm plugin change are untouched by the findings.

Mutation surface, complete: `packages/routing/src/{schema,load,resolve,index}.ts` modified;
`packages/routing/src/{fleet,document}.ts` created; `packages/routing/src/{load,schema}.test.ts`
modified and `fleet.test.ts` created; `packages/routing/test-fixtures/{matrix-full.8ba53bc,fleet-shaped.v2}.json`
created; `packages/routing/README.md` modified; `packages/dsh-app/src/{dry-run,dry-run-internal}.ts`,
`plugins/llm.ts` modified; `packages/dsh-app/src/{dry-run,plugins,llm/adapter}.test.ts` modified;
`packages/dsh-app/README.md` modified. Nothing else.

## Baseline and evidence updates

- Head is `1d5df95`; `9b120d2..1d5df95` touches only run artifacts, and the schema consumer paths
  are byte-identical to `8fd096d` (both executed). The coordinator's `baseline-verification.md`
  records the routing suite passing at `1d5df95` (205 tests); that is baseline evidence and passes
  neither the schema nor this plan. The
  contracts source is at `0.4.0` after #282 with `0.3.0` published; this step changes no contract
  and claims nothing about either (`resume-amendment.md`).
- `scripts/check-snapshots.mjs` gained an exact path-and-digest inventory for contracts fixtures
  (`SYNTHETIC_CONTRACT_FIXTURES`, `scripts/check-snapshots.mjs:84-93` at head) and skips only those
  paths. The two routing fixtures are not contract evidence and are not inventoried; they remain
  subject to the time-sliding-key and name rules, which none of their keys or names match
  (`plan.md` G-1 stands). No gate change.
- The fresh `matrix-full-resume.json` (NetScript `8eaa8c54`) is byte-identical to the original
  `matrix-full.json` (`8ba53bc`); the fresh role-mode `matrix-plan-eval*.json` select
  `muse_spark_1_3/max` then `grok_4_6/xhigh` with `maxRounds 1`, `escalateToOwnerAt 2`,
  `reSteerSameSession true`. The evaluation ran on the fallback row through OpenRouter at `xhigh`
  (`plan-eval-routing.md`). The plan's "Evaluation route" section is stale prose, not launch
  authority; the fresh files are.
- The loop's single round is consumed by this repair. A second Stage G pass requires owner
  escalation per the fresh policy; the coordinator owns that call. Nothing here launches a
  reviewer or infers a verdict.

## Unchanged and reaffirmed

D-1 to D-4, D-6 (except the capability rationale now reads with A-1.2), D-7 to D-9, D-11, D-12,
D-14 to D-16, D-18 to D-21; the consumer boundary table; `laneRouting`, `fleetRouting`,
`placementsOf`; the dry-run `routing-unsupported` refusal before any store read; cells as
`{ model, effort }` in CLI order with empties and repeats; loop words preserved with no
cross-field rule; coordinators by scope; precedence as a permutation; lanes with `lane-unrouted`;
strict unknown-key refusal with D-3 index paths; wholesale replacement (T-F7); no compiled fleet
constants (T-F12, the AST gate); the shipped default stays version 1 and no fleet document ships;
#273, #274 and #275 remain separate.

## Owner forks

None opened. Two engineering choices the evaluator's wording left open, flagged for its
attention rather than for the owner: the role scoping of `effort-unsupported` (A-1.2) and the
requirement of `why` on `known` evidence (A-1.2). Both follow existing house rules (v1
`constraint-violated` is role-scoped; placement records require `why`) and each has a one-line
alternative.

## Actual unresolved ambiguity

- Whether #274 will represent detection observations as a separate document section or as
  external observations compared against `effortSupport`. This amendment fixes only the declared
  field and its semantics; either #274 design reads it. Not a blocker for #272.
- The complex evaluator row (`muse/max` twice) with a retained report of `max` rejection over
  OpenRouter is an operational gap owned by #273 and #274 (their comments cited above). Version 2
  can now state that situation faithfully (`unknown` or declared unsupported per launch, request
  `max` in the cell) and refuses only when the document itself says no feasible launch supports
  the effort. It does not resolve the gap and does not claim to.

[source: `plan.md` at `324a3de` sections named above; topic: superseded text; consulted 2026-09-08]
[source: `packages/routing/src/family.ts:31,41-54`, `packages/dsh-app/src/plugins/llm.ts:56-60`, `packages/dsh-app/src/llm/adapter.ts:284`, `packages/llm-local/src/capability.ts:32-33`, `scripts/check-snapshots.mjs:84-93`, `docs/concepts/06-the-three-layers.md:29-37` at `9b120d2`; topic: seam identity, llm-seam addressing, placement matching, evidence `why`, gate inventory, intended-product paragraph; inspected 2026-09-08]
[source: `matrix-full-resume.json`, `matrix-plan-eval.json`, `matrix-plan-eval-fallback.json`, `plan-eval-routing.md`; topic: fresh authority, evaluator route and loop policy; consulted 2026-09-08]
