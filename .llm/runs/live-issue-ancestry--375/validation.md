# Live issue ancestry — INCONCLUSIVE

The one real matrix dispatch succeeded. The per-issue native ancestry proof did not:
`ancestry_unavailable`, **one root row, zero resolved child rows, depth zero**.
The canonical collection decoded successfully and retained `complete:false`.

## The missing evidence

The fresh dispatch receipt for [issue 375](https://github.com/rickylabs/harness/issues/375)
is `dispatched` but still has no `NativeSessionID`. A read of the exact registered proof
agent through `herdr agent get` also has **no `agent_session` field**, both while working
and after completion. It is interactive-ready and its final terminal status is `done`.
This establishes a missing upstream identity observation, not a permission to infer one.

The root reported that its one native child answered with the three cost-row names.
That report is an execution report, not an authoritative dispatch/native join. No native
parent pair is assigned to this issue by timestamps, terminal text or transcript prose.
No synthetic assignment or receipt was used. The other accessible receipt, for issue 368,
also remains unbound; the complete receipt scan has two dispatch records.

## What the existing consumer actually returns for issue 375

| Row | Workspace | Pane | Parent | Running in consumer |
| --- | --- | --- | --- | --- |
| Root | `w1F` | `w1F:p1` | unavailable, `identity_unavailable` | unknown, `observer-unavailable` |

| Route field | Requested | Observed |
| --- | --- | --- |
| provider (router) | `openai` | null |
| model | `gpt-5.6-luna` | null |
| effort | `max` | null |
| cwd | null | null |

Route status is `unknown`. Requested values are not proof of the provider/model/effort
actually used by an API request. Workspace and pane are public terminal references, not
operator locations. Tab and terminal fields remain unavailable with `source_not_bound`.

| Cost row | Unit | Availability | Measurement | Reason |
| --- | --- | --- | --- | --- |
| subscriptionHeadroom | percent_remaining | unavailable | null | source_not_bound |
| meteredSpend | currency | unavailable | null | source_not_bound |
| runTokens | tokens | unavailable | null | source_not_bound |

No cost was blended or imputed. [observation.json](observation.json) contains only the
redacted result and canonical public row fields, projected **after** the full collection
passed `readAgentObservations`. It is evidence, not a replacement consumer contract.
[terminal.json](terminal.json) is a separate supplemental terminal read; it does not
upgrade the consumer's unknown running field.

## Commands and results

All source/build evidence uses a fresh owned Harness clone at
`7c4e4db70a6dd00075353158e2d5e83e48564f92`. Private locations and the terminal lookup label
were supplied privately and are redacted in command forms below. No raw legacy native-run
output, receipt content or native identity is published.

    deno task agentic:matrix --tier simple --role implementation --json
    exit 0
    output: matrix.json contains the literal parsed query result and Orchid resolver output

    gh issue edit 375 --repo rickylabs/harness --add-label harness
    exit 0

The trigger was applied once, after naming the issue and lane to the owner and verifying
the complete issue body via `gh issue view`. No other issue was labelled or relabelled.

    pnpm --filter @rickylabs/telemetry run build
    exit 0

    node packages/telemetry/dist/cli.js runs --json --limit 50 --since 2026-09-15T12:25:13.439Z --home <private-configured-home>
    exit 3
    readAgentObservations: ok true
    complete: false
    reason: ancestry_unavailable
    issue 375 rows: 1
    resolved children: 0
    depth: 0

The query uses the existing configured receipt store and native store. The existing
`--since` bound selects recent activity, never a native identity. The collection's
incompleteness and consumer exit 3 are preserved; no complete native-store census is claimed.

    herdr agent get <private-proof-agent-label>
    exit 0
    interactive_ready: true
    agent_status: done
    agent_session field present: false

    gh issue edit 375 --repo rickylabs/harness --remove-label harness
    exit 0

The proof agent had finished before its trigger was cleared. The coordinator made no
restart, native-store edit, receipt write, synthetic assignment, second label application
or additional dispatch. The native identity source must supply an authoritative session
identifier to the existing writer before a later real issue can meet ancestry acceptance.

[Root completion report](https://github.com/rickylabs/harness/issues/375#issuecomment-5680176819) — not a substitute for native linkage.

## Telemetry-side follow-up: real native pair and budget data confirmed

The coordinator requested an identity-based telemetry check after the first evidence PR
was opened. The same already-dispatched proof agent performed one additional read in its
native tool environment. It wrote its own `CODEX_THREAD_ID` into a private 0600 diagnostic
handoff within a 0700 directory. The identifier was never printed, committed, supplied in
argv, or written into the dispatch store. No further agent or child was spawned.

An exact same-source identity lookup found **one telemetry root and one native child**.
The child's actual `parentId` equals that root's native identity: two observed telemetry
rows, depth one. Both runs record outcome `complete`, provider `openai`, model
`gpt-5.6-luna`, and effort `max`. The root's native parent is null, correctly.

| Telemetry row | Native parent linkage | Nonzero usage values | Quota observations with known percent, window and reset |
| --- | --- | --- | --- |
| Root | null | input, output, reasoning and cache-read tokens | 12 |
| Child | points exactly at the identified root | input, output, reasoning and cache-read tokens | 2 |

These are counts of quota observations, not distinct quota windows, and provider quota is
not one run's spend. No currency cost was supplied by these run usage objects. Actual
usage and quota values stay private; value availability was checked, not just key presence.
The bounded scan is incomplete, so this establishes the real pair, not a full-store census.

[telemetry-join.json](telemetry-join.json) records the redacted checks. The identity lookup
uses existing `backfillFromDisk` readers, compares the root ID exactly, and follows only
native `parentId` edges. No diagnostic identity was inserted into `DispatchEvidence`, no
assignment was synthesised, and no receipt or native store was changed.

**The two persisted sources still cannot provide the current consumer's per-issue tree.**
The exact missing join field is `NativeSessionID` in Orchid's private dispatch binding.
Telemetry already has the identified root, native child, parent edge, usage and quota.
The live `herdr agent get` response lacks the upstream `agent_session` source expected by
the writer. This proof does not establish why that field is unavailable.

There is a separate projection gap for real budget values: the current
[agent-observation builder](https://github.com/rickylabs/harness/blob/7c4e4db70a6dd00075353158e2d5e83e48564f92/packages/telemetry/src/agent-observations.ts#L60)
uses `unavailableAgentCost()` for both root and child rows (also line 85). The measurements
exist in telemetry, but they are not mapped into the three agent cost rows yet. Persisting
the native identity alone will not change that behavior. Keep subscription headroom,
metered currency spend and run tokens separate when those bindings are implemented.

Final consumer verdict remains `INCONCLUSIVE`, `ancestry_unavailable`: one issue row,
`complete:false`. No alpha PASS is claimed. The findings were reported to the coordinator
before this existing PR was updated; no additional PR or issue was opened.

## Evidence publication correction

This is historical evidence, not a runtime input or product delivery. The bounded read is not a complete fleet census. Per-row observation timestamps, validity and revisions were removed from the redacted data artifact after the snapshot-publication guard refused them. The test verdict and native pair findings stand; consumers must never use these artifacts as current availability.

## Evidence publication correction

This is historical evidence, not a runtime input or product delivery. The bounded read is not a complete fleet census. Per-row observation timestamps, validity and revisions were removed from the redacted data artifact after the snapshot-publication guard refused them. The test verdict and native pair findings stand; consumers must never use these artifacts as current availability.
