# routing-configuration--271 — plan

Stage E artifact for issue #271, step 1 of E11 (#270). Amended once before evaluation by the
coordinator's normative disposition (`coordinator-disposition.md`), which takes precedence
wherever this text and it differ; every amendment is applied below and logged in `drift.md`
D-014. Locked for independent evaluation; any change after evaluation is recorded in `drift.md`,
not edited here. No product mutation has occurred. Baseline
`4c813fe10218e471f5d78a2dc45bd805ec260749`.

## Summary

Replace the compiled routing table with a loader. `@rickylabs/routing` stops exporting any model,
lane, tier, effort, family, profile, preset or depth constant and instead exports
`loadRoutingConfiguration`, `validateRoutingConfiguration`, and the same resolver, family,
admission and probe functions it has today with a leading `configuration` parameter. The
configuration is a single JSON document with `schemaVersion: 1`, read by path, digested over its
raw bytes, validated strictly with no defaults filled, checked against the existing table
invariants, and refused with one of five distinct refusal kinds on any failure. There is no
module-level table, no global setter and no compiled fallback; a shipped default is one JSON
file that the composition root must name explicitly.

Schema version 1 is deliberately the shape the table has today, four tiers by implement/review
over 23 lanes, so that consumers keep working and the transcription can be reviewed line by line
against the deleted TypeScript. The document's own name and provenance say it is not a fleet
instance. Step 2 owns the fleet shape; step 3 owns generator-relative evaluator selection; this
plan removes the resolver's `"openai"` literal by reading the author family off the loaded
implementation primary and does nothing more clever than that.

Two consumers change: `llm-local`'s placement table, which is keyed by routing's ids and becomes
a section of the same document (OF-1, resolved A by the coordinator), and `dsh-app`, which gains
a `harness-routing` profile row with an explicit, portable document selection (OF-2, resolved A),
injects it into `harness-llm`, and carries the document text through the dry-run driver so the
intent key incorporates a digest the driver computed itself. The published contract is
untouched.

Expected footprint: 13 files modified, 5 created, 2 deleted in `packages/routing`; 3 modified in
`llm-local`; 9 modified and 1 created in `dsh-app`; one new root script wired into `build`; 6
documentation files; one golden re-bless. Roughly 136 routing tests re-targeted at fixture
documents plus about 55 new loader, bounds, replacement and consumer cases.

## Coordinator amendment, applied

Each line of `coordinator-disposition.md` and where it now binds this plan.

| Amendment | Applied in |
|---|---|
| OF-1 selects A; routing owns placement record types and validates references, shape and duplicate pairs; backends are bounded opaque strings at routing's boundary; llm-local validates mechanism kinds and refusal vocabulary; unsupported backend is a composition refusal, never dropped; observed refusals carried into the transcription unchanged; totality by explicit membership; empty membership legal; health callers inventoried | OF-1 (resolved), D-13, D-15, schema `placements`, manifest M-14 to M-16 and M-16b, T-C1, T-C6 |
| OF-2 selects A; explicit document location; the shipped profile may carry an explicit portable setting, never a fallback accessor; no operator path in patch or golden; package file list and asset resolution include the document; an executable check loads it from the packed layout | OF-2 (resolved), D-9, D-10, D-14, manifest M-13, M-17, M-18, T-L1b, T-L1c, T-C3 |
| Fixed error codes and structural paths; no raw OS or JSON exception text; no document values; source location in provenance, not in error strings; longest-name truncation is not redaction; credential-shaped values in malformed content and unknown keys must not escape | D-2 (revised), loader contract (revised), T-L8 |
| Bound bytes, depth and collection sizes before validation; reject accessors, cycles, non-plain objects and prototype tricks; clone and deep-freeze; no mutable global activation; reject duplicate records and reserved family names | D-16, schema bounds, T-L9, T-L10 |
| Pure `parseRoutingDocument` over bounded UTF-8 text plus a logical source id, computing the raw-byte digest itself; the file loader delegates; the dry-run carries the document text, never a caller-asserted digest; no filesystem read inside the dry-run; the intent key incorporates the computed identity | D-3 (revised), D-9 (revised), D-17, loader contract, manifest M-2, M-20, T-D1 to T-D3, T-C2 |
| Durable records may exist outside tests; a configuration change intentionally changes the input revision; pending or unknown intent stays guarded by the store's admission and fencing; regression that a changed configuration cannot bypass or resend; protocol 1 and unknown semantics preserved | R-6 (revised), S-4, T-C7 |
| Structural transport, trigger and subscription keywords may stay compiled as a boundary for the evaluator to attack; not permission to retain compiled route assignments | D-4 unchanged; boundary table |
| Full export now retained as `matrix-full.json`; no full parity claimed; the default document is a labelled transcription; extra families alone do not fix #181; #148 and #181 stay gated | S-3, D-10, D-8, research C-4 |
| The compiled-policy regression covers runtime consumer code as well as routing, distinguishes test fixtures and comments from executable assignments, and proves it detects a newly introduced assignment | D-18, T-R1 (revised), manifest M-24 |

## Acceptance map

| #271 box | Delivered by | Proven by |
|---|---|---|
| 1. Load one explicit versioned document; record source identity and digest; defaults are data only | D-1, D-2, D-3, D-10, D-14, D-17; manifest M-1 to M-4, M-13 | T-L1, T-L1b, T-L1c, T-L2 to T-L6, T-D1 to T-D3; shipped default loads under `check:snapshots` and resolves from the packed layout |
| 2. Remove production model, tier, effort, route, subscription and CLI-version literals, including hidden compatibility defaults; structural schema stays code | D-4 to D-8, D-13, D-18; manifest M-5 to M-9, M-12, M-14, M-24; boundary table below | T-R1 (an AST gate over every package's runtime sources that proves it catches a newly introduced assignment), review of the deleted files against the shipped JSON |
| 3. Baseline validation rejects unreadable, malformed, missing-required, unknown input; no fallback to the compiled table; unsupported/unknown kept distinct | D-2, D-5, D-6, D-16; loader contract | T-L2 to T-L6 (one case per code and per structural rule), T-L7 (invariant refusal), T-L8 (nothing escapes the diagnostic boundary), T-L9 and T-L10 (bounds and hostile values) |
| 4. Two disjoint documents replace one another without retained routes, models or policy values | D-1, D-11, D-16 (frozen, no global activation) | T-W1 to T-W5 |
| 5. Dependency for #148 and #181 concrete; not called unblocked | D-8, research "Downstream dependency", DAG | The plan and the PR description name the exact semantics still missing (`meta` family, CLI keys, role cells, generator-relative selection) and the steps that supply them |

## Boundary: what stays code, what becomes document

| Stays in TypeScript (structural) | Becomes document data (configuration) |
|---|---|
| The schema itself: field names, required-ness, reference rules, `schemaVersion` gate | Every model id and its family binding (research L4 to L9) |
| Resolver semantics: primary is `when: []`; fallback walks forward; turn-boundary rule; depth check; approval rule for `outside_plan`; author-family matching on `certifies` | The 23 lanes, their purposes, and the 40 route steps with harness, transport, model, effort, router, profile, preset, `when`, `certifies`, `subscription`, escalations, notes (L10, L11, L15) |
| Certifies discipline: `evaluation` steps declare `certifies`; non-evaluation steps may not; `any` and `none` keywords; self-certification refused; every implementation step needs a reviewer | Family vocabulary (L1) and effort vocabulary with order (L3) |
| Transport kinds `native` and `openrouter` and the relay rules keyed on them (L2, L22) | Tiers and their implement/review lane pairing (L16) |
| Fallback trigger names (L12) | Lane constraints and deep-research lanes (L17) |
| Subscription keywords `included` and `outside_plan` (L13) | Relay profile and preset names (L14) |
| Seams `subagents` and `llm` (L23); harness twin mapping (L20); credential shapes (L21) | Approved relay evaluators (L8) |
| Harness and router vocabularies, owned by `subagents` (L25) | `maxFallbackDepth` (L18) |
| Probe vocabulary, freshness default, metadata marker (L24) | The reviewer family, derived from data instead of the literal (L19) |

Reviewable calls: L2, L12 and L13 are classified structural because the resolver interprets
them and the fleet's CLI export has no equivalent to compare against. If the evaluator reads the
owner's "route" or "subscription" literals to include them, the change is contained: each becomes
a document-declared list validated the same way as efforts, and the three code sites that key on
a value (`resolve.ts:215,219,342,369`, `admit.ts:397-407`) key on a schema keyword instead.

## Decisions

### D-1 — No module state; every routing function takes the configuration first

`familyOf(configuration, model)`, `lanePolicy(configuration, lane)`, `resolveRoute(configuration,
lane, authorFamily?)`, `resolveFallback(configuration, request)`, `resolveEffort(configuration,
step, condition?)`, `tierPlan(configuration, tier)`, `checkPolicy(configuration)`,
`checkEvaluator(configuration, assignment)`, `admitDispatch(configuration, dispatch, context?)`,
and every query helper in `admit.ts`. `toDispatch`, `selfCertifies` and `unreviewedSteps` take the
configuration too because they read families. `probe.ts` is unchanged.

Rationale: a function of its arguments cannot retain a value from a previous document, which is
what acceptance box 4 asks to prove; this is also how `selectEvaluator(author, candidates,
policy)` and `checkTargets(table)` already work (`packages/coordinator/src/independence.ts:235-239`;
`packages/forge/src/targets/model.ts:232`).

Rejected: a `bindRouting(configuration)` object mirroring today's names. It halves call-site
churn but every method closes over state, and a `bindRouting()` with no argument is one commit
away from a hidden default. Rejected: a module-level `setConfiguration()`; it is a global by
another name and would make the replacement proof depend on call order.

### D-2 — One loader, five refusal kinds, nothing filled in

`parseRoutingDocument(text, sourceId)` and the file loader that delegates to it return either
`{ ok: true, loaded }` or `{ ok: false, refusal }` where `refusal.kind` is exactly one of five
and every refusal carries fixed codes and structural paths only:

- `unreadable`: the file cannot be read or is larger than the byte bound. Codes: `absent`,
  `not-a-file`, `permission`, `too-large`. No OS error text is copied; the source id is not in
  the refusal because it is already the caller's own input and belongs in provenance.
- `malformed`: the text is not JSON, is not UTF-8, or its root is not a plain object. Codes:
  `not-json`, `not-utf8`, `root-not-object`. No parser message is copied.
- `unsupported-schema-version`: `schemaVersion` is absent, not an integer, or not `1`. Carries
  `seen` (an integer or `null`, never a document string) and `supported: [1]`. Kept distinct from
  `invalid` so step 2 can add `2` and a version 1 loader says "too new" rather than "broken".
- `invalid`: structural problems, each `{ code, path }` with a dotted path such as
  `lanes[4].chain[1].route.model` and a code from the closed list `unknown-key`, `missing-key`,
  `wrong-type`, `empty`, `duplicate`, `dangling-reference`, `reserved-name`, `out-of-range`,
  `depth-exceeded`, `size-exceeded`, `not-plain-data`. All problems are collected; none carries a
  document value.
- `invariant`: well-formed but violating a table rule. `PolicyProblem` gains a `code` from the
  closed list `self-certifies`, `evaluation-without-certifies`, `certifies-outside-evaluation`,
  `relay-evaluator-unapproved`, `first-step-not-primary`, `duplicate-primary`, `no-primary`,
  `opencode-without-router`, `router-outside-opencode`, `relay-without-profile`,
  `escalation-not-raising`, `escalation-not-comparable`, `constraint-violated`, `tier-unresolved`,
  `unreviewed-step`, `duplicate-lane`, `lane-unrouted`, and carries `lane` and `index` as it does
  today; the prose `message` is derived from the code by `describeLoadRefusal`, never from the
  document.

No defaults are applied for any absent field; every field listed as required in the schema is
required, and an unknown key anywhere is `invalid`. `validateRoutingConfiguration(value:
unknown)` is exported separately so tests and step 5 can validate in-memory values, and it is what
`parseRoutingDocument` calls after parsing and the plain-data check (D-16). The longest-name
truncation rule in `admit.ts:243-263` is not relied on here: a refusal never quotes a value, so
there is nothing to truncate.

Rejected: dropping bad entries by index as `roster.ts` does. #270 forbids "a permissive, silently
ignoring loader", and a routing document with one lane dropped is a different matrix wearing the
same name.

### D-3 — Source identity is the bytes

`loaded.source = { id, digest, bytes, schemaVersion, name }`. `digest` is `sha256:` followed by
the full 64-hex SHA-256 of the UTF-8 bytes of the text that was parsed, computed by
`parseRoutingDocument` itself and never accepted from a caller. `bytes` is that byte length.
`name` is the document's own `name` field. `id` is the logical source identifier the caller
passed (a path for the file loader, a label for an in-memory document); it is provenance, and it
appears in no error string.

Rationale: acceptance box 1 says source identity, and the artifact that must be identifiable is
the text that was parsed; a canonical-JSON digest would report two differently formatted files as
one source, and a caller-supplied digest would let content change under an old identity. Consumers that want a semantic digest can compute one from `loaded.configuration`
with `coordinator`'s `digest()`, which already exists (`packages/coordinator/src/canonical.ts:81-83`);
`routing` must not depend on `coordinator` because `dsh-app` composes both and the edge would
invert the graph `check:graph` enforces.

No timestamp is recorded on the source. A load time is a time-sliding fact and the loaded value is
data that may be written into a plan or a receipt (`scripts/check-snapshots.mjs:41-72`).

### D-4 — Structural vocabularies stay closed in code

`TRANSPORTS`, `FALLBACK_TRIGGERS`, `SEAMS`, the subscription keywords, the `evaluation` purpose
keyword, the `any`/`none` certifies keywords and the constraint kinds remain `as const` unions in
`routing`; `HARNESSES` and `ROUTERS` remain in `subagents`. The document is validated against
them: a step's `transport`, `when`, `subscription`, `harness` and `router` must be members.

Rationale: each of these is interpreted by a code path and none names a fleet thing. The CLI
export prints no triggers, no seams and no subscription keywords, so parity has nothing to
compare there. It does print a `transportPriority` list (`claude`, `codex`, `agy`,
`github_copilot`, `opencode_go`, `ollama`, `openrouter`; research C-8), and that list is not what
`TRANSPORTS` is: `TRANSPORTS` is the two-member kind the relay rules key on, while the fleet's
list is provider precedence, which #270 names as configuration and #274 wires into the resolver
as data. Step 1 therefore keeps `TRANSPORTS` closed and leaves the priority list to step 2 and
step 4, and says nothing about whether `HARNESSES` should grow `github_copilot` or `ollama`,
which is E3's vocabulary. The doc sentence "the trigger union is closed at six members"
(`docs/concepts/06-the-three-layers.md:35-36`) stays true.

Rejected: making them document lists. It would satisfy the broadest reading of "route literal"
at the cost of a resolver that keys on strings it did not define, and it would not move parity.
Flagged as reviewable in the boundary table.

### D-5 — The effort vocabulary is data, with order and without it

The document declares `efforts: { ordered: string[], unordered?: string[] }`. `ordered` is the
ladder, lowest first; `unordered` lists efforts that exist but do not sit on the ladder, which is
what the CLI's `provider_default` is. Validation: no duplicates across both lists; every step
effort and escalation effort must be declared; an escalation whose source or target effort is
unordered is an `invariant` problem ("not comparable"), never silently accepted or ordered.
Admission's `unknown-effort` lists both sets as `expected`.

Rationale: research C-1. Rejected: keeping the ladder compiled and adding `provider_default` to it;
that is the hand-edit E11 exists to end.

### D-6 — Families are data; the independence rule is not

The document declares `families: string[]`; every model binds to one; `certifies` on an
evaluation step is a declared family, `any` or `none`. `checkEvaluator` keeps string equality,
which is already how `coordinator` treats families (`independence.ts:50-54`). The `Certifies` type
becomes `string`, with the two keywords documented on the schema.

Rationale: research C-2; the fleet's `meta` family must be sayable by a project document without
a code change. Rejected: a compiled union with `meta` appended.

### D-7 — Models are keyed by the id the wire carries, in version 1

`models: Record<string, { family: string; approvedRelayEvaluator?: true }>`. The key is the
string `DispatchRequest.model` and `RunIdentity.model` will carry, because admission compares
them verbatim (`packages/routing/src/admit.ts:357,385`) and nothing in step 1 translates ids.
Opencode ids stay unprefixed for the wire-format reason `subagents` states (`dispatch.ts:619-620`).

Rationale: research C-3; step 1 must keep today's consumers admitting today's dispatches. The CLI
key namespace (`fable_5_1`, `astra`, and fifteen more in `matrix-full.json`) is a step 2 schema
decision, recorded as spike S-2; the shipped default's `provenance` says its keys are wire ids
and that four of them (`sonnet-5`, `z-ai/glm-5.2`, `x-ai/grok-4.5`, `gemini-3.6-flash-high`)
have no key in the fresh export at all.

### D-8 — `tierPlan` reads the reviewer's author family off the data

`tierPlan(configuration, tier)` resolves the implementation lane, reads the family of the resolved
primary's model from `configuration.models`, and resolves the review lane against that family.
`checkPolicy` keeps `unreviewedSteps` so every implementation step, not only the primary, has a
seat that certifies its family.

Rationale: removes the only family literal in the resolver (research L19) with the smallest
change that does not pre-empt step 3. It does not select an evaluator after a generator fallback,
does not implement "first evaluator whose family differs from the actual generator", and does not
touch `review_codex_complex`'s data. #181 stays open on #272 and #273.

Rejected: deleting `tierPlan` now (it is the only thing that ties a tier to a review lane and
`checkPolicy` uses it); implementing step 3's selection early (scope).

### D-9 — Composition: a `harness-routing` row, injected by `harness-llm` and the dry-run

New `packages/dsh-app/src/plugins/routing.ts` providing `ctx.harnessRouting: RoutingService = {
configuration, source }` plus nothing else; callers use the `routing` package functions. Config
`{ path: string }`; an empty or absent path throws `RangeError` at boot (subject to OF-2), and a
load refusal throws with the refusal kind and problems rendered, the same way `resolvePolicy`
throws on an unknown policy (`plugins/coordinator.ts:99-106`). `harness-llm` adds
`harnessRouting` to `inject` and constructs the adapter with placements from the configuration
(subject to OF-1). `BUNDLE_ROWS` gains the row; `cordis.patch.yml` is re-rendered; the golden is
re-blessed with a one-line reason.

`DryRunPlan` gains `routing: { source: string; text: string }`, the document as text plus a
logical source id (plain data, so `snapshotData` accepts it). `driveSnapshot` checks both are
non-empty strings, calls `parseRoutingDocument(text, source)` in memory (no filesystem read inside
the drive), refuses with a new `DriveRefusal` kind `routing-unusable` carrying the refusal kind
and codes when parsing fails, calls `admitDispatch(loaded.configuration, ...)`, and includes
`routing: loaded.source.digest` in the `inputRevision` digest input (`dry-run-internal.ts:85-88`)
using the digest it computed. Two documents cannot alias one intent key, and asserting an old
digest over new text is impossible because no digest is accepted from the plan.

Rejected: loading the document inside `harness-llm` and again inside the dry-run; two loads, two
digests, and a record that cannot say which one ran. Rejected: passing a path in the plan; a plan
is data and a path is a pointer whose target can change between assembly and attempt. Rejected: a
pre-loaded object with its digest in the plan; the digest would be an assertion, not a
computation.

### D-10 — One shipped default, transcribed, labelled, named explicitly

`packages/routing/config/routing.v1.json` transcribes the compiled table: 14 models, families and
the two relay-evaluator approvals; effort ladder; four families; ten purposes; 23 lanes and 40
steps with their notes; four tiers; four constraints and the deep-research lane list; the profile
and presets; `maxFallbackDepth: 2`. Its `name` is `harness-compiled-table-transcription` and its
`provenance.description` says it reproduces the table deleted in this PR at the baseline commit,
keys models by wire id, and is not a fleet instance. The document is published by the package as the subpath
`@rickylabs/routing/config/routing.v1.json` through its `exports` map and `files` list, so a
composition root names it by that portable specifier; there is no accessor that returns it when
nothing was configured.

Rationale: acceptance box 1 allows a data default; the transcription is what lets a reviewer check
the JSON against the deleted TypeScript in one diff. The file sits outside `src/` because `tsc`
neither copies nor imports JSON here (research R-7).

### D-11 — Fixtures are in-memory documents; the loader is tested on temp files

Test documents are TypeScript object literals typed `unknown`, passed through
`validateRoutingConfiguration` at the top of each suite, so a test cannot run against a fixture
the loader would refuse. The file loader's suite writes documents to `mkdtemp` directories and
loads them by path. The only tracked JSON is the shipped default. This keeps `check:snapshots`'s
surface to one file and keeps model-name literals in tests, where #271 permits them.

### D-12 — Documentation follows the code, and CLI-version facts leave it

`packages/routing/README.md` is rewritten around the loader, the schema and the boundary table;
its example lanes cite the shipped document, and the Codex CLI version observations (0.144.3 and
0.153.4) are removed from README and code and live in this run's `research.md` L4 and L12 until
step 4 gives them a home. `packages/README.md`, `README.md:346`,
`docs/concepts/06-the-three-layers.md:29-36,225-226`, `packages/dsh-app/README.md` configuration
section, and the two provider comments naming `LOCAL_MODEL_IDS` are updated in wording only.

### D-13 — `llm-local` becomes a function of placement data

`capability.ts` exports `placementOf(placements, model, backend)`, `canRun`, `refusalOf`,
`backendsFor`, `placedModels` and `checkCapability(placements)` over the document's `placements`
section, with `BACKENDS` (the mechanism kinds) and the refusal vocabulary staying structural in
`llm-local`. Routing validates shape, references and duplicates (D-15); `llm-local` validates the
values it interprets: `verdict` in `runs`, `refused`, `unverified`; `reason` in `REFUSALS`
exactly when refused; `requires` only when `runs` and non-empty; `backend` in `BACKENDS`. A
placement naming a backend `llm-local` does not support is a composition refusal with a fixed
code in `harness-llm`'s boot, never a dropped entry and never a positive claim. Totality is
explicit: for every model that appears in any entry, an entry must exist for every backend the
section declares; nothing is inferred from an id prefix or from a compiled list. An empty
section is legal, for a project that routes only through vendor CLIs. `health.ts`, `endpoint.ts`
and `backends.ts` keep their behaviour; their only placement-adjacent caller is the adapter's
`resolveEndpoint` call (`packages/dsh-app/src/llm/adapter.ts:271`), inventoried in M-16b.

### D-14 — The shipped profile selects the document explicitly and portably

`BundleRow` gains an optional `config` that `renderPatch` renders as YAML under the row, and the
`harness-routing` row carries `config: { document: "@rickylabs/routing/config/routing.v1.json" }`.
The plugin resolves a `document` value that begins with `@` or a bare package name through
`import.meta.resolve`, and any other value as a filesystem path; a deployment's own patch layer
overrides it. The row's config has no default: absent or empty, `createService` throws
`RangeError` with the code `routing-document-not-configured`. The generated patch and the golden
therefore carry a package specifier, never an operator path.

Rationale: OF-2 A as the coordinator disposed it. The bundle header's rule that rows carry only
`id` and `name` (`packages/dsh-app/src/bundle.ts:16-22`) is about not restating plugin defaults;
a required selection is not a default, and the header is amended to say so. If rendering config
in the patch proves unportable at implementation time, the fallback the disposition names
applies: no config in the bundle, and boot reports `routing-document-not-configured` until a
deployment sets it.

### D-15 — Routing validates placements structurally, without knowing a backend

`placements: { backends: string[], entries: PlacementRecord[] }`. Routing validates: backends are
unique strings matching `^[a-z][a-z0-9-]{0,31}$`; each entry's `model` is a declared model and
`backend` a declared backend; `verdict`, `reason` and `why` are bounded strings; `requires`, when
present, is a plain object of `env: Record<string,string>` and `args: string[]`; no two entries
share a `(model, backend)` pair; totality by explicit membership (D-13). Routing does not import
`llm-local` and never will: the dependency runs `llm-local` to `routing` today
(`packages/llm-local/package.json:27`) and reversing it would cycle.

### D-16 — Hostile input is refused before it is read, and the result cannot be mutated

Bounds, as structural constants in `schema.ts`: document bytes at most 1 MiB, nesting depth at
most 16, any array or object at most 4,096 members. The parser checks the byte length before
parsing, then walks the parsed value once with the same plain-data discipline `dsh-app` applies to
a dry-run plan (`packages/dsh-app/src/dry-run-internal.ts:22-39`): own data properties only, no
accessors, no cycles, prototypes limited to `Object.prototype`, `Array.prototype` and `null`,
depth and size counted during the walk. Keys `__proto__`, `constructor` and `prototype` are
`reserved-name`. Family names equal to `any` or `none` are `reserved-name`. After validation the
value is structurally cloned and recursively frozen; the loaded configuration is immutable, and
every derived cache in `admit.ts` is keyed on that frozen object in a `WeakMap`. There is no
module-level "current configuration".

### D-17 — One pure parse function; the file loader is a thin caller

`parseRoutingDocument(text: string, sourceId: string)` is the only path from text to a
configuration. `loadRoutingConfiguration({ path })` stats the file, refuses `too-large` before
reading, reads bytes, refuses `not-utf8` on a failed strict decode, and calls
`parseRoutingDocument(text, path)`. Step 5's parity gate and the dry-run driver call the parse
function directly.

### D-18 — The compiled-policy gate is an AST scan over every runtime source

`scripts/check-compiled-policy.mjs`, run in `build` beside `check-snapshots`, parses every
`packages/*/src/**/*.ts` that is not a `*.test.ts` with the `typescript` compiler already at the
repository root (`package.json:35-38`) and reports any string literal that initialises a property
or variable named `model`, `effort`, `tier`, `lane`, `family`, `profile`, `preset` or `harness`
outside an allowlist. The allowlist is a table in the script: each entry names a file, the
identifiers it may assign, the reason and the owning issue. Initial entries: the structural
vocabularies in `packages/routing/src/schema.ts` and `packages/subagents/src/dispatch.ts`; the
dry-run test fixture (`dry-run-test-fixtures.ts`, test support only: synthetic document text and fake dispatch expectations, never imported by production entry points; M-20 moves its fixture to document text, not to production configuration); the telemetry provider
inference (`backfill/claude.ts:200`, E9, research L27) until E9 disposes of it. Comments and
JSDoc cannot trip it because it reads the AST. The script runs a self-test on every invocation:
it writes a temporary file containing a fresh assignment (`{ model: "never-seen", effort: "medium" }`),
asserts detection, writes one containing only a comment and a `*.test.ts` twin, asserts no
detection, and exits non-zero if either assertion fails. That proves the gate catches a newly
introduced assignment, not only the fourteen old spellings.

## Owner forks, resolved by the coordinator

Both forks below were answered in `coordinator-disposition.md` before evaluation; the text of
each is kept so the evaluator can see what was asked and what the answer bound.

### OF-1 — Where the placement table lives (resolved: A)

Question: `llm-local`'s model-by-backend placements (`capability.ts:101-231`) are keyed by
routing's ids and say where each model can physically run. When the ids stop being compiled,
where do the placements go?

Options:

- A. A `placements` section of the routing document, validated by the same loader (every
  placement's model must be a declared model; every backend a member of `BACKENDS`; totality
  enforced as today). `harness-llm` reads them from `ctx.harnessRouting`.
- B. A second document owned by `llm-local`, loaded by the same loader kit with its own
  `schemaVersion`, its model keys validated against a routing configuration passed in.
- C. Leave placements compiled in `llm-local` with literal ids, and defer to #274.

Recommendation: A. One document is what #270 asks for ("replaced wholesale"); B introduces a
second file whose model keys can drift from the first, which is a deep-merge by another route;
C keeps a compiled model table in production TypeScript and fails #271 box 2 on its face.

Cost if wrong: moving a section out of the document later is a `schemaVersion` bump, a loader
change in `llm-local`, and a re-bless; no consumer outside this repository reads it. Cost of C
being the owner's preference anyway: step 1 cannot land as one PR and the literal inventory stays
open.

### OF-2 — Must a deployment name the document? (resolved: A, with a portable explicit setting)

Question: does the `harness-routing` row's `path` default to `DEFAULT_ROUTING_DOCUMENT_URL`, or
must every profile set it?

Options:

- A. Required. Absent path is a boot-time `RangeError`, like a misspelled independence policy.
- B. Defaults to the shipped document; the loaded `source.path` and `digest` still say which
  document ran.

Recommendation: A. The record must be able to say a human chose the document, and a default that
is used silently is the hazard the loader exists to remove; the shipped file is one `path:` line
away. Cost if wrong: one config line in every profile, and `dsh --profile rickylabs` refuses to
boot until it is set, visibly.

## Schema, version 1 (design pack, draft; nothing here has been written to the product)

    {
      "schemaVersion": 1,
      "name": "<identifier>",
      "provenance": { "description": "<free text>" },
      "families": ["anthropic", "openai", "google", "open"],
      "efforts": { "ordered": ["low", "medium", "high", "xhigh", "max"], "unordered": [] },
      "purposes": ["orchestration", "implementation", "...", "evaluation", "..."],
      "models": {
        "gpt-5.6-sol": { "family": "openai" },
        "qwen/qwen3.8-flash": { "family": "open", "approvedRelayEvaluator": true }
      },
      "profiles": ["claude-openrouter"],
      "presets": ["claude-design-glm-5-2", "claude-evaluator-qwen-3-8-flash", "claude-evaluator-glm-5-3-flash"],
      "lanes": [
        {
          "lane": "docs_audit",
          "purpose": "docs_audit",
          "chain": [
            {
              "route": { "harness": "codex", "transport": "native", "model": "gpt-5.6-sol", "effort": "medium" },
              "when": [],
              "effortEscalations": [{ "condition": "large_changeset", "effort": "high" }],
              "note": "single_pass_opposite_family_audit_of_generated_docs_changeset"
            }
          ]
        }
      ],
      "tiers": [{ "tier": "light", "implement": "light_implementation", "review": "review_codex_light" }],
      "constraints": {
        "research_extraction": { "transports": ["native"], "harnesses": ["agy", "codex", "codex-run"], "why": "..." }
      },
      "deepResearchLanes": ["research_extraction"],
      "policy": { "maxFallbackDepth": 2 },
      "placements": {
        "backends": ["lm-studio", "llama-rocm", "openrouter"],
        "entries": [
          { "model": "n5air/qwen3.8-27b", "backend": "lm-studio", "verdict": "runs", "why": "..." },
          { "model": "n5air/qwen3.8-27b", "backend": "openrouter", "verdict": "refused", "reason": "not-served-here", "why": "..." }
        ]
      }
    }

Validation rules, all producing `invalid` problems with dotted paths:

- Root: the allowed key set is exactly the keys above; `provenance` is optional; every other listed key is required, including `placements`
  included (an empty `backends` and `entries` is the way to say none). Unknown key anywhere:
  problem. Before any of this: byte, depth and size bounds and the plain-data walk (D-16).
- `schemaVersion` must be the integer `1` (checked before anything else; a different value is the
  `unsupported-schema-version` refusal, not `invalid`).
- `name`: non-empty string matching `^[a-z0-9][a-z0-9-]*$`.
- `families`, `purposes`, `profiles`, `presets`, `efforts.ordered`, `efforts.unordered`: arrays of
  non-empty strings, no duplicates within or across the two effort lists. `families` and
  `efforts.ordered` non-empty; `purposes` must include `evaluation`.
- `models`: non-empty object; each value has `family` in `families` and optionally
  `approvedRelayEvaluator: true` (the literal `true`; `false` is refused so absence is the only
  way to say no).
- `lanes`: non-empty array; `lane` unique, matching `^[a-z][a-z0-9_]*$`; `purpose` in `purposes`;
  `chain` non-empty; each step: `route.harness` in `HARNESSES`, `route.transport` in
  `TRANSPORTS`, `route.model` in `models`, `route.effort` declared, `route.router` in `ROUTERS`
  when present, `route.profile` in `profiles` when present, `route.preset` in `presets` when
  present; `when` an array of `FALLBACK_TRIGGERS` members, no duplicates; `certifies` a family,
  `any` or `none` when present; `subscription` a subscription keyword when present;
  `effortEscalations` entries with non-empty `condition` and declared `effort`; `note` a string
  when present.
- `tiers`: array; `tier` unique; `implement` and `review` in `lanes`.
- `constraints`: keys in `lanes`; each with `why` non-empty and any of `transports`,
  `harnesses`, `families`, `models` validated against their vocabularies.
- `deepResearchLanes`: members of `lanes`; each must have a constraint whose `transports` is
  exactly `["native"]` (the rule `DEEP_RESEARCH_LANES` encodes today, `policy.ts:640-656`).
- `policy.maxFallbackDepth`: integer, at least 0.
- `placements`: per D-15. Routing checks shape, references, duplicate pairs and explicit
  totality; `llm-local` checks `verdict`, `reason`, `requires` and backend support at
  composition (D-13).
- `families`: no member may equal `any` or `none` (`reserved-name`).
- Duplicates, kept apart on purpose: a repeated model key, lane name, tier name, effort, family,
  profile, preset or `(model, backend)` placement pair is `duplicate`. Version 1's
  `duplicate-primary` invariant (two primaries certifying the same thing, `resolve.ts:353-359`)
  is a rule about lane chains and is kept as today. Neither is a rule about repeated ordered
  candidates in a tier-by-role cell, which version 1 does not have and which step 2 must accept
  as the CLI prints them (`coordinator-disposition.md:31`).

Invariants (`checkPolicy`, producing `invariant` on load) are today's list unchanged
(`resolve.ts:309-425`), plus "escalation between unordered efforts is not comparable" (D-5), and
with the reviewer family derived per D-8.

## Loader contract

    parseRoutingDocument(text: string, sourceId: string): LoadOutcome
    loadRoutingConfiguration({ path }): Promise<LoadOutcome>          // stat, bound, read, decode, then parse
    validateRoutingConfiguration(value: unknown): ValidationOutcome    // after the plain-data walk
    LoadOutcome = { ok: true, loaded: LoadedRoutingConfiguration } | { ok: false, refusal: LoadRefusal }
    LoadedRoutingConfiguration = { configuration: Readonly<RoutingConfiguration> /* deep-frozen */,
                                   source: { id, digest, bytes, schemaVersion, name } }
    LoadRefusal = { kind: "unreadable", code: "absent" | "not-a-file" | "permission" | "too-large" }
               | { kind: "malformed", code: "not-json" | "not-utf8" | "root-not-object" }
               | { kind: "unsupported-schema-version", seen: number | null, supported: [1] }
               | { kind: "invalid", problems: { code: InvalidCode, path: string }[] }
               | { kind: "invariant", problems: PolicyProblem[] }   // each with a fixed code, lane, index
    describeLoadRefusal(refusal): string   // codes and paths rendered to prose; no document text

`describeLoadRefusal` renders codes and structural paths only. It never quotes a document value,
an OS error, a parser message or the source id, so a credential pasted into a document, a key
name or a malformed file cannot reach a boot log, a receipt or an issue comment through it. The
source id is available on `loaded.source.id` for the success path and is the caller's own input
on the failure path.

## Exact implementation mutation manifest

`packages/routing`:

- M-1 create `src/schema.ts`: `RoutingConfiguration` and nested types; `validateRoutingConfiguration`;
  `SCHEMA_VERSION = 1`; the structural vocabularies `TRANSPORTS`, `FALLBACK_TRIGGERS`,
  `SUBSCRIPTION_STATES`, `CERTIFIES_KEYWORDS`, `EVALUATION_PURPOSE` moved here from `models.ts`
  and `policy.ts`.
- M-2 create `src/load.ts`: `parseRoutingDocument`, `loadRoutingConfiguration`,
  `describeLoadRefusal`, `LoadRefusal`, `LoadedRoutingConfiguration`, the plain-data walk and
  bounds (D-16), SHA-256 over UTF-8 bytes via `node:crypto`, deep freeze.
- M-3 create `config/routing.v1.json` (D-10).
- M-4 create `src/load.test.ts` and `src/schema.test.ts` (T-L, T-D, T-W below).
- M-5 delete `src/models.ts` and `src/models.test.ts`; the functions `familyOf`, `isPinnedModel`,
  `pinnedModels`, `isApprovedOpenEvaluator` move to `src/configuration.ts` (create) as
  configuration-first accessors together with `lanePolicy`, `lanes`, `tiers`, `tierLanes`,
  `laneConstraint`, `effortIndex`, `isDeclaredEffort`, `maxFallbackDepth`.
- M-6 delete `src/policy.ts`; keep its type declarations (`Route`, `RouteStep`, `LanePolicy`,
  `LaneConstraint`, `EffortEscalation`) in `src/schema.ts`.
- M-7 modify `src/resolve.ts`: configuration-first signatures; `DEFAULT_MAX_FALLBACK_DEPTH`
  removed, `resolveFallback` reads `request.maxDepth ?? maxFallbackDepth(configuration)`;
  `tierPlan` per D-8; `checkPolicy(configuration)`; escalation comparability per D-5.
- M-8 modify `src/admit.ts`: configuration-first; `ALL_STEPS` and `LONGEST_NAME` computed per
  configuration (a `WeakMap<RoutingConfiguration, ...>` cache is acceptable; a module constant is
  not); `isEffort` reads declared efforts.
- M-9 modify `src/family.ts`: `checkEvaluator(configuration, assignment)`, `familyOfRun(configuration, run)`;
  `Certifies` is `string`.
- M-10 modify `src/index.ts`: remove every constant export listed in research L1, L3 to L9, L11,
  L16 to L18; add loader, validator and schema types; no default-document accessor is exported; keep
  structural vocabularies and the probe surface.
- M-11 modify `src/family.test.ts`, `src/resolve.test.ts`, `src/admit.test.ts` (T-R below);
  `src/probe.test.ts` untouched.
- M-12 modify `README.md` (D-12).
- M-13 modify `package.json`: no dependency change; `files` becomes `["dist", "config"]` and
  `exports` gains `"./config/*.json": "./config/*.json"` so the document resolves through the
  package (D-10, D-14).

`packages/llm-local`:

- M-14 modify `src/capability.ts` (D-13); the `PLACEMENTS` constant is deleted; `checkCapability`
  validates values and backend support and returns coded problems.
- M-15 modify `src/capability.test.ts`; `src/index.ts` exports follow.
- M-16 modify `README.md` wording.
- M-16b inventory, no behaviour change: `src/health.ts`, `src/endpoint.ts`, `src/backends.ts`
  keep `BACKENDS` as the mechanism table and stay literal-free of models; the one production
  caller outside the package is `resolveEndpoint` at `packages/dsh-app/src/llm/adapter.ts:271`.

`packages/dsh-app`:

- M-17 create `src/plugins/routing.ts` (D-9) and export it from `package.json` `exports` as
  `./plugins/routing`.
- M-18 modify `src/bundle.ts` (`BundleRow.config`, rendered by `renderPatch`; `BUNDLE_ROWS`
  gains `harness-routing` with `config.document` set to the package specifier; header amended
  per D-14), re-render `cordis.patch.yml`, re-bless `dump-config.golden.yml` with the reason
  "harness-routing joins the bundle with an explicit document selection (#271)".
- M-19 modify `src/plugins/llm.ts` (`inject` gains `harnessRouting`; adapter constructed with
  placements) and `src/llm/adapter.ts` (placements as a constructor input).
- M-20 modify `src/dry-run.ts` (`DryRunPlan.routing: { source, text }`, `DriveRefusal` gains
  `routing-unusable`), `src/dry-run-internal.ts` (shape check, in-memory
  `parseRoutingDocument`, `admitDispatch(loaded.configuration, ...)`, computed digest in the key
  input), `src/dry-run-test-fixtures.ts` (fixture document text), `src/dry-run-child.ts` if its
  fixture call changes shape.
- M-21 modify `src/plugins.test.ts` (row list and a boot-refusal case), `src/bundle.test.ts`,
  `src/llm/adapter.test.ts`, `src/dry-run.test.ts`, `src/dry-run-crash.test.ts`.
- M-22 modify `src/index.ts` (export the routing service type), `README.md` (configuration
  section gains the row; dry-run section gains `routing`).

Documentation:

- M-23 `packages/README.md` routing row; `README.md:346`; `docs/concepts/06-the-three-layers.md`
  matrix paragraph; `packages/provider-claude/src/provider.ts:32` and
  `packages/provider-opencode/src/model.ts:9-21`, `packages/provider-opencode/README.md:111`
  wording; `docs/glossary.md` if it defines "matrix" (it does not today).

Repository scripts:

- M-24 create `scripts/check-compiled-policy.mjs` (D-18) and add `check:compiled-policy` to the
  root `build` chain beside `check:snapshots` (`package.json:23`).

Nothing else. No change to `contracts`, `coordinator`, `forge`, `board`, `telemetry`,
`subagents`, `provider-codex`, `deploy/`, `.github/`, `doctrine/`.

## Consumer transition

| Consumer | Before | After | If not done |
|---|---|---|---|
| `dsh-app` dry-run | `admitDispatch(dispatch, { lane })` reads the compiled table; the intent key ignores which table | `plan.routing` is the document text plus a source id; the driver parses it in memory and puts the digest it computed into `inputRevision` | Build fails (no compiled table); or, if shimmed, two documents alias one intent key |
| `dsh-app` llm adapter | `PLACEMENTS` imported from `llm-local` | constructed with the document's `placements` from `ctx.harnessRouting`, after `llm-local` has validated their values; an unsupported backend refuses the row's boot | `listModels` lists nothing and every `generate` refuses `not-served-here` |
| `dsh-app` profile | five rows, no routing | six rows; `harness-routing` carries an explicit portable `document` specifier; a deployment overrides it in its own patch layer | Boot reports `routing-document-not-configured`; `harness-llm` stays pending |
| `llm-local` capability | table of compiled ids | functions over `Placement[]`; `checkCapability(placements, models)` | Package cannot build |
| `contracts` | `lane: string`, five-field identity | unchanged | n/a |
| Downstream #148, #181 | blocked on #269 | blocked on #272 and #273, through the loader this step lands | n/a |

The transition is one PR because every consumer edge is a compile-time break: there is no
intermediate state in which the old constants and the loader both exist, and that is by design.
A compatibility re-export of the constants would be the hidden default #271 names.

## Test design

Every test names the fixture document it runs against. Fixture A is the shipped default loaded
from disk; fixture B is a small in-memory document sharing nothing with A (different lane names,
model ids, families `alpha`/`beta`, efforts `one`/`two`/`three`, tier `only`, profile `relay-b`,
depth 5); fixture C is B with one deliberate defect per case.

Loader and schema (`load.test.ts`, `schema.test.ts`):

- T-L1 loads the shipped default: `ok`, `schemaVersion 1`, `name` as in D-10, `bytes` equals the
  file length, `digest` matches an independently computed SHA-256 of the file, `checkPolicy`
  returns nothing, and the loaded object is frozen at every depth.
- T-L1b resolves `@rickylabs/routing/config/routing.v1.json` through `import.meta.resolve` from
  the built package and loads it, proving the `exports` entry.
- T-L1c runs `npm pack --dry-run --json` in `packages/routing` and asserts the tarball lists
  `config/routing.v1.json`, proving the `files` entry; this is the packed-layout check the
  disposition asks for and it mirrors `scripts/check-publish.mjs:27,100-103`.
- T-L2 `unreadable`: absent path; a directory. Both the refusal and describeLoadRefusal expose only fixed codes and structural field paths; the supplied location appears only in explicit caller-side provenance. Include a credential-shaped path canary.
- T-L3 `malformed`: invalid JSON; a JSON array root; a JSON string root.
- T-L4 `unsupported-schema-version`: `schemaVersion: 2`, `"1"`, absent. `seen` and `supported`
  reported.
- T-L5 `invalid`, one case per rule in the schema section: unknown root key; unknown step key;
  missing `lanes`; empty `families`; duplicate lane; duplicate effort across lists; model with
  unknown family; step with unknown model; step with undeclared effort; step with unknown
  trigger; `certifies` not a family or keyword; tier naming an unknown lane; constraint on an
  unknown lane; `deepResearchLanes` entry without a native-only constraint; `maxFallbackDepth`
  negative or fractional; `approvedRelayEvaluator: false`; a placement on an unknown backend
  (OF-1 A). Each asserts the dotted path.
- T-L6 problems are collected: a document with three defects reports three paths.
- T-L7 `invariant`: a self-certifying seat; an evaluation step without `certifies`; an
  implementation lane with a step no review step certifies; a relay evaluator not approved; an
  escalation that does not raise; an escalation onto an unordered effort.
- T-L8 nothing escapes the diagnostic boundary: documents whose unknown key, unknown lane,
  model id, `note`, `why` and malformed tail each carry a relay-key-shaped value (the same
  synthetic shape `admit.test.ts:230` already uses), a bearer token and a private-key block; every refusal, every `describeLoadRefusal` output and every
  `PolicyProblem` is asserted not to contain any of them, nor the source id, nor the words
  `SyntaxError`, `ENOENT` or `EISDIR`.
- T-L9 bounds: a document one byte over the byte bound is `unreadable/too-large` from the file
  loader and `invalid/size-exceeded` from the parser; nesting one level over the depth bound is
  `depth-exceeded`; an array one over the member bound is `size-exceeded`; each is reported
  before any structural problem.
- T-L10 hostile values: a parsed value with a getter, a cycle, a `__proto__` key, a `Map`, and a
  class instance is `not-plain-data` or `reserved-name`; a family named `any` or `none` is
  `reserved-name`; mutating the returned configuration throws in strict mode; a second document
  parsed while the first is held does not change any answer about the first.
- T-D1 digest is over bytes: the same document re-serialised with different whitespace parses to
  an equal `configuration` and a different `digest`.
- T-D2 digest is independent of the source id: the same text with two ids gives one digest.
- T-D3 the file loader and the parser agree: loading a temp file and parsing its text with the
  same id produce equal `loaded` values.

Wholesale replacement (`load.test.ts`, "two documents"):

- T-W1 every lane, model, tier, profile and effort of A is unknown to B: `lanePolicy(B, lane)`
  is `null` for all 23; `familyOf(B, id)` is `null` for all 14; `admitDispatch(B, ...)` refuses
  every A dispatch with `unknown-model` or `unknown-lane`; `expected` lists contain only B names.
- T-W2 the reverse direction for B against A.
- T-W3 policy values do not leak: `maxFallbackDepth(B)` is 5 and `resolveFallback(B, ...)` uses
  it; `pinnedModels(A)` and `pinnedModels(B)` are disjoint; `relayProfiles` disjoint.
- T-W4 loading B then A then B in one process gives byte-identical `describeAdmission` output for
  a fixed B dispatch each time (no order dependence).
- T-W5 with A and B both held, mutating a clone of A and re-asking A's questions changes nothing,
  and B's `placements` do not appear in `backendsFor(A, ...)`.

Re-targeted routing suites (`family.test.ts`, `resolve.test.ts`, `admit.test.ts`), T-R:

- T-R1 the compiled-policy gate (D-18) runs in `build`: it scans every package's runtime
  sources, honours the allowlist, and its own self-test proves it detects a fresh assignment and
  ignores a comment and a test file. A second, cheap assertion in `schema.test.ts` checks that
  none of the 14 wire ids, the 23 lane names, the four tier names, or the strings `0.144.3` and
  `0.153.4` appear in `packages/routing/src/*.ts` outside tests, as a fast local signal.
- T-R2 every existing behavioural case runs against A with the same expectations it has today
  (`resolveRoute("planning_decisions")` is opus at high; the Astra row; docs polish chain order;
  the totality admission of every step of every lane; the credential refusals). The literal tier
  order assertion becomes an assertion about A.
- T-R3 `tierPlan(A, tier)` equals today's answer for all four tiers; `tierPlan(B, "only")`
  resolves the review lane against the family of B's implementation primary, and a B variant
  whose primary is family `beta` selects the `beta`-certifying seat.
- T-R4 `checkEvaluator(B, ...)` with families `alpha`/`beta` reproduces every verdict of the
  current suite, proving the rule has no compiled family names in it. Explicitly assert that same-family evaluation with certifies:any is refused before any certification allowance is considered.

Consumers:

- T-C1 `llm-local`: `checkCapability` totality and every placement expectation of today against
  A's placements, which carry the eighteen observed verdicts and reasons unchanged; a placement
  naming a model absent from the configuration is a routing `dangling-reference`; a `refused`
  entry without a reason, a `runs` entry with an empty `requires`, and an unknown `verdict` are
  `llm-local` problems with fixed codes; an empty section is valid and `placedModels` is empty.
- T-C6 `dsh-app` composition refuses, never drops: a document whose placement names a backend
  outside `BACKENDS` makes `harness-llm`'s boot throw with the code
  `placement-backend-unsupported`, and no adapter is registered.
- T-C7 durable consumer safeguard: initialize a real FileStateStore, record a pending effect
  for the repository/task/workflow step, and drive a changed-document plan for that same
  operation. Assert no new intent entry, no fake delivery and an explicit unresolved-prior-effect
  refusal. Repeat after recovery orphans that effect to terminal unknown, and with a changed
  attempt number; changing a caller field is not operator reauthorization. Retain the original
  effect unchanged. Run equivalent MemoryStateStore tests and concurrent calls on the same
  handle; one unresolved effect must prevent every competing new-key attempt. Read failure also
  refuses before intent/delivery. This slice supplies no operator reauthorization bypass.
- T-C2 `dsh-app` dry-run: the fixture plan carries A's text; `dispatch-inadmissible` for lane
  `normal_implementation` with the Astra dispatch still holds; a plan whose `routing` is absent,
  not data, or fails to parse is refused before assembly (`source-unusable` or
  `routing-unusable`) with nothing appended; two plans equal except for one byte of document
  text produce different intent keys; the key does not change when only `routing.source` (the
  label) changes.
- T-C3 `dsh-app` plugins: `harness-routing` boots with the package specifier and with a temp
  path, and provides a frozen `configuration` and `source`; an absent or empty `document` throws
  `RangeError` with `routing-document-not-configured`; a refused document throws with the
  refusal kind and codes and no document text in the message; `harness-llm` waits for
  `harnessRouting` and registers once it is present; row order list updated.
- T-C4 `dsh-app` golden: re-blessed; `bundle.test.ts` asserts six rows, that the rendered config
  under `harness-routing` is the package specifier and contains no `/home` or drive-letter path,
  and that the new subpath exists in `exports`.
- T-C5 `dsh-app` adapter: `listModels` and refusal cases against A's placements.

## Runnable commands and gates

    pnpm run typecheck
    pnpm run build            # includes check:graph, check:snapshots, check:publish, check:docs
    pnpm test
    pnpm --filter @rickylabs/routing run test
    pnpm --filter @rickylabs/llm-local run test
    pnpm --filter @rickylabs/dsh-app run test
    pnpm run golden:bless -- "harness-routing joins the bundle: the routing configuration is loaded once and injected (#271)"

All of these run in this worktree today and in CI (`.github/workflows/ci.yml:55-63`). The one
gate that cannot run here is the independent exact-head implementation evaluation, which is a
separate session by doctrine (`doctrine/WORKFLOW.md`, Stage F and post-Stage-H).

## Dependency DAG

Inside step 1: M-1 and M-3 first (schema and the transcription can be reviewed against each
other before any consumer moves); M-2 and M-5 to M-10 next (the package compiles again); M-11
and M-4 (routing green); M-14 to M-16 (llm-local green, gated on OF-1); M-17 to M-22 (dsh-app
green, gated on OF-2 and the golden re-bless); M-12, M-23 last.

Across the epic: #271 unblocks #272 (schema v2 over this loader) and #274 (detection reads
`loaded.configuration` and adds account sections); #272 unblocks #273; #275 needs all four and
consumes `loadRoutingConfiguration` directly. #148 and #181 wait on #273 as their issues state.

## Spikes and integration gates

- S-1 schemastery required fields. The `harness-routing` row requires `document` with no default.
  Read the installed schemastery API to express that requirement where supported. Regardless of
  schema expressiveness, createService must always enforce a RangeError with fixed code
  routing-document-not-configured for absent or empty input. Schema-only rejection cannot replace
  this runtime backstop. Owner: implementer.
- S-2 CLI key namespace (research C-3, U-4). Step 2 must add the CLI key to the model record or
  define the mapping; step 5 cannot compare candidates until it does. The full export gives the
  seventeen keys and makes four compiled pins visibly orphaned. Recorded here so the v1
  document's `provenance` states the gap. Owner: #272.
- S-3 Resolved as evidence, open as design. `matrix-full.json` in this run directory is the
  shape step 2 must express: five tiers, eight roles, 76 candidates, two empty cells, policy
  fields holding numbers or the words `none`, `unspecified_by_owner`, `immediate`, four
  coordinator scopes, a seven-member transport priority list, and one cell with a duplicated
  candidate (research C-9, C-10). Step 2 must re-query fresh at dispatch rather than reuse this
  file. Per the coordinator's clarification, repeated ordered candidates in a cell are an
  authoritative shape that step 2's schema and step 5's parity must neither deduplicate nor
  reject; only duplicate model definitions, lane identities and placement pairs are invalid
  (`coordinator-disposition.md:31`). Owner: #272.
- S-4 Resolved identity consequence: coordinator's intentIdentity includes inputRevision.
  A changed document yields a different key that the store may accept despite an earlier pending
  or unknown effect. The root executed this characterization against MemoryStateStore; production
  FileStateStore semantics must be checked too. The dry-run consumer must therefore serialize its
  operations per store handle and read current state before writing any intent. Pending or unknown
  for the same repository/task/workflow step causes unresolved-prior-effect refusal, independent
  of inputRevision or attempt. A read refusal stops the operation. Existing lease/fencing remains
  intact, and no store contract is changed. T-C7 must prove the consumer guard, not merely earlier-
  key fencing. No explicit reauthorization/reconciliation API is introduced in this slice; such
  an unresolved operation remains refused. Owner: implementer.
- G-1 Golden re-bless is an implementation-time action that runs the real `dsh` binary from
  `node_modules`; it is executable here (`golden.ts:33-42`) and in CI.
- G-2 `npm pack --dry-run` for T-L1c needs `npm` on the path; CI's setup-node provides it, and
  the test fails rather than skips when it is absent.

## Risk register

| ID | Risk | Likelihood | Impact | Gate |
|---|---|---|---|---|
| R-1 | The transcription drifts from the deleted table (a step, a `when`, a note) | medium | high: silent route change | T-R2 runs every existing behavioural expectation against the transcription; reviewer diffs JSON against the deleted TypeScript in the PR |
| R-2 | OF-1 answered late, blocking the llm-local half | medium | medium: PR cannot merge as one | DAG orders llm-local after routing; the plan carries both A and B manifests |
| R-3 | A future edit re-introduces a literal in `routing` | high over time | medium | T-R1 AST gate and executable self-test |
| R-4 | `check:snapshots` refuses the shipped JSON on a key name | low | low | The schema has no time-sliding key; T-L1 runs under `pnpm run build` |
| R-5 | Per-configuration `LONGEST_NAME` computed on every call is slow | low | low | WeakMap cache in M-8 |
| R-6 | The dry-run key input gains the document digest, so existing durable records (which may exist outside tests) hold keys computed without it | certain | medium: a stale pending or unknown effect must stay fenced | Nothing asserts their absence; Earlier-key fencing remains unchanged; T-C7 proves the driver refuses new-key redispatch while a prior operation is pending/unknown, without an implicit reauthorization bypass; protocol 1 and unknown semantics untouched |
| R-7 | Reviewer reads L2/L12/L13 as forbidden literals | medium | low: contained change | Boundary table names the three code sites; D-4 states the alternative |
| R-8 | D-8's family derivation is mistaken for #181's fix | medium | medium: a false closure | D-8 and the research section say what is not done; #181 stays open on #273 |
| R-9 | The golden re-bless masks an unrelated dsh composition change | low | medium | `bless.ts` requires a reason and the diff shows exactly one added row |
| R-10 | `harness-llm` pending forever when `harness-routing` refuses at boot | certain by design | low: visible | T-C3 asserts the throw and the pending state; README says so |
| R-11 | Step 1's closed `TRANSPORTS` is read as a claim that the fleet's seven-name transport priority is unsupported, or step 2 tries to fit that list into `TRANSPORTS` or `HARNESSES` | medium | medium: a wrong schema in step 2 | D-4 and research C-8 separate the relay-rule kind from provider precedence; S-3 hands the list to #272 and #274 |

## Evaluation route and loop policy for this run

From `matrix-architecture.json`, identical to the architecture tier of `matrix-full.json` (both
fresh 2026-09-07): plan evaluation by
`muse_spark_1_3` at `max`, fallback `grok_4_6` at `xhigh`; implementation by `astra` at `xhigh`,
fallback `fable_5_1` at `xhigh`; implementation evaluation by `grok_4_6` at `xhigh`, fallback
`muse_spark_1_3` at `max`; documentation by `fable_5_1` at `high`, fallback `qwen_3_8_max` at
`provider_default`. Plan loop: one round, escalate to the owner at two, re-steer the same
session. Implementation loop: three rounds, notify the owner after two. No downgrade: if a
listed candidate cannot run, the coordinator re-queries the CLI rather than choosing a cheaper
sibling.

## Explicitly out of scope

The fleet shape (five tiers, eight roles, empty cells, `none`, `unspecified_by_owner`,
`immediate`, coordinator scopes), Muse or any new model, generator-relative evaluator selection
after fallback, CLI or account detection, the transport priority list and provider precedence as
data, the `subagents` harness and router vocabularies, the forge account mapping,
the telemetry provider inference (research L25 to L27), the parity gate, any CLI surface for
printing the loaded document, and any change to the published contract or its protocol version.
