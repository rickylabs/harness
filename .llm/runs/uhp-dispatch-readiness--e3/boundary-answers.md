# Five boundary questions from the consuming side, answered

Raised by the Cockpit coordinator from draft PR `atelier-cockpit#107`, its SSE consumer, while #286
is still unwritten. Three of the five change what Harness builds. Recorded because a boundary
settled in a message is a boundary nobody can find later.

## 1. Who derives `RouteStatus` — settled, Harness owns it

`provider-uhp` surfaces `RouteIdentityEvidence` complete, with both sides and the closed
`RouteSource` provenance labels. Cockpit consumes it and derives nothing.

This is not a preference. **`RouteStatus` is the result of comparing a requested side against an
observed side, and Cockpit only ever sees the observed side.** The request never crosses the
boundary. So a Cockpit-side derivation cannot be correct even in principle: it would be
observed-only evidence wearing a comparison's name, and it would look internally consistent while
being structurally incapable of detecting a substitution.

`compareRouteIdentity` in `packages/subagents/src/route.ts` stays the single derivation.

## 2. `metadata.model_fallback`, presence or truthiness — unanswerable today, routed to S10

The F10 rule on #286 is that any response carrying `metadata.model_fallback` is never `accepted`.
Cockpit treats **presence** as the trigger, so `model_fallback: "false"` reads as `mismatch`. That
was taken fail-closed as a guess rather than as a decision, and it is the right interim.

It is also potentially self-defeating, which is why it needs the wire rather than a convention: if
the router emits the key unconditionally with a falsy value, presence-as-signal turns every run
into a mismatch and destroys the signal it exists to carry.

Added to the S10 delegate's research scope while it has the specification open, under the same rule
as its other fields: answered from a cited chapter, never from a self-authored fixture, and if the
specification is silent then presence-as-signal is the fail-closed reading to keep until a real
router can be observed.

## 3. The three D11.2 items — all confirmed necessary, and #287 did not cover them

Verified directly against `packages/contracts/src/repository-run-observation.ts` on `main`.

#287's scope says `RunSource` remains unchanged. That is true, and it does not answer the question,
because **`ObservedRepositoryRun.source` is a different field and is the bare literal `"codex"`**.
Two more literals close the same door: `verification.basis` has exactly one value,
`"enrollment-and-local-worktree"`, and `execution.status` offers no in-flight state.

The union makes them jointly binding rather than separately annoying. The `coverage: "read"` arm
requires the `enrollment-and-local-worktree` basis together with a non-null `run`; the other arm
forces both to null. **So fixing two of the three yields exactly nothing.** #287 was amended with
all three plus the requirement that they land together.

Cockpit's current behaviour is correct and must not be worked around. Returning coverage-only for
UHP runs, with `scope-unverified` or `identity-mismatch`, is better than a `read` claim carrying a
local-worktree basis for a session that ran in a container on another host. That would be a false
provenance claim inside a published contract.

## 4. Stop verdict and `budget` detail shape — does not exist, and was not invented

It lands in #287, which is `status:triage` behind S10. Cockpit gets the concrete shape when that
issue is written. The only thing promised so far, and still honoured, is that it rides on the
versioned observation resource rather than becoming a new `RunView` field.

## 5. Metadata keys for `effort`, `provider`, `cwd` — S10 deliverable 1

Unknown until S10 reports, and it will be the first thing relayed.

**One gap flagged in the meantime.** Cockpit's `wire.ts` reads `metadata.effort`, `.provider` and
`.harness`. `ROUTE_FIELDS` is `provider`, `model`, `effort`, `cwd`. So `harness` and `cwd` are not
the same field, and **`model` has no reader on the Cockpit side at all** — which is precisely the
F10 substitution case going unobserved. Raised for them to confirm whether that is deliberate
before S10 lands keys.

## Two things taken from the other direction

**A design idea worth more than the answers above.** Cockpit's freshness function takes no status
argument at all. Rather than documenting the invariant that `LivenessState` must never be mapped
from a UHP status, the signature makes it unexpressible: lifecycle frames contribute no freshness
evidence, only deltas and output items do. A comment asking nobody to break an invariant is a
weaker guarantee than a parameter list that cannot express the violation. This generalises well
past `LivenessState` and is worth applying here.

**A runner warning, checked and answered.** Cockpit found that its generated `quality-runner.ts`
excludes `packages/` from `SOURCE_ROOTS`, so a new package is silently unchecked and reports green
because nothing looked at it.

This repository does not have that exclusion: `build`, `typecheck` and `test` are all `pnpm -r` and
sweep every workspace package. It has the same hole in a different shape. **`pnpm -r run test`
silently skips any package that does not declare a `test` script, and three do not:
`@rickylabs/governance`, `@rickylabs/netscript-bridge` and `@rickylabs/provider-acp`.** They are
stubs, so it is benign today and will bite silently the moment one gains behaviour. Same class as
the rest of today's list: green because nothing looked.

[observed — repository-run-observation.ts literals and the RepositoryRunObservation union read on
 main; per-package `test` script census across packages/*/package.json; 2026-09-12]
[source — five questions and the freshness-signature idea from the Cockpit coordinator, draft PR
 atelier-cockpit#107, 2026-09-12]
