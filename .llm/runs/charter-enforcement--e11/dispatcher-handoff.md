# Before-spawn handoff — draft, unproven integration

The enforcing seam is divybot's `Coord.spawn`, but admission also chooses an account before
calling it. Resolution must feed both choices. No dispatcher source or deployment changed.

Source inspected: [rickylabs/orchid at d344bd0](https://github.com/rickylabs/orchid/tree/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot).
The inspected `main.go` has one call to `c.spawn` (line 2112), one `Coord.spawn` definition
(line 2479), and one call to `host.spawnAgent` (line 2605). `overrides.go:119` builds commands.
This is the reached source inventory, not evidence about a deployed binary or other branches.

## Required order

1. Parse tier, role, profile and explicit overrides from the complete issue brief. The current
   parser does not declare tier, role or privileged authorization fields. A profile's routing
   restrictions must survive free-mode overrides. Reject unsupported profile/route metadata;
   never silently use the default transport.
2. Execute the authoritative matrix CLI afresh for this attempt. Keep source revision and a
   digest of the returned resolution. Missing command, malformed/empty JSON, unsupported shape
   or empty role cell prevent admission. Do not use an export cached from an earlier spawn.
3. Preserve NetScript's privileged-tier authorization check. Its actual resolver is
   `routing-policy.ts:190–215`; the table-printing CLI does not itself establish authorization.
   A named authorizer plus rationale must originate from trusted owner/coordinator provenance,
   not an arbitrary string in an untrusted issue. An override cannot waive that check.
4. Map the selected logical route through authoritative transport/model configuration, then
   check physical launchability. No guessed model aliases, fallback siblings, or entitlement
   inferred from an installed binary. Issue 321 owns a measured example of this failure.
5. Select capacity/account and host for that resolved transport. Current admission reads only
   the harness override at `main.go:2099` and `Coord.spawn` selects its host before parsing
   overrides. Refactor both through the same immutable resolution for this attempt.
6. For an evaluator, assert different family and session against the generator actually used,
   including after fallback. The existing NetScript assertion at `routing-policy.ts:228` is
   the authority to preserve, not a duplicated policy table.
7. Persist the private resolution/request receipt before the spawn effect. If persistence
   fails, do not launch. Invoke the existing `buildAgentCmd` and `host.spawnAgent` path.
8. Add observed model, effort, transport, role and tier from launcher/control-plane evidence.
   Keep unknown values explicit, with their reason. Brief prose is not observed effort.
   A failed observation leaves the run unproven; it cannot backfill requested values as fact.

## Acceptance matrix

| Entry / failure | Required evidence |
| --- | --- |
| Initial issue, mirrored comment, continuation, retry | Each reaches the same resolver before capacity selection and spawn; one fresh resolution per attempt |
| Resolver unavailable, malformed JSON, empty result | Spy spawn count zero; explicit failure, no default-model fallback |
| Privileged request without trusted authority | Spy spawn count zero, even with explicit model override |
| Resolved but unsupported physical model | Spy spawn count zero; logical model and refusing launcher identified in private diagnostic |
| Generator fallback changes family | Evaluator recomputed against actual generator; same-family/session refused |
| Receipt storage unavailable | Spy spawn count zero |
| Observation unavailable or effort only injected as prose | Receipt valid structurally but invariant unproven |
| Controlled real dispatch | Private resolution plus independent launcher observation; sanitized public verdict only |

The local receipt checker will prove only schema/verdict behavior. All-launcher enforcement,
receipt-to-spawn completeness and deployed reachability remain unproven until these tests and
a controlled real issue launch execute. No dispatch-trigger label was applied in this work.
