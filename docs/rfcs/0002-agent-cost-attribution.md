# RFC 0002: Agent cost attribution from native telemetry

- Status: implemented in this slice; pending review and deployment
- Date: 2026-09-15
- Scope: three existing AgentCost rows on root and child observations
- Evidence snapshot: Harness `e118ff9dcf1631ed7a3c7e0e3daefd793b67ea0a`; NetScript `f3324909e0896cedc9729005bac5f508e122d6c6`
- Delivery tracking: [#377](https://github.com/rickylabs/harness/issues/377); [ancestry evidence #376](https://github.com/rickylabs/harness/pull/376)

## Claim labels

**CURRENT** means inspected source, not deployed behavior. **CITED** names an external authority.
**PLANNED** names outstanding work. **MEASURED** refers to executed receipts in the linked run.

## Summary

**CURRENT.** [The projector](../../packages/telemetry/src/agent-cost.ts) binds existing native usage and
quota observations to three permanently separate rows. It collects no data and assigns no prices.
The existing `dsh-telemetry runs --json` / `agentObservations` surface and exported decoder retain
schema 1, protocol 1. No matching cockpit contract change is needed.

**CITED.** [Charter section 9](../../ARCHITECTURE.md#9-cost) requires subscription headroom, metered
spend and run tokens as separate truths. [The task](https://github.com/rickylabs/harness/issues/377)
requires unknown and zero to remain distinct.

## Context and current state

**CURRENT.** [RunRecord](../../packages/telemetry/src/model.ts) already carries optional usage fields
and an array of account-window readings. [Codex backfill](../../packages/telemetry/src/backfill/codex.ts)
assigns cumulative native token totals rather than summing repeated totals. [OpenCode backfill](../../packages/telemetry/src/backfill/opencode.ts)
reads reported currency from the native store. None of these sources licenses an inferred subscription price.

**CURRENT.** Previously both root and child observation constructors called `unavailableAgentCost()`.
[The observation builder](../../packages/telemetry/src/agent-observations.ts) now calls one shared
projector only after the existing identity, duplicate and completeness fences. Dispatch-only rows
retain their existing three unavailable rows and `source_not_bound` reason.

## Attribution: exactly which run belongs to an agent

**CURRENT.** A root requires the existing dispatcher-confirmed assignment plus an exact same-source
native identity binding. A child requires an explicit native parent chain to that root. Native
identifiers remain private; public agent and assignment identities keep their existing opaque form.
The cost projector receives that exact RunRecord, not an issue-number match or a time-correlated run.

**CURRENT.** A public child represents one native thread; a dispatched root represents its one bound
thread. More than one native record for the same source and identity, or multiple dispatches claiming
one native root, retain the existing `ancestry_unavailable` collection refusal. Shared-run totals are
not divided among agents. The current source does not establish turn-level allocations among several
workers inside one thread; such a breakdown is not claimed. It cannot identify an undisclosed worker.

**CURRENT.** Separate dispatches on the same issue remain separate agent rows. An agent resumed in
one native thread uses that thread's reported cumulative counters once. Distinct native threads are
not combined into one persistent agent; there is no evidence in this contract that several native
runs are one agent. No parent-plus-child sums, per-issue sums, prorating or convenient attribution.

## Meaning of each row

**CURRENT.** `runTokens` copies only present input, output, reasoning, cache-read and cache-write
components. These can overlap, so there is no invented total. Counts must be finite, nonnegative safe
integers. Missing components remain absent; an empty usage object produces `measurement_missing`.
An invalid component makes only the token row unavailable with `binding_invalid`.

**CURRENT.** `meteredSpend` copies only a finite nonnegative `usage.costUsd` as reported USD. Reported
zero is available zero; absent cost is `measurement_missing`. Accounting is `reported`, not an invoice
verification or attribution of account-wide spend. Tokens, quota, credit balance and plan name never
produce currency. Invalid currency data does not discard a valid token or headroom row.

**CURRENT.** `subscriptionHeadroom` is the subscription window observed by this run, scoped
`subscription_account`, not that agent's consumption. The latest timestamp batch in `run.quota` is
selected; older windows are never carried forward into a newer batch, and different runs are never
pooled. The existing source field `dsh-telemetry.governance.usage` identifies this quota evidence class;
this implementation binds the account readings already carried by native telemetry rather than a
new governance collector.

**CURRENT.** The latest batch must have same-source readings, known percentages within 0–100,
positive integer window lengths, and valid reset times after the observation. Conflicting readings
for the same limit and duration at one timestamp are `binding_invalid`. With multiple reported windows,
the row displays the most constrained window, deterministically. It does not assert that unreported
windows do not exist. No global subscription account identity is available; the row cannot be named,
deduplicated or summed across agents as an account census.

## Time, validity and revisions

**CURRENT.** Token and spend rows use native `updatedAt` as the source-record timestamp, not the time
of every component's last update. These historical cumulative reports have no fabricated expiration.
Malformed or future source time makes these two rows `binding_invalid`. An invalid child-level time
continues to fail the existing whole-collection decoder; a child is never silently dropped to complete a tree.

**CURRENT.** Headroom is explicitly **last reported as of its observation time**, not a guarantee of
the live balance. `validUntil` is the earliest reset in the selected batch; the measurement retains the
chosen window's own reset. Any expired window makes the batch `source_stale` with null measurement.
The projector does not refill it to 100 percent or ignore an expired limiting window. A reset deadline
is not a freshness SLA: other account activity may change headroom before that deadline. Consumers
must display the source time and must not use this historical projection for dispatch admission.

**CURRENT.** Fixed row literals and an ordered component whitelist make revisions independent of
input property order. Row revisions include public measurements and their times. Agent revisions
include the projected cost, so a measurement correction with unchanged timestamps changes both agent
and collection revisions. Private identities, credit balances and operator paths never enter cost output.

## Consequences

**CURRENT.** Real usage can populate budget rows without changing ancestry, route, location or liveness
claims. Unknown is not zero. A known native usage value does not repair a missing issue-to-native binding.
Read the whole collection through `readAgentObservations` before filtering; the complete-tree fence stays.

**MEASURED.** The [run receipts](../../.llm/runs/agent-cost--bindings/validation.md) record tests,
guard mutations, independent review and bounded live reads. Live values remain private; only availability,
closed reasons and comparison predicates are published. A pure projection check is distinguished from
a successful deployed per-issue read.

## Revisit triggers

**PLANNED.** Revisit when native sources identify account switches within one observation batch,
provide an account identity safe for public aggregation, distinguish several workers sharing one
native thread, or bind several native threads to one persistent agent. Those changes need explicit
attribution evidence; this slice does not guess them. A live headroom SLA needs an authoritative
freshness policy and account feed, not a longer guessed expiry.
