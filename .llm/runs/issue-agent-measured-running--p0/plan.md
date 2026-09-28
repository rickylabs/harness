# Plan — issue-agent-measured-running--p0

## Summary

Measure root and child running from a native active task with a recent transcript event. Keep native terminal outcomes authoritative. A missing, expired, or contradictory signal stays unknown. Ship a small reviewed telemetry PR; live proof remains an integration gate.

## Decisions

1. For each dispatcher-bound native root and proven native child, accept `RunRecord.outcome === running` with an event timestamp no more than 105 seconds before snapshot capture. The parser sets this outcome from `task_started` and clears it on terminal events (`packages/telemetry/src/backfill/codex.ts:224-230`). Reject future timestamps. Set the observation's `validUntil` to event time plus 120 seconds and require it to be at least the snapshot's 15-second `validUntil`; this bounds a false running state after abrupt exit to two minutes even for consumers that display the frame until expiry. The 105-second capture window covers the coordinator's 90-second foreground hold.
2. Terminal native `complete` or `failed` wins over any stale running observation. Newer `task_started` changes the parsed outcome back to running; recency then immediately restores running, eliminating the observed unknown flip where evidence exists. Never claim an end time from last activity.
3. Keep schema/protocol 1; public `running` and `liveness` already represent this fact. No app-server query is added to the feed. `validUntil` is the event timestamp plus 120 seconds, and an available value must remain valid at snapshot capture.
4. The public snapshot decoder must reject a `liveness.state=running` row unless its validated observation has `running.value=true`, the same `observedAt` as liveness, and `running.validUntil` at least the enclosing frame's `validUntil`. This closes the independent review's concrete frame-expiry counterexample. Tighten decoder semantics in a 0.5.3 patch release; schema/protocol remain 1. A completed/failed native outcome still ends the producer row and does not need a running leaf.

## Owner forks and spikes

Coordinator explicitly requested goal-active or bounded native recency in the 23:33 UTC decision. The reviewer identified that goal `active` can outlive a running turn, so native task plus recent event is the stronger signal. The 120-second window is a product tradeoff: it can briefly overstate running after an abrupt exit, but it covers the requested 90-second proof hold and then expires. Integration spike S1: capture the new proof against the live home before claiming the running acceptance; no live dispatch or config edit in this PR.

## Dependency DAG and gates

Research → independent Stage F review → Stage G PASS → pure observation projection → tests → deliberate red mutation of recency/terminal/ancestry conditions → independent implementation review. The review found decoder gap D1, so a fresh F/G gate on the expanded contract surface precedes contract mutation. Then add decoder cross-check and negative contract test, mutation-control the check, rerun Node 24 telemetry/contracts suites and full build, privacy scan, ready PR. Coordinator applies budget table, merges PR, and triggers a fresh proof before #381 can close.

## Risks

- Wrong native run binds to issue: retain exact dispatch-root and parent-chain binding, negative test.
- Stale task falsely remains running: 105-second capture cutoff and 120-second effective expiry through frame validity, future-time rejection, negative tests.
- Terminal run appears running: terminal precedence and multi-turn mutation test.
- Private native identity leaks: canary snapshot test and diff/PR leak scan.
- Public consumer accepts expired or fabricated running leaves: decoder cross-checks running value/time/frame expiry and negative test.

Plan lock: 2026-09-27 23:40 UTC. The review-driven amendment is recorded in `drift.md`.
