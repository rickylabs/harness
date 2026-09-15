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
