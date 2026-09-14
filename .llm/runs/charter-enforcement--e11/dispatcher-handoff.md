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
a controlled real issue launch execute. Evaluation requests used the existing dispatcher. None exercised a new matrix hook or proves deployed integration.

## Bridge boundary found during implementation follow-up

The public docs search did not locate a routing-policy operation; it returned web-routing pages.
The inspected `runtime/cli/routing-state.ts` is a persisted-state reader, not a launch resolver.
The existing first-party `resolveWorkloadRoute` remains the concrete authority to call in place:
[routing-policy.ts:90–113,190–216](https://github.com/rickylabs/netscript/blob/f3324909e0896cedc9729005bac5f508e122d6c6/.llm/tools/agentic/runtime/routing-policy.ts#L90).
It returns logical/physical model, family, transport and both requested/concrete effort, and requires
the actual generator model for evaluation. Do not transcribe those mappings into Go or Harness.
A reviewed process bridge may invoke it against the same source revision as the fresh matrix CLI;
the current table output alone lacks that launch envelope. No bridge implementation is claimed.

The input is a typed TypeScript interface, not a validated untrusted JSON API. Its privileged guard
checks rationale at runtime; the `authorizer` union is a compile-time restriction:
[delegation-matrix.ts:260–276](https://github.com/rickylabs/netscript/blob/f3324909e0896cedc9729005bac5f508e122d6c6/.llm/tools/agentic/runtime/delegation-matrix.ts#L260).
A read-only synthetic probe on that revision refused missing authorization but accepted an untyped
invalid authorizer with a rationale. No agent was spawned. Preserve the resolver; validate the
bridge input against its declared type and trusted provenance before calling it. An arbitrary
`authorizer` string copied from issue text is not a trusted owner/coordinator request.

The dispatch `Issue` structure currently retains only number, title, body and labels, and its query
does not fetch the author or an authorization receipt:
[main.go:926–969](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/main.go#L926).
The assignment feeder separately fetches an author, then embeds it in mirrored prose; that prose
is not an authority receipt. A bridge lacking trusted privileged provenance must refuse that spawn,
not synthesize owner authority from the bot identity. This is an integration requirement, not a
change to the locked I3 invariant.
