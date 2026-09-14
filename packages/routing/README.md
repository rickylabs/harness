# @rickylabs/routing

Load one explicit routing document, then ask immutable, configuration-first questions about model
selection, admission and evaluator independence. Owned by E4 (#34) and E11 step 1 (#271).

There is no active global matrix, compiled model table, merge with defaults, or missing-document
fallback. Every project supplies its own complete document. The profile explicitly selects the
packaged [compatibility transcription](config/routing.v1.json); a deployment may replace that
selection in its own patch layer.

## Loading and provenance

```ts
import { fileURLToPath } from "node:url";
import { loadRoutingConfiguration, describeLoadRefusal, resolveRoute } from "@rickylabs/routing";

const result = await loadRoutingConfiguration({
  path: fileURLToPath(import.meta.resolve("@rickylabs/routing/config/routing.v1.json")),
});
if (!result.ok) throw new RangeError(describeLoadRefusal(result.refusal));
const { configuration, source } = result.loaded;
const route = resolveRoute(configuration, "planning_decisions");
```

`parseRoutingDocument(text, sourceId)` is the pure equivalent for already captured UTF-8 JSON text.
`validateRoutingConfiguration(value)` accepts in-memory plain data. Both validate the whole
structure and policy invariants, clone it and freeze every depth. A second load cannot change
answers from a previously loaded configuration. There is no hot reload or global setter.

`source` contains `id`, `name`, `schemaVersion`, `bytes` and the full `sha256:` digest computed from
the exact UTF-8 document bytes. Whitespace changes the digest; changing only the source label does
not. A caller-provided digest is never an input to parsing. The filesystem loader delegates to the
same parser after a bounded read and strict UTF-8 decoding. It opens nonblocking and checks the
opened descriptor for a regular file, so a FIFO cannot block before that check.

| Refusal | Meaning |
| --- | --- |
| `unreadable` | Missing, inaccessible, non-file or oversized input |
| `malformed` | Invalid JSON, invalid UTF-8 or a non-object root |
| `unsupported-schema-version` | Missing, non-integer or unsupported version; integer `seen` or `null` |
| `invalid` | Structural errors, unknown fields, dangling references, duplicates or bounds |
| `invariant` | Structurally valid data violates a routing rule |

Refusals contain fixed codes and structural paths, never raw JSON/OS exceptions, dynamic keys,
document values or the caller's source location. `describeLoadRefusal` preserves that boundary.
Source locations belong to successful provenance or the caller's own input, not a boot error.
Limits are 1 MiB of document bytes, nesting depth 16 and 4,096 members in each collection.
Source identifiers must be primitive strings, nonblank and at most 4,096 UTF-8 bytes; valid labels
are preserved exactly. Invalid identifiers produce only a code at the fixed path `source.id`.
Accessors, proxies, cycles, non-plain objects and reserved prototype keys are refused before
validation reads their values. Duplicate JSON keys are rejected before they can overwrite data.

## Schema version 1

[The structural schema](src/schema.ts) requires every root field below except the explicitly optional fields.
Unknown structural fields are errors. Tier role names are open keys; their values must reference canonical lanes.

| Field | Document data |
| --- | --- |
| `schemaVersion`, `name`, optional `provenance.description` | Version 1, stable name and transcription/source description |
| `families`, `models` | Family identifiers and wire model ids, each bound to a family; optional `approvedRelayEvaluator: true`, `label` and `description` |
| `efforts` | Nonempty `ordered` ladder, lowest first; optional `unordered` vocabulary |
| `purposes`, `profiles`, `presets` | Declared identifiers, with `evaluation` required among purposes |
| optional `triggers`, `routers` | Complete custom vocabularies; omission accepts the original v1 vocabulary for compatibility. An explicit empty list stays empty |
| optional `laneAliases` | One-hop old-name → canonical-lane map for caller queries only |
| `lanes` | Named purposes and ordered chains containing routes, triggers, certification and declared escalations |
| `tiers` | Open role-to-lane maps, including `implementation`, `implementation_evaluation`, `plan`, `plan_evaluation`, and any project-specific role; legacy `implement`/`review` accepted |
| `constraints`, `deepResearchLanes` | Per-lane restrictions; deep research requires an explicit native-only constraint |
| `policy.maxFallbackDepth` | Nonnegative integer fallback limit |
| `placements` | Declared backend identifiers and model/backend records, including observations and requirements |

Families cannot be the certification keywords `any` or `none`. An escalation must raise effort on
the declared ordered ladder; unordered efforts may be selected but cannot be compared for an
escalation. Model, lane, tier and placement identities cannot be duplicated. Routing treats backend
names as bounded opaque identifiers; [llm-local](../llm-local/README.md) validates the mechanism,
verdict and refusal vocabulary before the adapter is registered. An empty placement section is
legal. Membership is explicit, with a record for every participating model/declared-backend pair.

Transport kinds (`native` and the legacy relay kind `openrouter`), subscription payment states,
certification keywords (`any`/`none`), the semantic purposes `implementation`/`evaluation`, and the
two seams remain structural code. Supported harnesses come from `subagents`: an unknown harness
can silently launch a different executor, so a document cannot add executor support. These are
mechanism and safety boundaries, not model preferences. Router IDs are document data and must
match `^[a-z0-9][a-z0-9_.-]*$` with a 4,096-character limit; OpenCode carries that provider ID
unchanged, including for a relay route. Model IDs, registered families, efforts, purposes, triggers,
tiers, role bindings, route selections, profiles, presets, constraints and depth are data.
Provider/account detection and CLI version requirements are later E11 work.

## Family is a property of the model, not of the harness

`familyOf(configuration, model)` reads the document's binding and returns `null` for an unknown
model, including inherited object property names. `checkEvaluator(configuration, assignment)`
refuses the same run, unknown models, supplementary `certifies: none`, and the same family even
when the seat declares `certifies: any`. Relay evaluators additionally require explicit approval.
The [two seams](../../docs/concepts/02-the-two-seams.md) remain independent of model family.

`tierPlan(configuration, tier)` uses the implementation **primary's** configured family to resolve
its review lane. This is not generator-relative evaluator selection after fallback. `checkPolicy`
checks every implementation step, including fallbacks, for a registered opposite-family certifier.
Every implementation-purpose lane must be bound as a tier's implementation. A named same-family
certification is refused; `any` is legal only as an opposite-family seat for the work it certifies.
`resolveRoute` and `resolveFallback` skip same-family certifiers when given an author family.
`checkEvaluator` remains required at the session boundary.

Coverage is not availability or payment approval. A triggered or paid reviewer can provide declared
coverage while launch still requires the matching trigger, a turn boundary, depth budget and paid
approval. The editor catalog makes no claim that any configured model is currently reachable.

## Resolution and admission

`resolveRoute`, `resolveFallback`, `resolveEffort`, `toDispatch`, `laneChain`, `tierPlan`,
`selfCertifies`, `unreviewedSteps`, `admitDispatch` and all model/lane query functions take the
configuration first. Pure verdict renderers do not need it. No compatibility re-export supplies a
hidden table. `checkPolicy(configuration)` returns coded invariant problems with structural
locations; it is also called during loading.

Fallback walks forward through the selected chain and requires a turn boundary. A step outside
its subscription plan needs explicit paid approval. An undeclared effort escalation is refused.
`model-unavailable` remains distinct from `native-quota-limit`; no routing selection is inferred
from the former. The compatibility document preserves the old chain order and observations.

Admission composes `subagents.validateDispatch` with configured model, harness, router, profile,
lane and effort checks. Unknown, unrouted and unroutable models remain separate refusals.
Credential-shaped payloads are refused before ordinary diagnostics; expected choices come only
from the supplied document. Admission opens no socket and observes no quota.

## Availability expires, and everything else here does not

[probe.ts](src/probe.ts) is unchanged. Admission decides what is permitted; availability evaluates
a caller-supplied observation of what is currently possible. Missing, incomplete or stale evidence
cannot become a positive availability claim. A static fallback may refuse and may never permit.
`mayDispatch` requires both available status and probe provenance. Configuration placement data
is not evidence of live reachability.

## Tier roles and compatibility

New callers use `tierRoleLane(configuration, tier, role)` or
`resolveTierRole(configuration, tier, role, authorFamily)` rather than constructing lane names.
A row can directly express all eight fleet roles (implementation, ui_ux, plan, plan_evaluation,
implementation_evaluation, vision_evaluation, documentation, deep_research), plus custom roles.
The bindings reference reusable ordered lane chains; they do not embed another model table.

```json
{
  "tier": "feature",
  "implementation": "feature_implementation",
  "implementation_evaluation": "feature_evaluation",
  "plan": "feature_plan",
  "plan_evaluation": "feature_plan_evaluation",
  "accessibility_audit": "feature_accessibility"
}
```

Every row requires implementation and implementation-evaluator bindings; the legacy spellings
`implement`/`review` satisfy those requirements. Both implementation spellings, if present, must
agree. An explicit legacy `review` may differ from `implementation_evaluation`; `tierPlan.review`
preserves that legacy choice and both lanes must cover every implementation step. A plan evaluator
requires a plan binding and must cover every plan step. A plan without a plan evaluator is legal.
Other role names are unrestricted identifiers referring to declared lanes; their semantics belong
to the consuming profile. No new role needs a TypeScript change.

The shipped document uses names such as `light_review`, `complex_review` and `workflow` and
explicitly binds tier-local formal evaluators. `laneAliases` preserves old names such as
`review_codex_light` and `claude_workflow` for existing query, admission and fallback callers.
Aliases cannot collide with lanes, point to other aliases, or appear in document-internal
references. There is no lane-name parser. A harness change only changes the route data.

This is an additive v1 extension, not the separate fleet-shaped v2 work in #272. Existing valid
v1 vocabularies remain accepted when optional lists are absent. Previously accepted unsafe
same-family `any` coverage and unbound implementation lanes now fail validation. The packaged
matrix adds an explicit chore tier for its existing chore implementation and binds its existing
formal evaluator. Its model selections remain the PR baseline; it is not evidence of fleet parity.

## Editor catalog for the cockpit

```ts
import { routingEditorCatalog, resolveTierRole } from "@rickylabs/routing";

const catalog = routingEditorCatalog(configuration);
const jsonForFrontend = JSON.stringify(catalog);
const choice = resolveTierRole(configuration, "feature", "plan_evaluation", authorFamily);
```

The JSON-serializable catalog exports `value`/`label` choices for supported harnesses, transports,
configured routers, efforts, triggers, purposes, families, profiles, presets, roles and lanes.
It also includes the tier bindings, compatibility alias map, and all registered models, including
models that have no route yet. Model entries carry their configured label (or a readable fallback),
description, family, lowercase `searchText`, route combinations, and `availability: "unproven"`.
Search the text and group by route router and model family, as the eis-chat picker does. Model
labels are owner data and survive model-ID changes independently.

Per-model routes preserve each declared harness/router/transport/effort/profile combination.
Global lists are choices, not permission to combine every field arbitrarily. The consuming app
edits the original JSON and reloads it through `validateRoutingConfiguration` or
`parseRoutingDocument`; the catalog is a projection, not a second source of truth. Discovery
adapters may supply new registrations and labels, but must not infer family from a provider name
or treat catalog membership as proof of availability. Live discovery, persistence, authorization,
and cockpit UI remain in their owning applications.

## Tests and policy ownership

The shipped document is checked only for structure and invariants in `agnostic.test.ts` (and
package-asset loading). Model-specific behavior uses the compact fixed document under
`test-fixtures/compatibility.json`; do not synchronize it with live policy edits.
`test-fixtures/owner-matrix.json` exercises arbitrary model/family/router/effort/role choices.
Paired mutation controls break and restore every new guard, and substitution of all shipped model
and family IDs proves the invariant tests do not own model choices.

The remaining E11 provider/account discovery and fleet parity work is separate. Exporting a
configured choice does not observe a provider, apply an effort setting, or launch an agent.
