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
same parser after a bounded read and strict UTF-8 decoding.

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
Accessors, proxies, cycles, non-plain objects and reserved prototype keys are refused before
validation reads their values. Duplicate JSON keys are rejected before they can overwrite data.

## Schema version 1

[The structural schema](src/schema.ts) requires every root field below except `provenance`.
Unknown fields at any nesting level are errors; omitted optional fields never activate defaults.

| Field | Document data |
| --- | --- |
| `schemaVersion`, `name`, optional `provenance.description` | Version 1, stable name and transcription/source description |
| `families`, `models` | Family identifiers and wire model ids, each bound to a family; optional `approvedRelayEvaluator: true` |
| `efforts` | Nonempty `ordered` ladder, lowest first; optional `unordered` vocabulary |
| `purposes`, `profiles`, `presets` | Declared identifiers, with `evaluation` required among purposes |
| `lanes` | Named purposes and ordered chains containing routes, triggers, certification and declared escalations |
| `tiers` | Named implement/review lane pairs |
| `constraints`, `deepResearchLanes` | Per-lane restrictions; deep research requires an explicit native-only constraint |
| `policy.maxFallbackDepth` | Nonnegative integer fallback limit |
| `placements` | Declared backend identifiers and model/backend records, including observations and requirements |

Families cannot be the certification keywords `any` or `none`. An escalation must raise effort on
the declared ordered ladder; unordered efforts may be selected but cannot be compared for an
escalation. Model, lane, tier and placement identities cannot be duplicated. Routing treats backend
names as bounded opaque identifiers; [llm-local](../llm-local/README.md) validates the mechanism,
verdict and refusal vocabulary before the adapter is registered. An empty placement section is
legal. Membership is explicit, with a record for every participating model/declared-backend pair.

Transport kinds, fallback triggers, subscription states, certification keywords and the two seams
remain structural code. Harness/router vocabulary is owned by `subagents`. Model ids, family
bindings, efforts, tiers, route selections, profiles, presets, constraints and depth are data.
Provider/account detection and CLI version requirements are later E11 work.

## Family is a property of the model, not of the harness

`familyOf(configuration, model)` reads the document's binding and returns `null` for an unknown
model, including inherited object property names. `checkEvaluator(configuration, assignment)`
refuses the same run, unknown models, supplementary `certifies: none`, and the same family even
when the seat declares `certifies: any`. Relay evaluators additionally require explicit approval.
The [two seams](../../docs/concepts/02-the-two-seams.md) remain independent of model family.

`tierPlan(configuration, tier)` uses the implementation **primary's** configured family to resolve
its review lane. This is not generator-relative evaluator selection after fallback. `checkPolicy`
still checks every implementation step for a certification seat. #181 remains dependent on #272
and #273; configurable family names alone do not close it.

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

## Compatibility and remaining E11 work

The packaged document is named `harness-compiled-table-transcription`. It preserves 14 wire model
ids, 23 lanes, four tiers and 18 placement records from the removed table. Its provenance explains
the gap from fresh CLI matrix keys and names the baseline; it is **not a fleet-parity result**.
No new model was added as a stopgap.

Step 2 (#272) owns the fleet schema and CLI key namespace; step 3 (#273) owns generator-relative
evaluator selection; step 4 (#274) owns detection; step 5 (#275) owns executable parity. #148 and
#181 are not unblocked by this loader alone. No published contract or protocol changes here.

Tests load the compatibility asset and a disjoint synthetic document, verify wholesale replacement,
mutations, malformed data and diagnostics, and resolve the asset from an actual extracted npm
package. `check:compiled-policy` scans runtime assignments in every package and runs a mutation
self-test during the root build.
