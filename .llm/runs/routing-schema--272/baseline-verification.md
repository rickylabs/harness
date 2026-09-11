# Resumed routing baseline verification

The existing routing suite passed on source commit1d5df95 before any schema-v2 implementation.
This is baseline evidence only; it does not pass the proposed schema or its plan.

Command: `pnpm --filter @rickylabs/routing test`.
Observed exit0, tests205, suites35, pass205, fail0, cancelled0, skipped0, todo0.
The command compiles through `tsc -b` before running the emitted tests.
Runtime: Node26.8.1, pnpm11.25.0. No broader workspace or new-schema tests ran for this checkpoint.

The board checker also reported no anomalies after the independent FAIL_FIX was recorded
and issue272 moved back to plan for repair. Four findings remain unapproved pending repaired
plan evaluation; this passing baseline cannot waive them.

[source — routing test command on1d5df95, current baseline compilation and205tests; executed2026-09-08]
[source — dsh-board check --repo rickylabs/harness --lane-prefix topic, post-phase consistency; executed2026-09-08]
