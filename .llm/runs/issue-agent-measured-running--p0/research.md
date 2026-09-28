# Research — issue-agent-measured-running--p0

## Summary

The public tree has a `running` state, but the producer never supplies a measured running observation. The native rollout parser already distinguishes `task_started` from terminal events. An exact read-only Codex goal query can establish an active root independently of transcript recency.

## Sources

- `packages/telemetry/src/agent-observations.ts:61,94` sets root and child `running` to unavailable.
- `packages/telemetry/src/issue-agent-feed.ts:56-64` maps terminal native outcomes to ended and a true observed running value to running; otherwise unknown.
- `packages/telemetry/src/backfill/codex.ts:224-230` derives native outcome from task event order, and `packages/telemetry/src/model.ts` defines the recovered `RunRecord` timestamps and outcome.
- `packages/telemetry/src/issue-agent-feed-cli.ts:28-77` bounds issue groups, receipt windows and transcript bytes, then builds per-issue trees.
- `packages/telemetry/src/codex-thread-connection.ts` allows exact `thread/goal/get` through a bounded read-only JSONL transport; `packages/telemetry/src/codex-thread-project.ts:23-35` validates goal thread ID and status.
- `packages/contracts/src/agent-observations.ts:15-24,138-157` requires a measured value's observed time and revision; a freshness deadline must remain valid at capture.
- Private run evidence in the coordinator's 23:33 UTC decision and #381/#392 report: one fresh proof showed a transient unknown after ended, and native goal was non-null while route budget was unset. Private IDs and paths stay in private brief files.
- The [Codex goals guide](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) says a goal can remain `active` while a thread is idle. A goal state therefore cannot establish live execution. The [Codex state implementation](https://github.com/openai/codex/blob/main/codex-rs/state/src/runtime/goals.rs) establishes the work-stopping budget behavior for the separate private budget recommendation.

## Integration uncertainty

The native parser's `updatedAt` is the last recognized event timestamp, not an operating-system process check. A crash without a terminal event can leave `running` displayed for at most 120 seconds; then the observation expires. The live #393 proof found another integration gap: Orchid's receipt had the route-default budget but never acquired a native session binding, so the public feed remained `ancestry_unavailable` even after the agent's comment. The dispatcher owns that binding writer; this telemetry PR cannot fabricate ancestry.
