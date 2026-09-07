# Coordinator disposition — normative plan amendment

This amendment precedes independent plan evaluation and takes precedence over the draft plan where they differ. No product code is authorized until the amended plan receives PASS. The coordinator resolves implementation choices within the owner's E11 directive; no new owner decision is pending.

## Decisions resolved

OF-1 selects A: placement data belongs to the same wholly replaced document. This follows the owner’s one-document/no-compiled-model requirement. There must be no routing dependency on llm-local (which already depends on routing). Routing owns structural placement record types and validates model references, record shape and duplicate model/backend pairs. Backend identifiers are bounded opaque strings at this structural boundary; llm-local validates supported mechanism kinds and refusal vocabulary before exposing any placement. An unsupported backend is an explicit configuration refusal at composition, never a silently dropped placement or a positive availability claim. Its existing observed refusals must carry into the transcribed default data unchanged. Placement totality must be defined by explicit configured placement membership, not inferred from model prefixes or compiled model lists. Empty placement membership is legal for a project using only vendor CLI routes. The llm-local health callers must be included in the mutation inventory.

OF-2 selects A: the loader and service require an explicit document location. The shipped profile may carry an explicit data-document setting, with documented override; it may not hide that selection inside a fallback accessor. If a portable explicit selection cannot be expressed in the current bundle, the profile must report missing configuration clearly. Do not embed an operator's absolute path in the generated patch or golden. Package file lists and asset resolution must include the shipped document and an executable check must load it from the packed layout. Private-package status does not make a missing runtime asset acceptable.

## Validation and identity corrections

- Loader failure diagnostics contain fixed error codes and structural field paths, never raw OS/JSON exceptions or arbitrary document values. Caller-provided source location belongs to explicit provenance, not a copied public error string. Longest-name truncation is not credential redaction. Tests inject credential-shaped values into malformed content and unknown keys and assert none escapes the diagnostic boundary.
- Bound document bytes, nesting depth and collection sizes before expensive validation. In-memory validation rejects accessors, cycles, non-plain objects and dangerous prototype behavior before accessing unknown properties. Clone validated input and recursively freeze the result; caller mutations and simultaneous project configurations cannot alter an admitted route or stale a cached query. No mutable global activation. Reject duplicate records and reserved family names that collide with certifies keywords.
- Do not trust a caller-supplied LoadedRoutingConfiguration digest in the dry-run boundary. Prefer a pure parseRoutingDocument entry point over bounded raw UTF-8 JSON text plus a logical source identifier. It computes the exact raw-byte digest itself, invokes the same validator and returns the immutable configuration. DryRunPlan carries this explicit document input rather than a forged loaded object; the file loader delegates to the same parser. No filesystem read occurs inside the dry-run operation. The intent key incorporates the computed identity; changing content with an asserted old digest cannot alias an existing intent.
- Existing durable records may exist outside tests. Do not assert their absence. A configuration change intentionally changes the input revision; existing pending or unknown intent must remain guarded by the store's admission/fencing rules. Add a regression proving a changed configuration cannot bypass a pending/unknown effect or trigger a resend. Preserve protocol1 and existing unknown semantics.
- Structural transport/trigger/subscription keywords interpreted by the mechanism may remain compiled; the selected subscription accounts, models, efforts, tiers, routes, CLI version requirements and policy values remain document data. This is a boundary interpretation for the evaluator to attack, not permission to retain compiled route assignments.

## Evidence and scope corrections

The coordinator has now queried the full matrix CLI export, retained as matrix-full.json at NetScript source 8ba53bc50ca02aab29e99ba5362728839b8f1713. U-3/S-3 describes the planner's earlier input limit; it is no longer missing from this run. No full parity is claimed: the CLI export still does not expose every hard rule and capability.

The default document remains a labelled transcription for compatibility, not a fleet-parity result. Configurable family identifiers may include additional families without a code change; that alone does not fix #181’s generator-relative fallback evaluation. #148 and #181 remain gated on the actual later semantics.

The regression for compiled policy must cover runtime consumer code as well as routing. Test-only fixtures and explanatory comments are distinct from executable assignments. Keep the test maintainable and prove it detects a newly introduced model/tier/effort assignment rather than checking only the old spellings.

[source: owner E11 directive and issues270/271; topic: whole replacement, data boundary and continuation authorization; consulted 2026-09-07]
[source: packages/routing, packages/llm-local and packages/dsh-app at 4c813fe; topic: dependency graph, mutable input and durable intent identity; inspected 2026-09-07]
[source: fresh NetScript matrix CLI full JSON at 8ba53bc; topic: direct fleet shape evidence; queried 2026-09-07]

Clarification: duplicate model definitions, lane identities and placement pairs are invalid. Repeated ordered route candidates are a different fact: the full CLI explicitly prints identical default/fallback candidates in a cell. Do not silently deduplicate or reject that authoritative route shape in later schema/parity steps.
