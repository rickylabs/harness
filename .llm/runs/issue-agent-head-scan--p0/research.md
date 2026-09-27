# Issue agent head scan — research

The coordinator's 2026-09-27 22:50 UTC runtime report found all four issues `scan_limit` in 2 seconds. Three unrelated same-day seat rollouts were 15.8, 23.3 and 17.6 MiB; #387's matching pair was 0.5/0.1 MiB. The matching filenames use local UTC+2 clock time (23:26) for a 21:26 UTC receipt. This is runtime evidence supplied for this run, not a synthetic test result.

`packages/telemetry/src/backfill/index.ts:151-209` currently enumerates UTC day directories and parses filename clocks as UTC; `:237-291` applies full-file size caps before knowing whether a rollout belongs to the issue. `packages/telemetry/src/orchid-native-binding.ts:12-68` keeps the exact Codex root credential private in a WeakMap. `packages/telemetry/src/backfill/codex.ts:166-190` reads the first `session_meta` line's id and optional parent id. The issue feed passes all window files to backfill (`packages/telemetry/src/issue-agent-feed-cli.ts:51-70`).
