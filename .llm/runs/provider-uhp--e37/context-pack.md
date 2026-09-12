# Context pack — `provider-uhp--e37`

The one file that resumes this run cold. Written for a reader with no history.

## What this run did

Implemented `provider-uhp` — a `SubagentProvider` over the Unified Harness Protocol `2026-08-11`,
against `$HARNESSROUTER_BASE_URL` — inside `@rickylabs/subagents`, for issue
[#286](https://github.com/rickylabs/harness/issues/286) under E3
([#33](https://github.com/rickylabs/harness/issues/33)).

Baseline `origin/main` at `e8ff35f`. Branch `feat/286-provider-uhp`. Build and test green: 3,118 tests
across 12 packages, 0 fail, of which 436 are `packages/subagents` (92 added by this run).

## Where everything is

    packages/subagents/src/uhp-provider.ts        dispatch, observe, steer, stop
    packages/subagents/src/uhp-harnesses.ts       the pinned manifest and console drift (F1)
    packages/subagents/src/uhp-transport.ts       the HTTP port; the only place a credential exists
    packages/subagents/src/uhp-redact.ts          the publication boundary and its independent fence
    packages/subagents/config/harnesses.v1.json   the pinned chrn_ ids — reconciledAt is null
    packages/subagents/src/uhp-{gate,wire,mock}.ts   extended, not duplicated
    packages/subagents/README.md                  the "provider-uhp" section is the narrative

    .llm/runs/provider-uhp--e37/supervisor.md     identity, baseline, mutation surface
    .llm/runs/provider-uhp--e37/verification.md   what the mock proved, what only #294 can, the mutations
    .llm/runs/provider-uhp--e37/worklog.md        decisions, forks, one contract proposal, the timeline
    .llm/runs/provider-uhp--e37/drift.md          six recorded deviations, each with a disposition
    .llm/runs/provider-uhp--e37/mutations.mjs     the mutation campaign, runnable
    .llm/runs/provider-uhp--e37/mutations.json    its receipt

## The five things to know before changing any of it

1. **The order in `uhpRouteVerdict` is the rule, not a detail.** Contradiction is checked before absence.
   Reversing it makes the refusal branch unreachable over this transport, which is the defect that made
   the codex ladder dead code here. Its parameter type deliberately has no `status` field; do not add
   one as a convenience. Mutation M1 swaps the order and kills 13 tests.
2. **`provider-uhp` never returns `accepted`, and that is not a bug.** Three of the four route fields are
   unreportable over UHP, so a conformant response is `unknown`. Whether a lane needing no route evidence
   may proceed anyway is **open owner fork F1**; whether the vocabulary should separate "cannot name the
   run" from "cannot attest three fields" is **open owner fork F2**. Both are at their fail-closed
   default. Implementing either side of either is how the question stops being visible.
3. **The checked-in manifest is unreconciled on purpose.** `reconciledAt: null`, placeholder `chrn_` ids,
   and the ordinary drift check refusing every dispatch through it. Reconcile it by reading
   `GET /v1/harnesses` from a real deployment (#294) and setting `reconciledAt` in the same edit. Setting
   the date without doing the read is the one edit that turns a refusal into a false green.
4. **Nothing published may carry a path.** `RouteIdentityEvidence.detail` documents itself as unsafe and
   leaks `cwd` on the success branch as well as the failure branch. `redactPaths` rewrites,
   `pathShapedStrings` finds, and they do not call each other — so breaking one does not silence the
   other. If you add a verb or a detail string, route it through `publish()`.
5. **The credential is a name.** `HARNESSROUTER_API_KEY` is the profile name, resolved by the transport at
   call time. The provider never sees a token, so it cannot put one in a payload. Keep it that way rather
   than passing a token in for convenience.

## What is still open, beyond the two forks

- **#294** — the live HarnessRouter round-trip. Everything in `verification.md` §3 is unproven until it
  runs: that any router answers these shapes, that the pinned ids exist, that `background` is honoured,
  that `Idempotency-Key` prevents a double execution, that cancel behaves as Sessions §4 says.
- **S10's reading** that `provider`, `effort` and `cwd` are unobservable is owner-certified and not
  independently re-derived (PR #292, `status:impl-eval`). Every gate here is correct either way, and no
  reader was deleted — `readUhpProvider`, `readUhpEffort` and `readUhpCwd` return `null` and stay.
- **`SteerResult` cannot carry route evidence.** A substitution on a continuation is reported in prose.
  The non-breaking fix is an optional `route` field mirroring `DispatchResult`; it belongs in a slice that
  updates all five providers. `worklog.md` §4.
- **Cockpit** (`rickylabs/atelier-cockpit` #101, #102) is held on this issue for its integration,
  cancellation and continuation fixtures. The cancellation evidence they asked for by name is in
  `verification.md` §2.1: `POST /cancel` yields `stopped`, an already-terminal task yields `already-over`,
  and a 404 or `session_expired` yields `unknown` with no synthesized terminal state. Continuation
  identity is recoverable — `previous_response_id` chaining is proven against the mock — and a chain that
  comes back reporting a different `session_id` is refused rather than continued.

## How to re-run what this run claims

    pnpm run build
    TMPDIR=<an executable directory> pnpm run test
    node .llm/runs/provider-uhp--e37/mutations.mjs

The third rewrites source files in place and restores them; it refuses to attribute anything to a
mutation if the suite is not green first. `check:installed` needs an executable `TMPDIR` on this host —
a property of the host, recorded by S11 before this run and unrelated to anything in it.
